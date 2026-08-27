# Visual Archives next iteration — verification log

## Desktop catalog check

On the authenticated staging preview, project 144 rendered the new Visual Archives catalog with the image-first Grid view selected by default. The page showed protected thumbnails, title/type/revision context, consistent approved status chips, project-scoped search and review filters, a Grid/List toggle, and clear **Select page** / **Select all** controls. The surrounding document-mode routes and UI were not opened or altered for this check.

The temporary owner session is used only for staging verification and will be cleared after the remaining Visual Archives checks.

## Export check

With the temporary owner session, the protected catalog endpoints returned non-empty private attachment downloads for all catalog formats: CSV (690 bytes), JSON (1,990 bytes), and VRA Core XML (1,665 bytes). Each response supplied an attachment `Content-Disposition` header. The Visual Archives export page rendered those three catalog controls and the existing selected-original ZIP selection interface.

## Evidence-chat check

The authenticated Visual Archives Ask Archive page answered the synthetic question “Which approved Images depict a courtyard?” from approved record data only. It cited the two approved Image records and showed clickable in-context evidence cards whose labels identify the matched approved fields (`title`, `subjects`, and `description`). The conversation remained visible while citations can be opened in a metadata drawer; no AI draft metadata appeared in the returned answer or citation labels.

Opening the cited Image card displayed its protected thumbnail, matched approved fields, and reviewed metadata in a dialog above the preserved conversation. The reviewer can open the full Image record from the dialog only by deliberate navigation.

## Responsive QA note

Desktop QA was completed on the authenticated staging preview for the image-first Catalog, protected Exports, cited Ask Archive results, and in-place evidence drawer. The responsive Catalog uses mobile-first single-column controls and progressively adds grid columns at the `sm`/`lg` breakpoints. Two independent mobile screenshot capture attempts failed before navigation completed because the automated capture lacks the temporary authenticated staging session; this was a verification-environment limitation rather than an observed layout failure. Manual mobile testing remains a handoff item.

## Unapplied visual-memory migration

`0013_visual_archives_memory.sql` is forward-only and intentionally **has not been applied**. It creates a project-scoped `visual_record_embeddings` table for vectors generated only from approved VRA metadata, with composite project/record and project/asset foreign keys. Existing perceptual neighborhood matching is available now from derivative fingerprints, is project-scoped, shows a score explanation, and cannot create a relation or merge records. Apply the migration in the Supabase SQL Editor only after reviewing it; then the next isolated increment can turn on text-vector and hybrid ranking.
