# TURATH Visual Archives — Controlled MVP

## Status

The Visual Archives product mode is implemented behind the server-side environment flag `TURATH_VISUAL_ARCHIVES_ENABLED`. The default is `false`, so existing document-transcription projects and production routes retain their previous behavior until the PostgreSQL migration is applied and the flag is deliberately enabled.

## Domain model

The MVP uses the VRA Core distinction between a visual **Collection**, a **Work**, and an **Image** that documents a Work. VRA records store two independent JSON documents:

- `reviewedJson`: human-authored or human-approved catalog data;
- `aiSuggestedJson`: model-generated suggestions that are never approved automatically.

`suggestionProvenance` records the model, source asset, generation time, and evidence constraint. Accepting a suggestion copies only explicitly selected fields into `reviewedJson` and creates a record revision.

## Storage and ingestion

The first controlled release accepts JPEG and PNG images up to 15 MB. Each successful ingestion produces:

1. an immutable original object;
2. a bounded JPEG display derivative;
3. a bounded JPEG thumbnail;
4. a SHA-256 checksum and technical image metadata;
5. project-scoped database records containing object keys, not provider URLs.

All variants are delivered through authenticated project routes. Raw object keys are not accepted from clients. The current MVP does not expose a destructive asset-delete action because the live Forge deletion endpoint has not been credential-smoke-tested; the schema reserves `deletion_pending` for a later verified lifecycle.

## Tenant boundaries

Every visual asset, VRA record, relation, and revision is project-scoped. Composite PostgreSQL foreign keys prevent a record in one project from referencing an asset or record in another project. Application procedures also require a project membership role; viewers can read while owners and editors can mutate.

## Project-mode compatibility

Existing rows in `projects` are untouched. A one-to-one row in `visual_project_modes` marks only new visual projects. Absence of that row means the project is a standard document-transcription project. Visual mode is therefore immutable without rewriting existing project data.

## Activation gate

The reviewed migration is:

`drizzle/migrations/0011_visual_archives_mvp.sql`

It has been executed successfully against an isolated PostgreSQL-compatible database containing a pre-existing document project. The existing project remained unchanged and no visual-mode row was created for it.

The current WebDev SQL control plane points to a legacy TiDB/MySQL database rather than TURATH's Supabase PostgreSQL connection, so the migration was **not** applied there. Do not enable `TURATH_VISUAL_ARCHIVES_ENABLED` until the SQL has been applied to TURATH's actual Supabase PostgreSQL database through the approved production migration channel.

## Controlled release checklist

1. Back up the live PostgreSQL database.
2. Apply `0011_visual_archives_mvp.sql` to the Supabase staging database.
3. Verify the new tables and composite foreign keys.
4. Enable `TURATH_VISUAL_ARCHIVES_ENABLED=true` in staging only.
5. Smoke-test authenticated JPEG and PNG upload, derivative delivery, VRA record creation, field-level suggestion acceptance, and cross-tenant denial.
6. Use only synthetic or explicitly authorized images.
7. Enable for an explicit tester allowlist before any broader release.

## Deferred capabilities

This controlled MVP intentionally defers large TIFF/RAW upload, direct-to-object-storage multipart upload, visual embeddings, duplicate detection, Archive Atlas, IIIF manifests, Web Annotation regions, VRA XML export, bulk ingest, storage deletion reconciliation, and an Autoscale-compatible durable analysis worker.

## Standards references

The domain and export roadmap follow the Library of Congress VRA Core documentation and the IIIF Presentation 3 / W3C Web Annotation models.[1] [2] [3]

## References

[1]: https://www.loc.gov/standards/vracore/ "Library of Congress — VRA Core"
[2]: https://iiif.io/api/presentation/3.0/ "IIIF Presentation API 3.0"
[3]: https://www.w3.org/TR/annotation-model/ "W3C Web Annotation Data Model"
