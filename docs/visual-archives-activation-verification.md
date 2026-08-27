# Visual Archives Activation Verification

**Scope:** controlled staging verification after the live Supabase migration and RLS enablement.

## Confirmed runtime state

- The restarted development runtime reports `visualArchives.availability = { enabled: true }`.
- The configured runtime database contains all five Visual Archives tables:
  `visual_project_modes`, `visual_assets`, `vra_records`, `vra_record_relations`, and `vra_record_revisions`.
- The required project-scoped composite foreign keys and indexes are present.
- RLS is enabled on every Visual Archives table.

## Credentialed smoke result

Using the owner’s existing authorized account and a locally generated **synthetic PNG only**, the staging harness completed these live checks successfully:

- PNG ingestion, immutable original storage, and JPEG display/thumbnail generation;
- unauthenticated thumbnail denial (`401`) and owner-authorized original/display/thumbnail retrieval with private cache controls;
- VRA Collection, Work, and Image creation, plus an explicitly approved Work–Image relation;
- Gemini 3.1 Pro evidence-only suggestions retained separately from reviewed metadata;
- explicit acceptance of an allowed descriptive field, rejection of `confidenceNotes`, and persisted record revision provenance; and
- same-user, cross-project asset attachment and protected-asset delivery denial (`404`).

The checks left three clearly named internal smoke-test projects containing only synthetic material as auditable staging evidence. No deletion workflow was exercised.

## RLS limitation to retain

The runtime connection is the database role `postgres`, which has `BYPASSRLS`; the five visual tables currently have **zero RLS policies**. Application-level authorization and the tenant/composite foreign-key constraints therefore remain the active enforcement controls for the direct server connection. This is appropriate only while the database is not exposed through Supabase client credentials. Do not claim database-enforced tenant isolation unless a non-bypass runtime role and explicit project-membership policies are introduced.

## Browser verification note

The temporary development preview host is not registered as a Google OAuth redirect URI, so browser login on that host is blocked by Google’s `redirect_uri_mismatch` response. The primary `turath.app` domain correctly reaches Google’s sign-in flow, but the attached browser session is not currently signed in. A short-lived, owner-scoped verification session was used only on the staging preview to confirm that the enabled dashboard shows the three internal Visual Archives projects alongside existing document projects, and that the completed visual workspace shows its VRA navigation, distinct Collection/Work/Image totals, approved record, empty review queue, and rendered authenticated thumbnail. The temporary session was cleared immediately after verification. The credentialed server-side smoke harness remains the authoritative asset/AI/storage evidence.
