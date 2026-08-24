// TURATH Subscription Plans
// These will be created in Stripe on first use via ensureProducts()

export const PLANS = {
  free: {
    name: "Free",
    documentLimit: 100,
    transcriptionLimit: 100,
    priceMonthly: 0,
    features: ["100 document uploads", "100 AI processing runs", "All AI models", "Search & Ask Archive", "JSON/CSV export"],
  },
  pro: {
    name: "Pro",
    documentLimit: 300,
    transcriptionLimit: 300,
    priceMonthly: 2000, // $20.00 in cents
    features: ["300 document uploads per billing period", "300 AI processing runs per billing period", "All AI models", "Search & Ask Archive", "JSON/CSV/TEI-XML export", "Priority processing"],
  },
  team: {
    name: "Team",
    documentLimit: 1100,
    transcriptionLimit: 1100,
    priceMonthly: 5000, // $50.00 in cents
    features: ["1,100 document uploads per billing period", "1,100 AI processing runs per billing period", "All AI models", "Search & Ask Archive", "JSON/CSV/TEI-XML export", "Priority processing", "Team collaboration"],
  },
  enterprise: {
    name: "Enterprise",
    documentLimit: Infinity,
    transcriptionLimit: Infinity,
    priceMonthly: 0, // Custom pricing
    features: ["Unlimited documents", "All AI models", "Dedicated support", "Custom integrations", "SLA"],
  },
} as const;

export type PlanId = keyof typeof PLANS;

export function getDocumentLimit(plan: PlanId): number {
  return PLANS[plan].documentLimit;
}

export function getTranscriptionLimit(plan: PlanId): number {
  return PLANS[plan].transcriptionLimit;
}
