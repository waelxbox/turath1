import { and, eq, isNull, or, sql } from "drizzle-orm";
import { users } from "../../drizzle/schema";
import { getDb } from "../db";
import { PLANS, type PlanId } from "./products";

export type QuotaKind = "document" | "transcription";

export class QuotaExceededError extends Error {
  constructor(
    public readonly kind: QuotaKind,
    public readonly limit: number,
  ) {
    super(`${kind === "document" ? "Document" : "Transcription"} quota reached (${limit}). Upgrade the project owner's plan to continue.`);
    this.name = "QuotaExceededError";
  }
}

/** Pricing is fail-closed by default. Local development may explicitly disable it. */
export function isPricingEnabled(
  value = process.env.TURATH_PRICING_ENABLED,
  nodeEnv = process.env.NODE_ENV,
): boolean {
  if (nodeEnv === "production") return true;
  return value !== "false";
}

export function getQuotaLimit(plan: PlanId, kind: QuotaKind): number {
  return kind === "document" ? PLANS[plan].documentLimit : PLANS[plan].transcriptionLimit;
}

function planLimitSql(kind: QuotaKind) {
  const limits = kind === "document"
    ? [PLANS.free.documentLimit, PLANS.pro.documentLimit, PLANS.team.documentLimit]
    : [PLANS.free.transcriptionLimit, PLANS.pro.transcriptionLimit, PLANS.team.transcriptionLimit];
  return sql<number>`CASE ${users.plan}
    WHEN 'free' THEN ${limits[0]}
    WHEN 'pro' THEN ${limits[1]}
    WHEN 'team' THEN ${limits[2]}
    ELSE 2147483647
  END`;
}

async function reserveQuota(userId: number, kind: QuotaKind, count = 1): Promise<void> {
  if (!isPricingEnabled()) return;
  if (!Number.isSafeInteger(count) || count < 1) throw new Error("Quota reservation count must be a positive integer");

  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const column = kind === "document" ? users.documentQuotaUsed : users.transcriptionQuotaUsed;
  const field = kind === "document" ? "documentQuotaUsed" : "transcriptionQuotaUsed";

  // The limit predicate and increment execute as one UPDATE. Concurrent requests
  // serialize on the user row and cannot both consume the final quota slot.
  const reserved = await db
    .update(users)
    .set({ [field]: sql`${column} + ${count}` })
    .where(and(
      eq(users.id, userId),
      or(eq(users.plan, "enterprise"), sql`${column} + ${count} <= ${planLimitSql(kind)}`),
    ))
    .returning({ plan: users.plan });

  if (reserved[0]) return;
  const account = await db.select({ plan: users.plan }).from(users).where(eq(users.id, userId)).limit(1);
  if (!account[0]) throw new Error("Quota owner not found");
  throw new QuotaExceededError(kind, getQuotaLimit(account[0].plan, kind));
}

async function releaseQuota(userId: number, kind: QuotaKind, count = 1): Promise<void> {
  if (!isPricingEnabled()) return;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const column = kind === "document" ? users.documentQuotaUsed : users.transcriptionQuotaUsed;
  const field = kind === "document" ? "documentQuotaUsed" : "transcriptionQuotaUsed";
  await db.update(users).set({
    [field]: sql`GREATEST(${column} - ${count}, 0)`,
  }).where(eq(users.id, userId));
}

export const reserveDocumentQuota = (userId: number, count = 1) => reserveQuota(userId, "document", count);
export const releaseDocumentQuota = (userId: number) => releaseQuota(userId, "document");
export const reserveTranscriptionQuota = (userId: number, count = 1) => reserveQuota(userId, "transcription", count);

export async function claimDemoProject(userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const claimed = await db.update(users).set({ demoProjectCreatedAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.demoProjectCreatedAt)))
    .returning({ id: users.id });
  return Boolean(claimed[0]);
}

export async function releaseDemoProjectClaim(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ demoProjectCreatedAt: null }).where(eq(users.id, userId));
}
