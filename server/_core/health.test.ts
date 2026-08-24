import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "../db";
import {
  beginShutdown,
  getReadiness,
  resetHealthStateForTests,
} from "./health";

const validEnvironment = {
  SUPABASE_DATABASE_URL: "postgresql://user:password@database.example/turath",
  JWT_SECRET: "a-secure-secret-with-more-than-32-bytes",
  GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "google-secret",
  BUILT_IN_FORGE_API_URL: "https://forge.example/v1",
  BUILT_IN_FORGE_API_KEY: "forge-secret",
};

describe("readiness", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    for (const [key, value] of Object.entries(validEnvironment)) {
      vi.stubEnv(key, value);
    }
    vi.stubEnv("TURATH_PRICING_ENABLED", "false");
    resetHealthStateForTests();
    vi.mocked(getDb).mockReset();
  });

  it("passes only when configuration and the database are healthy", async () => {
    vi.mocked(getDb).mockResolvedValue({
      execute: vi.fn().mockResolvedValue([]),
    } as never);

    const result = await getReadiness({ bypassCache: true });

    expect(result.ok).toBe(true);
    expect(result.checks.database.status).toBe("pass");
    expect(result.checks.configuration.status).toBe("pass");
  });

  it("fails without exposing the database error", async () => {
    vi.mocked(getDb).mockResolvedValue({
      execute: vi
        .fn()
        .mockRejectedValue(
          new Error("password secret@private-host was rejected")
        ),
    } as never);

    const result = await getReadiness({ bypassCache: true });

    expect(result.ok).toBe(false);
    expect(result.checks.database).toMatchObject({
      status: "fail",
      message: "database connectivity check failed",
    });
    expect(JSON.stringify(result)).not.toContain("private-host");
  });

  it("becomes unready as soon as shutdown begins", async () => {
    vi.mocked(getDb).mockResolvedValue({
      execute: vi.fn().mockResolvedValue([]),
    } as never);
    beginShutdown();

    const result = await getReadiness({ bypassCache: true });

    expect(result.ok).toBe(false);
    expect(result.checks.shutdown.status).toBe("fail");
  });
});
