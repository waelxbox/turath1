import type { NextFunction, Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionCookieOptions } from "./cookies";
import { getAppOrigin, getJwtSecret, validateStartupEnv } from "./env";
import { getHelmetOptions, requireTrustedOrigin } from "./httpSecurity";
import {
  createOAuthTransaction,
  createSessionToken,
  verifyOAuthTransaction,
  verifySessionToken,
} from "./oauth";
import { createRateLimit } from "./rateLimit";
import { getInlineScriptHashesFromHtml } from "./vite";

const TEST_SECRET = "test-secret-that-is-at-least-32-bytes-long";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("JWT_SECRET", TEST_SECRET);
  vi.stubEnv("GOOGLE_CLIENT_ID", "client.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");
  vi.stubEnv("APP_ORIGIN", "https://staging.turath.example");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("startup authentication configuration", () => {
  it("rejects a missing or weak session secret", () => {
    expect(() => getJwtSecret({ JWT_SECRET: "short" })).toThrow(/32 bytes/);
    expect(() => getJwtSecret({})).toThrow(/JWT_SECRET/);
  });

  it("requires a canonical HTTPS production origin", () => {
    expect(() =>
      getAppOrigin({
        NODE_ENV: "production",
        APP_ORIGIN: "http://turath.example",
      })
    ).toThrow(/HTTPS/);
    expect(() =>
      getAppOrigin({
        NODE_ENV: "production",
        APP_ORIGIN: "https://turath.example/path",
      })
    ).toThrow(/scheme, host/);
  });

  it("validates all required auth settings", () => {
    expect(
      validateStartupEnv({
        NODE_ENV: "production",
        JWT_SECRET: TEST_SECRET,
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: "client-secret",
        APP_ORIGIN: "https://turath.example",
        TRUST_PROXY_HOPS: "1",
      })
    ).toEqual({ appOrigin: "https://turath.example", trustProxyHops: 1 });
  });
});

describe("session and OAuth tokens", () => {
  it("binds a session to the supplied session version", async () => {
    const sessionStartedAt = new Date("2026-08-24T00:00:00.123Z");
    const token = await createSessionToken("google_123", sessionStartedAt);

    await expect(verifySessionToken(token)).resolves.toEqual({
      openId: "google_123",
      sessionVersion: sessionStartedAt.getTime(),
    });

    vi.stubEnv("JWT_SECRET", "a-different-secret-that-is-at-least-32-bytes");
    await expect(verifySessionToken(token)).resolves.toBeNull();
  });

  it("requires a matching signed state and PKCE transaction", async () => {
    const first = await createOAuthTransaction();
    const second = await createOAuthTransaction();

    const verified = await verifyOAuthTransaction(
      first.state,
      first.transactionCookie
    );
    expect(verified?.codeVerifier).toHaveLength(43);
    await expect(
      verifyOAuthTransaction(first.state, second.transactionCookie)
    ).resolves.toBeNull();
    await expect(
      verifyOAuthTransaction(`${first.state}x`, first.transactionCookie)
    ).resolves.toBeNull();
  });
});

describe("HTTP boundary hardening", () => {
  it("does not trust a raw forwarded-proto header", () => {
    const req = {
      protocol: "http",
      secure: false,
      headers: { "x-forwarded-proto": "https" },
    } as unknown as Request;

    expect(getSessionCookieOptions(req)).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: false,
    });
  });

  it("enables a production CSP without unsafe inline scripts", () => {
    const hashes = getInlineScriptHashesFromHtml(
      '<script src="/app.js"></script><script>window.RUNTIME = true;</script>'
    );
    const options = getHelmetOptions({ NODE_ENV: "production" }, hashes);
    expect(options.contentSecurityPolicy).not.toBe(false);
    const directives =
      typeof options.contentSecurityPolicy === "object"
        ? options.contentSecurityPolicy.directives
        : undefined;
    expect(directives?.scriptSrc).toContain("'self'");
    expect(directives?.scriptSrc).not.toContain("'unsafe-inline'");
    expect(directives?.scriptSrc).toContain(hashes[0]);
  });

  it("rejects cross-origin browser API requests", () => {
    let statusCode = 0;
    let body: unknown;
    let advanced = false;
    const req = {
      get: (name: string) =>
        name.toLowerCase() === "origin" ? "https://evil.example" : undefined,
    } as unknown as Request;
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(value: unknown) {
        body = value;
        return this;
      },
    } as unknown as Response;

    requireTrustedOrigin(req, res, (() => {
      advanced = true;
    }) as NextFunction);

    expect(statusCode).toBe(403);
    expect(body).toEqual({ error: "Untrusted request origin" });
    expect(advanced).toBe(false);
  });

  it("returns 429 after a client exceeds its request window", () => {
    const headers = new Map<string, string>();
    let statusCode = 0;
    let nextCalls = 0;
    const req = { ip: "192.0.2.1", socket: {} } as Request;
    const res = {
      setHeader(name: string, value: string) {
        headers.set(name, value);
      },
      status(code: number) {
        statusCode = code;
        return this;
      },
      json() {
        return this;
      },
    } as unknown as Response;
    const next = (() => {
      nextCalls += 1;
    }) as NextFunction;
    const limiter = createRateLimit({ windowMs: 60_000, max: 1 });

    limiter(req, res, next);
    limiter(req, res, next);

    expect(nextCalls).toBe(1);
    expect(statusCode).toBe(429);
    expect(headers.get("Retry-After")).toBeDefined();
  });
});
