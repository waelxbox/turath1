// Preconfigured storage helpers for Manus WebDev templates
// Uses the Biz-provided storage proxy (Authorization: Bearer <token>)

import { createHmac, timingSafeEqual } from "node:crypto";
import sharp from "sharp";
import { ENV } from "./_core/env";

type StorageConfig = { baseUrl: string; apiKey: string };

export type ValidationStorageToken = {
  shareToken: string;
  projectId: number;
  documentId: number;
  expiresAt: number;
};

const VALIDATION_STORAGE_TOKEN_TTL_MS = 5 * 60 * 1000;
const STORAGE_REQUEST_TIMEOUT_MS = 30_000;
const MAX_VISUAL_INPUT_PIXELS = 100_000_000;

export type VisualDerivatives = {
  display: Buffer;
  thumbnail: Buffer;
  displayMimeType: "image/jpeg";
  width: number;
  height: number;
  format: string;
  orientation: number | null;
  density: number | null;
  space: string | null;
  hasAlpha: boolean;
};

export async function createVisualDerivatives(source: Buffer): Promise<VisualDerivatives> {
  const metadata = await sharp(source, { limitInputPixels: MAX_VISUAL_INPUT_PIXELS }).metadata();
  if (!metadata.width || !metadata.height || !["jpeg", "png"].includes(metadata.format ?? "")) {
    throw new Error("The uploaded file is not a supported JPEG or PNG image");
  }
  const [display, thumbnail] = await Promise.all([
    sharp(source, { limitInputPixels: MAX_VISUAL_INPUT_PIXELS })
      .rotate()
      .resize({ width: 2200, height: 2200, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer(),
    sharp(source, { limitInputPixels: MAX_VISUAL_INPUT_PIXELS })
      .rotate()
      .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer(),
  ]);
  return {
    display,
    thumbnail,
    displayMimeType: "image/jpeg",
    width: metadata.width,
    height: metadata.height,
    format: metadata.format ?? "unknown",
    orientation: metadata.orientation ?? null,
    density: metadata.density ?? null,
    space: metadata.space ?? null,
    hasAlpha: metadata.hasAlpha ?? false,
  };
}

export function buildVisualAssetKey(
  projectId: number,
  assetId: string,
  variant: "original" | "display" | "thumbnail",
  mimeType: "image/jpeg" | "image/png",
): string {
  const extension = variant === "original" && mimeType === "image/png" ? "png" : "jpg";
  return `projects/${projectId}/visual-assets/${assetId}/${variant}.${extension}`;
}

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

function buildUploadUrl(baseUrl: string, relKey: string): URL {
  const url = new URL("v1/storage/upload", ensureTrailingSlash(baseUrl));
  url.searchParams.set("path", normalizeKey(relKey));
  return url;
}

async function buildDownloadUrl(
  baseUrl: string,
  relKey: string,
  apiKey: string
): Promise<string> {
  const downloadApiUrl = new URL(
    "v1/storage/downloadUrl",
    ensureTrailingSlash(baseUrl)
  );
  downloadApiUrl.searchParams.set("path", normalizeKey(relKey));
  const response = await fetch(downloadApiUrl, {
    method: "GET",
    headers: buildAuthHeaders(apiKey),
    signal: AbortSignal.timeout(STORAGE_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(
      `Storage download URL failed (${response.status} ${response.statusText}): ${message}`
    );
  }
  const payload = (await response.json()) as { url?: string };
  if (!payload.url) throw new Error("Storage backend returned an empty download URL");
  return payload.url;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function normalizeKey(relKey: string): string {
  const key = relKey.replace(/^\/+/, "");
  if (!key || key.length > 2048 || key.includes("\0") || key.includes("\\")) {
    throw new Error("Invalid storage key");
  }
  for (const segment of key.split("/")) {
    if (!segment) throw new Error("Invalid storage key");
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new Error("Invalid storage key");
    }
    if (decoded === "." || decoded === ".." || decoded.includes("/")) {
      throw new Error("Invalid storage key");
    }
  }
  return key;
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

function buildAuthHeaders(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}` };
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const { baseUrl, apiKey } = getStorageConfig();
  const key = normalizeKey(relKey);
  const uploadUrl = buildUploadUrl(baseUrl, key);
  const formData = toFormData(data, contentType, key.split("/").pop() ?? key);
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: buildAuthHeaders(apiKey),
    body: formData,
    signal: AbortSignal.timeout(STORAGE_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(
      `Storage upload failed (${response.status} ${response.statusText}): ${message}`
    );
  }
  const url = (await response.json()).url;
  return { key, url };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string; }> {
  const { baseUrl, apiKey } = getStorageConfig();
  const key = normalizeKey(relKey);
  return {
    key,
    url: await buildDownloadUrl(baseUrl, key, apiKey),
  };
}

export function documentAccessUrl(projectId: number, documentId: number): string {
  return `/api/storage/projects/${projectId}/documents/${documentId}`;
}

export function onboardingSampleAccessUrl(projectId: number, sampleId: number): string {
  return `/api/storage/projects/${projectId}/samples/${sampleId}`;
}

export function visualAssetAccessUrl(
  projectId: number,
  assetId: string,
  variant: "original" | "display" | "thumbnail",
): string {
  return `/api/storage/projects/${projectId}/visual-assets/${assetId}/${variant}`;
}

function validationStorageSecret(): Uint8Array {
  if (!ENV.cookieSecret) throw new Error("JWT_SECRET is required for validation storage access");
  return new TextEncoder().encode(ENV.cookieSecret);
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
  const payload = Buffer.from(JSON.stringify({
    shareToken,
    projectId,
    documentId,
    expiresAt: now + VALIDATION_STORAGE_TOKEN_TTL_MS,
  } satisfies ValidationStorageToken)).toString("base64url");
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
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
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
