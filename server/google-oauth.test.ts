import express from "express";
import type { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerOAuthRoutes, verifyOAuthTransaction } from "./_core/oauth";

const TEST_SECRET = "test-secret-that-is-at-least-32-bytes-long";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("JWT_SECRET", TEST_SECRET);
  vi.stubEnv("GOOGLE_CLIENT_ID", "client.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");
  vi.stubEnv("APP_ORIGIN", "https://staging.turath.example");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

type RouteHandler = (req: Request, res: Response) => Promise<void>;

function getRouteHandler(path: string): RouteHandler {
  const app = express();
  registerOAuthRoutes(app);
  const layer = (
    app as unknown as {
      _router: {
        stack: Array<{
          route?: { path: string; stack: Array<{ handle: RouteHandler }> };
        }>;
      };
    }
  )._router.stack.find(item => item.route?.path === path);
  if (!layer?.route) throw new Error(`Route not registered: ${path}`);
  return layer.route.stack[0]!.handle;
}

describe("Google OAuth authorization boundary", () => {
  it("uses the configured origin and issues signed state with PKCE", async () => {
    const handler = getRouteHandler("/api/auth/google");
    let redirectLocation = "";
    let cookieValue = "";
    let cookieOptions: Record<string, unknown> = {};
    const req = {
      query: { origin: "https://evil.example" },
      headers: {},
      protocol: "http",
      secure: false,
    } as unknown as Request;
    const res = {
      cookie(_name: string, value: string, options: Record<string, unknown>) {
        cookieValue = value;
        cookieOptions = options;
        return this;
      },
      redirect(location: string) {
        redirectLocation = location;
        return this;
      },
      status() {
        return this;
      },
      json() {
        return this;
      },
    } as unknown as Response;

    await handler(req, res);

    const location = new URL(redirectLocation);
    expect(location.origin).toBe("https://accounts.google.com");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://staging.turath.example/api/auth/google/callback"
    );
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("code_challenge")).toMatch(
      /^[A-Za-z0-9_-]{43}$/
    );

    expect(cookieOptions).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/api/auth/google/callback",
    });
    const state = location.searchParams.get("state")!;
    await expect(
      verifyOAuthTransaction(state, cookieValue)
    ).resolves.toMatchObject({ codeVerifier: expect.any(String) });
  });

  it("rejects callbacks without a matching state transaction", async () => {
    const handler = getRouteHandler("/api/auth/google/callback");
    let statusCode = 0;
    let responseBody: unknown;
    const req = {
      query: { code: "untrusted" },
      headers: {},
      protocol: "http",
      secure: false,
    } as unknown as Request;
    const res = {
      clearCookie() {
        return this;
      },
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(value: unknown) {
        responseBody = value;
        return this;
      },
    } as unknown as Response;

    await handler(req, res);

    expect(statusCode).toBe(400);
    expect(responseBody).toEqual({ error: "Invalid OAuth callback" });
  });
});
