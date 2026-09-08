// TURATH access plans. Runtime checkout requires explicit Stripe launch configuration.

import { PLATFORM_OWNER_EMAIL, isPlatformOwner } from "../../shared/admin";

// Launch authorization is explicit; checkout also requires validated Stripe configuration.
export const BILLING_LAUNCH_ENABLED = true;
export const FREE_DOCUMENT_LIMIT = 20;
export const UNLIMITED_OWNER_EMAIL = PLATFORM_OWNER_EMAIL;
export const isUnlimitedOwnerEmail = isPlatformOwner;

export const PLANS = {
  free: {
    name: "Free",
    documentLimit: FREE_DOCUMENT_LIMIT,
    priceMonthly: 0,
    features: [
      "20 documents",
      "All AI models",
      "Search & Ask Archive",
      "JSON/CSV export",
    ],
  },
  pro: {
    name: "Pro",
    documentLimit: 100,
    priceMonthly: 2000, // $20.00 in cents
    features: [
      "100 documents per billing month",
      "All AI models",
      "Search & Ask Archive",
      "JSON/CSV export",
    ],
  },
  team: {
    name: "Team",
    documentLimit: 300,
    priceMonthly: 5000, // $50.00 in cents
    features: [
      "300 documents per billing month",
      "All AI models",
      "Search & Ask Archive",
      "JSON/CSV export",
      "Team collaboration",
    ],
  },
  enterprise: {
    name: "Archive",
    documentLimit: 1000,
    priceMonthly: 10000, // $100.00 in cents
    features: [
      "1,000 documents per billing month",
      "All AI models",
      "Search & Ask Archive",
      "JSON/CSV export",
      "Team collaboration",
    ],
  },
} as const;

export type PlanId = keyof typeof PLANS;
export type PaidPlanId = Exclude<PlanId, "free">;
export const PAID_PLAN_IDS: PaidPlanId[] = ["pro", "team", "enterprise"];

export function getDocumentLimit(plan: PlanId): number {
  return PLANS[plan].documentLimit;
}
