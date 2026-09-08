import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

const CONTACT_EMAIL = "adamamin2027@gmail.com";
const paidPlans = ["pro", "team", "enterprise"] as const;

export default function BillingPage() {
  const [returnedAt] = useState(() =>
    new URLSearchParams(window.location.search).has("success") ? Date.now() : 0
  );
  const access = trpc.billing.getMyPlan.useQuery(undefined, {
    refetchInterval: query =>
      returnedAt &&
      Date.now() - returnedAt < 90_000 &&
      query.state.data?.plan === "free"
        ? 3000
        : false,
  });
  const plans = trpc.billing.getPlans.useQuery();
  const checkout = trpc.billing.createCheckout.useMutation({
    onSuccess: result => window.location.assign(result.url),
    onError: error => toast.error(error.message),
  });
  const portal = trpc.billing.createPortal.useMutation({
    onSuccess: result => window.location.assign(result.url),
    onError: error => toast.error(error.message),
  });
  const busy = checkout.isPending || portal.isPending;
  if (access.isLoading || plans.isLoading)
    return (
      <div className="p-8" role="status">
        Loading plans and usage…
      </div>
    );
  if (access.error || plans.error || !access.data || !plans.data)
    return (
      <div className="p-8 space-y-4" role="alert">
        <p>
          Sign in to view billing. If you are already signed in, usage details
          could not load.
        </p>
        <Link href="/">Back to TURATH</Link>
        <Button
          onClick={() => {
            void access.refetch();
            void plans.refetch();
          }}
        >
          Retry
        </Button>
      </div>
    );
  const data = access.data;
  const ready = data.paidUpgradesEnabled;
  const percent = data.documentLimit
    ? Math.min(100, (data.documentsUsed / data.documentLimit) * 100)
    : 0;
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6 sm:p-8">
      <Link href="/" className="text-sm text-primary hover:underline">
        ← Your projects
      </Link>
      <header>
        <h1 className="text-3xl font-semibold">Plans & billing</h1>
        <p className="mt-2 text-muted-foreground">
          Start with 20 lifetime free document uploads. Choose a monthly plan
          when you need more.
        </p>
      </header>
      {returnedAt > 0 && (
        <div role="status" className="rounded-xl border p-4">
          {data.plan === "free"
            ? "Checking payment confirmation. Your allowance updates after Stripe confirms payment; this return page alone does not activate a plan."
            : "Your paid plan is active."}
          <Button variant="ghost" onClick={() => void access.refetch()}>
            Refresh status
          </Button>
        </div>
      )}
      {new URLSearchParams(window.location.search).has("canceled") && (
        <p role="status">
          Checkout was canceled. Your current plan is unchanged.
        </p>
      )}
      <section className="rounded-xl border bg-card p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">Current plan</p>
            <h2 className="text-xl font-semibold">{data.planName}</h2>
          </div>
          {data.hasBillingAccount && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => portal.mutate()}
            >
              Manage subscription
            </Button>
          )}
        </div>
        {data.isOwnerExempt ? (
          <p>
            Unlimited document uploads — your owner exemption remains active.
          </p>
        ) : (
          <>
            <p>
              {data.documentsUsed} / {data.documentLimit} documents used ·{" "}
              {data.documentsRemaining} remaining
            </p>
            <div
              className="h-2 rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={data.documentLimit ?? 20}
              aria-valuenow={Math.min(
                data.documentsUsed,
                data.documentLimit ?? 20
              )}
              aria-label="Document allowance"
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {data.resetsAt
                ? `${data.cancelAtPeriodEnd ? "Paid access ends" : "Current period ends; allowance renews after successful payment"}: ${new Date(data.resetsAt).toLocaleDateString()}.`
                : "Free usage is lifetime and never resets."}
            </p>
          </>
        )}
      </section>
      {!ready && !data.isOwnerExempt && (
        <p role="status" className="rounded-xl border p-4">
          Paid checkout is being prepared. No payment can be taken here until
          configuration is complete.
        </p>
      )}
      {!data.isOwnerExempt && (
        <section
          className="grid gap-4 md:grid-cols-3"
          aria-label="Monthly plans"
        >
          {paidPlans.map(id => {
            const plan = plans.data.plans[id];
            const current = data.plan === id;
            return (
              <article
                key={id}
                className={`flex flex-col rounded-xl border bg-card p-6 ${current ? "border-primary" : ""}`}
              >
                <h2 className="text-xl font-semibold">{plan.name}</h2>
                <p className="mt-3">
                  <span className="text-3xl font-semibold">
                    ${plan.priceMonthly / 100}
                  </span>
                  <span className="text-muted-foreground"> USD / month</span>
                </p>
                <p className="mt-2 font-medium">
                  {plan.documentLimit.toLocaleString()} document uploads /
                  billing month
                </p>
                <ul className="my-5 flex-1 space-y-2 text-sm">
                  {plan.features.slice(1).map(feature => (
                    <li key={feature} className="flex gap-2">
                      <Check className="h-4 w-4 shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Button
                  disabled={busy || current || !ready}
                  onClick={() =>
                    data.plan !== "free"
                      ? portal.mutate()
                      : checkout.mutate({ planId: id })
                  }
                >
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {current
                    ? "Current plan"
                    : data.plan !== "free"
                      ? "Change plan in Stripe"
                      : `Choose ${plan.name}`}
                </Button>
              </article>
            );
          })}
        </section>
      )}
      <section className="space-y-2 text-sm text-muted-foreground">
        <h2 className="font-medium text-foreground">
          How document allowances work
        </h2>
        <p>
          Each uploaded image or PDF page counts as one document. Transcription
          retries and review do not consume another upload slot. Deleting a
          document does not refund a slot.
        </p>
        <p>
          Paid allowances reset on your subscription billing date after
          successful renewal, not the first day of the calendar month. Unused
          paid allowance does not roll over. The 20 lifetime free uploads are
          separate and never reset.
        </p>
        <p>
          Subscriptions renew automatically each month until canceled. Cancel
          through Manage subscription; paid access continues through the paid
          period when cancellation is scheduled for its end. Existing documents
          are not deleted when a plan ends. Shared-project uploads use the
          project owner's allowance.
        </p>
        <p>Email {CONTACT_EMAIL} for additional usage.</p>
        <a
          href={`mailto:${CONTACT_EMAIL}`}
          className="text-primary hover:underline"
        >
          Contact billing support
        </a>
      </section>
    </main>
  );
}
