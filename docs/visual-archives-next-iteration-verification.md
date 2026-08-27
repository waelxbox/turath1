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

## Productization desktop audit

Authenticated desktop review of the Visual Archives Catalog confirmed that the project-scoped workspace renders the dark archive navigation, visual-mode label, image-first thumbnail cards, selected-state checkboxes, consistent status chips, bounded selection controls, filters, and direct record navigation in one coherent layout. The refined heading and sticky-control treatments are present in the running preview. This evidence uses an internal short-lived owner session only.

## Productization discovery audit

Authenticated desktop review of Discover confirmed the approved-only default, explicit draft-record toggle, typed metadata search, thumbnail-led result cards, facet counts, and a temporary-reference image control. The page visibly identifies the reference-image flow as in-memory and non-persistent. It also truthfully reports that semantic visual memory is unavailable pending the unapplied `0013` migration and explicit flag; no semantic results are presented as if they exist.

## Productization evidence-chat audit

Authenticated desktop review confirmed the refined Ask Archive workspace shows its approved-evidence scope, device-local history scope, intentionally worded suggested questions, and a stable composer. Selecting a suggested question populated the composer without navigating away or altering the active Visual Archive context. The next response check will verify cited evidence and local conversation continuity.

The selected question returned a grounded **insufficient-evidence** answer rather than inventing a religious-architecture conclusion from synthetic courtyard records. The response retained the question in device-local conversation history and displayed three clickable citation cards with matched approved fields. The result did not display AI drafts. This confirms that the productized chat retains a truthful evidence boundary under an unsupported question.

Reloading the Ask Archive route preserved the two-message conversation and its citation cards, confirming device-local continuity within the same project without changing the server-side evidence scope.

## Productization export audit

Authenticated desktop review confirmed the Export page renders consistent workspace navigation, clearly separated catalog versus selected-original export scopes, concise format explanations, protected thumbnail selection cards, an approved-only default, and a disabled ZIP action before an image is chosen. The UI now reports that a catalog attachment or streaming ZIP has **started**, rather than falsely claiming that a browser-streamed ZIP has finished.

Clicking the CSV control in the authenticated desktop preview successfully produced a visible toast naming `turath-visual-catalog-2026-08-27.csv` and stating that the download started. This verifies the browser-facing feedback together with the earlier protected attachment-header checks. The standalone mobile capture session remains unauthenticated and could not capture the protected catalog route; no responsive issue was observed in authenticated desktop QA, but manual mobile QA remains required.

## Record-route crash repair

The direct Visual Archives route that previously threw React error 310 was opened successfully after the repair: `/projects/137/records/0cc01df5-b890-4e76-a43f-401844f583ac`. The Image record rendered its protected display derivative, status/revision data, review controls, candidate identification, reviewed-field acceptance/rejection controls, and keyboard-navigation controls without an error boundary. The root cause was a keyboard `useEffect` declared after loading and missing-record conditional returns; it now runs unconditionally with safe optional-record guards.
