import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { users } from "../../drizzle/schema";
import { getDb } from "../db";

const PROVISIONAL_LOCK_MS = 40 * 60 * 1000;

export type CheckoutClaim = {
  lockId: string;
  email: string | null;
  name: string | null;
  stripeCustomerId: string | null;
};

export async function claimCheckoutLock(
  userId: number,
  targetPlan: "pro" | "team"
): Promise<CheckoutClaim | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const now = new Date();
  const lockId = randomUUID();
  const claimed = await db.update(users).set({
    pendingStripeCheckoutLockId: lockId,
    pendingStripeCheckoutSessionId: null,
    pendingStripeCheckoutExpiresAt: new Date(now.getTime() + PROVISIONAL_LOCK_MS),
  }).where(and(
    eq(users.id, userId),
    or(isNull(users.pendingStripeCheckoutExpiresAt), lt(users.pendingStripeCheckoutExpiresAt, now)),
    or(isNull(users.stripeSubscriptionId), eq(users.stripeSubscriptionStatus, "canceled")),
    targetPlan === "pro" ? eq(users.plan, "free") : inArray(users.plan, ["free", "pro"]),
  )).returning({
    email: users.email,
    name: users.name,
    stripeCustomerId: users.stripeCustomerId,
  });
  return claimed[0] ? { lockId, ...claimed[0] } : null;
}

export async function recordCheckoutSession(
  userId: number,
  lockId: string,
  sessionId: string,
  expiresAt: Date,
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updated = await db.update(users).set({
    pendingStripeCheckoutSessionId: sessionId,
    pendingStripeCheckoutExpiresAt: expiresAt,
  }).where(and(eq(users.id, userId), eq(users.pendingStripeCheckoutLockId, lockId)))
    .returning({ id: users.id });
  return Boolean(updated[0]);
}

export async function releaseCheckoutLock(userId: number, lockId: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({
    pendingStripeCheckoutLockId: null,
    pendingStripeCheckoutSessionId: null,
    pendingStripeCheckoutExpiresAt: null,
  }).where(and(eq(users.id, userId), eq(users.pendingStripeCheckoutLockId, lockId)));
}
