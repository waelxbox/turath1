import { trpc } from "@/lib/trpc";
import { Check, ShieldCheck } from "lucide-react";

export default function BillingPage() {
  const { data: myPlan, isLoading } = trpc.billing.getMyPlan.useQuery();

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading...</div>;

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-2">Plan & usage</h1>
      <p className="text-muted-foreground mb-8">
        TURATH is currently available on a limited free tier. Paid upgrades are not yet available.
      </p>

      {/* Current usage */}
      <div className="bg-card border border-border rounded-lg p-6 mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm text-muted-foreground">Current Plan</p>
            <p className="text-xl font-semibold">{myPlan?.planName || "Free"}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="flex justify-between text-sm mb-1">
              <span>Documents used</span>
              <span>{myPlan?.isOwnerExempt ? "Not capped" : `${myPlan?.documentsUsed || 0} / ${myPlan?.documentLimit || 50}`}</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-600 rounded-full transition-all"
                style={{ width: `${myPlan?.isOwnerExempt ? 0 : Math.min(100, ((myPlan?.documentsUsed || 0) / (myPlan?.documentLimit || 50)) * 100)}%` }}
              />
            </div>
            {!myPlan?.isOwnerExempt && (
              <p className="mt-2 text-xs text-muted-foreground">
                {myPlan?.documentsRemaining ?? 0} document{myPlan?.documentsRemaining === 1 ? "" : "s"} remaining on the current free tier.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="border border-amber-700/25 bg-amber-50/50 dark:bg-amber-950/10 rounded-lg p-6">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-amber-700 mt-0.5" />
          <div>
            <h2 className="font-semibold">Free-tier access</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Each non-owner account can upload up to 50 documents. The cap is enforced before a file is stored or sent for AI processing.
            </p>
            <ul className="mt-4 space-y-2">
              {(myPlan?.features || []).map((feature: string, index: number) => (
                <li key={index} className="flex items-center gap-2 text-sm">
                  <Check className="w-4 h-4 text-green-600" />
                  {feature}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mt-6">
        Need additional capacity for an institution or research project? Contact us at adamamin2027@gmail.com.
      </p>
    </div>
  );
}
