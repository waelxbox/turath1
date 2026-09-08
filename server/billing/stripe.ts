import Stripe from "stripe";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { rows, type BillingExecutor } from "./quota";
import {
  BILLING_LAUNCH_ENABLED,
  PAID_PLAN_IDS,
  PLANS,
  isUnlimitedOwnerEmail,
  type PaidPlanId,
} from "./products";

export function stripePriceIds(): Record<PaidPlanId, string> {
  return {
    pro: process.env.STRIPE_PRICE_PRO ?? "",
    team: process.env.STRIPE_PRICE_TEAM ?? "",
    enterprise: process.env.STRIPE_PRICE_ARCHIVE ?? "",
  };
}
export function billingOrigin() {
  const url = new URL(process.env.TURATH_APP_URL || "https://turath.app");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("TURATH_APP_URL must be an HTTPS origin");
  return url.origin;
}
export function isPricingEnabled() {
  const ids = Object.values(stripePriceIds());
  return (
    BILLING_LAUNCH_ENABLED &&
    process.env.TURATH_PRICING_ENABLED === "true" &&
    Boolean(process.env.STRIPE_SECRET_KEY || process.env.Stripe_Secret_Key) &&
    Boolean(process.env.STRIPE_WEBHOOK_SECRET) &&
    /^bpc_/.test(process.env.STRIPE_PORTAL_CONFIGURATION ?? "") &&
    ids.every(id => /^price_/.test(id)) &&
    new Set(ids).size === 3
  );
}
export function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY || process.env.Stripe_Secret_Key;
  if (!key) throw new Error("Stripe is not configured");
  return new Stripe(key, {
    apiVersion: "2024-12-18.acacia" as any,
    timeout: 20_000,
    maxNetworkRetries: 1,
  });
}
export function validatePrice(price: Stripe.Price, plan: PaidPlanId) {
  if (
    !price.active ||
    price.currency !== "usd" ||
    price.unit_amount !== PLANS[plan].priceMonthly ||
    price.billing_scheme !== "per_unit" ||
    price.recurring?.interval !== "month" ||
    price.recurring.interval_count !== 1 ||
    price.recurring.usage_type !== "licensed"
  ) {
    throw new Error(
      `Stripe price does not match the published ${PLANS[plan].name} plan`
    );
  }
}
export async function validateConfiguredPrices(stripe = getStripe()) {
  const ids = stripePriceIds();
  const key =
    process.env.STRIPE_SECRET_KEY || process.env.Stripe_Secret_Key || "";
  for (const plan of PAID_PLAN_IDS) {
    const price = await stripe.prices.retrieve(ids[plan]);
    validatePrice(price, plan);
    if (price.livemode !== /^(sk|rk)_live_/.test(key))
      throw new Error("Stripe price and key modes do not match");
  }
}

export async function createCheckoutSession(
  opts: {
    userId: number;
    userEmail: string;
    userName: string;
    planId: PaidPlanId;
    stripeCustomerId?: string | null;
    origin?: string;
  },
  stripeClient?: Stripe
) {
  if (!isPricingEnabled())
    throw new Error("Paid checkout is not configured yet");
  const stripe = stripeClient ?? getStripe();
  const priceId = stripePriceIds()[opts.planId];
  validatePrice(await stripe.prices.retrieve(priceId), opts.planId);
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db.transaction(async tx => {
    const [user] = await rows(
      tx,
      sql`SELECT id,email,"stripeCustomerId" FROM users WHERE id=${opts.userId} FOR UPDATE`
    );
    if (!user || isUnlimitedOwnerEmail(user.email))
      throw new Error("This account does not need a paid subscription");
    let customerId: string = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create(
        {
          email: user.email || undefined,
          name: opts.userName || undefined,
          metadata: { turath_user_id: String(opts.userId) },
        },
        { idempotencyKey: `turath-customer-${opts.userId}` }
      );
      customerId = customer.id;
      await tx.execute(
        sql`UPDATE users SET "stripeCustomerId"=${customerId} WHERE id=${opts.userId}`
      );
    }
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
    });
    if (
      subscriptions.has_more ||
      subscriptions.data.some(
        sub => !["canceled", "incomplete_expired"].includes(sub.status)
      )
    )
      throw new Error(
        "You already have a subscription. Use Manage subscription to update or cancel it."
      );
    await tx.execute(
      sql`INSERT INTO billing_accounts(user_id) VALUES(${opts.userId}) ON CONFLICT DO NOTHING`
    );
    const [account] = await rows(
      tx,
      sql`SELECT checkout_id,checkout_plan FROM billing_accounts WHERE user_id=${opts.userId}`
    );
    if (account.checkout_id) {
      const previous = await stripe.checkout.sessions.retrieve(
        account.checkout_id,
        { expand: ["line_items"] }
      );
      if (previous.status === "open") {
        if (
          account.checkout_plan === opts.planId &&
          previous.url &&
          previous.line_items?.data.length === 1 &&
          previous.line_items.data[0].price?.id === priceId &&
          previous.line_items.data[0].quantity === 1
        )
          return previous.url;
        await stripe.checkout.sessions.expire(previous.id);
      } else if (previous.status === "complete") {
        const subId =
          typeof previous.subscription === "string"
            ? previous.subscription
            : previous.subscription?.id;
        if (
          subId &&
          !["canceled", "incomplete_expired"].includes(
            (await stripe.subscriptions.retrieve(subId)).status
          )
        )
          throw new Error(
            "Payment is being synchronized. Refresh billing shortly."
          );
      }
    }
    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: customerId,
        client_reference_id: String(opts.userId),
        line_items: [{ price: priceId, quantity: 1 }],
        payment_method_types: ["card"],
        success_url: `${billingOrigin()}/settings/billing?success=true`,
        cancel_url: `${billingOrigin()}/settings/billing?canceled=true`,
        metadata: { user_id: String(opts.userId), plan_id: opts.planId },
        subscription_data: {
          metadata: { turath_user_id: String(opts.userId) },
        },
      },
      {
        idempotencyKey: `turath-checkout-${opts.userId}-${opts.planId}-${account.checkout_id ?? "first"}`,
      }
    );
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    await tx.execute(
      sql`UPDATE billing_accounts SET checkout_id=${session.id},checkout_plan=${opts.planId} WHERE user_id=${opts.userId}`
    );
    return session.url;
  });
}

export async function createPortalSession(customerId: string) {
  const configuration = process.env.STRIPE_PORTAL_CONFIGURATION;
  if (!configuration) throw new Error("Billing portal configuration missing");
  const session = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    configuration,
    return_url: `${billingOrigin()}/settings/billing`,
  });
  return session.url;
}

/** Only current, paid, recognized monthly subscriptions confer capacity. */
export function paidEntitlement(sub: Stripe.Subscription, now = Date.now()) {
  if (sub.status !== "active" || sub.items.data.length !== 1) return null;
  const item = sub.items.data[0];
  const plan = PAID_PLAN_IDS.find(
    plan => stripePriceIds()[plan] === item.price.id
  );
  if (!plan || item.quantity !== 1) return null;
  validatePrice(item.price, plan);
  const invoice = sub.latest_invoice;
  if (!invoice || typeof invoice === "string" || invoice.status !== "paid")
    return null;
  const period = sub as unknown as {
    current_period_start?: number;
    current_period_end?: number;
  };
  const itemPeriod = item as unknown as {
    current_period_start?: number;
    current_period_end?: number;
  };
  const start = period.current_period_start ?? itemPeriod.current_period_start;
  const end = period.current_period_end ?? itemPeriod.current_period_end;
  if (!start || !end || end <= start || start * 1000 > now || end * 1000 <= now)
    return null;
  return {
    plan,
    start: new Date(start * 1000),
    end: new Date(end * 1000),
    periodKey: `${sub.id}:${start}`,
    subscriptionId: sub.id,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  };
}

async function reconciliationNow(
  stripe: Stripe,
  subscriptions: Stripe.Subscription[]
) {
  const clockIds = new Set(
    subscriptions
      .map(sub =>
        typeof sub.test_clock === "string"
          ? sub.test_clock
          : sub.test_clock?.id
      )
      .filter((id): id is string => Boolean(id))
  );
  if (clockIds.size === 0) return Date.now();
  if (clockIds.size > 1)
    throw new Error("Multiple Stripe test clocks require operator review");
  const clockId = Array.from(clockIds)[0];
  const clock = await stripe.testHelpers.testClocks.retrieve(clockId);
  return clock.frozen_time * 1000;
}

export async function syncCustomerInTransaction(
  tx: BillingExecutor,
  customerId: string,
  stripe: Stripe
) {
  const [user] = await rows(
    tx,
    sql`SELECT id FROM users WHERE "stripeCustomerId"=${customerId} FOR UPDATE`
  );
  if (!user) {
    // Checkout may emit events before the local customer binding transaction commits.
    // Retry TURATH customer events rather than acknowledging and losing the payment.
    const customer = await stripe.customers.retrieve(customerId);
    if (!customer.deleted && customer.metadata.turath_user_id)
      throw new Error("Customer binding is not committed yet; retry event");
    return; // Unrelated merchant customer.
  }
  // Fetch current Stripe state under the account lock, never apply stale event snapshots.
  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 100,
    expand: ["data.latest_invoice"],
  });
  if (subscriptions.has_more)
    throw new Error("Too many subscriptions to reconcile safely");
  const effectiveNow = await reconciliationNow(stripe, subscriptions.data);
  const entitlements = subscriptions.data.flatMap(sub => {
    const paid = paidEntitlement(sub, effectiveNow);
    return paid ? [paid] : [];
  });
  if (entitlements.length > 1)
    throw new Error("Multiple paid subscriptions require operator review");
  const entitlement = entitlements[0];
  await tx.execute(
    sql`INSERT INTO billing_accounts(user_id) VALUES(${user.id}) ON CONFLICT DO NOTHING`
  );
  if (entitlement) {
    await tx.execute(sql`UPDATE billing_accounts SET plan=${entitlement.plan},subscription_id=${entitlement.subscriptionId},
      period_start=${entitlement.start.toISOString()},period_end=${entitlement.end.toISOString()},period_key=${entitlement.periodKey},
      cancel_at_period_end=${entitlement.cancelAtPeriodEnd},subscription_status='active',synced_at=now() WHERE user_id=${user.id}`);
    await tx.execute(
      sql`UPDATE users SET plan=${entitlement.plan} WHERE id=${user.id}`
    );
  } else {
    const [prior] = await rows(
      tx,
      sql`SELECT * FROM billing_accounts WHERE user_id=${user.id}`
    );
    const previousSub = subscriptions.data.find(
      sub => sub.id === prior.subscription_id
    );
    // Preserve already-paid time during recovery; never extend it without a paid invoice.
    if (
      previousSub &&
      ["active", "past_due"].includes(previousSub.status) &&
      prior.period_end &&
      new Date(prior.period_end).getTime() > effectiveNow
    ) {
      await tx.execute(
        sql`UPDATE billing_accounts SET subscription_status=${previousSub.status},synced_at=now() WHERE user_id=${user.id}`
      );
    } else {
      await tx.execute(
        sql`UPDATE billing_accounts SET plan='free',subscription_status=${previousSub?.status ?? "none"},period_end=NULL,cancel_at_period_end=false,synced_at=now() WHERE user_id=${user.id}`
      );
      await tx.execute(sql`UPDATE users SET plan='free' WHERE id=${user.id}`);
    }
  }
}
export async function syncCustomer(customerId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.transaction(tx =>
    syncCustomerInTransaction(tx, customerId, getStripe())
  );
}

export async function billingCustomerId(
  userId: number
): Promise<string | null> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [user] = await rows(
    db,
    sql`SELECT "stripeCustomerId" FROM users WHERE id=${userId}`
  );
  return user?.stripeCustomerId ?? null;
}
