# Owner dashboard

The new `/admin` page is restricted to the authenticated account whose stored
email normalizes to `adamamin2027@gmail.com`. An **Admin** button appears on that
account's projects dashboard. Other accounts, including accounts with the generic
`admin` role, cannot use these endpoints. The server checks every data request;
hiding the navigation link is only a convenience.

## What it includes

- Platform totals: users, recent sign-ins and signups, project modes/status,
  document quota caps, document files, saved transcriptions, visual assets and VRA
  records, known original-file storage, review backlogs and job statuses.
- A 30-day UTC daily signup/intake series, with an accessible data table.
- Searchable user directory with signup/last-login dates, plan, quota counter,
  owned/shared project counts, retained workload and estimated costs.
- All-project browsing with search and archive-mode filters. Selecting a user
  shows both owned and shared projects, labeled with that user's membership role.
- Per-project collaborator lists including the owner exactly once.
- Manual refresh, server pagination, responsive layouts, and loading, empty,
  error/retry, signed-out and forbidden screens.

Administration is read-only. It does not grant access to another user's document
contents, change memberships, alter billing, or provide impersonation. Account
rows omit authentication identifiers, payment IDs, tokens and passwords. Metrics
responses use `Cache-Control: private, no-store`.

## Cost estimates and definitions

There is no complete historical token/billing ledger in the current schema.
The dashboard deliberately starts with unset cost rates instead of inventing a
provider bill. Enter average USD rates in **Cost assumptions**:

1. Per saved transcription record.
2. Per retained visual asset intake (your assumed average cataloguing expense).
3. Per decimal GB of original-file storage per month.

Processing = transcription count × transcription rate + asset count × intake
rate. Monthly storage = known original bytes / 1,000,000,000 × storage rate.
These appear separately; they are different time bases and must not be added as
a monthly bill. Rates are held in the page's memory and reset on reload. Zero is
an explicit rate; missing rates show **Set rates**, not a misleading $0.

Estimates exclude unmetered chat, onboarding, retries/reprocessing, cross-checks,
deleted data, embeddings, thumbnails/derivatives, database and hosting overhead,
taxes and provider discounts. Counts reflect retained rows, not an immutable
usage ledger. `documentQuotaUsed` is the existing lifetime quota counter, not
the number of currently stored files or a provider request count. Multi-page
uploads can have multiple document-file rows. Sign-in metrics count the stored
last-login timestamp, not daily active users. Job statuses are stored statuses,
not worker heartbeats. Saved conversations exclude ephemeral/unsaved chats.

User workload/cost is attributed to the **current project owner**. Shared
projects are shown for inspection but are not added to a collaborator's owned
totals. Historical ownership changes therefore change attribution. Project
member counts deduplicate repeated membership rows. Document bytes with missing
sizes are counted separately and excluded from the known-byte total.

## Implementation and deployment review

The branch adds `server/admin`, `shared/admin.ts`, and a lazy-loaded dashboard
page, plus registration in the app router and an owner-only navigation link.
No schema migration, new production dependency, billing activation, or provider
call is required. Existing database migrations (including Visual Archives) must
already be applied. The normal server-side session authentication and database
connection configuration remain prerequisites.

SQL aggregates each child table before joining, avoiding document × member ×
job multiplication. List endpoints page in the database (maximum 50 rows), and
detail aggregates scope to the selected page's projects. Multi-query responses
use a read-only, repeatable-read transaction. Global aggregates scan retained
metadata tables; there is no automatic polling or loading of archive bodies.
At substantially larger scale, consider indexed daily rollups/materialized
aggregates. Accurate provider spend requires a separate durable usage ledger.

Before publishing, Manus should review the branch, merge it, run the checks
below with a fresh dependency install, and verify `/admin` using the real owner
and a non-owner account in staging. Check live counts against a small known
project and confirm the cost assumptions match the intended operating model.
Rollback is a revert of this branch's commit and redeploy; there are no new DB
objects or data changes to reverse.

## Verification

```sh
pnpm check
pnpm exec vitest run server/admin/dashboard.test.ts --maxWorkers=1 --minWorkers=1
pnpm build
```

The admin tests run production SQL against PostgreSQL in PGlite and exercise
owner authorization, generic-admin denial, pagination, literal search/injection
inputs, quota filtering, ownership attribution, project modes, duplicate
memberships, aggregate fan-out, zero-data states, and explicit cost assumptions.

For UI checks using synthetic data only:

```sh
pnpm exec vite --host 127.0.0.1 --port 5183
# In another terminal; uses installed Chromium/Chrome in a separate headless profile:
node scripts/admin-dashboard-ui-qa.mjs
```

Screenshots default to `/tmp/turath-admin-qa`. Override with `ADMIN_QA_OUTPUT`.
`ADMIN_QA_PLAYWRIGHT` can point to an installed Playwright module if an isolated
test runtime is required. The script verifies desktop/mobile layout, cost
inputs, pagination, member expansion, empty/error/retry, and denied/anonymous
states without credentials or a real TURATH database.

Independent verification after integration: TypeScript passed; production client
and server builds passed; 209 tests across 71 suites passed, including 13 admin
tests, with no suites excluded. The UI smoke test passed against a local-only
Vite preview with synthetic API responses on desktop and 390px mobile.
Use `ADMIN_QA_BASE` to point the UI script at a different local preview port.
The existing build still reports analytics environment, font-import ordering,
and large-bundle warnings. Nothing was deployed or changed in the live database.
