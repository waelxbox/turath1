# Visual Archives: Controlled-Staging Readiness

## Decision

**TURATH Visual Archives is ready for controlled staging, not an unrestricted production launch.** The feature is enabled in the restarted staging runtime, and the live verification used only an owner-authorized account and synthetic images. Existing document-transcription projects continue to appear and function as document projects.

## Verification evidence

| Area | Result | Evidence |
|---|---|---|
| Feature availability | Passed | The restarted runtime returned `visualArchives.availability = { enabled: true }`. |
| Supabase migration | Passed | All five expected tables exist: `visual_project_modes`, `visual_assets`, `vra_records`, `vra_record_relations`, and `vra_record_revisions`. |
| Data integrity | Passed | Project-scoped composite foreign keys and indexes, including the visual-asset, relation, and revision constraints, were present. |
| Image ingestion | Passed | A synthetic PNG uploaded successfully; the immutable original and JPEG display/thumbnail derivatives were created. |
| Asset access | Passed | An unauthenticated derivative request returned `401`; an owner-authorized request returned original, display, and thumbnail bytes with the intended private cache controls. |
| VRA catalog workflow | Passed | A Collection, Work, and Image record were created, manually linked, and an approved Work–Image relationship persisted. |
| AI review boundary | Passed | Gemini 3.1 Pro suggestions remained separate from human-reviewed metadata; one permitted field was explicitly accepted and `confidenceNotes` was rejected. |
| Provenance | Passed | Record creation, field acceptance, and approval produced three persisted revision entries. |
| Project isolation | Passed | A visual asset could not be attached to a same-user sibling project; protected derivative delivery through the sibling project returned `404`. |
| Existing regression suite | Passed | 144 of 144 tests passed. |
| Type and build validation | Passed | TypeScript completed without errors and the production build completed. |
| Dependency audit | Passed | The production dependency audit reported no known vulnerabilities. |
| Browser verification | Passed | In the authenticated staging preview, visual projects appeared alongside existing document projects; the completed visual workspace rendered the protected thumbnail, VRA navigation, Collection/Work/Image counts, and review state. |

## RLS finding

RLS is enabled on all five Visual Archives tables, but the current runtime connection uses the PostgreSQL role `postgres`, which has `BYPASSRLS`; no table policy currently exists. Therefore, **RLS is not an independent access-control layer for the server today**. Project membership checks in the application, protected asset routes, and project-scoped foreign keys are the active safeguards.

Before exposing Supabase directly to client credentials or relying on database RLS for tenant isolation, introduce a non-bypass runtime role and explicit policies tied to project membership. This requirement is recorded in `todo.md` and is not a blocker for the present direct-server controlled staging model.

## Release boundary

The three new `[Internal] Visual Archives smoke …` projects are intentional audit artifacts and contain only synthetic content. No collection documents, Behna material, or Qufti material was used. Asset deletion was not tested and remains outside this release scope.

Keep the feature limited to explicit testers and approved or synthetic images. Do not position Visual Archives as fully production-ready until the deletion/reconciliation lifecycle, direct or multipart large-file ingestion, durable background processing, visual discovery/embeddings, IIIF/VRA exports, an RLS non-bypass path, and broader operational testing have been completed.

## Publishing note

This checkpoint records the verified staging state. It does **not** publish or change the public deployment. If you decide to expose this updated build, use the Management UI’s **Publish** control after reviewing the checkpoint.
