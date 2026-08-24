// Preconfigured storage helpers for Manus WebDev templates.
// Uses the Biz-provided storage proxy (Authorization: Bearer <token>).

import { ENV, getJwtSecret } from "./_core/env";
import { createHmac, timingSafeEqual } from "node:crypto";

type StorageConfig = { baseUrl: string; apiKey: string };

export type StorageDeleteFailure = {
  key: string;
  error: Error;
};

export type ValidationStorageToken = {
  shareToken: string;
  projectId: number;
  documentId: number;
  expiresAt: number;
};

const VALIDATION_STORAGE_TOKEN_TTL_MS = 5 * 60 * 1000;
const STORAGE_REQUEST_TIMEOUT_MS = 30_000;

function getStorageConfig(): StorageConfig {
  const baseUrl = ENV.forgeApiUrl;
  const apiKey = ENV.forgeApiKey;

  if (!baseUrl || !apiKey) {
    throw new Error(
      "Storage proxy credentials missing: set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY"
    );
  }

  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

/**
 * Normalize a storage key while rejecting traversal and ambiguous separators.
 * User-controlled filenames are allowed, but they cannot change the intended
 * project prefix.
 */
export function normalizeStorageKey(relKey: string): string {
  const key = relKey.replace(/^\/+/, "");
  if (!key || key.length > 2048 || key.includes("\0") || key.includes("\\")) {
    throw new Error("Invalid storage key");
  }

  const segments = key.split("/");
  for (const segment of segments) {
    if (!segment) throw new Error("Invalid storage key");
    let decoded = segment;
    // Decode repeatedly so double-encoded separators cannot become traversal
    // after another layer of URL parsing in the storage service.
    for (let pass = 0; pass < 3; pass++) {
      try {
        const next = decodeURIComponent(decoded);
        if (next === decoded) break;
        decoded = next;
      } catch {
        // A literal percent sign is valid in an object name. URLSearchParams
        // will encode it safely before the key reaches the storage service.
        break;
      }
    }
    if (
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\")
    ) {
      throw new Error("Invalid storage key");
    }
  }

  return segments.join("/");
}

export function isProjectStorageKey(key: string, projectId: number): boolean {
  try {
    return normalizeStorageKey(key).startsWith(`projects/${projectId}/`);
  } catch {
    return false;
  }
}

function buildStorageUrl(
  baseUrl: string,
  endpoint: string,
  relKey: string
): URL {
  const url = new URL(endpoint, ensureTrailingSlash(baseUrl));
  url.searchParams.set("path", normalizeStorageKey(relKey));
  return url;
}

function buildAuthHeaders(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}` };
}

async function readUrlResponse(
  response: Response,
  operation: string
): Promise<string> {
  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(
      `Storage ${operation} failed (${response.status} ${response.statusText}): ${message}`
    );
  }

  const body = (await response.json().catch(() => null)) as {
    url?: unknown;
  } | null;
  if (!body || typeof body.url !== "string") {
    throw new Error(`Storage ${operation} returned no URL`);
  }

  let parsed: URL;
  try {
    parsed = new URL(body.url);
  } catch {
    throw new Error(`Storage ${operation} returned an invalid URL`);
  }
  const allowsLocalHttp = !ENV.isProduction && parsed.protocol === "http:";
  if (parsed.protocol !== "https:" && !allowsLocalHttp) {
    throw new Error(`Storage ${operation} returned an unsafe URL`);
  }
  return parsed.toString();
}

function toFormData(
  data: Buffer | Uint8Array | string,
  contentType: string,
  fileName: string
): FormData {
  const blob =
    typeof data === "string"
      ? new Blob([data], { type: contentType })
      : new Blob([data as any], { type: contentType });
  const form = new FormData();
  form.append("file", blob, fileName || "file");
  return form;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const { baseUrl, apiKey } = getStorageConfig();
  const key = normalizeStorageKey(relKey);
  const uploadUrl = buildStorageUrl(baseUrl, "v1/storage/upload", key);
  const formData = toFormData(data, contentType, key.split("/").pop() ?? key);
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: buildAuthHeaders(apiKey),
    body: formData,
    signal: AbortSignal.timeout(STORAGE_REQUEST_TIMEOUT_MS),
  });

  return { key, url: await readUrlResponse(response, "upload") };
}

export async function storageGet(
  relKey: string
): Promise<{ key: string; url: string }> {
  const { baseUrl, apiKey } = getStorageConfig();
  const key = normalizeStorageKey(relKey);
  const downloadApiUrl = buildStorageUrl(
    baseUrl,
    "v1/storage/downloadUrl",
    key
  );
  const response = await fetch(downloadApiUrl, {
    method: "GET",
    headers: buildAuthHeaders(apiKey),
    signal: AbortSignal.timeout(STORAGE_REQUEST_TIMEOUT_MS),
  });
  return { key, url: await readUrlResponse(response, "download") };
}

/** Delete an object. A missing object is already in the desired state. */
export async function storageDelete(relKey: string): Promise<{ key: string }> {
  const { baseUrl, apiKey } = getStorageConfig();
  const key = normalizeStorageKey(relKey);
  const deleteUrl = buildStorageUrl(baseUrl, "v1/storage/delete", key);
  const response = await fetch(deleteUrl, {
    method: "DELETE",
    headers: buildAuthHeaders(apiKey),
    signal: AbortSignal.timeout(STORAGE_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok && response.status !== 404) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(
      `Storage deletion failed (${response.status} ${response.statusText}): ${message}`
    );
  }
  return { key };
}

/** Delete objects with bounded concurrency and report every failed key. */
export async function storageDeleteMany(
  relKeys: string[],
  concurrency = 5
): Promise<{ deleted: string[]; failures: StorageDeleteFailure[] }> {
  const keys = Array.from(new Set(relKeys));
  const deleted: string[] = [];
  const failures: StorageDeleteFailure[] = [];
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, concurrency), keys.length);

  const worker = async () => {
    while (cursor < keys.length) {
      const key = keys[cursor++];
      try {
        await storageDelete(key);
        deleted.push(key);
      } catch (error) {
        failures.push({
          key,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return { deleted, failures };
}

export function documentAccessUrl(
  projectId: number,
  documentId: number
): string {
  return `/api/storage/projects/${projectId}/documents/${documentId}`;
}

export function onboardingSampleAccessUrl(
  projectId: number,
  sampleId: number
): string {
  return `/api/storage/projects/${projectId}/samples/${sampleId}`;
}

function validationStorageSecret(): Uint8Array {
  return getJwtSecret();
}

function validationStorageSignature(payload: string): string {
  return createHmac("sha256", validationStorageSecret())
    .update(payload)
    .digest("base64url");
}

export function validationDocumentAccessUrl(
  shareToken: string,
  projectId: number,
  documentId: number,
  now = Date.now()
): string {
  const payload = Buffer.from(
    JSON.stringify({
      shareToken,
      projectId,
      documentId,
      expiresAt: now + VALIDATION_STORAGE_TOKEN_TTL_MS,
    } satisfies ValidationStorageToken)
  ).toString("base64url");
  const token = `${payload}.${validationStorageSignature(payload)}`;
  return `/api/storage/validation/${encodeURIComponent(token)}`;
}

export function verifyValidationStorageToken(
  token: string,
  now = Date.now()
): ValidationStorageToken | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;

  const expected = Buffer.from(validationStorageSignature(payload));
  const received = Buffer.from(signature);
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as Partial<ValidationStorageToken>;
    if (
      typeof parsed.shareToken !== "string" ||
      !parsed.shareToken ||
      !Number.isSafeInteger(parsed.projectId) ||
      Number(parsed.projectId) <= 0 ||
      !Number.isSafeInteger(parsed.documentId) ||
      Number(parsed.documentId) <= 0 ||
      !Number.isSafeInteger(parsed.expiresAt) ||
      Number(parsed.expiresAt) <= now
    ) {
      return null;
    }
    return parsed as ValidationStorageToken;
  } catch {
    return null;
  }
}
