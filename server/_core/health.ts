import type { Express } from "express";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { validateRuntimeConfig } from "./runtimeConfig";

type CheckResult = {
  status: "pass" | "fail";
  durationMs?: number;
  message?: string;
};

export type ReadinessResult = {
  ok: boolean;
  status: "ready" | "not_ready";
  timestamp: string;
  checks: {
    configuration: CheckResult;
    database: CheckResult;
    shutdown: CheckResult;
  };
};

const DATABASE_CHECK_TIMEOUT_MS = 3_000;
const READINESS_CACHE_MS = 5_000;

let shuttingDown = false;
let cachedReadiness: { expiresAt: number; result: ReadinessResult } | null =
  null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function checkDatabase(): Promise<CheckResult> {
  const startedAt = Date.now();
  try {
    const db = await getDb();
    if (!db) throw new Error("database is not configured");
    await withTimeout(db.execute(sql`select 1`), DATABASE_CHECK_TIMEOUT_MS);
    return { status: "pass", durationMs: Date.now() - startedAt };
  } catch (error) {
    return {
      status: "fail",
      durationMs: Date.now() - startedAt,
      message: errorMessage(error).includes("timed out")
        ? "database connectivity check timed out"
        : "database connectivity check failed",
    };
  }
}

export function beginShutdown(): void {
  shuttingDown = true;
  cachedReadiness = null;
}

export function resetHealthStateForTests(): void {
  shuttingDown = false;
  cachedReadiness = null;
}

export async function getReadiness(
  options: { bypassCache?: boolean } = {}
): Promise<ReadinessResult> {
  const now = Date.now();
  const cached = cachedReadiness;
  if (
    !options.bypassCache &&
    cached &&
    cached.expiresAt > now &&
    !shuttingDown
  ) {
    return cached.result;
  }

  const configIssues = validateRuntimeConfig();
  const configuration: CheckResult =
    configIssues.length === 0
      ? { status: "pass" }
      : {
          status: "fail",
          message: `${configIssues.length} required setting(s) are invalid`,
        };
  const database = await checkDatabase();
  const shutdown: CheckResult = shuttingDown
    ? { status: "fail", message: "server is shutting down" }
    : { status: "pass" };
  const ok = [configuration, database, shutdown].every(
    check => check.status === "pass"
  );
  const result: ReadinessResult = {
    ok,
    status: ok ? "ready" : "not_ready",
    timestamp: new Date().toISOString(),
    checks: { configuration, database, shutdown },
  };

  if (!shuttingDown) {
    cachedReadiness = { expiresAt: now + READINESS_CACHE_MS, result };
  }
  return result;
}

export function registerHealthRoutes(app: Express): void {
  app.get("/health/live", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      ok: true,
      status: "alive",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  app.get("/health/ready", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const readiness = await getReadiness();
    res.status(readiness.ok ? 200 : 503).json(readiness);
  });
}
