import { trpc } from "@/lib/trpc";
import { Check } from "lucide-react";

const PLAN_DETAILS = {
  free: { name: "Free", price: "$0", period: "forever", docs: "100 documents" },
  pro: { name: "Pro", price: "$20", period: "/month", docs: "300 documents" },
  team: { name: "Team", price: "$50", period: "/month", docs: "1,100 documents" },
  enterprise: { name: "Enterprise", price: "Custom", period: "", docs: "Unlimited" },
};

export default function BillingPage() {
  const { data: myPlan, isLoading } = trpc.billing.getMyPlan.useQuery();
  const checkout = trpc.billing.createCheckout.useMutation();
  const portal = trpc.billing.createPortal.useMutation();

  const handleUpgrade = async (planId: "pro" | "team") => {
    const { url } = await checkout.mutateAsync({
      planId,
      origin: window.location.origin,
    });
    window.open(url, "_blank");
  };

  const handleManage = async () => {
    const { url } = await portal.mutateAsync({
      origin: window.location.origin,
    });
    window.open(url, "_blank");
  };

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading...</div>;

  const currentPlan = myPlan?.plan || "free";

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-2">Plan & Billing</h1>
      <p className="text-muted-foreground mb-8">
        Manage your subscription and document usage.
      </p>

      {/* Current usage */}
      <div className="bg-card border border-border rounded-lg p-6 mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm text-muted-foreground">Current Plan</p>
            <p className="text-xl font-semibold">{PLAN_DETAILS[currentPlan as keyof typeof PLAN_DETAILS]?.name || "Free"}</p>
          </div>
          {currentPlan !== "free" && (
            <button
              onClick={handleManage}
              className="text-sm text-amber-700 hover:underline"
            >
              Manage subscription →
            </button>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="flex justify-between text-sm mb-1">
              <span>Documents used</span>
              <span>{myPlan?.documentsUsed || 0} / {myPlan?.documentLimit || 100}</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-600 rounded-full transition-all"
                style={{ width: `${Math.min(100, ((myPlan?.documentsUsed || 0) / (myPlan?.documentLimit || 100)) * 100)}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(["free", "pro", "team"] as const).map((planId) => {
          const plan = PLAN_DETAILS[planId];
          const isCurrent = currentPlan === planId;
          return (
            <div
              key={planId}
              className={`border rounded-lg p-6 ${isCurrent ? "border-amber-600 bg-amber-50 dark:bg-amber-950/20" : "border-border"}`}
            >
              <h3 className="font-semibold text-lg">{plan.name}</h3>
              <p className="text-2xl font-bold mt-2">
                {plan.price}<span className="text-sm font-normal text-muted-foreground">{plan.period}</span>
              </p>
              <p className="text-sm text-muted-foreground mt-1">{plan.docs}</p>
              <ul className="mt-4 space-y-2">
                {(myPlan?.features || []).length > 0 && planId === currentPlan &&
                  (myPlan?.features || []).map((f: string, i: number) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-600" />
                      {f}
                    </li>
                  ))
                }
              </ul>
              <div className="mt-6">
                {isCurrent ? (
                  <span className="text-sm text-amber-700 font-medium">Current plan</span>
                ) : planId === "free" ? null : (
                  <button
                    onClick={() => handleUpgrade(planId)}
                    disabled={checkout.isPending}
                    className="w-full py-2 px-4 bg-amber-700 text-white rounded-lg text-sm font-medium hover:bg-amber-800 disabled:opacity-50"
                  >
                    {checkout.isPending ? "Loading..." : "Upgrade"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground mt-6">
        Need more? Contact us at adamamin2027@gmail.com for Enterprise pricing.
      </p>
    </div>
  );
}
