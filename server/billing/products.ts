// TURATH access plans. Paid checkout remains intentionally disabled until the
// launch configuration and webhook verification are completed.

export const BILLING_LAUNCH_ENABLED = false;
export const FREE_DOCUMENT_LIMIT = 50;

export const PLANS = {
  free: {
    name: "Free",
    documentLimit: FREE_DOCUMENT_LIMIT,
    priceMonthly: 0,
    features: ["50 documents", "All AI models", "Search & Ask Archive", "JSON/CSV export"],
  },
  pro: {
    name: "Pro",
    documentLimit: 300,
    priceMonthly: 2000, // $20.00 in cents
    features: ["300 documents", "All AI models", "Search & Ask Archive", "JSON/CSV/TEI-XML export", "Priority processing"],
  },
  team: {
    name: "Team",
    documentLimit: 1100,
    priceMonthly: 5000, // $50.00 in cents
    features: ["1,100 documents", "All AI models", "Search & Ask Archive", "JSON/CSV/TEI-XML export", "Priority processing", "Team collaboration"],
  },
  enterprise: {
    name: "Enterprise",
    documentLimit: Infinity,
    priceMonthly: 0, // Custom pricing
    features: ["Unlimited documents", "All AI models", "Dedicated support", "Custom integrations", "SLA"],
  },
} as const;

export type PlanId = keyof typeof PLANS;

export function getDocumentLimit(plan: PlanId): number {
  return PLANS[plan].documentLimit;
}
