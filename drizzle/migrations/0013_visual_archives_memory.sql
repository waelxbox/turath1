-- TURATH Visual Archives controlled-beta visual memory foundation.
-- Forward-only. Do not apply automatically; run in Supabase SQL Editor only
-- after reviewing the Visual Archives controlled-beta runbook.

CREATE TABLE IF NOT EXISTS "visual_record_embeddings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "projectId" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "recordId" uuid NOT NULL,
  "assetId" uuid,
  "sourceRevision" integer NOT NULL,
  "content" text NOT NULL,
  "embedding" vector(3072),
  "model" varchar(120) NOT NULL,
  "status" varchar(32) DEFAULT 'pending' NOT NULL,
  "errorMessage" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "visual_record_embeddings_project_record_fk"
    FOREIGN KEY ("projectId", "recordId") REFERENCES "vra_records"("projectId", "id") ON DELETE CASCADE,
  CONSTRAINT "visual_record_embeddings_project_asset_fk"
    FOREIGN KEY ("projectId", "assetId") REFERENCES "visual_assets"("projectId", "id") ON DELETE CASCADE,
  CONSTRAINT "visual_record_embeddings_project_record_uq" UNIQUE ("projectId", "recordId")
);

CREATE INDEX IF NOT EXISTS "visual_record_embeddings_project_status_idx"
  ON "visual_record_embeddings" ("projectId", "status");
CREATE INDEX IF NOT EXISTS "visual_record_embeddings_project_asset_idx"
  ON "visual_record_embeddings" ("projectId", "assetId");

ALTER TABLE "visual_record_embeddings" ENABLE ROW LEVEL SECURITY;
