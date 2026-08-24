# TURATH controlled-staging runbook

This environment is for synthetic or explicitly approved non-production archive
data only. Do not admit external institutions or production collections until
the tenant-isolation, storage-authorization, migration, webhook, and durable-job
security work has passed independent review.

## Release gates

A staging release is eligible to deploy only when all of the following are true:

- CI typechecks production and test code, runs unit and isolated-database tests,
  builds the production artifact, validates migrations, and passes the critical
  production-dependency audit.
- The release uses an immutable image tag containing the Git commit SHA.
- A database backup has completed and a restore was verified during the last 30
  days.
- The database migration plan and the preceding application image are recorded
  in the release ticket.
- The smoke-test checklist below has an assigned operator.

Never run integration tests against staging. `pnpm test:integration` requires a
separate URL named `TURATH_TEST_DATABASE_URL` and refuses database names that do
not contain `test`.

## Required configuration

Copy `.env.staging.example` to the deployment platform's secret manager. Do not
commit `.env.staging`. Production-mode startup fails closed when any of these
critical values are absent:

| Setting                                             | Requirement                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `SUPABASE_DATABASE_URL`                             | Staging-only PostgreSQL connection with TLS; use the pooled application URL.                            |
| `JWT_SECRET`                                        | Independently generated random value of at least 32 bytes. Never reuse production or developer secrets. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`         | Dedicated staging OAuth web client with only the staging callback URL.                                  |
| `BUILT_IN_FORGE_API_URL` / `BUILT_IN_FORGE_API_KEY` | Dedicated staging storage/Forge credentials and namespace.                                              |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`       | Required when `TURATH_PRICING_ENABLED=true`; use Stripe test mode only.                                 |

Keep `TURATH_PRICING_ENABLED=false` until the signed webhook smoke test passes.
Apply least privilege and rotate every secret after suspected disclosure.

## Pre-deployment

1. Confirm the commit SHA, image digest, CI result, and prior image digest.
2. Confirm `/health/ready` on the current release is HTTP 200.
3. Take a provider snapshot and a logical backup using `pg_dump --format=custom
--no-owner --no-acl "$SUPABASE_DATABASE_URL" --file turath-before-<sha>.dump`.
   Store it encrypted outside the application host and record its checksum.
4. Run `pnpm db:check` against the release source.
5. Apply migrations once from a controlled release job with a direct migration
   database URL. Do not let every application replica migrate at startup.
6. Deploy one canary replica and wait for `/health/ready` before adding traffic.

The liveness endpoint is `/health/live`; it reports only whether the process is
alive. `/health/ready` additionally checks critical configuration, PostgreSQL,
and shutdown state. Load balancers should route traffic using readiness, not
liveness.

## Smoke tests

Run these with two synthetic tenants, A and B, and retain the results:

- `GET /health/live` returns 200 and `GET /health/ready` returns 200.
- Missing `JWT_SECRET` or an unreachable database prevents a production-mode
  process from starting.
- Google OAuth accepts the staging callback and logout clears the session.
- Tenant A cannot read, update, group, assign, validate, merge, or delete tenant
  B's resources when B's numeric IDs are substituted into A's requests.
- An unauthenticated storage request and a request for another tenant's object
  key are rejected without returning object bytes or a signed URL.
- A small synthetic image uploads, transcribes, saves review edits, appears in
  search, exports, and is removed from both PostgreSQL and object storage when
  deleted.
- Restarting a worker during transcription does not lose or duplicate the job.
- An unsigned or tampered Stripe webhook returns 400. A signed Stripe test event
  is processed once, including when delivered twice.
- Structured startup and shutdown events appear in logs without secret values.
- Send `SIGTERM`; readiness becomes 503, in-flight requests drain, and the
  process exits within 10 seconds.

## Monitoring during the controlled pilot

Alert on readiness failures, HTTP 5xx rate, database pool exhaustion, background
job age/failure rate, provider latency and errors, storage failures, and unusual
per-user AI/storage consumption. Retain security-relevant logs and ensure logs do
not contain document contents, signed URLs, credentials, or raw session tokens.

For the initial pilot, restrict access at the identity provider or ingress to an
explicit tester allowlist. Review errors and failed jobs daily.

## Rollback

1. Stop routing new traffic to the failing image; preserve logs and the release
   timeline.
2. If the schema remains backward compatible, deploy the recorded previous image
   by immutable digest and rerun the smoke tests.
3. Do not automatically reverse a database migration. Prefer a reviewed forward
   fix. A restore loses writes made after the backup and requires an incident
   owner to approve a maintenance window.
4. If restoration is approved, isolate traffic, preserve a forensic snapshot,
   restore to a new database, validate row counts and tenant boundaries, then
   switch the application connection secret. Never restore over the only copy.

## Backup and restore drill

At least monthly, restore the newest encrypted dump into a disposable database
whose name contains `restore_test`. Verify migration metadata, table and tenant
row counts, representative document metadata, and application readiness. Delete
the disposable environment through the database provider after evidence is
captured. A backup is not considered valid until this drill succeeds.
