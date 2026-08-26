import type { Express, Request, Response } from "express";
import {
  getDocumentById,
  getOnboardingSampleById,
  getProjectRole,
  getValidationSessionByToken,
} from "../db";
import {
  storageGet,
  verifyValidationStorageToken,
  type ValidationStorageToken,
} from "../storage";
import { authenticateRequestUser } from "./context";
import { ENV } from "./env";
import { getVisualAsset } from "../visualArchives/db";
import { isVisualArchivesEnabled } from "../visualArchives/config";

type AuthenticatedUser = { id: number };
type StoredDocument = { storagePath: string; storageUrl: string | null };
type StoredSample = { imagePath: string };
type ValidationSession = { projectId: number; documentIds: unknown; status: string };
type StoredVisualAsset = {
  originalKey: string;
  displayKey: string | null;
  thumbnailKey: string | null;
  status: string;
};

export type StorageProxyDependencies = {
  visualArchivesEnabled: () => boolean;
  authenticateUser: (req: Request) => Promise<AuthenticatedUser | null>;
  getProjectRole: (
    projectId: number,
    userId: number
  ) => Promise<"owner" | "editor" | "viewer" | null>;
  getDocument: (
    documentId: number,
    projectId: number
  ) => Promise<StoredDocument | undefined>;
  getSample: (
    sampleId: number,
    projectId: number
  ) => Promise<StoredSample | undefined>;
  getVisualAsset?: (
    projectId: number,
    assetId: string
  ) => Promise<StoredVisualAsset | undefined>;
  getValidationSession: (
    token: string
  ) => Promise<ValidationSession | null | undefined>;
  verifyValidationToken: (token: string) => ValidationStorageToken | null;
  getDownloadUrl: (key: string) => Promise<string>;
};

const STORAGE_OBJECT_TIMEOUT_MS = 30_000;

async function heroDownloadUrl(): Promise<string> {
  if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
    throw new Error("Storage proxy is not configured");
  }
  const forgeUrl = new URL(
    "v1/storage/presign/get",
    `${ENV.forgeApiUrl.replace(/\/+$/, "")}/`
  );
  forgeUrl.searchParams.set("path", "manuscript-hero_a377d6f4.jpg");
  const response = await fetch(forgeUrl, {
    headers: { Authorization: `Bearer ${ENV.forgeApiKey}` },
    signal: AbortSignal.timeout(STORAGE_OBJECT_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Hero presign failed with HTTP ${response.status}`);
  const payload = (await response.json()) as { url?: string };
  if (!payload.url) throw new Error("Hero presign returned an empty URL");
  return payload.url;
}

const defaultDependencies: StorageProxyDependencies = {
  visualArchivesEnabled: isVisualArchivesEnabled,
  authenticateUser: authenticateRequestUser,
  getProjectRole,
  getDocument: getDocumentById,
  getSample: getOnboardingSampleById,
  getVisualAsset,
  getValidationSession: getValidationSessionByToken,
  verifyValidationToken: verifyValidationStorageToken,
  getDownloadUrl: async key => (await storageGet(key)).url,
};

function positiveInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function validUuid(value: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function trustedDemoUrl(document: StoredDocument): string | null {
  if (!document.storagePath.startsWith("demo/") || !document.storageUrl) return null;
  try {
    const url = new URL(document.storageUrl);
    if (url.protocol === "https:" && url.hostname === "d2xsxph8kpxj0f.cloudfront.net") {
      return url.toString();
    }
  } catch {
    // Treat malformed legacy demo URLs as unavailable.
  }
  return null;
}

async function documentDownloadUrl(
  document: StoredDocument,
  dependencies: StorageProxyDependencies
): Promise<string> {
  return trustedDemoUrl(document) ?? dependencies.getDownloadUrl(document.storagePath);
}

async function streamStorageObject(res: Response, url: string, cacheControl: string): Promise<void> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(STORAGE_OBJECT_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Storage object fetch failed with HTTP ${response.status}`);
  res.set("Content-Type", response.headers.get("content-type") || "application/octet-stream");
  res.set("Cache-Control", cacheControl);
  res.set("Referrer-Policy", "no-referrer");
  res.send(Buffer.from(await response.arrayBuffer()));
}

function storageFailure(res: Response, error: unknown): void {
  console.error("[StorageAccess] backend request failed:", error);
  res.status(502).send("Storage backend error");
}

async function authorizeProjectRequest(
  req: Request,
  res: Response,
  projectId: number,
  dependencies: StorageProxyDependencies
): Promise<boolean> {
  const user = await dependencies.authenticateUser(req);
  if (!user) {
    res.status(401).send("Authentication required");
    return false;
  }
  const role = await dependencies.getProjectRole(projectId, user.id);
  if (!role) {
    res.status(404).send("Not found");
    return false;
  }
  return true;
}

export function registerStorageProxy(
  app: Express,
  dependencies: StorageProxyDependencies = defaultDependencies
) {
  app.get("/api/hero-image", async (_req, res) => {
    try {
      await streamStorageObject(
        res,
        await heroDownloadUrl(),
        "public, max-age=86400, immutable"
      );
    } catch (error) {
      storageFailure(res, error);
    }
  });

  app.get("/api/storage/projects/:projectId/documents/:documentId", async (req, res) => {
    const projectId = positiveInteger(req.params.projectId);
    const documentId = positiveInteger(req.params.documentId);
    if (!projectId || !documentId) {
      res.status(404).send("Not found");
      return;
    }
    try {
      if (!(await authorizeProjectRequest(req, res, projectId, dependencies))) return;
      const document = await dependencies.getDocument(documentId, projectId);
      if (!document) {
        res.status(404).send("Not found");
        return;
      }
      await streamStorageObject(
        res,
        await documentDownloadUrl(document, dependencies),
        "private, no-store"
      );
    } catch (error) {
      storageFailure(res, error);
    }
  });

  app.get("/api/storage/projects/:projectId/samples/:sampleId", async (req, res) => {
    const projectId = positiveInteger(req.params.projectId);
    const sampleId = positiveInteger(req.params.sampleId);
    if (!projectId || !sampleId) {
      res.status(404).send("Not found");
      return;
    }
    try {
      if (!(await authorizeProjectRequest(req, res, projectId, dependencies))) return;
      const sample = await dependencies.getSample(sampleId, projectId);
      if (!sample) {
        res.status(404).send("Not found");
        return;
      }
      await streamStorageObject(
        res,
        await dependencies.getDownloadUrl(sample.imagePath),
        "private, no-store"
      );
    } catch (error) {
      storageFailure(res, error);
    }
  });

  app.get("/api/storage/projects/:projectId/visual-assets/:assetId/:variant", async (req, res) => {
    if (!dependencies.visualArchivesEnabled()) {
      res.status(404).send("Not found");
      return;
    }
    const projectId = positiveInteger(req.params.projectId);
    const assetId = validUuid(req.params.assetId);
    const variant = req.params.variant;
    if (!projectId || !assetId || !["original", "display", "thumbnail"].includes(variant)) {
      res.status(404).send("Not found");
      return;
    }
    try {
      if (!(await authorizeProjectRequest(req, res, projectId, dependencies))) return;
      const asset = await dependencies.getVisualAsset?.(projectId, assetId);
      if (!asset || asset.status !== "ready") {
        res.status(404).send("Not found");
        return;
      }
      const key = variant === "original"
        ? asset.originalKey
        : variant === "display"
          ? asset.displayKey
          : asset.thumbnailKey;
      if (!key) {
        res.status(404).send("Not found");
        return;
      }
      await streamStorageObject(
        res,
        await dependencies.getDownloadUrl(key),
        variant === "original" ? "private, no-store" : "private, max-age=3600",
      );
    } catch (error) {
      storageFailure(res, error);
    }
  });

  app.get("/api/storage/validation/:accessToken", async (req, res) => {
    const access = dependencies.verifyValidationToken(req.params.accessToken);
    if (!access) {
      res.status(404).send("Not found");
      return;
    }
    try {
      const session = await dependencies.getValidationSession(access.shareToken);
      const allowedDocumentIds = Array.isArray(session?.documentIds) ? session.documentIds : [];
      if (
        !session ||
        session.status !== "active" ||
        session.projectId !== access.projectId ||
        !allowedDocumentIds.includes(access.documentId)
      ) {
        res.status(404).send("Not found");
        return;
      }
      const document = await dependencies.getDocument(access.documentId, access.projectId);
      if (!document) {
        res.status(404).send("Not found");
        return;
      }
      await streamStorageObject(
        res,
        await documentDownloadUrl(document, dependencies),
        "private, no-store"
      );
    } catch (error) {
      storageFailure(res, error);
    }
  });

  // Retire arbitrary key access. API responses now expose resource-scoped URLs.
  app.get("/manus-storage/*", async (req, res) => {
    const user = await dependencies.authenticateUser(req);
    if (!user) {
      res.status(401).send("Authentication required");
      return;
    }
    res.status(404).send("Not found");
  });
}
