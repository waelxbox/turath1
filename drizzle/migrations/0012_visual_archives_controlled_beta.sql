-- Forward-only Visual Archives controlled-beta performance indexes.
-- Safe for existing document projects: the indexed tables contain visual-mode data only.

CREATE INDEX IF NOT EXISTS "visual_assets_project_status_created_id_idx"
  ON "visual_assets" ("projectId", "status", "createdAt" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "vra_records_project_status_updated_id_idx"
  ON "vra_records" ("projectId", "status", "updatedAt" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "vra_records_project_type_status_updated_id_idx"
  ON "vra_records" ("projectId", "recordType", "status", "updatedAt" DESC, "id" DESC);
