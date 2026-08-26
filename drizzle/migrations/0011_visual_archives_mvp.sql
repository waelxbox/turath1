-- TURATH Visual Archives controlled MVP
-- Forward-only: existing projects remain document_transcription projects.

DO $$ BEGIN
  CREATE TYPE "public"."archive_mode" AS ENUM ('document_transcription', 'visual_vra');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."visual_asset_status" AS ENUM ('uploaded', 'ready', 'failed', 'deletion_pending');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."vra_record_type" AS ENUM ('collection', 'work', 'image');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."vra_record_status" AS ENUM ('draft', 'needs_review', 'approved', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."vra_relation_status" AS ENUM ('suggested', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "visual_project_modes" (
  "projectId" integer PRIMARY KEY REFERENCES "projects"("id") ON DELETE CASCADE,
  "archiveMode" "archive_mode" DEFAULT 'visual_vra' NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "visual_project_modes_visual_only_chk" CHECK ("archiveMode" = 'visual_vra')
);

CREATE TABLE IF NOT EXISTS "visual_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "projectId" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "createdByUserId" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "filename" varchar(512) NOT NULL,
  "mimeType" varchar(64) NOT NULL,
  "byteSize" integer NOT NULL,
  "sha256" varchar(64) NOT NULL,
  "width" integer,
  "height" integer,
  "originalKey" text NOT NULL,
  "displayKey" text,
  "thumbnailKey" text,
  "technicalMetadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" "visual_asset_status" DEFAULT 'uploaded' NOT NULL,
  "errorMessage" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "visual_assets_projectId_id_uq"
  ON "visual_assets" ("projectId", "id");
CREATE INDEX IF NOT EXISTS "visual_assets_projectId_idx"
  ON "visual_assets" ("projectId");
CREATE INDEX IF NOT EXISTS "visual_assets_projectId_status_idx"
  ON "visual_assets" ("projectId", "status");
CREATE INDEX IF NOT EXISTS "visual_assets_projectId_sha256_idx"
  ON "visual_assets" ("projectId", "sha256");

CREATE TABLE IF NOT EXISTS "vra_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "projectId" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "recordType" "vra_record_type" NOT NULL,
  "status" "vra_record_status" DEFAULT 'draft' NOT NULL,
  "title" varchar(1024) NOT NULL,
  "localIdentifier" varchar(255),
  "assetId" uuid,
  "reviewedJson" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "aiSuggestedJson" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "suggestionProvenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "createdByUserId" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "updatedByUserId" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "approvedByUserId" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "approvedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "vra_records_projectId_id_uq"
  ON "vra_records" ("projectId", "id");
CREATE INDEX IF NOT EXISTS "vra_records_projectId_idx"
  ON "vra_records" ("projectId");
CREATE INDEX IF NOT EXISTS "vra_records_projectId_type_idx"
  ON "vra_records" ("projectId", "recordType");
CREATE INDEX IF NOT EXISTS "vra_records_projectId_status_idx"
  ON "vra_records" ("projectId", "status");
CREATE INDEX IF NOT EXISTS "vra_records_projectId_assetId_idx"
  ON "vra_records" ("projectId", "assetId");

DO $$ BEGIN
  ALTER TABLE "vra_records"
    ADD CONSTRAINT "vra_records_project_asset_fk"
    FOREIGN KEY ("projectId", "assetId")
    REFERENCES "visual_assets" ("projectId", "id")
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "vra_record_relations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "projectId" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "sourceRecordId" uuid NOT NULL,
  "targetRecordId" uuid NOT NULL,
  "relationType" varchar(128) NOT NULL,
  "status" "vra_relation_status" DEFAULT 'approved' NOT NULL,
  "evidenceJson" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "createdByUserId" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "approvedByUserId" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "vra_relations_project_source_target_type_uq"
  ON "vra_record_relations" ("projectId", "sourceRecordId", "targetRecordId", "relationType");
CREATE INDEX IF NOT EXISTS "vra_relations_projectId_idx"
  ON "vra_record_relations" ("projectId");
CREATE INDEX IF NOT EXISTS "vra_relations_source_idx"
  ON "vra_record_relations" ("projectId", "sourceRecordId");
CREATE INDEX IF NOT EXISTS "vra_relations_target_idx"
  ON "vra_record_relations" ("projectId", "targetRecordId");

DO $$ BEGIN
  ALTER TABLE "vra_record_relations"
    ADD CONSTRAINT "vra_relations_source_fk"
    FOREIGN KEY ("projectId", "sourceRecordId")
    REFERENCES "vra_records" ("projectId", "id")
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "vra_record_relations"
    ADD CONSTRAINT "vra_relations_target_fk"
    FOREIGN KEY ("projectId", "targetRecordId")
    REFERENCES "vra_records" ("projectId", "id")
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "vra_record_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "projectId" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "recordId" uuid NOT NULL,
  "revision" integer NOT NULL,
  "snapshotJson" jsonb NOT NULL,
  "changeSummary" text,
  "createdByUserId" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "vra_revisions_project_record_revision_uq"
  ON "vra_record_revisions" ("projectId", "recordId", "revision");
CREATE INDEX IF NOT EXISTS "vra_revisions_projectId_recordId_idx"
  ON "vra_record_revisions" ("projectId", "recordId");

DO $$ BEGIN
  ALTER TABLE "vra_record_revisions"
    ADD CONSTRAINT "vra_revisions_record_fk"
    FOREIGN KEY ("projectId", "recordId")
    REFERENCES "vra_records" ("projectId", "id")
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
