import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./env", () => ({
  ENV: {
    forgeApiUrl: "https://forge.example.test/",
    forgeApiKey: "server-only-key",
  },
}));

import { registerStorageProxy } from "./storageProxy";

type Handler = (req: any, res: any, next?: () => void) => unknown;

function captureRoutes() {
  const routes = new Map<string, Handler[]>();
  const app = {
    get(path: string, ...handlers: Handler[]) {
      routes.set(path, handlers);
    },
  };
  registerStorageProxy(app as any);
  return routes;
}

async function runHandlers(handlers: Handler[], req: any, res: any) {
  let index = 0;
  const next = async () => {
    const handler = handlers[index++];
    if (handler) await handler(req, res, next);
  };
  await next();
}

describe("private storage proxy authorization", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects an unauthenticated request before using server storage credentials", async () => {
    const backendFetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: "https://objects.example.test/victim" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response("VICTIM ARCHIVE BYTES", {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }));

    const routes = captureRoutes();
    const handlers = routes.get("/manus-storage/*");
    expect(handlers).toBeDefined();

    let responseStatus = 200;
    const response = {
      status(code: number) {
        responseStatus = code;
        return this;
      },
      set: vi.fn(),
      send: vi.fn(),
    };

    await runHandlers(handlers!, {
      path: "/manus-storage/projects/2002/documents/private.jpg",
      headers: {},
      user: null,
    }, response);

    expect([401, 403]).toContain(responseStatus);
    expect(backendFetch).not.toHaveBeenCalled();
  });
});
