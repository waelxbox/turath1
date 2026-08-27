# Visual Archives Controlled Beta

## Scope boundary

This increment changes only the Visual Archives workspace. Document upload, transcription, review, search, and chat behavior remain outside its implementation scope.

## Standards basis

The VRA Core XML export uses the official VRA Core 4.0 namespace, `http://www.vraweb.org/vracore4.htm`, and wrapper/record structure published by the Library of Congress. The unrestricted VRA Core 4 schema defines a `vra` wrapper containing `collection`, `work`, and `image` records, with nesting available for Collection–Work–Image hierarchy. TURATH currently exports a reviewed-metadata profile aligned to that structure and should be independently schema-validated with institutional data before it is represented as a complete interoperability implementation.

Source: https://www.loc.gov/standards/vracore/vra.xsd and https://www.loc.gov/standards/vracore/schemas.html

## Verification context

On 2026-08-27, a short-lived owner-only session was loaded in the staging preview solely to inspect the Visual Archives interfaces. It will be cleared after verification. The live controlled-beta smoke project is `144`, contains synthetic courtyard images only, and must not be treated as collection content.

## Completed controlled-beta capabilities

- Cursor-paginated Visual Asset and VRA catalog views, searchable reviewed-record discovery, filters, and bulk review state changes.
- Human-confirmed many-Images-to-one-Work/Site organization and AI comparison output that never creates a link or record on its own.
- Evidence-linked Visual Archives Q&A, restricted to approved records, with citations and protected thumbnails.
- Approved-by-default CSV, JSON, and VRA Core 4 XML catalog data exports, plus selected-original ZIP export with a protected manifest.

## Live database handoff

Before testing a collection with hundreds of images, apply `drizzle/migrations/0012_visual_archives_controlled_beta.sql` in the TURATH Supabase SQL Editor. It adds only three Visual Archives indexes; it does not create, edit, or delete projects, assets, catalog records, relationships, or document-mode data. The application remains compatible before the indexes are applied, but the indexes make the cursor-based asset and catalog views perform predictably as the number of Images grows.

## Browser verification

The authenticated staging review of synthetic project `144` confirmed that **Discover** shows only approved Work and Image records, usable Work type, location, and subject facets, and protected thumbnails. The **Ask archive** page presents its evidence boundary before a question is sent: it states that answers cite approved VRA records and excludes AI drafts and unreviewed candidate identifications.

The controlled browser question, “Which approved Images depict the test-site courtyard?”, was submitted through the Visual Archives interface for the final cited-response rendering check.

The answer identified the two approved synthetic Image records, cited them as `[Record 2]` and `[Record 3]`, and displayed protected thumbnail cards for each cited Work or Image. The browser also confirmed that **Exports** renders reviewed-only CSV, JSON, and VRA Core 4 XML choices, keeps “Include unapproved working records” unchecked by default, and requires an explicit selected-image action before the private ZIP control becomes available.

Selecting one synthetic image changed the disabled action to “Download 1 as ZIP”; the authenticated browser flow was then invoked. The endpoint had already been independently verified with the same synthetic project: its ZIP contained the selected immutable originals plus `turath-visual-manifest.json` and no raw storage URL.

## Validation result

The controlled-beta checks used only synthetic images. Live owner-authorized smoke tests verified automated two-image intake, one Image record and separate Gemini draft per image, approved-only discovery, evidence-linked Q&A with record citations, human-authorized Work grouping, reviewed catalog exports, and selected-original ZIP contents. The final automated suite reported 17 passing test files and 162 passing tests; TypeScript passed; the production build completed; and the production dependency audit reported no known vulnerabilities.

## Remaining controlled-beta boundaries

- Apply `0012_visual_archives_controlled_beta.sql` manually in the real Supabase SQL Editor before a several-hundred-image test; the managed SQL action targets the wrong historical database and must not be used for this migration.
- Browser intake remains intentionally bounded to two concurrent image-and-Gemini operations, with up to two retries for temporary failures. It is designed for a few hundred images but is not yet a durable background queue; keeping the tab open is required.
- AI grouping output is a non-persisting hypothesis only. It neither creates a Work nor attaches any Image until the reviewer chooses the grouping action.
- Visual Archives remains restricted to Adam’s allowlisted account. No collaborator or public access was enabled.
