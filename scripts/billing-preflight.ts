/** Read-only: validates configured billing resources; never creates a price or charges a card. */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";
import { rows } from "../server/billing/quota";
import {
  billingOrigin,
  getStripe,
  isPricingEnabled,
  stripePriceIds,
  validateConfiguredPrices,
} from "../server/billing/stripe";

async function main() {
  if (!isPricingEnabled())
    throw new Error(
      "Missing launch flag, Stripe key, signing secret, three distinct price IDs, or portal configuration ID"
    );
  const stripe = getStripe();
  await validateConfiguredPrices(stripe);
  console.log(
    "PASS: $20/100, $50/300, $100/1000 USD monthly price configuration"
  );
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  const endpoint = endpoints.data.find(
    item =>
      item.url === `${billingOrigin()}/api/stripe/webhook` &&
      item.status === "enabled"
  );
  if (!endpoint)
    throw new Error(
      "No enabled Stripe webhook endpoint for the configured TURATH origin"
    );
  const required = [
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.paid",
    "invoice.payment_failed",
  ];
  if (
    !endpoint.enabled_events.includes("*") &&
    required.some(type => !endpoint.enabled_events.includes(type as any))
  )
    throw new Error(
      "Webhook does not subscribe to every required billing event"
    );
  console.log(
    "PASS: webhook URL and event subscriptions (signing secret still requires signed end-to-end verification)"
  );
  const portal = await stripe.billingPortal.configurations.retrieve(
    process.env.STRIPE_PORTAL_CONFIGURATION!
  );
  if (
    !portal.active ||
    !portal.features.subscription_cancel.enabled ||
    portal.features.subscription_cancel.mode !== "at_period_end" ||
    !portal.features.payment_method_update.enabled
  )
    throw new Error(
      "Portal must support end-of-period cancellation and payment-method updates"
    );
  const updates = portal.features.subscription_update;
  if (
    !updates.enabled ||
    !updates.default_allowed_updates.includes("price") ||
    updates.default_allowed_updates.includes("quantity")
  )
    throw new Error("Portal must allow price changes but not quantity changes");
  if (updates.proration_behavior !== "always_invoice")
    throw new Error(
      "Portal upgrades must invoice immediately; do not silently grant unpaid upgrades"
    );
  const allowed = new Set(Object.values(stripePriceIds()));
  const portalPrices = (updates.products ?? []).flatMap(
    product => product.prices
  );
  if (portalPrices.length !== 3 || portalPrices.some(id => !allowed.has(id)))
    throw new Error(
      "Portal must offer exactly the three configured TURATH prices"
    );
  console.log("PASS: customer portal controls");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [schema] = await rows(
    db,
    sql`SELECT to_regclass('billing_accounts') a,to_regclass('billing_usage') u,to_regclass('billing_reservations') r`
  );
  if (!schema.a || !schema.u || !schema.r)
    throw new Error("Apply billing migration 0014 before deploying");
  console.log("PASS: billing tables present");
  console.log(
    "Configuration checks passed. Still required: test-mode checkout, signed webhook, renewal, portal cancellation, then live-mode verification before launch."
  );
}
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(
      "Billing preflight failed:",
      error instanceof Error ? error.message : "unknown error"
    );
    process.exit(1);
  });
