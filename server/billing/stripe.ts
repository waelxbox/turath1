import Stripe from "stripe";
import { PLANS, type PlanId } from "./products";

// Lazy-init stripe client (only when keys are available)
let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY || process.env.Stripe_Secret_Key;
    if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
    _stripe = new Stripe(key, { apiVersion: "2024-12-18.acacia" as any });
  }
  return _stripe;
}

// Cache for Stripe price IDs (created on first use)
let priceCache: Record<string, string> = {};

/**
 * Ensure Stripe products and prices exist, return price IDs.
 * Creates them if they don't exist yet.
 */
export async function ensureStripePrices(): Promise<Record<string, string>> {
  if (Object.keys(priceCache).length > 0) return priceCache;

  const stripe = getStripe();

  for (const [planId, plan] of Object.entries(PLANS)) {
    if (planId === "free" || planId === "enterprise") continue; // No Stripe product for free/enterprise

    // Search for existing product
    const products = await stripe.products.search({
      query: `metadata["turath_plan"]:"${planId}"`,
    });

    let product: Stripe.Product;
    if (products.data.length > 0) {
      product = products.data[0];
    } else {
      product = await stripe.products.create({
        name: `TURATH ${plan.name}`,
        description: plan.features.join(", "),
        metadata: { turath_plan: planId },
      });
    }

    // Get or create price
    const prices = await stripe.prices.list({
      product: product.id,
      active: true,
      type: "recurring",
    });

    let price: Stripe.Price;
    if (prices.data.length > 0) {
      price = prices.data[0];
    } else {
      price = await stripe.prices.create({
        product: product.id,
        unit_amount: plan.priceMonthly,
        currency: "usd",
        recurring: { interval: "month" },
        metadata: { turath_plan: planId },
      });
    }

    priceCache[planId] = price.id;
  }

  return priceCache;
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
  origin: string;
}): Promise<string> {
  const stripe = getStripe();
  const prices = await ensureStripePrices();
  const priceId = prices[opts.planId];

  if (!priceId) throw new Error(`No Stripe price for plan: ${opts.planId}`);

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${opts.origin}/settings/billing?success=true`,
    cancel_url: `${opts.origin}/settings/billing?canceled=true`,
    client_reference_id: opts.userId.toString(),
    allow_promotion_codes: true,
    metadata: {
      user_id: opts.userId.toString(),
      customer_email: opts.userEmail,
      customer_name: opts.userName,
      plan_id: opts.planId,
    },
  };

  if (opts.stripeCustomerId) {
    sessionParams.customer = opts.stripeCustomerId;
  } else {
    sessionParams.customer_email = opts.userEmail;
  }

  const session = await stripe.checkout.sessions.create(sessionParams);
  return session.url!;
}

/**
 * Create a Stripe Customer Portal session for managing subscription.
 */
export async function createPortalSession(stripeCustomerId: string, origin: string): Promise<string> {
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${origin}/settings/billing`,
  });
  return session.url;
}

/**
 * Check if pricing enforcement is enabled.
 * Returns false until you flip this to true (everything stays free).
 */
export function isPricingEnabled(): boolean {
  return process.env.TURATH_PRICING_ENABLED === "true";
}

