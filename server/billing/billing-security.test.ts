import type express from "express";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { getBillingOrigin, getCheckoutIdempotencyKey, getConfiguredPriceIds } from "./stripe";
import { getQuotaLimit, isPricingEnabled } from "./quota";
import {
  getSubscriptionPlan,
  InvalidStripeEventError,
  normalizeSubscriptionStatus,
  registerStripeWebhook,
  validateCheckoutSession,
} from "./webhook";

function checkoutSession(overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
  return {
    id: "cs_test_valid",
    object: "checkout.session",
    client_reference_id: "42",
    customer: "cus_valid123",
    metadata: { user_id: "42", plan_id: "pro" },
    mode: "subscription",
    payment_status: "paid",
    status: "complete",
    subscription: "sub_valid123",
    ...overrides,
  } as Stripe.Checkout.Session;
}

function subscription(plan = "team"): Stripe.Subscription {
  return {
    id: "sub_valid123",
    customer: "cus_valid123",
    status: "active",
    items: {
      data: [{ price: { metadata: { turath_plan: plan } } }],
    },
  } as unknown as Stripe.Subscription;
}

describe("billing redirect origin", () => {
  it("only accepts a configured HTTPS origin", () => {
    expect(getBillingOrigin("https://staging.turath.example/", "production")).toBe("https://staging.turath.example");
    expect(() => getBillingOrigin("http://staging.turath.example", "production")).toThrow("HTTPS");
    expect(() => getBillingOrigin("https://turath.example/redirect", "production")).toThrow("origin without");
    expect(() => getBillingOrigin(undefined, "production")).toThrow("not configured");
  });

  it("allows plain HTTP only for local non-production development", () => {
    expect(getBillingOrigin("http://localhost:3000", "development")).toBe("http://localhost:3000");
    expect(() => getBillingOrigin("http://localhost:3000", "production")).toThrow("HTTPS");
  });

  it("requires explicit Stripe price IDs and derives a stable daily checkout key", () => {
    expect(getConfiguredPriceIds({
      STRIPE_PRO_PRICE_ID: "price_pro123",
      STRIPE_TEAM_PRICE_ID: "price_team123",
    } as NodeJS.ProcessEnv)).toEqual({ pro: "price_pro123", team: "price_team123" });
    expect(() => getConfiguredPriceIds({})).toThrow("STRIPE_PRO_PRICE_ID");

    expect(getCheckoutIdempotencyKey("92c604ef-5d70-4ae3-b412-2a5b66183ea8"))
      .toBe("turath-checkout-v2:92c604ef-5d70-4ae3-b412-2a5b66183ea8");
  });
});

describe("quota policy", () => {
  it("is enabled unless it is explicitly disabled", () => {
    expect(isPricingEnabled(undefined)).toBe(true);
    expect(isPricingEnabled("true")).toBe(true);
    expect(isPricingEnabled("false", "development")).toBe(false);
    expect(isPricingEnabled("false", "production")).toBe(true);
  });

  it("uses bounded upload and transcription limits for non-enterprise plans", () => {
    expect(getQuotaLimit("free", "document")).toBe(100);
    expect(getQuotaLimit("pro", "transcription")).toBe(300);
    expect(getQuotaLimit("team", "document")).toBe(1100);
    expect(getQuotaLimit("enterprise", "transcription")).toBe(Infinity);
  });
});

describe("Stripe event validation", () => {
  it("accepts a fully paid, internally consistent subscription checkout", () => {
    expect(validateCheckoutSession(checkoutSession())).toEqual({
      userId: 42,
      plan: "pro",
      customerId: "cus_valid123",
      subscriptionId: "sub_valid123",
    });
  });

  it("rejects unsupported plans and mismatched user identifiers", () => {
    expect(() => validateCheckoutSession(checkoutSession({ metadata: { user_id: "42", plan_id: "enterprise" } })))
      .toThrow(InvalidStripeEventError);
    expect(() => validateCheckoutSession(checkoutSession({ client_reference_id: "99" })))
      .toThrow("do not match");
  });

  it("maps subscription state conservatively and requires one known plan", () => {
    expect(normalizeSubscriptionStatus("active")).toBe("active");
    expect(normalizeSubscriptionStatus("unpaid")).toBe("canceled");
    expect(getSubscriptionPlan(subscription("team"))).toBe("team");
    expect(() => getSubscriptionPlan(subscription("enterprise"))).toThrow(InvalidStripeEventError);
  });
});

describe.sequential("Stripe webhook fail-closed behavior", () => {
  const originalSecret = process.env.STRIPE_SECRET_KEY;
  const originalWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = originalSecret;
    if (originalWebhookSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = originalWebhookSecret;
  });

  function captureHandler() {
    let handler: ((req: any, res: any) => Promise<unknown>) | undefined;
    const app = {
      post: (_path: string, _raw: unknown, routeHandler: typeof handler) => {
        handler = routeHandler;
      },
    } as unknown as express.Application;
    registerStripeWebhook(app);
    return handler!;
  }

  function responseRecorder() {
    const result = { status: 200, body: undefined as unknown };
    const response = {
      status(code: number) { result.status = code; return response; },
      json(body: unknown) { result.body = body; return response; },
    };
    return { response, result };
  }

  it("returns 503 instead of accepting unsigned JSON when configuration is missing", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const { response, result } = responseRecorder();
    await captureHandler()({ headers: {}, body: Buffer.from("{}") }, response);
    expect(result.status).toBe(503);
  });

  it("rejects an invalid signature before touching the database", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_placeholder";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_placeholder";
    const { response, result } = responseRecorder();
    await captureHandler()({
      headers: { "stripe-signature": "t=1,v1=invalid" },
      body: Buffer.from("{}"),
    }, response);
    expect(result.status).toBe(400);
  });
});
