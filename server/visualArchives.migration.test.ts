import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../drizzle/migrations/0011_visual_archives_mvp.sql", import.meta.url),
  "utf8",
);
const betaMigration = readFileSync(
  new URL("../drizzle/migrations/0012_visual_archives_controlled_beta.sql", import.meta.url),
  "utf8",
);

describe("Visual Archives forward migration", () => {
  it("does not alter the live projects table", () => {
    expect(migration).not.toMatch(/ALTER\s+TABLE\s+"?projects"?/i);
  });

  it("uses a one-to-one visual mode side table with document projects as the implicit default", () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "visual_project_modes"');
    expect(migration).toContain('"projectId" integer PRIMARY KEY');
    expect(migration).toContain('"archiveMode" "archive_mode" DEFAULT \'visual_vra\' NOT NULL');
    expect(migration).toContain('CHECK ("archiveMode" = \'visual_vra\')');
  });

  it("creates tenant-scoped foreign keys for assets, records, relations, and revisions", () => {
    expect(migration).toContain('"visual_assets_projectId_id_uq"');
    expect(migration).toContain('"vra_records_projectId_id_uq"');
    expect(migration).toContain('FOREIGN KEY ("projectId", "assetId")');
    expect(migration).toContain('FOREIGN KEY ("projectId", "sourceRecordId")');
    expect(migration).toContain('FOREIGN KEY ("projectId", "recordId")');
  });

  it("executes forward-only against an existing PostgreSQL database without changing document projects", async () => {
    const database = new PGlite();
    await database.exec(`
      CREATE TABLE "users" ("id" serial PRIMARY KEY);
      CREATE TABLE "projects" (
        "id" serial PRIMARY KEY,
        "userId" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "name" varchar(255) NOT NULL
      );
      INSERT INTO "users" ("id") VALUES (1);
      INSERT INTO "projects" ("id", "userId", "name") VALUES (7, 1, 'Existing document archive');
    `);

    await database.exec(migration);

    const projectRows = await database.query<{ id: number; name: string }>(
      'SELECT "id", "name" FROM "projects" ORDER BY "id"',
    );
    const visualModeRows = await database.query<{ projectId: number }>(
      'SELECT "projectId" FROM "visual_project_modes"',
    );
    const tableRows = await database.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('visual_assets', 'vra_records', 'vra_record_relations', 'vra_record_revisions')
      ORDER BY table_name
    `);

    expect(projectRows.rows).toEqual([{ id: 7, name: "Existing document archive" }]);
    expect(visualModeRows.rows).toEqual([]);
    expect(tableRows.rows.map(row => row.table_name)).toEqual([
      "visual_assets",
      "vra_record_relations",
      "vra_record_revisions",
      "vra_records",
    ]);
    await database.close();
  });

  it("adds only visual-mode cursor indexes after the MVP migration", async () => {
    expect(betaMigration).not.toMatch(/ALTER\s+TABLE|DROP\s+/i);
    const database = new PGlite();
    await database.exec(`
      CREATE TABLE "users" ("id" serial PRIMARY KEY);
      CREATE TABLE "projects" ("id" serial PRIMARY KEY, "userId" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE, "name" varchar(255) NOT NULL);
      INSERT INTO "users" ("id") VALUES (1);
    `);
    await database.exec(migration);
    await database.exec(betaMigration);
    const rows = await database.query<{ indexname: string }>(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'visual_assets_project_status_created_id_idx',
          'vra_records_project_status_updated_id_idx',
          'vra_records_project_type_status_updated_id_idx'
        )
      ORDER BY indexname
    `);
    expect(rows.rows.map(row => row.indexname)).toEqual([
      "visual_assets_project_status_created_id_idx",
      "vra_records_project_status_updated_id_idx",
      "vra_records_project_type_status_updated_id_idx",
    ]);
    await database.close();
  });
});
