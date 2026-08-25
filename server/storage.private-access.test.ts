import { describe, expect, it, vi } from "vitest";

vi.mock("./_core/context", () => ({
  authenticateRequestUser: vi.fn(),
}));

vi.mock("./db", () => ({
  getDocumentById: vi.fn(),
  getOnboardingSampleById: vi.fn(),
  getProjectRole: vi.fn(),
  getValidationSessionByToken: vi.fn(),
}));

vi.mock("./storage", () => ({
  storageGet: vi.fn(),
  verifyValidationStorageToken: vi.fn(),
}));

import {
  registerStorageProxy,
  type StorageProxyDependencies,
} from "./_core/storageProxy";

type Handler = (req: any, res: any) => unknown;

function captureRoutes(dependencies: StorageProxyDependencies) {
  const routes = new Map<string, Handler>();
  const app = {
    get(path: string, handler: Handler) {
      routes.set(path, handler);
    },
  };
  registerStorageProxy(app as any, dependencies);
  return routes;
}

function fakeResponse() {
  const state = { status: 200, body: undefined as unknown, headers: new Map<string, string>() };
  return {
    state,
    response: {
      status(code: number) {
        state.status = code;
        return this;
      },
      set(name: string, value: string) {
        state.headers.set(name, value);
        return this;
      },
      send(body: unknown) {
        state.body = body;
        return this;
      },
    },
  };
}

function dependencies(overrides: Partial<StorageProxyDependencies> = {}): StorageProxyDependencies {
  return {
    authenticateUser: vi.fn().mockResolvedValue({ id: 7 }),
    getProjectRole: vi.fn().mockResolvedValue("owner"),
    getDocument: vi.fn().mockResolvedValue({
      storagePath: "projects/12/documents/private.jpg",
      storageUrl: null,
    }),
    getSample: vi.fn().mockResolvedValue({ imagePath: "projects/12/samples/sample.jpg" }),
    getValidationSession: vi.fn().mockResolvedValue({
      projectId: 12,
      documentIds: [34],
      status: "active",
    }),
    verifyValidationToken: vi.fn().mockReturnValue({
      shareToken: "share-token",
      projectId: 12,
      documentId: 34,
      expiresAt: Date.now() + 60_000,
    }),
    getDownloadUrl: vi.fn().mockResolvedValue("https://objects.example.test/private.jpg"),
    ...overrides,
  };
}

describe("private storage resource routes", () => {
  it("serves a document only after project authorization", async () => {
    const deps = dependencies();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("archive bytes", {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    }));
    const routes = captureRoutes(deps);
    const { response, state } = fakeResponse();

    await routes.get("/api/storage/projects/:projectId/documents/:documentId")!(
      { params: { projectId: "12", documentId: "34" }, headers: {} },
      response
    );

    expect(state.status).toBe(200);
    expect(deps.getProjectRole).toHaveBeenCalledWith(12, 7);
    expect(deps.getDocument).toHaveBeenCalledWith(34, 12);
    expect(state.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("does not fetch storage for a user outside the project", async () => {
    const deps = dependencies({ getProjectRole: vi.fn().mockResolvedValue(null) });
    const backendFetch = vi.spyOn(globalThis, "fetch");
    const routes = captureRoutes(deps);
    const { response, state } = fakeResponse();

    await routes.get("/api/storage/projects/:projectId/documents/:documentId")!(
      { params: { projectId: "12", documentId: "34" }, headers: {} },
      response
    );

    expect(state.status).toBe(404);
    expect(deps.getDocument).not.toHaveBeenCalled();
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it("serves validation images only when the signed document is in an active session", async () => {
    const deps = dependencies();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("validation bytes", {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    }));
    const routes = captureRoutes(deps);
    const { response, state } = fakeResponse();

    await routes.get("/api/storage/validation/:accessToken")!(
      { params: { accessToken: "signed-token" }, headers: {} },
      response
    );

    expect(state.status).toBe(200);
    expect(deps.getValidationSession).toHaveBeenCalledWith("share-token");
    expect(deps.getDocument).toHaveBeenCalledWith(34, 12);
  });
});
