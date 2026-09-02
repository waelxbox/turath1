// TURATH Subscription Plans
// These will be created in Stripe on first use via ensureProducts()

export const PLANS = {
  free: {
    name: "Demo access",
    documentLimit: 20,
    priceMonthly: 0,
    features: ["20 AI document-processing uses", "Search & Ask Archive", "JSON/CSV export"],
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
