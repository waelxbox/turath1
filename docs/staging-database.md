# Staging database setup and recovery

This runbook creates a fresh controlled-staging database from the current
Drizzle schema. It does not modify or adopt any pre-existing Turath database.

## What is canonical

- Schema source: `drizzle/schema.ts`
- Drizzle configuration: `drizzle.config.ts`
- Deployable migrations: `drizzle/staging-migrations/`
- Offline execution verifier: `scripts/verify-staging-migrations.ts`

The older SQL and metadata in `drizzle/` and `drizzle/migrations/` are preserved
as forensic evidence. They are deliberately excluded from Drizzle's configured
output path because they are incompatible or corrupted. See
`drizzle/LEGACY_MIGRATIONS.md`.

## Prerequisites

1. PostgreSQL 15 or newer with the `vector` extension available. Supabase's
   extension dashboard can enable it if the migration role cannot run
   `CREATE EXTENSION`.
2. A new, empty staging database and a dedicated staging credential.
3. The exact package manager version declared in `package.json` and a frozen
   dependency install: `corepack pnpm install --frozen-lockfile`.
4. A direct/session PostgreSQL URL for migration work. Avoid a transaction
   pooler for DDL migrations. The runtime can use a pooler URL afterward.

Never point these steps at production or a database containing data.

## Create fresh staging

1. Copy `.env.example` to `.env` and replace every placeholder. Set
   `DATABASE_URL` to the new staging database. `SUPABASE_DATABASE_URL` is no
   longer read; runtime and migration commands use the same variable.
2. Validate the migration metadata:

   ```bash
   corepack pnpm db:check
   ```

3. Execute the complete chain against disposable in-memory PostgreSQL with
   pgvector and assert tables, foreign keys, indexes, and vector dimensions:

   ```bash
   corepack pnpm db:verify
   ```

4. Take a provider snapshot or record a restore point, then apply migrations:

   ```bash
   corepack pnpm db:migrate
   ```

5. Verify the deployed database before starting the application:

   ```sql
   SELECT extname FROM pg_extension WHERE extname = 'vector';

   SELECT count(*) AS public_tables
   FROM information_schema.tables
   WHERE table_schema = 'public' AND table_type = 'BASE TABLE';

   SELECT format_type(a.atttypid, a.atttypmod) AS embedding_type
   FROM pg_attribute a
   JOIN pg_class c ON c.oid = a.attrelid
   WHERE c.relname = 'document_embeddings'
     AND a.attname = 'embedding';
   ```

   Expected results are the `vector` extension, all 23 core public application
   tables (the total may grow in later migrations), and `vector(3072)`.

6. Start the application with the same database in staging and run a smoke test:
   create a user and project, upload one non-sensitive fixture, transcribe it,
   review it, search for it, then delete it. Confirm no production credentials
   or production storage buckets are present in the staging environment.

## Migration discipline after the baseline

1. Change `drizzle/schema.ts`.
2. Run `corepack pnpm db:generate` once and review every generated SQL statement.
3. Run `corepack pnpm db:check` and `corepack pnpm db:verify`.
4. Apply first to a newly created disposable database, then to staging.
5. Snapshot staging before migration and record the application commit and
   migration journal state used by the deployment.

Do not combine generation and migration in one command. Generation is a code
review step; migration is an environment change.

## Rollback and recovery

The baseline is forward-only. SQL `down` migrations are intentionally not
generated because destructive reversal is unsafe for archival data.

- Before a staging migration, take a provider snapshot and test that it can be
  restored.
- If a fresh staging baseline fails, discard only that explicitly identified
  empty staging database, create another empty database, fix the migration, and
  rerun the verifier. Never recursively delete a broad database/server target.
- If a later migration fails after writing data, stop application traffic and
  restore the pre-migration snapshot. Do not hand-edit Drizzle's migration
  journal to force success.
- Preserve the failed database until the cause and any partial effects have been
  recorded.

## Existing database upgrade path

Do **not** run `db:migrate` with this baseline against an existing Turath
database. It will attempt to create objects that may already exist, and the old
migration journals cannot prove which schema changes were applied.

An existing environment requires a separate audited forward-migration project:

1. Take a full backup and restore it into an isolated clone.
2. Introspect the clone into a temporary directory, not
   `drizzle/staging-migrations/`.
3. Compare every enum, table, column, default, index, foreign key, extension, and
   migration-journal row with `drizzle/schema.ts` and the canonical baseline.
4. Run data audits for duplicate rows before adding the new unique indexes, and
   audit project/resource mismatches before adding tenant-integrity constraints.
5. Write explicit, idempotent forward SQL for the observed starting state. Use
   `NOT VALID` followed by `VALIDATE CONSTRAINT` for large-table constraints
   where appropriate.
6. Rehearse the upgrade and snapshot restore on the clone, measure locks and
   duration, then schedule a controlled staging maintenance window.
7. Adopt a new migration baseline only after schema equality is independently
   verified. Document any manual journal adoption; never mark migrations as
   applied merely to silence an error.

This process preserves existing data and provides a defensible upgrade path;
the repository alone does not contain enough reliable history to automate it.
