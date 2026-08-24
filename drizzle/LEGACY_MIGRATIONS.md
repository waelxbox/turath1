# Legacy migration histories

The SQL and metadata directly under `drizzle/` and under `drizzle/migrations/`
are retained only as forensic history. They are not deployable:

- `drizzle/meta/_journal.json` identifies the root history as MySQL, while the
  application schema is PostgreSQL.
- PostgreSQL migration files `0002` through `0010` under
  `drizzle/migrations/` contain NUL bytes and no executable migration SQL.
- Those histories do not reproduce the current 25-table schema.

`drizzle/0011_durable_transcription_queue.sql` is retained only as the isolated
queue integration-test fixture. It is not part of the deployable journal.

`drizzle.config.ts` intentionally points to `drizzle/staging-migrations/`, the
new canonical chain for **empty databases only**. Do not change the output path
back to either legacy location and do not apply the canonical baseline to an
existing database.

See `docs/staging-database.md` for deployment and existing-database guidance.
