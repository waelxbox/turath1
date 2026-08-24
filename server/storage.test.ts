import type { Express, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./_core/env", () => ({
  ENV: {
    appId: "turath-test",
    forgeApiUrl: "https://forge.example/api",
    forgeApiKey: "forge-secret",
  },
  getJwtSecret: () =>
    new TextEncoder().encode("storage-test-secret-at-least-32-bytes"),
}));

import {
  documentAccessUrl,
  isProjectStorageKey,
  normalizeStorageKey,
  storageDelete,
  storageDeleteMany,
  storageGet,
  validationDocumentAccessUrl,
  verifyValidationStorageToken,
} from "./storage";
import {
  registerStorageProxy,
  type StorageProxyDependencies,
} from "./_core/storageProxy";

type RouteHandler = (req: Request, res: Response) => Promise<void> | void;

function fakeApp() {
  const routes = new Map<string, RouteHandler>();
  const app = {
    get(path: string, handler: RouteHandler) {
      routes.set(path, handler);
    },
  } as unknown as Express;
  return { app, routes };
}

function fakeResponse() {
  const state: {
    status: number;
    body?: string;
    redirect?: string;
    headers: Record<string, string>;
  } = { status: 200, headers: {} };
  const response = {
    status(code: number) {
      state.status = code;
      return response;
    },
    send(body: string) {
      state.body = body;
      return response;
    },
    set(name: string, value: string) {
      state.headers[name] = value;
      return response;
    },
    redirect(code: number, url: string) {
      state.status = code;
      state.redirect = url;
      return response;
    },
  } as unknown as Response;
  return { response, state };
}

function request(params: Record<string, string> = {}): Request {
  return { params, headers: {} } as Request;
}

function dependencies(
  overrides: Partial<StorageProxyDependencies> = {}
): StorageProxyDependencies {
  return {
    authenticateUser: vi.fn().mockResolvedValue({ id: 7 }),
    getProjectRole: vi.fn().mockResolvedValue("viewer"),
    getDocument: vi.fn().mockResolvedValue({
      storagePath: "projects/12/documents/page.jpg",
      storageUrl: null,
    }),
    getSample: vi.fn().mockResolvedValue({
      imagePath: "projects/12/samples/sample.jpg",
    }),
    getValidationSession: vi.fn().mockResolvedValue({
      projectId: 12,
      documentIds: [34],
      status: "active",
    }),
    verifyValidationToken: vi.fn().mockReturnValue({
      shareToken: "share-secret",
      projectId: 12,
      documentId: 34,
      expiresAt: Date.now() + 60_000,
    }),
    getDownloadUrl: vi
      .fn()
      .mockResolvedValue("https://objects.example/fresh-signed-url"),
    ...overrides,
  };
}

describe("storage key safety", () => {
  it("accepts a project object key and rejects traversal", () => {
    expect(normalizeStorageKey("/projects/12/documents/page 1.jpg")).toBe(
      "projects/12/documents/page 1.jpg"
    );
    expect(() => normalizeStorageKey("projects/12/../34/secret.jpg")).toThrow(
      "Invalid storage key"
    );
    expect(() =>
      normalizeStorageKey("projects/12/%2e%2e/34/secret.jpg")
    ).toThrow("Invalid storage key");
    expect(() =>
      normalizeStorageKey("projects/12/%252e%252e/34/secret.jpg")
    ).toThrow("Invalid storage key");
    expect(() =>
      normalizeStorageKey("projects/12/documents%2fsecret.jpg")
    ).toThrow("Invalid storage key");
  });

  it("ties managed keys to the exact project prefix", () => {
    expect(isProjectStorageKey("projects/12/documents/page.jpg", 12)).toBe(
      true
    );
    expect(isProjectStorageKey("projects/123/documents/page.jpg", 12)).toBe(
      false
    );
    expect(isProjectStorageKey("demo/page.jpg", 12)).toBe(false);
  });
});

describe("storage backend helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requests a fresh authenticated download URL", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            url: "https://objects.example/signed?expires=soon",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );

    const result = await storageGet("projects/12/documents/page.jpg");

    expect(result.url).toBe("https://objects.example/signed?expires=soon");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("v1/storage/downloadUrl");
    expect(String(url)).toContain("path=projects%2F12%2Fdocuments%2Fpage.jpg");
    expect(init).toMatchObject({
      method: "GET",
      headers: { Authorization: "Bearer forge-secret" },
    });
  });

  it("deletes objects and treats a missing object as already deleted", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("missing", { status: 404 }));

    await expect(
      storageDelete("projects/12/documents/page.jpg")
    ).resolves.toEqual({ key: "projects/12/documents/page.jpg" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("v1/storage/delete");
    expect(init).toMatchObject({ method: "DELETE" });
  });

  it("reports individual failures during bounded bulk deletion", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      return String(input).includes("bad.jpg")
        ? new Response("backend down", { status: 503 })
        : new Response(null, { status: 204 });
    });

    const result = await storageDeleteMany([
      "projects/12/documents/good.jpg",
      "projects/12/documents/bad.jpg",
    ]);

    expect(result.deleted).toEqual(["projects/12/documents/good.jpg"]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].key).toBe("projects/12/documents/bad.jpg");
  });
});

describe("protected storage routes", () => {
  it("retires the arbitrary-key public route", async () => {
    const { app, routes } = fakeApp();
    registerStorageProxy(app, dependencies());
    const { response, state } = fakeResponse();

    await routes.get("/manus-storage/*")!(request(), response);

    expect(state.status).toBe(404);
    expect(state.redirect).toBeUndefined();
  });

  it("requires authentication before resolving a project document", async () => {
    const deps = dependencies({
      authenticateUser: vi.fn().mockResolvedValue(null),
    });
    const { app, routes } = fakeApp();
    registerStorageProxy(app, deps);
    const { response, state } = fakeResponse();

    await routes.get("/api/storage/projects/:projectId/documents/:documentId")!(
      request({ projectId: "12", documentId: "34" }),
      response
    );

    expect(state.status).toBe(401);
    expect(deps.getProjectRole).not.toHaveBeenCalled();
    expect(deps.getDownloadUrl).not.toHaveBeenCalled();
  });

  it("does not resolve objects when the user lacks project access", async () => {
    const deps = dependencies({
      getProjectRole: vi.fn().mockResolvedValue(null),
    });
    const { app, routes } = fakeApp();
    registerStorageProxy(app, deps);
    const { response, state } = fakeResponse();

    await routes.get("/api/storage/projects/:projectId/documents/:documentId")!(
      request({ projectId: "12", documentId: "34" }),
      response
    );

    expect(state.status).toBe(404);
    expect(deps.getDocument).not.toHaveBeenCalled();
    expect(deps.getDownloadUrl).not.toHaveBeenCalled();
  });

  it("redirects an authorized request to a fresh URL without buffering", async () => {
    const deps = dependencies();
    const { app, routes } = fakeApp();
    registerStorageProxy(app, deps);
    const { response, state } = fakeResponse();

    await routes.get("/api/storage/projects/:projectId/documents/:documentId")!(
      request({ projectId: "12", documentId: "34" }),
      response
    );

    expect(deps.getDocument).toHaveBeenCalledWith(34, 12);
    expect(deps.getDownloadUrl).toHaveBeenCalledWith(
      "projects/12/documents/page.jpg"
    );
    expect(state).toMatchObject({
      status: 302,
      redirect: "https://objects.example/fresh-signed-url",
      headers: {
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  });

  it("limits validation-token access to the session document set", async () => {
    const deps = dependencies({
      verifyValidationToken: vi.fn().mockReturnValue({
        shareToken: "share-secret",
        projectId: 12,
        documentId: 99,
        expiresAt: Date.now() + 60_000,
      }),
    });
    const { app, routes } = fakeApp();
    registerStorageProxy(app, deps);
    const { response, state } = fakeResponse();

    await routes.get("/api/storage/validation/:accessToken")!(
      request({ accessToken: "signed-token" }),
      response
    );

    expect(state.status).toBe(404);
    expect(deps.getDocument).not.toHaveBeenCalled();
    expect(deps.getDownloadUrl).not.toHaveBeenCalled();
  });

  it("resolves a document for a valid short-lived validation token", async () => {
    const deps = dependencies();
    const { app, routes } = fakeApp();
    registerStorageProxy(app, deps);
    const { response, state } = fakeResponse();

    await routes.get("/api/storage/validation/:accessToken")!(
      request({ accessToken: "signed-token" }),
      response
    );

    expect(deps.getValidationSession).toHaveBeenCalledWith("share-secret");
    expect(deps.getDocument).toHaveBeenCalledWith(34, 12);
    expect(state.status).toBe(302);
  });

  it("builds stable access URLs without embedding a provider URL", () => {
    expect(documentAccessUrl(12, 34)).toBe(
      "/api/storage/projects/12/documents/34"
    );
    const url = validationDocumentAccessUrl("token/value", 12, 34, 1_000);
    const token = decodeURIComponent(
      url.replace("/api/storage/validation/", "")
    );
    expect(url).toMatch(/^\/api\/storage\/validation\/[A-Za-z0-9_.%-]+$/);
    expect(verifyValidationStorageToken(token, 2_000)).toEqual({
      shareToken: "token/value",
      projectId: 12,
      documentId: 34,
      expiresAt: 301_000,
    });
    expect(verifyValidationStorageToken(`${token}tampered`, 2_000)).toBeNull();
    expect(verifyValidationStorageToken(token, 301_001)).toBeNull();
  });
});
