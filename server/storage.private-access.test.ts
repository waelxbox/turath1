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
    visualArchivesEnabled: vi.fn().mockReturnValue(true),
    authenticateUser: vi.fn().mockResolvedValue({ id: 7, email: "adamamin2027@gmail.com" }),
    getProjectRole: vi.fn().mockResolvedValue("owner"),
    getDocument: vi.fn().mockResolvedValue({
      storagePath: "projects/12/documents/private.jpg",
      storageUrl: null,
    }),
    getSample: vi.fn().mockResolvedValue({ imagePath: "projects/12/samples/sample.jpg" }),
    getVisualAsset: vi.fn().mockResolvedValue({
      originalKey: "projects/12/visual-assets/123e4567-e89b-12d3-a456-426614174000/original.jpg",
      displayKey: "projects/12/visual-assets/123e4567-e89b-12d3-a456-426614174000/display.jpg",
      thumbnailKey: "projects/12/visual-assets/123e4567-e89b-12d3-a456-426614174000/thumbnail.jpg",
      status: "ready",
    }),
    getVisualCatalogExport: vi.fn().mockResolvedValue({
      profile: "VRA Core 4-aligned reviewed catalog export",
      exportedAt: "2026-08-27T00:00:00.000Z",
      projectId: 12,
      includeUnapproved: false,
      records: [{
        id: "123e4567-e89b-12d3-a456-426614174000",
        recordType: "image",
        title: "Approved courtyard",
        localIdentifier: null,
        status: "approved",
        reviewedJson: { locations: ["Cairo"] },
        assetId: "123e4567-e89b-12d3-a456-426614174000",
      }],
      relations: [],
    }),
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
  it("does not access visual storage or database dependencies when the feature is disabled", async () => {
    const deps = dependencies({ visualArchivesEnabled: vi.fn().mockReturnValue(false) });
    const routes = captureRoutes(deps);
    const handler = routes.get("/api/storage/projects/:projectId/visual-assets/:assetId/:variant")!;
    const { response, state } = fakeResponse();

    await handler(
      { params: { projectId: "12", assetId: "123e4567-e89b-12d3-a456-426614174000", variant: "thumbnail" } },
      response,
    );

    expect(state.status).toBe(404);
    expect(deps.authenticateUser).not.toHaveBeenCalled();
    expect(deps.getVisualAsset).not.toHaveBeenCalled();
    expect(deps.getDownloadUrl).not.toHaveBeenCalled();
  });

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

  it("serves a visual thumbnail only after project authorization", async () => {
    const deps = dependencies();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("thumbnail bytes", {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    }));
    const routes = captureRoutes(deps);
    const { response, state } = fakeResponse();

    await routes.get("/api/storage/projects/:projectId/visual-assets/:assetId/:variant")!(
      {
        params: {
          projectId: "12",
          assetId: "123e4567-e89b-12d3-a456-426614174000",
          variant: "thumbnail",
        },
        headers: {},
      },
      response,
    );

    expect(state.status).toBe(200);
    expect(deps.getProjectRole).toHaveBeenCalledWith(12, 7);
    expect(deps.getVisualAsset).toHaveBeenCalledWith(12, "123e4567-e89b-12d3-a456-426614174000");
    expect(deps.getDownloadUrl).toHaveBeenCalledWith(expect.stringContaining("thumbnail.jpg"));
    expect(state.headers.get("Cache-Control")).toBe("private, max-age=3600");
  });

  it("does not fetch a visual asset for a user outside the project", async () => {
    const deps = dependencies({ getProjectRole: vi.fn().mockResolvedValue(null) });
    const backendFetch = vi.spyOn(globalThis, "fetch");
    const routes = captureRoutes(deps);
    const { response, state } = fakeResponse();

    await routes.get("/api/storage/projects/:projectId/visual-assets/:assetId/:variant")!(
      {
        params: {
          projectId: "12",
          assetId: "123e4567-e89b-12d3-a456-426614174000",
          variant: "original",
        },
        headers: {},
      },
      response,
    );

    expect(state.status).toBe(404);
    expect(deps.getVisualAsset).not.toHaveBeenCalled();
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it("does not reveal visual assets to an authenticated user outside the controlled preview allowlist", async () => {
    const deps = dependencies({
      authenticateUser: vi.fn().mockResolvedValue({ id: 8, email: "researcher@example.org" }),
      visualArchivesUserAllowed: vi.fn().mockReturnValue(false),
    });
    const backendFetch = vi.spyOn(globalThis, "fetch");
    const routes = captureRoutes(deps);
    const { response, state } = fakeResponse();

    await routes.get("/api/storage/projects/:projectId/visual-assets/:assetId/:variant")!(
      {
        params: {
          projectId: "12",
          assetId: "123e4567-e89b-12d3-a456-426614174000",
          variant: "thumbnail",
        },
        headers: {},
      },
      response,
    );

    expect(state.status).toBe(404);
    expect(deps.getProjectRole).not.toHaveBeenCalled();
    expect(deps.getVisualAsset).not.toHaveBeenCalled();
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it("does not create a selected-image ZIP for a user outside the controlled preview allowlist", async () => {
    const deps = dependencies({
      authenticateUser: vi.fn().mockResolvedValue({ id: 8, email: "researcher@example.org" }),
      visualArchivesUserAllowed: vi.fn().mockReturnValue(false),
    });
    const backendFetch = vi.spyOn(globalThis, "fetch");
    const routes = captureRoutes(deps);
    const { response, state } = fakeResponse();

    await routes.get("/api/storage/projects/:projectId/visual-exports/selected.zip")!(
      {
        params: { projectId: "12" },
        query: { assetIds: "123e4567-e89b-12d3-a456-426614174000" },
        headers: {},
      },
      response,
    );

    expect(state.status).toBe(404);
    expect(deps.getProjectRole).not.toHaveBeenCalled();
    expect(deps.getVisualAsset).not.toHaveBeenCalled();
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it("serves a reviewed Visual Archives CSV as a private attachment with an explicit content type", async () => {
    const deps = dependencies();
    const routes = captureRoutes(deps);
    const { response, state } = fakeResponse();

    await routes.get("/api/storage/projects/:projectId/visual-exports/catalog.:format")!(
      { params: { projectId: "12", format: "csv" }, query: { includeUnapproved: "false" }, headers: {} },
      response,
    );

    expect(state.status).toBe(200);
    expect(state.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(state.headers.get("Content-Disposition")).toMatch(/^attachment; filename="turath-visual-catalog-.*\.csv"$/);
    expect(state.headers.get("Cache-Control")).toBe("private, no-store");
    expect(String(state.body)).toContain("Approved courtyard");
    expect(deps.getVisualCatalogExport).toHaveBeenCalledWith(12, false);
  });

  it("does not create a catalog export for a user outside the controlled preview allowlist", async () => {
    const deps = dependencies({
      authenticateUser: vi.fn().mockResolvedValue({ id: 8, email: "researcher@example.org" }),
      visualArchivesUserAllowed: vi.fn().mockReturnValue(false),
    });
    const routes = captureRoutes(deps);
    const { response, state } = fakeResponse();

    await routes.get("/api/storage/projects/:projectId/visual-exports/catalog.:format")!(
      { params: { projectId: "12", format: "json" }, query: {}, headers: {} },
      response,
    );

    expect(state.status).toBe(404);
    expect(deps.getVisualCatalogExport).not.toHaveBeenCalled();
  });

  it("rejects unknown visual asset variants before authorization or storage access", async () => {
    const deps = dependencies();
    const backendFetch = vi.spyOn(globalThis, "fetch");
    const routes = captureRoutes(deps);
    const { response, state } = fakeResponse();

    await routes.get("/api/storage/projects/:projectId/visual-assets/:assetId/:variant")!(
      {
        params: {
          projectId: "12",
          assetId: "123e4567-e89b-12d3-a456-426614174000",
          variant: "raw-provider-key",
        },
        headers: {},
      },
      response,
    );

    expect(state.status).toBe(404);
    expect(deps.getProjectRole).not.toHaveBeenCalled();
    expect(backendFetch).not.toHaveBeenCalled();
  });
});
