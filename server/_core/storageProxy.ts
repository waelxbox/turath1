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

type AuthenticatedUser = { id: number };
type StoredDocument = {
  storagePath: string;
  storageUrl: string | null;
};
type StoredSample = { imagePath: string };
type ValidationSession = {
  projectId: number;
  documentIds: unknown;
  status: string;
};

export type StorageProxyDependencies = {
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
  getValidationSession: (
    token: string
  ) => Promise<ValidationSession | null | undefined>;
  verifyValidationToken: (token: string) => ValidationStorageToken | null;
  getDownloadUrl: (key: string) => Promise<string>;
};

const defaultDependencies: StorageProxyDependencies = {
  authenticateUser: authenticateRequestUser,
  getProjectRole,
  getDocument: getDocumentById,
  getSample: getOnboardingSampleById,
  getValidationSession: getValidationSessionByToken,
  verifyValidationToken: verifyValidationStorageToken,
  getDownloadUrl: async key => (await storageGet(key)).url,
};

function positiveInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function trustedDemoUrl(document: StoredDocument): string | null {
  if (!document.storagePath.startsWith("demo/") || !document.storageUrl) {
    return null;
  }
  try {
    const url = new URL(document.storageUrl);
    if (
      url.protocol === "https:" &&
      url.hostname === "d2xsxph8kpxj0f.cloudfront.net"
    ) {
      return url.toString();
    }
  } catch {
    // Treat malformed legacy URLs as unavailable.
  }
  return null;
}

async function documentDownloadUrl(
  document: StoredDocument,
  dependencies: StorageProxyDependencies
): Promise<string> {
  return (
    trustedDemoUrl(document) ??
    dependencies.getDownloadUrl(document.storagePath)
  );
}

function redirectToStorage(res: Response, url: string): void {
  // The application URL is stable, but the backend URL is deliberately fresh
  // and must not be cached beyond its provider-defined lifetime.
  res.set("Cache-Control", "private, no-store");
  res.set("Referrer-Policy", "no-referrer");
  res.redirect(302, url);
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
    // Avoid confirming whether an inaccessible project or object exists.
    res.status(404).send("Not found");
    return false;
  }
  return true;
}

export function registerStorageProxy(
  app: Express,
  dependencies: StorageProxyDependencies = defaultDependencies
) {
  // This one public endpoint serves a single non-sensitive marketing asset.
  app.get("/api/hero-image", async (_req, res) => {
    try {
      redirectToStorage(
        res,
        await dependencies.getDownloadUrl("manuscript-hero_a377d6f4.jpg")
      );
    } catch (error) {
      storageFailure(res, error);
    }
  });

  app.get(
    "/api/storage/projects/:projectId/documents/:documentId",
    async (req, res) => {
      const projectId = positiveInteger(req.params.projectId);
      const documentId = positiveInteger(req.params.documentId);
      if (!projectId || !documentId) {
        res.status(404).send("Not found");
        return;
      }

      try {
        if (
          !(await authorizeProjectRequest(req, res, projectId, dependencies))
        ) {
          return;
        }
        const document = await dependencies.getDocument(documentId, projectId);
        if (!document) {
          res.status(404).send("Not found");
          return;
        }
        redirectToStorage(
          res,
          await documentDownloadUrl(document, dependencies)
        );
      } catch (error) {
        storageFailure(res, error);
      }
    }
  );

  app.get(
    "/api/storage/projects/:projectId/samples/:sampleId",
    async (req, res) => {
      const projectId = positiveInteger(req.params.projectId);
      const sampleId = positiveInteger(req.params.sampleId);
      if (!projectId || !sampleId) {
        res.status(404).send("Not found");
        return;
      }

      try {
        if (
          !(await authorizeProjectRequest(req, res, projectId, dependencies))
        ) {
          return;
        }
        const sample = await dependencies.getSample(sampleId, projectId);
        if (!sample) {
          res.status(404).send("Not found");
          return;
        }
        redirectToStorage(
          res,
          await dependencies.getDownloadUrl(sample.imagePath)
        );
      } catch (error) {
        storageFailure(res, error);
      }
    }
  );

  // Validation sessions are intentionally shareable. Images use a separate
  // short-lived signed token tied to one project and document.
  app.get("/api/storage/validation/:accessToken", async (req, res) => {
    const access = dependencies.verifyValidationToken(req.params.accessToken);
    if (!access) {
      res.status(404).send("Not found");
      return;
    }

    try {
      const session = await dependencies.getValidationSession(
        access.shareToken
      );
      const allowedDocumentIds = Array.isArray(session?.documentIds)
        ? session.documentIds
        : [];
      if (
        !session ||
        session.status !== "active" ||
        session.projectId !== access.projectId ||
        !allowedDocumentIds.includes(access.documentId)
      ) {
        res.status(404).send("Not found");
        return;
      }

      const document = await dependencies.getDocument(
        access.documentId,
        access.projectId
      );
      if (!document) {
        res.status(404).send("Not found");
        return;
      }
      redirectToStorage(res, await documentDownloadUrl(document, dependencies));
    } catch (error) {
      storageFailure(res, error);
    }
  });

  // Explicitly retire the old arbitrary-key route. Existing database rows are
  // mapped to the protected resource routes when returned by the API.
  app.get("/manus-storage/*", async (req, res) => {
    const user = await dependencies.authenticateUser(req);
    if (!user) {
      res.status(401).send("Authentication required");
      return;
    }
    res.status(404).send("Not found");
  });
}
