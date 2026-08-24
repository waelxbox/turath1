import Stripe from "stripe";
import { PLANS, type PlanId } from "./products";

// Lazy-init stripe client (only when keys are available)
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY || process.env.Stripe_Secret_Key;
    if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
    _stripe = new Stripe(key, { apiVersion: "2024-12-18.acacia" as any });
  }
  return _stripe;
}

/**
 * Billing configuration is provisioned out-of-band. Request handlers must not
 * create products or guess which active price is the intended one.
 */
export async function ensureStripePrices(): Promise<Record<string, string>> {
  return getConfiguredPriceIds();
}

export function getConfiguredPriceIds(env: NodeJS.ProcessEnv = process.env): Record<"pro" | "team", string> {
  const prices = { pro: env.STRIPE_PRO_PRICE_ID, team: env.STRIPE_TEAM_PRICE_ID };
  for (const [plan, priceId] of Object.entries(prices)) {
    if (!priceId || !/^price_[A-Za-z0-9_]+$/.test(priceId)) {
      throw new Error(`STRIPE_${plan.toUpperCase()}_PRICE_ID is not configured with a valid Stripe price ID`);
    }
  }
  return prices as Record<"pro" | "team", string>;
}

export function getCheckoutIdempotencyKey(lockId: string): string {
  return `turath-checkout-v2:${lockId}`;
}

/**
 * Create a Stripe Checkout Session for upgrading to a plan.
 */
export async function createCheckoutSession(opts: {
  userId: number;
  userEmail: string;
  userName: string;
  planId: PlanId;
  stripeCustomerId?: string | null;
  checkoutLockId: string;
}): Promise<{ url: string; sessionId: string; expiresAt: Date }> {
  const stripe = getStripe();
  const origin = getBillingOrigin();
  const prices = await ensureStripePrices();
  const priceId = prices[opts.planId];

  if (!priceId) throw new Error(`No Stripe price for plan: ${opts.planId}`);
  const price = await stripe.prices.retrieve(priceId);
  const expected = PLANS[opts.planId];
  if (
    !price.active ||
    price.currency !== "usd" ||
    price.unit_amount !== expected.priceMonthly ||
    price.recurring?.interval !== "month" ||
    price.metadata?.turath_plan !== opts.planId
  ) {
    throw new Error(`Configured Stripe price does not match the ${opts.planId} plan`);
  }

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/settings/billing?success=true`,
    cancel_url: `${origin}/settings/billing?canceled=true`,
    client_reference_id: opts.userId.toString(),
    allow_promotion_codes: true,
    expires_at: Math.floor(Date.now() / 1000) + (35 * 60),
    metadata: {
      user_id: opts.userId.toString(),
      customer_email: opts.userEmail,
      customer_name: opts.userName,
      plan_id: opts.planId,
      checkout_lock_id: opts.checkoutLockId,
    },
  };

  if (opts.stripeCustomerId) {
    sessionParams.customer = opts.stripeCustomerId;
  } else {
    sessionParams.customer_email = opts.userEmail;
  }

  const session = await stripe.checkout.sessions.create(sessionParams, {
    idempotencyKey: getCheckoutIdempotencyKey(opts.checkoutLockId),
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return { url: session.url, sessionId: session.id, expiresAt: new Date(session.expires_at * 1000) };
}

/**
 * Create a Stripe Customer Portal session for managing subscription.
 */
export async function createPortalSession(stripeCustomerId: string): Promise<string> {
  const stripe = getStripe();
  const origin = getBillingOrigin();
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${origin}/settings/billing`,
  });
  return session.url;
}

/**
 * Stripe redirects must come from server configuration, never a browser-supplied
 * origin. This prevents authenticated open redirects and poisoned checkout URLs.
 */
export function getBillingOrigin(
  configuredOrigin = process.env.PUBLIC_APP_URL,
  nodeEnv = process.env.NODE_ENV,
): string {
  if (!configuredOrigin) throw new Error("PUBLIC_APP_URL not configured");

  let url: URL;
  try {
    url = new URL(configuredOrigin);
  } catch {
    throw new Error("PUBLIC_APP_URL must be a valid absolute URL");
  }

  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(nodeEnv !== "production" && isLocal)) {
    throw new Error("PUBLIC_APP_URL must use HTTPS");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("PUBLIC_APP_URL must be an origin without credentials, path, query, or fragment");
  }
  return url.origin;
}
