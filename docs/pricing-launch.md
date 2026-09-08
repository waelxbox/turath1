# TURATH pricing launch

## Approved pricing and behavior

| Plan | USD/month | Documents |
| --- | ---: | ---: |
| Free | 0 | 20 lifetime |
| Pro | 20 | 100 per paid billing month |
| Team | 50 | 300 per paid billing month |
| Archive | 100 | 1,000 per paid billing month |

Archive uses the existing internal `enterprise` plan ID, avoiding a database enum rename. Adam's normalized `adamamin2027@gmail.com` identity remains unlimited. No other admin role grants an exemption.

An upload/image or PDF page is one document. Transcription retries and review do not consume more slots. Deletion does not refund slots. Paid counters are separate from lifetime free usage: after cancellation, only unused lifetime free slots remain. Paid allowances renew only after confirmed payment for the new Stripe billing period and never roll over. Same-period plan changes retain usage; a downgrade below usage blocks further uploads. Existing documents remain available. Collaborators consume the project owner's allowance.

## Deployment order — do not skip

1. Review this branch with the September 6 transcription fix included. Do not replace main with an older checkout.
2. Pause new upload intake during the migration/cutover so the old release-counter behavior cannot race the new reservation ledger. Back up the database. Apply `drizzle/migrations/0014_billing_launch.sql` explicitly using the existing server database role. It is transactional and rerunnable. It reconciles historical free usage once, creates three server-only RLS tables, and requires unique Stripe customer bindings. It does not delete documents or change Stripe resources. Do not run a blanket schema push.
3. In Stripe TEST mode create three active USD, licensed, per-unit, monthly recurring prices: 2000, 5000, 10000 cents. No trial. Record their exact price IDs in the corresponding environment variables. Never choose an arbitrary existing price by product name.
4. Configure a dedicated Stripe customer portal: payment-method updates, invoice history, cancellation **at period end**, and price changes restricted to these three prices, quantity fixed at one. Configure upgrade payment/proration explicitly; use payment-confirmed/pending updates where available. For a downgraded plan, usage is retained and access never gains a fresh allowance in the same period.
5. Set the following server-side environment variables in the deployment environment. Never commit values or paste secrets into task messages:
   - `STRIPE_SECRET_KEY` (test first, live for launch)
   - `STRIPE_WEBHOOK_SECRET` (the secret belonging to that exact endpoint/mode)
   - `STRIPE_PRICE_PRO`, `STRIPE_PRICE_TEAM`, `STRIPE_PRICE_ARCHIVE`
   - `STRIPE_PORTAL_CONFIGURATION`
   - `TURATH_APP_URL=https://turath.app` (use the private preview origin for testing)
   - `TURATH_PRICING_ENABLED=true` **only when ready for checkout**
6. Register `/api/stripe/webhook` before JSON middleware. Subscribe to checkout.session.completed, checkout.session.async_payment_succeeded, customer.subscription.created/updated/deleted, invoice.paid, invoice.payment_failed, invoice.payment_action_required. Unsigned requests must fail. Any reconciliation error returns 500 for Stripe retry. Old and duplicate deliveries re-fetch current subscription state under an account lock instead of replaying stale state or resetting counters.
7. Run `node_modules/.bin/tsx scripts/billing-preflight.ts` with the appropriate runtime environment. This only reads Stripe/database configuration. It cannot verify a signing secret merely by listing an endpoint.
8. Exercise real Stripe TEST-mode checkout and signed webhook delivery; verify all acceptance cases below. Then replace **all** Stripe settings together with LIVE-mode counterparts, rerun preflight, deploy, and verify the published billing page before accepting customer payments. The local development tests do not substitute for this step.

## Acceptance checks

- Free account at 19: ten concurrent uploads admit exactly one. Free remains 20 lifetime after deletion, paid months, or cancellation.
- Each plan displays correct price/allowance and checkout charges exactly that amount monthly.
- Double-click checkout reuses one session; existing subscribers manage through the portal rather than creating another subscription.
- Payment failure, authentication required, canceled checkout, or fabricated return URL never grants paid access.
- Successful signed event grants correct quota; duplicate/reordered deliveries do not reset usage.
- Billing-cycle renewal grants a fresh bucket only after payment; no-payment expiry locally removes paid capacity even if webhook delivery is delayed.
- Failed upload releases its exact reservation once, even after the billing period changes.
- Upgrade retains usage; downgrade cannot create additional slots; scheduled cancellation retains paid access through the paid period; canceled subscription returns to remaining free capacity.
- Customer can update payment details and cancel even when new checkout is temporarily disabled.
- Project collaborators see and consume owner capacity; no private customer/payment fields are exposed.
- Document transcription/review, existing owner access, and image archive tests remain green.

## Operations and limitations

Set `TURATH_PRICING_ENABLED=false` to stop **new** checkout without deleting usage or disabling signed webhooks / existing subscription management. Do not roll code back to the old hardcoded free quota implementation with live subscribers.

Monitor Stripe failed deliveries and `[Stripe] Reconciliation failed` logs. After an outage, resend failed events; renewal reconciliation never changes existing period counters. Unrecognized prices/multiple paid subscriptions need operator review, not guessed entitlements. A process crash between reservation and document insert may strand a slot; investigate the reservation timestamp and storage/document evidence before manually releasing it. Do not automatically refund old reservations with no evidence that an upload failed.

These limits cover document uploads, not unlimited provider spending: repeat transcriptions, chat and onboarding can still incur costs. Priority queues, SLA guarantees and dedicated support are not claimed by these plans. Visual mode remains governed by its existing controlled-preview rules. Tax collection, business details, refund policy and billing terms must be configured/reviewed by the merchant before a public commercial launch; this code does not choose tax treatment or issue refunds.

No production credentials were available in the local task. No production migration, live Stripe resource creation, charge, deployment, or publication was performed by this implementation.

## Local verification

- Production client and server bundles built successfully; existing analytics/font-order/chunk-size warnings remain.
- TypeScript passed.
- 228 tests across 26 suites passed, including signed webhook verification, fail-closed checkout settings, real PostgreSQL-compatible transactional quota/migration tests, double-click checkout, renewal/cancellation/upgrade handling, and document/image-mode regressions. OAuth and live-membership suites require external credentials and were excluded.
- `scripts/billing-ui-qa.mjs` passed against the built app with synthetic local responses: desktop/mobile layout, all three checkout choices, checkout payload, owner exemption, management while new checkout is disabled, canceled return, and error/retry. It blocks external requests and excludes the unconfigured analytics script. Screenshots use synthetic accounts, not customer data.
