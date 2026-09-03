import { trpc } from "@/lib/trpc";
import { Check, Infinity as InfinityIcon, Mail, ShieldCheck } from "lucide-react";

const CONTACT_EMAIL = "adamamin2027@gmail.com";

export default function BillingPage() {
  const { data: access, isLoading, error } = trpc.billing.getMyPlan.useQuery();

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading access details…</div>;
  if (error || !access) {
    return <div className="p-8 text-destructive">Usage details are unavailable. Please refresh and try again.</div>;
  }

  const used = access.documentsUsed ?? 0;
  const limit = access.documentLimit;
  const isExempt = access.isOwnerExempt;
  const remaining = isExempt ? null : Math.max(0, access.documentsRemaining ?? (limit ?? 0) - used);
  const usagePercent = !isExempt && limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  return (
    <div className="max-w-3xl mx-auto p-6 sm:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-2">Access & usage</h1>
        <p className="text-muted-foreground">
          TURATH is currently available on a limited free tier. Paid upgrades are not yet available.
        </p>
      </div>

      <div className="bg-card border border-border rounded-xl p-6 mb-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Current access</p>
              <p className="text-xl font-semibold">{access.planName}</p>
            </div>
          </div>

          {isExempt ? (
            <div className="inline-flex items-center gap-2 rounded-full bg-green-500/10 px-3 py-1.5 text-sm font-medium text-green-700 dark:text-green-400">
              <InfinityIcon className="h-4 w-4" />
              Unlimited document uploads
            </div>
          ) : (
            <div className="text-left sm:text-right">
              <p className="text-2xl font-semibold tabular-nums">{remaining ?? 0}</p>
              <p className="text-xs text-muted-foreground">document uploads remaining</p>
            </div>
          )}
        </div>

        {!isExempt && limit !== null && (
          <div className="mt-6">
            <div className="flex justify-between text-sm mb-2">
              <span>Document uploads</span>
              <span className="tabular-nums">{used} of {limit} used</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden" aria-label={`${used} of ${limit} document uploads used`}>
              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${usagePercent}%` }} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Each uploaded document consumes one free-tier slot. Retrying transcription or review does not consume another slot.
            </p>
          </div>
        )}

        <ul className="mt-6 grid gap-2 text-sm sm:grid-cols-2">
          {access.features.map((feature: string) => (
            <li key={feature} className="flex items-center gap-2">
              <Check className="h-4 w-4 shrink-0 text-green-600" />
              {feature}
            </li>
          ))}
        </ul>
      </div>

      {!isExempt && (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-5">
          <Mail className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div>
            <p className="font-medium">Need additional capacity?</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Paid upgrades are not available yet. For research or institutional access, contact Adam directly.
            </p>
            <a className="mt-2 inline-block text-sm font-medium text-primary hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
