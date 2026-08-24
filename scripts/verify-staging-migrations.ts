import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";

const migrationsDir = resolve(process.cwd(), "drizzle/staging-migrations");
const migrationFiles = (await readdir(migrationsDir))
  .filter(name => /^\d+_.+\.sql$/.test(name))
  .sort();

if (migrationFiles.length === 0) {
  throw new Error(`No staging migrations found in ${migrationsDir}`);
}

const db = await PGlite.create({ extensions: { vector } });

try {
  for (const filename of migrationFiles) {
    const sql = await readFile(resolve(migrationsDir, filename), "utf8");
    const statements = sql
      .split("--> statement-breakpoint")
      .map(statement => statement.trim())
      .filter(Boolean);

    for (const [index, statement] of statements.entries()) {
      try {
        await db.exec(statement);
      } catch (error) {
        throw new Error(
          `${filename}, statement ${index + 1}: ${String(error)}`
        );
      }
    }
  }

  const tables = await db.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  const requiredTables = [
    "activity_log",
    "document_assignments",
    "document_embeddings",
    "document_entities",
    "document_groups",
    "documents",
    "entities",
    "entity_aliases",
    "jobs",
    "merge_suggestions",
    "onboarding_samples",
    "project_invites",
    "project_members",
    "projects",
    "research_conversations",
    "review_activities",
    "review_sessions",
    "stripe_webhook_events",
    "transcription_queue_tasks",
    "transcriptions",
    "user_xp_stats",
    "users",
    "validation_assignments",
    "validation_reviews",
    "validation_sessions",
  ];
  const actualTables = new Set(tables.rows.map(({ table_name }) => table_name));
  const missingTables = requiredTables.filter(name => !actualTables.has(name));
  if (missingTables.length > 0) {
    throw new Error(`Missing required tables: ${missingTables.join(", ")}`);
  }

  const vectorColumn = await db.query<{ type: string }>(`
    SELECT format_type(a.atttypid, a.atttypmod) AS type
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    WHERE c.relname = 'document_embeddings'
      AND a.attname = 'embedding'
      AND a.attnum > 0
      AND NOT a.attisdropped
  `);
  if (vectorColumn.rows[0]?.type !== "vector(3072)") {
    throw new Error(
      `Expected vector(3072), found ${vectorColumn.rows[0]?.type ?? "nothing"}`
    );
  }

  const requiredIndexes = [
    "embeddings_content_tsv_idx",
    "pm_project_user_unique",
    "rs_user_project_unique",
    "uxs_user_project_unique",
    "va_session_doc_reviewer_unique",
    "vr_assignment_line_unique",
    "transcription_queue_project_document_uq",
    "transcriptions_documentId_unique",
    "users_stripeCustomerId_unique",
    "users_stripeSubscriptionId_unique",
  ];
  const indexes = await db.query<{ indexname: string }>(`
    SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
  `);
  const actualIndexes = new Set(indexes.rows.map(({ indexname }) => indexname));
  const missingIndexes = requiredIndexes.filter(
    name => !actualIndexes.has(name)
  );
  if (missingIndexes.length > 0) {
    throw new Error(`Missing required indexes: ${missingIndexes.join(", ")}`);
  }

  const foreignKeys = await db.query<{ count: number }>(`
    SELECT count(*)::int AS count
    FROM pg_constraint
    WHERE contype = 'f' AND connamespace = 'public'::regnamespace
  `);
  if ((foreignKeys.rows[0]?.count ?? 0) < 40) {
    throw new Error(
      `Expected at least 40 foreign keys, found ${foreignKeys.rows[0]?.count ?? 0}`
    );
  }

  const queueChecks = await db.query<{ conname: string }>(`
    SELECT conname
    FROM pg_constraint
    WHERE contype = 'c'
      AND conrelid = 'transcription_queue_tasks'::regclass
  `);
  const actualQueueChecks = new Set(
    queueChecks.rows.map(({ conname }) => conname)
  );
  const requiredQueueChecks = [
    "transcription_queue_attempts_check",
    "transcription_queue_max_attempts_check",
    "transcription_queue_attempt_limit_check",
  ];
  const missingQueueChecks = requiredQueueChecks.filter(
    name => !actualQueueChecks.has(name)
  );
  if (missingQueueChecks.length > 0) {
    throw new Error(
      `Missing queue constraints: ${missingQueueChecks.join(", ")}`
    );
  }

  console.log(
    `Verified ${migrationFiles.length} migration${migrationFiles.length === 1 ? "" : "s"}: ` +
      `${tables.rows.length} tables, ` +
      `${foreignKeys.rows[0].count} foreign keys, pgvector vector(3072), and required indexes.`
  );
} finally {
  await db.close();
}
