import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => {
  let nextDocumentId = 4000;
  let createdDocuments: Array<Record<string, unknown>> = [];
  let releaseAllCreated: (() => void) | undefined;
  let allCreated = new Promise<void>((resolve) => {
    releaseAllCreated = resolve;
  });

  return {
    reset() {
      nextDocumentId = 4000;
      createdDocuments = [];
      allCreated = new Promise<void>((resolve) => {
        releaseAllCreated = resolve;
      });
    },
    storagePut: vi.fn(async () => ({ key: "test-key", url: "https://example.invalid/test" })),
    storageGet: vi.fn(async () => ({ key: "test-key", url: "data:image/jpeg;base64,dGVzdA==" })),
    getProjectRole: vi.fn(async () => "owner" as const),
    getProjectById: vi.fn(async () => ({ id: 39, userId: 1, status: "active" })),
    reserveDocumentQuotaSlot: vi.fn(async () => ({
      allowed: true,
      quotaReserved: false,
      isOwnerExempt: true,
      documentLimit: null,
      documentsUsed: 0,
      documentsRemaining: null,
    })),
    releaseDocumentQuotaSlot: vi.fn(async () => undefined),
    createDocument: vi.fn(async (data: Record<string, unknown>) => {
      const created = {
        ...data,
        id: ++nextDocumentId,
        uploadedAt: new Date(),
        processedAt: null,
        errorMessage: null,
      };
      createdDocuments.push(created);
      if (createdDocuments.length === 5) releaseAllCreated?.();
      return created;
    }),
    // This models the production bug: a post-insert project-list lookup returns
    // whichever document is newest after all five parallel inserts finish.
    getDocumentsByProjectId: vi.fn(async () => {
      await allCreated;
      return [...createdDocuments].reverse();
    }),
    logActivity: vi.fn(async () => undefined),
    claimDocumentForTranscription: vi.fn(async () => true),
    createJob: vi.fn(async () => ({ id: 9001 })),
    updateJob: vi.fn(async () => undefined),
    getDocumentById: vi.fn(async (id: number) => ({
      id,
      projectId: 39,
      storagePath: `projects/39/documents/${id}.jpg`,
      mimeType: "image/jpeg",
      filename: `${id}.jpg`,
      status: "pending",
    })),
    updateDocumentStatus: vi.fn(async () => undefined),
    createTranscription: vi.fn(async (data: Record<string, unknown>) => ({ id: 8001, ...data })),
    processDocument: vi.fn(async () => ({
      rawJson: { transcription: "test" },
      originalText: "test",
      modelUsed: "gemini-3.1-pro-preview",
    })),
  };
});

vi.mock("./storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./storage")>();
  return { ...actual, storagePut: mocks.storagePut, storageGet: mocks.storageGet };
});

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getProjectRole: mocks.getProjectRole,
    getProjectById: mocks.getProjectById,
    reserveDocumentQuotaSlot: mocks.reserveDocumentQuotaSlot,
    releaseDocumentQuotaSlot: mocks.releaseDocumentQuotaSlot,
    createDocument: mocks.createDocument,
    getDocumentsByProjectId: mocks.getDocumentsByProjectId,
    logActivity: mocks.logActivity,
    claimDocumentForTranscription: mocks.claimDocumentForTranscription,
    createJob: mocks.createJob,
    updateJob: mocks.updateJob,
    getDocumentById: mocks.getDocumentById,
    updateDocumentStatus: mocks.updateDocumentStatus,
    createTranscription: mocks.createTranscription,
  };
});

vi.mock("./transcriptionEngine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./transcriptionEngine")>();
  return { ...actual, processDocument: mocks.processDocument };
});

import { appRouter } from "./routers";
import { isRetryableTranscriptionError } from "./routers";
import { buildDocumentStatusUpdate } from "./db";
import { GEMINI_REQUEST_TIMEOUT_MS } from "./geminiClient";

function createContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "google_adam",
      email: "adamamin2027@gmail.com",
      name: "Adam Amin",
      loginMethod: "google",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      stripeCustomerId: null,
      plan: "free",
      documentQuotaUsed: 0,
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("document transcription pipeline reliability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reset();
  });

  it("returns the exact inserted document for each of five concurrent uploads", async () => {
    const caller = appRouter.createCaller(createContext());
    const filenames = Array.from({ length: 5 }, (_, index) => `page-${index + 1}.jpg`);

    const uploaded = await Promise.all(filenames.map((filename) => caller.documents.upload({
      projectId: 39,
      filename,
      fileBase64: "dGVzdA==",
      mimeType: "image/jpeg",
      fileSizeBytes: 4,
    })));

    expect(new Set(uploaded.map((document) => document.id))).toHaveLength(5);
    expect(uploaded.map((document) => document.filename).sort()).toEqual([...filenames].sort());
    expect(mocks.createDocument).toHaveBeenCalledTimes(5);
  });

  it("rejects a duplicate transcription request before starting another model call", async () => {
    mocks.claimDocumentForTranscription.mockResolvedValueOnce(false);
    const caller = appRouter.createCaller(createContext());

    await expect(caller.documents.transcribe({ documentId: 3156, projectId: 39 }))
      .rejects.toMatchObject({ code: "CONFLICT" });

    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(mocks.processDocument).not.toHaveBeenCalled();
    expect(mocks.createTranscription).not.toHaveBeenCalled();
  });

  it("records a successful single-document attempt and clears the prior error state", async () => {
    const caller = appRouter.createCaller(createContext());

    await expect(caller.documents.transcribe({ documentId: 3152, projectId: 39 }))
      .resolves.toEqual({ success: true });

    expect(mocks.createTranscription).toHaveBeenCalledWith(expect.objectContaining({
      documentId: 3152,
      projectId: 39,
    }));
    expect(mocks.updateDocumentStatus).toHaveBeenCalledWith(3152, 39, "needs_review");
    expect(mocks.updateJob).toHaveBeenCalledWith(9001, expect.objectContaining({
      status: "completed",
      completedItems: 1,
      errorMessage: null,
    }));
  });

  it("clears stale timeout text when a document leaves the error state", () => {
    expect(buildDocumentStatusUpdate("needs_review")).toMatchObject({
      status: "needs_review",
      errorMessage: null,
    });
    expect(buildDocumentStatusUpdate("error", "The operation was aborted due to timeout"))
      .toMatchObject({
        status: "error",
        errorMessage: "The operation was aborted due to timeout",
      });
  });

  it("does not label server-declared failures or client timeouts as completed uploads", () => {
    const source = readFileSync(new URL("../client/src/pages/project/UploadPage.tsx", import.meta.url), "utf8");
    expect(source).toContain("if (!outcome.success)");
    expect(source).toContain('return "processing" as const');
    expect(source).toContain("still processing on the server");
  });

  it("retries one transient timeout automatically before succeeding", async () => {
    mocks.processDocument
      .mockResolvedValueOnce({
        rawJson: {},
        modelUsed: "gemini-3.1-pro-preview",
        error: "The operation was aborted due to timeout",
      })
      .mockResolvedValueOnce({
        rawJson: { transcription: "recovered" },
        originalText: "recovered",
        modelUsed: "gemini-3.1-pro-preview",
      });
    const caller = appRouter.createCaller(createContext());

    await expect(caller.documents.transcribe({ documentId: 3155, projectId: 39 }))
      .resolves.toEqual({ success: true });

    expect(mocks.processDocument).toHaveBeenCalledTimes(2);
    expect(mocks.createTranscription).toHaveBeenCalledTimes(1);
  });

  it("uses a five-minute Gemini ceiling and retries only transient failures", () => {
    expect(GEMINI_REQUEST_TIMEOUT_MS).toBe(300_000);
    expect(isRetryableTranscriptionError("The operation was aborted due to timeout")).toBe(true);
    expect(isRetryableTranscriptionError("Gemini API error: 503 Service Unavailable")).toBe(true);
    expect(isRetryableTranscriptionError("Schema validation failed: missing transcription")).toBe(false);
  });
});
