import express from "express";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { stripeWebhookEvents, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { getStripe } from "./stripe";
import type { PlanId } from "./products";

type PaidPlanId = Extract<PlanId, "pro" | "team">;
type StoredSubscriptionStatus = "active" | "canceled" | "past_due" | "trialing";
type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const PLAN_RANK: Record<PlanId, number> = { free: 0, pro: 1, team: 2, enterprise: 3 };

export class InvalidStripeEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidStripeEventError";
  }
}

function requireStripeId(value: string | { id: string } | null, field: string): string {
  const id = typeof value === "string" ? value : value?.id;
  if (!id || !/^[a-z]+_[A-Za-z0-9_]+$/.test(id)) {
    throw new InvalidStripeEventError(`Stripe event is missing a valid ${field}`);
  }
  return id;
}

function requirePaidPlan(value: string | undefined): PaidPlanId {
  if (value !== "pro" && value !== "team") {
    throw new InvalidStripeEventError("Stripe event contains an unsupported plan");
  }
  return value;
}

function requireUserId(session: Stripe.Checkout.Session): number {
  const metadataId = session.metadata?.user_id;
  const referenceId = session.client_reference_id;
  if (metadataId && referenceId && metadataId !== referenceId) {
    throw new InvalidStripeEventError("Stripe checkout user identifiers do not match");
  }
  const userId = Number(metadataId || referenceId);
  if (!Number.isSafeInteger(userId) || userId < 1) {
    throw new InvalidStripeEventError("Stripe checkout is missing a valid user identifier");
  }
  return userId;
}

export function validateCheckoutSession(session: Stripe.Checkout.Session) {
  if (session.mode !== "subscription" || session.status !== "complete") {
    throw new InvalidStripeEventError("Checkout session is not a completed subscription");
  }
  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
    throw new InvalidStripeEventError("Checkout session payment is not complete");
  }
  return {
    userId: requireUserId(session),
    plan: requirePaidPlan(session.metadata?.plan_id),
    customerId: requireStripeId(session.customer, "customer ID"),
    subscriptionId: requireStripeId(session.subscription, "subscription ID"),
  };
}

export function normalizeSubscriptionStatus(status: Stripe.Subscription.Status): StoredSubscriptionStatus {
  if (status === "active") return "active";
  if (status === "trialing") return "trialing";
  if (status === "past_due") return "past_due";
  return "canceled";
}

export function getSubscriptionPlan(subscription: Stripe.Subscription): PaidPlanId {
  const planIds = new Set(
    subscription.items.data.map(item => item.price.metadata?.turath_plan).filter(Boolean),
  );
  if (planIds.size !== 1) {
    throw new InvalidStripeEventError("Subscription does not map to exactly one TURATH plan");
  }
  return requirePaidPlan(Array.from(planIds)[0]);
}

function getSubscriptionPeriodStart(subscription: Stripe.Subscription): number {
  const starts = subscription.items.data.map(item => item.current_period_start);
  const periodStart = starts.length > 0 ? Math.min(...starts) : 0;
  if (!Number.isSafeInteger(periodStart) || periodStart < 1) {
    throw new InvalidStripeEventError("Subscription is missing a valid billing period");
  }
  return periodStart;
}

async function applyCheckoutEvent(
  tx: DatabaseTransaction,
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
  subscription: Stripe.Subscription,
): Promise<void> {
  const checkout = validateCheckoutSession(session);
  const subscriptionCustomerId = requireStripeId(subscription.customer, "subscription customer ID");
  if (subscription.id !== checkout.subscriptionId || subscriptionCustomerId !== checkout.customerId) {
    throw new InvalidStripeEventError("Checkout does not match its Stripe subscription");
  }
  const subscriptionStatus = normalizeSubscriptionStatus(subscription.status);
  if (subscriptionStatus !== "active" && subscriptionStatus !== "trialing") {
    throw new InvalidStripeEventError("Checkout subscription is not active or trialing");
  }
  if (getSubscriptionPlan(subscription) !== checkout.plan) {
    throw new InvalidStripeEventError("Checkout metadata does not match the purchased Stripe price");
  }
  const periodStart = getSubscriptionPeriodStart(subscription);
  const account = await tx.select().from(users).where(eq(users.id, checkout.userId)).limit(1).for("update");
  if (!account[0]) throw new Error(`Checkout references unknown user ${checkout.userId}`);
  const checkoutLockId = session.metadata?.checkout_lock_id;
  if (account[0].pendingStripeCheckoutSessionId && account[0].pendingStripeCheckoutSessionId !== session.id) {
    throw new InvalidStripeEventError("Checkout session does not match the pending billing session");
  }
  if (account[0].pendingStripeCheckoutLockId && account[0].pendingStripeCheckoutLockId !== checkoutLockId) {
    throw new InvalidStripeEventError("Checkout lock does not match the pending billing session");
  }
  if (account[0].stripeCustomerId && account[0].stripeCustomerId !== checkout.customerId) {
    throw new InvalidStripeEventError("Checkout customer does not match the user's billing account");
  }
  if (account[0].lastStripeEventCreatedAt > event.created) return;
  if (account[0].lastStripeEventCreatedAt === event.created && account[0].stripeSubscriptionStatus === "canceled") return;
  // Checkout is an upgrade-only path. Downgrades are reconciled from the
  // subscription object delivered by Stripe's customer portal workflow.
  if (PLAN_RANK[checkout.plan] < PLAN_RANK[account[0].plan]) return;
  const resetQuota = periodStart > account[0].quotaPeriodStartedAt;

  await tx.update(users).set({
    stripeCustomerId: checkout.customerId,
    stripeSubscriptionId: checkout.subscriptionId,
    stripeSubscriptionStatus: subscriptionStatus,
    lastStripeEventCreatedAt: event.created,
    plan: checkout.plan,
    quotaPeriodStartedAt: resetQuota ? periodStart : account[0].quotaPeriodStartedAt,
    documentQuotaUsed: resetQuota ? 0 : account[0].documentQuotaUsed,
    transcriptionQuotaUsed: resetQuota ? 0 : account[0].transcriptionQuotaUsed,
    pendingStripeCheckoutLockId: null,
    pendingStripeCheckoutSessionId: null,
    pendingStripeCheckoutExpiresAt: null,
    updatedAt: new Date(),
  }).where(eq(users.id, checkout.userId));
}

async function applyExpiredCheckoutEvent(
  tx: DatabaseTransaction,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const userId = requireUserId(session);
  const account = await tx.select().from(users).where(eq(users.id, userId)).limit(1).for("update");
  if (!account[0]) return;
  if (account[0].pendingStripeCheckoutSessionId !== session.id) return;
  await tx.update(users).set({
    pendingStripeCheckoutLockId: null,
    pendingStripeCheckoutSessionId: null,
    pendingStripeCheckoutExpiresAt: null,
  }).where(eq(users.id, userId));
}

async function applyPaidInvoiceEvent(
  tx: DatabaseTransaction,
  invoice: Stripe.Invoice,
): Promise<void> {
  if (invoice.status !== "paid" || !Number.isSafeInteger(invoice.period_start) || invoice.period_start < 1) {
    throw new InvalidStripeEventError("Paid invoice event is missing a valid billing period");
  }
  const subscriptionId = requireStripeId(
    invoice.parent?.subscription_details?.subscription ?? null,
    "invoice subscription ID",
  );
  const customerId = requireStripeId(invoice.customer, "invoice customer ID");
  const accounts = await tx.select().from(users).where(eq(users.stripeCustomerId, customerId)).limit(2).for("update");
  if (accounts.length !== 1) throw new Error(`Stripe customer ${customerId} is not mapped to exactly one user`);
  if (accounts[0].stripeSubscriptionId && accounts[0].stripeSubscriptionId !== subscriptionId) return;
  if (invoice.period_start <= accounts[0].quotaPeriodStartedAt) return;
  await tx.update(users).set({
    quotaPeriodStartedAt: invoice.period_start,
    documentQuotaUsed: 0,
    transcriptionQuotaUsed: 0,
    updatedAt: new Date(),
  }).where(eq(users.id, accounts[0].id));
}

async function applySubscriptionEvent(
  tx: DatabaseTransaction,
  event: Stripe.Event,
  subscription: Stripe.Subscription,
  deleted: boolean,
): Promise<void> {
  const customerId = requireStripeId(subscription.customer, "customer ID");
  const subscriptionId = requireStripeId(subscription.id, "subscription ID");
  const accounts = await tx.select().from(users).where(eq(users.stripeCustomerId, customerId)).limit(2).for("update");
  if (accounts.length !== 1) throw new Error(`Stripe customer ${customerId} is not mapped to exactly one user`);

  const account = accounts[0];
  // A delayed cancellation for an old subscription must never downgrade a newer one.
  if (account.stripeSubscriptionId && account.stripeSubscriptionId !== subscriptionId) {
    if (deleted) return;
    throw new InvalidStripeEventError("Subscription does not match the user's active subscription");
  }
  if (account.lastStripeEventCreatedAt > event.created) return;
  if (!deleted && account.lastStripeEventCreatedAt === event.created && account.stripeSubscriptionStatus === "canceled") return;

  const status = deleted ? "canceled" : normalizeSubscriptionStatus(subscription.status);
  const paid = status === "active" || status === "trialing";
  const plan = paid ? getSubscriptionPlan(subscription) : "free";
  const periodStart = paid ? getSubscriptionPeriodStart(subscription) : account.quotaPeriodStartedAt;
  const resetQuota = paid && periodStart > account.quotaPeriodStartedAt;
  await tx.update(users).set({
    stripeSubscriptionId: subscriptionId,
    stripeSubscriptionStatus: status,
    lastStripeEventCreatedAt: event.created,
    plan,
    quotaPeriodStartedAt: resetQuota ? periodStart : account.quotaPeriodStartedAt,
    documentQuotaUsed: resetQuota ? 0 : account.documentQuotaUsed,
    transcriptionQuotaUsed: resetQuota ? 0 : account.transcriptionQuotaUsed,
    updatedAt: new Date(),
  }).where(eq(users.id, account.id));
}

async function processEventTransactionally(
  event: Stripe.Event,
  authoritativeSubscription?: Stripe.Subscription,
): Promise<"processed" | "duplicate"> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async tx => {
    const claimed = await tx.insert(stripeWebhookEvents).values({
      eventId: event.id,
      eventType: event.type,
      stripeCreatedAt: event.created,
    }).onConflictDoNothing({ target: stripeWebhookEvents.eventId }).returning({ eventId: stripeWebhookEvents.eventId });

    if (!claimed[0]) return "duplicate" as const;

    switch (event.type) {
      case "checkout.session.completed":
        if (!authoritativeSubscription) throw new Error("Authoritative subscription was not loaded");
        await applyCheckoutEvent(tx, event, event.data.object as Stripe.Checkout.Session, authoritativeSubscription);
        break;
      case "checkout.session.expired":
        await applyExpiredCheckoutEvent(tx, event.data.object as Stripe.Checkout.Session);
        break;
      case "customer.subscription.updated":
        if (!authoritativeSubscription) throw new Error("Authoritative subscription was not loaded");
        await applySubscriptionEvent(tx, event, authoritativeSubscription, false);
        break;
      case "customer.subscription.deleted":
        await applySubscriptionEvent(tx, event, event.data.object as Stripe.Subscription, true);
        break;
      case "invoice.paid":
        await applyPaidInvoiceEvent(tx, event.data.object as Stripe.Invoice);
        break;
      default:
        // Recording ignored, verified events is intentional: repeated deliveries
        // remain idempotent and the audit trail shows they were received.
        break;
    }
    return "processed" as const;
  });
}

export function registerStripeWebhook(app: express.Application) {
  // MUST be registered BEFORE express.json() middleware.
  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json", limit: "256kb" }),
    async (req, res) => {
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      const secretKey = process.env.STRIPE_SECRET_KEY || process.env.Stripe_Secret_Key;
      if (!webhookSecret || !secretKey) {
        console.error("[Stripe Webhook] Stripe signing configuration is missing");
        return res.status(503).json({ error: "Stripe webhook unavailable" });
      }

      const signature = req.headers["stripe-signature"];
      if (typeof signature !== "string" || !Buffer.isBuffer(req.body)) {
        return res.status(400).json({ error: "Invalid Stripe webhook request" });
      }

      let event: Stripe.Event;
      try {
        event = getStripe().webhooks.constructEvent(req.body, signature, webhookSecret);
      } catch (error) {
        console.warn("[Stripe Webhook] Signature verification failed", error instanceof Error ? error.message : error);
        return res.status(400).json({ error: "Invalid Stripe webhook signature" });
      }

      try {
        let authoritativeSubscription: Stripe.Subscription | undefined;
        if (event.type === "checkout.session.completed") {
          const checkout = validateCheckoutSession(event.data.object as Stripe.Checkout.Session);
          authoritativeSubscription = await getStripe().subscriptions.retrieve(checkout.subscriptionId);
        } else if (event.type === "customer.subscription.updated") {
          const subscription = event.data.object as Stripe.Subscription;
          authoritativeSubscription = await getStripe().subscriptions.retrieve(subscription.id);
        }

        const result = await processEventTransactionally(event, authoritativeSubscription);
        return res.status(200).json({ received: true, duplicate: result === "duplicate" });
      } catch (error) {
        console.error("[Stripe Webhook] Processing failed", error);
        const status = error instanceof InvalidStripeEventError ? 422 : 500;
        return res.status(status).json({ error: "Stripe webhook processing failed" });
      }
    },
  );
}
