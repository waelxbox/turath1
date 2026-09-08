import { describe, expect, it } from "vitest";
import {
  billingOrigin,
  getStripe,
  isPricingEnabled,
  stripePriceIds,
  validateConfiguredPrices,
} from "./stripe";

describe("configured Stripe sandbox resources", () => {
  it("validates the test-mode prices, portal, and webhook through Stripe's API", async () => {
    const key = process.env.STRIPE_SECRET_KEY || process.env.Stripe_Secret_Key;
    expect(key).toMatch(/^sk_test_/);
    expect(billingOrigin()).toBe("https://turath.app");
    expect(isPricingEnabled()).toBe(false);

    const stripe = getStripe();
    await validateConfiguredPrices(stripe);

    const portalId = process.env.STRIPE_PORTAL_CONFIGURATION;
    expect(portalId).toMatch(/^bpc_/);
    const portal = await stripe.billingPortal.configurations.retrieve(portalId!);
    expect(portal.active).toBe(true);
    expect(portal.features.payment_method_update.enabled).toBe(true);
    expect(portal.features.subscription_cancel).toMatchObject({
      enabled: true,
      mode: "at_period_end",
    });

    // Stripe accepts the allowed product/price list on create/update but does
    // not return that create-only field on configuration retrieval. Preserve
    // the intended allowlist in metadata and verify it against live price IDs.
    expect(new Set((portal.metadata.allowed_prices ?? "").split(",").filter(Boolean))).toEqual(
      new Set(Object.values(stripePriceIds())),
    );

    const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
    const endpoint = endpoints.data.find(
      item => item.url === `${billingOrigin()}/api/stripe/webhook` && item.status === "enabled",
    );
    expect(endpoint).toBeTruthy();
    expect(endpoint?.enabled_events).toEqual(
      expect.arrayContaining([
        "checkout.session.completed",
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
        "invoice.paid",
        "invoice.payment_failed",
      ]),
    );
  }, 30_000);
});
