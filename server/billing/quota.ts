import crypto from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { getDb, type DocumentQuotaStatus } from "../db";
import { PLANS, isUnlimitedOwnerEmail, type PaidPlanId } from "./products";

export type BillingExecutor = { execute: (query: SQL) => PromiseLike<any> };
export async function rows<T = any>(
  db: BillingExecutor,
  query: SQL
): Promise<T[]> {
  const result = await db.execute(query);
  return Array.isArray(result) ? result : result.rows;
}

export async function quotaInTransaction(
  tx: BillingExecutor,
  userId: number,
  reserve: boolean
): Promise<DocumentQuotaStatus> {
  // The same user-row lock is used by webhooks and releases: no renewal/reservation race.
  const [user] = await rows(
    tx,
    sql`SELECT id, email, "documentQuotaUsed" FROM users WHERE id=${userId} FOR UPDATE`
  );
  if (!user) throw new Error("User not found");
  if (isUnlimitedOwnerEmail(user.email))
    return {
      allowed: true,
      quotaReserved: false,
      plan: "owner",
      documentLimit: null,
      documentsUsed: user.documentQuotaUsed,
      documentsRemaining: null,
    };
  await tx.execute(
    sql`INSERT INTO billing_accounts(user_id) VALUES(${userId}) ON CONFLICT DO NOTHING`
  );
  const [account] = await rows(
    tx,
    sql`SELECT *, (period_start <= now() AND period_end > now()) AS current FROM billing_accounts WHERE user_id=${userId}`
  );
  const paid =
    account?.current &&
    account.period_key &&
    ["pro", "team", "enterprise"].includes(account.plan);
  const plan = paid ? (account.plan as PaidPlanId) : "free";
  const limit = PLANS[plan].documentLimit;
  let used = Number(user.documentQuotaUsed);
  if (paid) {
    const [usage] = await rows(
      tx,
      sql`SELECT used FROM billing_usage WHERE user_id=${userId} AND period_key=${account.period_key}`
    );
    used = Number(usage?.used ?? 0);
  }
  const allowed = used < limit;
  let reservationId: string | undefined;
  if (reserve && allowed) {
    reservationId = crypto.randomUUID();
    if (paid) {
      await tx.execute(sql`INSERT INTO billing_usage(user_id,period_key,used) VALUES(${userId},${account.period_key},1)
        ON CONFLICT(user_id,period_key) DO UPDATE SET used=billing_usage.used+1`);
    } else {
      await tx.execute(
        sql`UPDATE users SET "documentQuotaUsed"="documentQuotaUsed"+1 WHERE id=${userId}`
      );
    }
    await tx.execute(
      sql`INSERT INTO billing_reservations(id,user_id,period_key) VALUES(${reservationId},${userId},${paid ? account.period_key : null})`
    );
    used++;
  }
  return {
    allowed,
    quotaReserved: Boolean(reservationId),
    reservationId,
    plan,
    documentLimit: limit,
    documentsUsed: used,
    documentsRemaining: Math.max(0, limit - used),
    resetsAt: paid ? new Date(account.period_end).toISOString() : null,
    cancelAtPeriodEnd: Boolean(paid && account.cancel_at_period_end),
  };
}

export async function readOrReserveQuota(userId: number, reserve = false) {
  const db = await getDb();
  if (!db)
    throw new Error("Database unavailable while checking document usage");
  return db.transaction(tx => quotaInTransaction(tx, userId, reserve));
}

export async function releaseInTransaction(
  tx: BillingExecutor,
  userId: number,
  reservationId: string
) {
  await tx.execute(sql`SELECT id FROM users WHERE id=${userId} FOR UPDATE`);
  const [released] = await rows(
    tx,
    sql`UPDATE billing_reservations SET released=true WHERE id=${reservationId} AND user_id=${userId} AND released=false RETURNING period_key`
  );
  if (!released) return;
  if (released.period_key) {
    await tx.execute(
      sql`UPDATE billing_usage SET used=GREATEST(used-1,0) WHERE user_id=${userId} AND period_key=${released.period_key}`
    );
  } else {
    await tx.execute(
      sql`UPDATE users SET "documentQuotaUsed"=GREATEST("documentQuotaUsed"-1,0) WHERE id=${userId}`
    );
  }
}

export async function releaseQuota(userId: number, reservationId?: string) {
  if (!reservationId) return; // Never decrement a different request or billing period.
  const db = await getDb();
  if (!db)
    throw new Error("Database unavailable while releasing document usage");
  await db.transaction(tx => releaseInTransaction(tx, userId, reservationId));
}
