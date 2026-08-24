import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";

// ─── Auth helpers ─────────────────────────────────────────────────────────────

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(role: "user" | "admin" = "user"): { ctx: TrpcContext; clearedCookies: { name: string; options: Record<string, unknown> }[] } {
  const clearedCookies: { name: string; options: Record<string, unknown> }[] = [];

  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-openid",
    email: "researcher@example.com",
    name: "Dr. Test Researcher",
    loginMethod: "manus",
    role,
    plan: "free",
    stripeCustomerId: null,
    documentQuotaUsed: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as TrpcContext["res"],
  };

  return { ctx, clearedCookies };
}

function createUnauthContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

// ─── Auth tests ───────────────────────────────────────────────────────────────

describe("auth", () => {
  it("returns null user when unauthenticated", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    const user = await caller.auth.me();
    expect(user).toBeNull();
  });

  it("returns user when authenticated", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const user = await caller.auth.me();
    expect(user).toBeDefined();
    expect(user?.email).toBe("researcher@example.com");
    expect(user?.role).toBe("user");
  });

  it("clears session cookie on logout", async () => {
    const { ctx, clearedCookies } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();
    expect(result).toEqual({ success: true });
    expect(clearedCookies).toHaveLength(1);
    expect(clearedCookies[0]?.name).toBe(COOKIE_NAME);
    expect(clearedCookies[0]?.options).toMatchObject({ maxAge: -1, httpOnly: true });
  });
});

// ─── Projects router tests ────────────────────────────────────────────────────

describe("projects.list", () => {
  it("throws UNAUTHORIZED when not logged in", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.projects.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("projects.create", () => {
  it("throws UNAUTHORIZED when not logged in", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.projects.create({ name: "Test Archive" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("projects.get", () => {
  it("throws UNAUTHORIZED when not logged in", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.projects.get({ id: 1 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// ─── Onboarding router tests ──────────────────────────────────────────────────

describe("onboarding.getSamples", () => {
  it("throws UNAUTHORIZED when not logged in", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.onboarding.getSamples({ projectId: 1 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
