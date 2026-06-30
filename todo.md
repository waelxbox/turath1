# TURATH Platform TODO

## Phase 1: Foundation
- [x] Global design system (colors, typography, CSS variables)
- [x] App layout structure and routing
- [x] Landing page (marketing, CTA, feature overview)
- [x] Auth flow (login, protected routes)

## Phase 2: Database Schema
- [x] projects table (config, prompts, schema, glossary, pipeline)
- [x] onboarding_samples table (image, manual transcription, isHeldOut)
- [x] documents table (filename, storage_path, status, project_id)
- [x] transcriptions table (raw_json, reviewed_json, original_text, model_used)
- [x] jobs table (background processing queue)
- [x] Run migrations

## Phase 3: tRPC Routers
- [x] projects router (CRUD, config update, stats)
- [x] onboarding router (upload samples, generate config, validate, refine, activate)
- [x] documents router (list, upload, transcribe, batchTranscribe)
- [x] transcriptions router (getByDocument, saveReview)
- [x] export router (CSV, JSON ZIP generation)
- [x] jobs router (list)
- [x] transcriptionEngine.ts (universal single-pass + two-pass)
- [x] onboardingAgent.ts (Meta-AI config generation, validation, refinement)

## Phase 4: Dashboard & Auth
- [x] Project dashboard (list projects, stats, progress)
- [x] Create project dialog
- [x] Project workspace layout (sidebar nav per project)

## Phase 5: Onboarding Wizard
- [x] Sample upload with drag-and-drop and image preview
- [x] Manual transcription JSON editor with live validation
- [x] Held-out sample selection
- [x] AI analysis loading screen
- [x] Validation diff view (field-by-field comparison)
- [x] Natural language refinement feedback loop
- [x] Project activation and redirect

## Phase 6: Transcription Engine & Upload
- [x] Universal transcription engine (single-pass + two-pass)
- [x] Bulk document upload UI with per-file status
- [x] Batch transcribe pending documents
- [x] Active configuration summary panel

## Phase 7: Review Interface
- [x] Dynamic schema-driven form renderer
- [x] Side-by-side image + form layout
- [x] Status workflow (needs_review → reviewed / flagged)
- [x] Review queue with status filter
- [x] Field type mapping (string, boolean, array/tags, long text)
- [x] Auto-advance to next document after save

## Phase 8: Export & Settings
- [x] CSV export (dynamic columns from schema)
- [x] JSON export
- [x] TEI-XML placeholder (coming soon)
- [x] Project settings page (edit prompt, schema, glossary, pipeline, model, temperature)

## Phase 9: Polish & Tests
- [x] 17 vitest unit tests passing (auth, authorization, input validation)
- [x] Zero TypeScript errors
- [x] Status badge utility classes
- [x] Empty states for all pages
- [x] Final checkpoint and delivery

## Future Enhancements
- [ ] TEI-XML export format
- [ ] Hijri-to-Gregorian date conversion post-processing rule
- [ ] Project member invitations and shared workspaces
- [ ] Real-time batch processing progress via WebSocket
- [ ] Document page/folio management (multi-page documents)
- [ ] Confidence score display per transcription field

## Bug Fixes & Improvements (Round 2)
- [x] Add GOOGLE_AI_API_KEY secret and wire transcription engine to use it directly
- [x] Expand model dropdown: Gemini 3.1 Pro Preview, Gemini 2.5 Pro (stable + preview), Gemini 2.5 Flash, Gemini 2.0 Flash, Gemini 1.5 Pro/Flash, GPT-4o, GPT-4o-mini, o4-mini
- [x] Onboarding: replace JSON editor with plain text textarea (auto-convert to JSON internally)
- [x] Fix review page 404 — docId param not passed through nested wouter route (fixed with useRoute)
- [x] Fix review page empty results — transcription data loading now correctly tied to resolved docId

## Bug Fixes & Improvements (Round 3)
- [x] Fix review page: transcription metadata not loading/displaying
- [x] Fix review page: verify document list, transcription fetch, and dynamic field rendering end-to-end
- [x] Add skip-onboarding button: marks project active, navigates to Settings

## Bug Fixes & Improvements (Round 4)
- [x] Fix review page navigation — error when switching between document cards
- [x] Fix Gemini 3.1 Pro API failure — removed (model not available on OpenAI-compat endpoint); using gemini-2.5-pro-preview-05-06 as top model
- [x] Simplify model dropdown — 8 essential models with friendly labels grouped by family
- [x] Fix batch transcription to fire all API calls in parallel (Promise.all, concurrency cap 3)
- [x] Harden onboarding agent — always generate JSON schema + glossary from plain-text transcriptions
- [x] Fix onboarding validation accuracy — fuzzy character-level similarity replaces strict JSON string compare
- [x] Onboarding validation UI — human-readable side-by-side diff with per-field similarity % badges

## Bug Fixes & Improvements (Round 5)
- [x] Add Gemini 3.1 Pro to model dropdown and make it work — correct model ID is gemini-3.1-pro-preview (verified from SelimHassan settings.py); also added gemini-3-flash-preview

## Bug Fixes & Improvements (Round 6)
- [x] Fix review page routing — rewrote ProjectWorkspace to use <Router base="/projects/:id"> so all child routes are relative; fixed all absolute navigate() calls in ReviewPage and ProjectOverview to use relative paths; fixed back-to-dashboard button to use window.location.href

## Bug Fixes & Improvements (Round 7)
- [x] Fix routing 404 — root cause was wrong wildcard syntax in App.tsx: regexparam v3 requires /projects/:id/* not /projects/:id/:rest* (which never matched). Verified all 7 URL patterns now route correctly.

## Phase 2: Supabase Migration + RAG (Round 8)
- [x] Add Supabase DATABASE_URL secret (Postgres connection string)
- [x] Update drizzle.config.ts to use postgres driver
- [x] Rewrite drizzle/schema.ts from mysqlTable to pgTable with all 6 tables
- [x] Enable pgvector extension on Supabase
- [x] Add document_embeddings table (id, project_id, document_id, content, metadata, embedding vector(768))
- [x] Run Drizzle migration to Supabase Postgres (all 7 tables created)
- [x] Update server/db.ts all query helpers for Postgres (drizzle-orm/postgres-js)
- [x] Build embeddingService.ts — Google text-embedding-004 (768-dim), RETRIEVAL_DOCUMENT + RETRIEVAL_QUERY task types
- [x] Wire embedding generation into the transcription review mutation (fire-and-forget)
- [x] Build rag.search tRPC endpoint with strict projectId filter + cosine similarity via pgvector
- [x] Build rag.chat tRPC backend — top-5 retrieval, context injection, LLM answer with source citations
- [x] Build SemanticChatPage UI — chat bubbles, source citation toggle, suggested questions, typing indicator
- [x] Add Ask Archive nav item to project workspace sidebar
- [x] Update tests: 21 vitest tests passing (added 4 RAG tests)
- [x] Push to GitHub and deploy

## Bug Fixes & Features (Round 9)
- [x] Fix embedding API 404 — switch from v1beta to v1 endpoint for text-embedding-004
- [x] Add semantic search UI page in project workspace (search bar + ranked results with excerpts)
- [x] Add "Generate for me" button for output schema in project settings (based on system prompt)
- [x] Add "Generate for me" button for domain glossary in project settings (based on system prompt)
## Bug Fixes (Round 10)
- [x] Discovered text-embedding-004 is not available on this API key (404 on both v1 and v1beta)
- [x] Switched to gemini-embedding-001 (3072 dimensions, v1beta endpoint) — confirmed working
- [x] Updated drizzle/schema.ts vector column from 768 to 3072 dimensions
- [x] Ran ALTER TABLE migration on Supabase to resize the embedding column
- [x] 21 tests passing, zero TypeScript errors
- [x] Push to GitHub

## Features (Round 11)
- [x] Upgrade embedding model from gemini-embedding-001 to gemini-embedding-2-preview
- [x] Confirmed gemini-embedding-2-preview produces 3072-dim vectors (same as gemini-embedding-001)
- [x] Add getReviewedDocsWithoutEmbeddings helper to db.ts
- [x] Add projects.reindexAll tRPC mutation to backfill embeddings for all reviewed documents (batches of 5)
- [x] Add Re-index all button to Project Settings with loading state and success/info toasts
- [x] 21 tests passing, zero TypeScript errors
- [x] Push to GitHub

## Features (Round 12)
- [x] Add Retranscribe button to review page header (always visible, disabled during save/transcribe)
- [x] Add content_tsv tsvector column to document_embeddings table in Supabase
- [x] Create GIN index on content_tsv for fast FTS
- [x] Update createEmbedding in db.ts to populate content_tsv on insert
- [x] Upgrade searchEmbeddings in db.ts to Hybrid Search (pgvector + FTS + RRF fusion, k=60)
- [x] Fix semanticSearch signature to pass queryText to searchEmbeddings
- [x] Update SemanticSearchPage to show match type badge (Hybrid/Semantic/Keyword) and RRF-calibrated scores
- [x] 21 tests passing, zero TypeScript errors
- [x] Push to GitHub

## Features (Round 13) — NER + Knowledge Graph
- [x] Create entities table in Supabase (id, projectId, name, type enum, normalizedName for dedup)
- [x] Create document_entities join table (id, documentId, entityId, projectId, contextSnippet)
- [x] Update Drizzle schema with both new tables + entityTypeEnum
- [x] Build nerService.ts — NER extraction via Gemini with strict JSON schema, Arabic diacritics normalization
- [x] Wire NER extraction into saveReview mutation (fire-and-forget on reviewed docs)
- [x] Add db helpers: getEntitiesByProject, getEntitiesByDocument, getEntityStats, getGraphData
- [x] Add tRPC endpoints: entities.list, entities.byDocument, entities.stats, entities.graph, entities.reindexAll
- [x] Install react-force-graph-2d for interactive knowledge graph
- [x] Build KnowledgeGraphPage — force-directed graph, type filtering, zoom controls, detail panel with connections
- [x] Add Knowledge Graph nav item to project workspace sidebar
- [x] 21 tests passing, zero TypeScript errors
- [x] Push to GitHub

## Features (Round 14) — Entity Directory
- [x] Add entities.getDetails tRPC endpoint (entity data, document mentions with contextSnippet, co-occurring connections sorted by frequency)
- [x] Add getEntityDetails db helper with document mentions join and co-occurrence query (using inArray for co-occurrence)
- [x] Build EntityDirectoryPage.tsx with master-detail layout (left pane: search + filter + alphabetical list grouped by letter; right pane: entity profile, document mentions, clickable related entities)
- [x] Add /directory route to ProjectWorkspace Switch block
- [x] Add Entity Directory nav item (BookOpenText icon) to project workspace sidebar between Knowledge Graph and Export
- [x] 21 tests passing, zero TypeScript errors
- [ ] Push to GitHub

## Bug Fixes (Round 15)
- [x] Fix Entity Directory scroll layout — parent locked to screen height with overflow-hidden, left pane search/filters pinned with flex-1 overflow-y-auto list, right detail pane independently scrollable
- [x] Fix Entity Directory scroll (attempt 2) — main wrapper changed to overflow-hidden relative, inner absolute inset-0 overflow-auto div wraps all routes, EntityDirectoryPage uses absolute inset-0 to fill space with independent scroll panes

## Features (Round 16) — Delete Project
- [x] Existing deleteProject db helper already handles cascade via ON DELETE CASCADE
- [x] Add projects.delete tRPC mutation (protected, owner-verified)
- [x] Add Danger Zone section to ProjectSettings with AlertDialog confirmation
- [x] Redirects to /dashboard after successful deletion
- [x] 21 tests passing, zero TypeScript errors
- [ ] Push to GitHub

## Features (Round 17) — Google OAuth
- [x] Store Google OAuth Client ID and Client Secret as secrets
- [x] Build server-side Google OAuth flow (/api/auth/google + /api/auth/google/callback)
- [x] Create own JWT session tokens with jose (no Manus SDK dependency)
- [x] Update context.ts to verify sessions via our own verifySessionToken
- [x] Update user upsert to work with Google profile data (openId = google_{id})
- [x] Update frontend getLoginUrl() to point to /api/auth/google
- [x] Remove Manus SDK imports from oauth.ts and context.ts
- [x] 21 tests passing, zero TypeScript errors
- [ ] Push to GitHub

## UX Overhaul (Round 18) — Comprehensive Navigation & Workflow Improvements

### P0: Critical UX Fixes
- [x] Replace overview with "Next step" dashboard showing one dominant action based on project state
- [x] Add persistent progress checklist (Create → Upload → Configure → Process → Review → Explore)
- [x] Turn every empty state into a useful action with clear next step
- [x] Make Upload one clear operation with "Upload and transcribe" primary button
- [x] Hide advanced settings (JSON schema, system prompt, temperature, tokens, model, embeddings) behind collapsible
- [ ] Add configuration presets (Letters, Index cards, Administrative records, Registers, Custom) — deferred

### P1: Navigation & Structure
- [x] Reorganize sidebar by workflow groups (Process: Overview/Upload/Review, Explore: Search/Ask/Entities, Output: Export, Project: Settings)
- [x] Combine Knowledge Graph and Entity Directory into one "Entities" section with toggle (List view / Graph view)
- [x] Standardize names: "Ask Archive" (not Semantic Chat), "Search archive" (not Semantic Search), "Transcription method" (not Pipeline Configuration), "Fields to extract" (not Output JSON Schema)
- [x] Add breadcrumb navigation (Projects / Archive Name / Current Page)
- [x] Make project cards fully clickable with keyboard focus and accessible labels
- [x] Add recommended action to each project card (Continue setup / Review N docs / Open archive)

### P1: Review Experience
- [x] Rename review actions to plain language: "Approve", "Re-read", "Flag for later"
- [x] Add explanation of what approval enables (document appears in Search, Ask Archive, Entities, Export)
- [x] Remove technical explanations from primary screens (no hybrid search, embeddings, vector mentions)
- [x] Better empty state for review page: guide to upload if no documents exist

### P1: Search & Chat
- [x] Rename "Semantic Search" to "Search archive" with simpler empty state
- [x] Rename "Semantic Chat" to "Ask Archive" with simpler empty state
- [x] Add source citations with "Open source" action in Ask Archive responses
- [x] Remove technical jargon from search/chat descriptions

### P1: Entities
- [x] Unify entity terminology: "People", "Places", "Organizations" consistently
- [x] Give entity pages useful empty states with route to required review step

### P1: Polish & Accessibility
- [x] Strengthen visual hierarchy: one primary button per page, quieter secondary actions
- [x] Reduce dashboard statistics: prioritize actionable items over zero-value metrics
- [x] Add meaningful success feedback (first upload, first approval, archive ready to search)
- [x] Use helpful loading states explaining what AI is doing
- [x] Improve accessibility: visible keyboard focus, proper links/buttons, screen-reader labels

## Features (Round 19) — Natural Language Settings Refinement
- [x] Add AI refinement chat to Settings page (natural language → edit JSON schema, system prompt, domain glossary)
- [x] Wire to existing onboarding agent's refine logic (send feedback + current config, get updated config)
- [x] Show reasoning/explanation of what changed (via assistant message in chat)
- [ ] Add diff preview before auto-saving refined config (currently saves immediately)
- [x] Allow iterative refinement (multiple rounds of feedback)

## Bug Fixes (Round 20) — AI Refinement Quality
- [x] Fix refineConfig to use Gemini 3.1 Pro instead of default model
- [x] Rewrite refine prompt to be explicit about preserving all existing config fields while making targeted edits
- [x] Ensure refineConfig can edit JSON schema, glossary, AND system prompt (not just system prompt)
- [x] Add explicit instruction: never delete/empty existing fields unless user explicitly asks

## Features (Round 21) — Guided Tour + Demo Project
- [x] Build guided tour component (tooltip walkthrough for first-time users)
- [x] Tour covers: Welcome → Create project → Upload → Configure → Review (mentions processing) → Search → Ask Archive → Entities → Done
- [x] Tour state persisted (localStorage) so it only shows once per user
- [x] Create demo project seed endpoint that pre-loads a sample archive with real documents
- [x] Demo project includes 4 real archival document images (Al Lataif Al Musawara 1923) with completed transcriptions
- [x] Demo project shows all features working: reviewed docs, search results, entities, knowledge graph
- [x] Add "Try demo project" button on Dashboard empty state and first-time experience

## Features (Round 22) — Collaborator Invites & Shared Projects
- [x] Add project_members table (id, projectId, userId, role: owner/editor/viewer, addedAt)
- [x] Add project_invites table (id, projectId, invitedByUserId, email, role, token, status: pending/accepted/expired, createdAt, expiresAt)
- [x] Run database migration for new tables (drizzle-kit push to Supabase)
- [x] Add tRPC endpoints: members.list, members.invite, members.remove, members.updateRole, members.acceptByToken, members.cancelInvite, members.leave, members.myRole
- [x] Update project access checks: owner OR member with appropriate role can access project (getProjectById, getProjectsByUserId, getProjectRole)
- [x] Role-based permissions: owner (full control + delete + manage members), editor (upload, transcribe, review, search, ask, export), viewer (search, ask, read documents, export)
- [x] Build MembersSection in Project Settings UI (invite form with email + role picker, member list with role dropdown, remove button, pending invites with cancel)
- [x] Invite acceptance flow: user signs in with Google → if matching pending invite exists → auto-accept and grant access (wired in oauth.ts callback)
- [x] Show shared projects on Dashboard (with role badge: "Editor" / "Viewer")
- [x] Write vitest tests for invite and permission logic (13 tests passing)
- [x] Auto-accept invites for existing users (if email already in system, skip pending state)

## Bug Fixes (Round 23) — Semantic Search Broken
- [x] Fix semantic search query failure — root cause: content_tsv column stored as text type but ts_rank() requires tsvector; fixed by adding ::tsvector cast in the hybrid search SQL

## Features (Round 24) — Entity Merge Review System
- [x] Add entity_aliases table (id, entityId, alias, normalizedAlias, language, createdAt)
- [x] Add canonical_id column to entities table (self-referencing FK, nullable — points to master entity)
- [x] Add merge_suggestions table (id, projectId, status: pending/accepted/rejected/skipped, suggestedCanonical, confidence, entityIds JSON array, createdAt, reviewedAt)
- [x] Backend: fuzzy clustering algorithm (Levenshtein + phonetic + cross-script grouping)
- [x] Backend: LLM-powered merge candidate generation (batch job that proposes clusters with canonical names)
- [x] Backend: tRPC endpoints — merge.list, merge.generate, merge.accept, merge.reject, merge.skip, merge.stats
- [x] Backend: merge execution logic (reassign document_entities links, create aliases, set canonical_id)
- [x] Backend: update NER extraction to check existing canonicals + aliases + merged entities before creating new entities
- [x] Frontend: Entity Merge Review page with cluster cards showing entities, document mentions, context snippets
- [x] Frontend: merge/split/skip actions with editable canonical name
- [x] Frontend: document mentions with filename + context snippet shown in merge cards
- [x] Wire merge review page into project navigation (Merge button in Entity Directory header + /entities/merge route)

## Bug Fixes (Round 25) — Entity Merge Cleanup
- [x] Filter out merged entities (canonical_id IS NOT NULL) from entity directory list and knowledge graph

## Features (Round 26) — Document Management
- [x] Add delete document tRPC mutation (cascade delete transcriptions, embeddings, document_entities)
- [x] Add rename document tRPC mutation
- [x] Add delete/rename UI actions to document list (context menu or action buttons)

## Features (Round 27) — Pagination for 2000+ Documents
- [x] Add paginated documents.list endpoint (cursor-based, 50 per page, search by filename)
- [x] Update document sidebar with infinite scroll (load more on scroll to bottom)
- [x] Add document search/filter input in sidebar header
- [x] Batch transcribe already processes in chunks of 3 concurrently (works fine for 2000 docs)

## Features (Round 28) — Manual Entity Merge
- [x] Add manual merge UI: select two or more entities from the entity list and merge them
- [x] Add backend mutation for manual merge (reuse existing merge logic, just user-initiated)
- [x] Show merge button/action when multiple entities are selected

## Features (Round 29) — Fix Onboarding Wizard Output Separation
- [x] Fix wizard to output JSON schema, system prompt, and domain glossary as SEPARATE fields (not one megaprompt)
- [x] Ensure generated JSON schemas always include Dublin Core core fields (title, subject, description, type, source, creator, date) + transcription + user-requested fields
- [x] System prompt should only contain transcription rules/instructions (no schema, no glossary embedded)
- [x] Domain glossary should be a separate JSON object of term:definition pairs
- [x] Inject glossary into system prompt at runtime in transcription engine (buildRuntimePrompt)
- [x] Add cleanSystemPrompt post-processing to strip any embedded schema/glossary from generated prompts
- [x] Add ensureDublinCoreFields post-processing to guarantee core fields are always present

## Features (Round 30) — Entity Aliases, TEI-XML Export, Entity Sync
- [x] Show merged variant names (aliases) on entity detail panel
- [x] Search entities by alias/variant names (not just canonical name)
- [x] TEI-XML entity export (authority file with numeric IDs, canonical names, all variants, mention refs)
- [x] Sync entity name edits from transcription review back to the entity record

## Features (Round 31) — Annotated Entity Tags in Review
- [x] Show entity ID tags [#42] next to recognized entity names in the transcription review panel
- [x] Fetch document-linked entities and highlight matching text in field values
- [x] Make entity tags clickable (navigate to entity detail)

## Features (Round 32) — Entity Validation on Review
- [x] On save/approve, check if extracted entities still appear in the transcription text
- [x] If entities are stale (name not found in transcription), re-run entity extraction on the updated text
- [x] Remove stale document_entities links for entities no longer mentioned

## Features (Round 33) — Multi-Page Document Support
- [x] Add document_groups table (id, projectId, title, sharedMetadata JSON, createdAt)
- [x] Add groupId and pageNumber columns to documents table
- [x] Create migration SQL and apply
- [x] Backend: CRUD for document groups (create group, add page to group, reorder pages)
- [x] Backend: transcription with page context (pass previous pages' transcriptions to AI)
- [x] Backend: shared metadata save/load (one edit applies to all pages in group)
- [x] Frontend: upload flow supports "Upload as multi-page document" (multiple files → one group)
- [x] Frontend: review page shows shared metadata at top + per-page tab/flipper for transcription
- [ ] Frontend: "Add page to existing document" action (deferred)
- [ ] Export: multi-page documents export as single logical entry with concatenated transcription (deferred)

## Bug Fixes (Round 34) — Production DB Migration
- [x] Fix production documents disappearing — migration 0004 (document_groups + groupId/pageNumber) was never applied to the Supabase PostgreSQL database
- [x] Applied migration directly to Supabase: CREATE TABLE document_groups, ALTER TABLE documents ADD COLUMN groupId/pageNumber, FK constraints, indexes
- [x] Verified documents load correctly in review sidebar after fix

## Multi-Page Document Improvements (Round 35)

- [x] Shared metadata set once from page 1 and reused for subsequent pages (not re-generated each page)
- [x] Per-page fields (transcription, translation, persons_mentioned, keywords, legal_references, etc.) regenerated each page
- [x] Auto-transcribe all pages sequentially on multi-page upload (already coded, verified working — schema error was the blocker)
- [x] Add "Transcribe all remaining" button in ReviewPage for existing grouped documents with pending pages
- [x] Fix page 3 status stuck at 'processing' (fixed directly in DB)

## State Persistence Fix (Round 36)

- [x] Persist Search tab state (query, results) when navigating away to view a document
- [x] Persist Ask Archive tab state (conversation history, input) when navigating away to view a document
- [x] Persist Entities page state (search query, type filter) when navigating away

## Transcription Reliability (Round 37)

- [x] Add "Retry all failed/pending" button on Review page to batch-transcribe all pending/error/stuck docs
- [x] Add JSON repair logic (attempt to close truncated JSON before throwing parse error)
- [x] Auto-recover stuck 'processing' docs (>5 min) by resetting to 'pending' (built into retryAllPending)
- [ ] Add 1 automatic retry on JSON parse failure in transcription engine (deferred — JSON repair covers most cases)

## Onboarding Improvements (Round 36)
- [x] Default Arabic collections to gemini-3.1-pro-preview during onboarding (auto-detect Arabic in samples/config)

## Gamification Features (Round 38)
- [x] Database schema: review_activities table (tracks XP-earning events per user per project)
- [x] Database schema: user_stats table (total XP, level, current streak, longest streak, last active date)
- [x] Backend: XP earning logic (2 XP per line approved, 5 XP per correction, 50 XP per page completed)
- [x] Backend: Streak tracking (daily activity, resets after missed day)
- [x] Backend: Leaderboard query (per project, ranked by XP)
- [x] Frontend: New "Quick Review" tab in project workspace (completely separate from traditional Review tab)
- [x] Frontend: Line-by-line review mode (split transcription into lines, step through one at a time with image)
- [x] Frontend: XP counter + level display in Quick Review header
- [x] Frontend: Streak counter with visual indicator
- [x] Frontend: Project leaderboard component on Quick Review page

## Gamification Enhancements (Round 38b)
- [x] Add metadata verification step after all lines reviewed (yes/no per field)
- [x] Only mark document as 'reviewed' after BOTH text lines AND metadata are verified
- [x] Show metadata fields as simple yes/no questions (non-expert friendly)

## Quick Review Language Filter (Round 38c)
- [x] Add language selector dropdown to Quick Review page
- [x] Filter document queue by selected language (server-side via transcription metadata)
- [x] Backend endpoint to get distinct languages for a project

## Mobile Quick Review (Round 39)
- [x] Mobile-first responsive layout for Quick Review (stacked: image top, review bottom)
- [x] Thumb-friendly action buttons (large tap targets, bottom of screen)
- [x] Compact stats bar for mobile (XP/streak/progress in minimal space)
- [x] Swipe gestures (swipe right = approve, swipe left = skip)
- [x] Pinch-to-zoom on document image
- [x] Mobile metadata verification (card-style yes/no swipe)
- [x] Hide keyboard shortcuts hint on mobile
- [x] Touch-optimized edit mode (auto-focus, larger input)
- [x] Mobile-responsive sidebar (slide-out overlay menu replaces always-visible sidebar)
- [x] Quick Review gets full-screen treatment on mobile (minimal header, no sidebar)

## Pyramid Mode - Gamified Quick Review (Round 40)
- [x] Pyramid Mode as new mode toggle in Quick Review (classic vs pyramid)
- [x] Animated SVG pyramid that grows block by block as lines are reviewed
- [x] Desert theme background (gradient sky, sand particles)
- [x] Block placement animation on approve/correct
- [x] Golden/glowing blocks for corrections
- [x] Row completion celebration (hieroglyphic seal animation)
- [x] Pyramid progress persists across sessions (tied to XP/stats)
- [x] Mobile-first layout (pyramid top 30%, review card bottom 70%)
- [x] Mode toggle accessible from Quick Review header

## Pyramid Mode Fixes (Round 41)
- [x] Fix pyramid blocks to stack bottom-up properly (fill each row left-to-right before moving up)
- [x] Add 3D depth/texture to blocks (stone look, not flat yellow rectangles)
- [x] Add document image viewer back into Pyramid Mode
- [x] Make pyramid visually fill the available space correctly

## Pyramid Mode Redesign v2 (Round 42)
- [x] Compact elegant pyramid widget in header (not full-screen)
- [x] Side-by-side layout on desktop (image left, review right)
- [x] Mobile: collapsible image panel with tap to show/hide
- [x] Pyramid is always visible as progress indicator
- [x] Polished visual style with desert night sky, gradient stones, gold capstone

## Pyramid Mode v3 - Canvas & Quarry + Locked Deck (Round 43)
- [x] Desktop: Split screen - document image left, pyramid+review right
- [x] Desktop: Digital Ruler overlay on document image (draggable golden bar)
- [x] Desktop: Large pyramid as main focus on right panel (not tiny widget)
- [x] Desktop: Block-fly animation when approving (text transforms to stone, flies into pyramid)
- [x] Desktop: Stats bar (XP, Level, Streak, blocks verified count)
- [x] Mobile: Top 40% locked document viewer (pinch-zoom then stays)
- [x] Mobile: Bottom 60% swipe card deck with pyramid integrated
- [x] Mobile: Swipe right = verify (card to block animation), swipe left = skip
- [x] Mobile: Correct/Edit/Skip buttons at bottom
- [x] 3D isometric pyramid with warm lighting, glowing capstone, incoming block animation

## Persistent Review Session State (Round 44)
- [x] Database table for review_sessions (user, project, current doc, line index, reviewed lines JSON, mode)
- [x] tRPC endpoints: saveReviewSession, getReviewSession
- [x] Auto-save on every approve/skip/edit action (debounced 500ms)
- [x] Auto-restore on page load (both Classic and Pyramid modes)
- [x] Persist across reload, tab change, and browser close (visibilitychange + beforeunload)

## Skip Document Feature (Round 45)
- [x] Add "Skip Document" button/action to Classic mode (jumps to next doc without reviewing)
- [x] Add "Skip Document" button/action to Pyramid mode

## Sandboxed Review Portal (Round 46)

### Database & Schema
- [x] Create validation_sessions table (id, projectId, title, createdAt, status: active/closed)
- [x] Create validation_assignments table (id, sessionId, documentId, reviewerUsername, status: pending/in_progress/completed, assignedAt, completedAt)
- [x] Create validation_reviews table (id, assignmentId, sessionId, documentId, reviewerUsername, lineIndex, lineText, verdict: correct/incorrect, timestamp)
- [x] Run migration SQL

### Server (tRPC Procedures)
- [x] Public: getValidationSession (session info + assignment for username)
- [x] Public: getNextAssignment (round-robin auto-assign doc to username, max 5 unique reviewers per doc)
- [x] Public: submitLineVerdict (save correct/incorrect for a line)
- [x] Public: completeAssignment (mark doc review done by this reviewer)
- [x] Public: getReviewerProgress (stats for this reviewer in this session)
- [x] Admin: createValidationSession (select docs, generate shareable link)
- [x] Admin: getValidationStats (accuracy rates, reviewer breakdown, inter-rater agreement, error counts)
- [x] Admin: closeValidationSession

### Frontend — Sandboxed Review Portal
- [x] Route: /review/:sessionId (completely sandboxed, no sidebar, no nav)
- [x] Username gate (prompt on first visit, store in localStorage)
- [x] Fixed-position orange highlight box (viewport) with lines scrolling through it
- [x] Show ALL lines in white font, current line highlighted in orange box
- [x] Filter: only show lines containing Arabic text (skip English headings/metadata)
- [x] Only Correct / Incorrect buttons (no Edit)
- [x] Mobile-optimized layout
- [x] Progress indicator (docs completed / total assigned)
- [x] Thank-you/completion screen when all assigned docs reviewed

### Backport to Classic Quick Review
- [x] Implement fixed-position orange highlight viewport in Classic Quick Review mode
- [x] Show all following lines in white font (not just next 2 in grey)

### Admin UI
- [x] "Create Validation Session" flow in project settings (select docs, generate link)
- [x] Validation stats dashboard (accuracy per doc, per line, reviewer breakdown, inter-rater agreement)
- [x] Copy shareable link button

### Review Portal UX Enhancements (Round 47)
- [x] Dynamic Magnifying Glass (Loupe) on document image — circular magnification follows cursor/finger, enlarges localized area
- [x] "View Full Context" section below current line — show preceding/succeeding lines in white with bordered box on current, "View Full Context" expand button

### Document Status Management
- [x] Allow changing document status to any valid status (pending, processing, needs_review, reviewed, flagged, error) from the UI

- [x] Add "Skip" button to validation review portal for illegible/unclear lines — stores as its own verdict category, never returns to reviewer

## Conversational Onboarding Rebuild
- [x] Server: onboarding.chat tRPC mutation — accepts messages + image URLs, returns AI response with structured suggestions
- [x] Server: onboarding.generateConfig mutation — takes conversation history, produces final system prompt + JSON schema + domain glossary
- [x] Server: onboarding.applyConfig mutation — saves generated config to project settings (prompt, schema, glossary, pipeline type)
- [x] Frontend: ChatOnboardingPage — chat UI with message bubbles, image upload inline, AI suggestions rendered as cards
- [x] Frontend: AI suggests additional metadata fields as interactive cards (accept/reject/modify)
- [x] Frontend: "Generate Config" button appears when AI determines enough info gathered
- [x] Frontend: Config preview panel (shows generated prompt, schema, glossary before applying)
- [x] Frontend: "Apply to Project" action that saves config and redirects to upload page
- [x] Replace old onboarding wizard route with new conversational flow
- [x] Handle two-pass pipeline detection (AI suggests two-pass when appropriate)

### Fix Onboarding Config Generation Quality
- [x] Fix Pass 1 prompt generation: must produce clean line-by-line Arabic text (not JSON), preserve line breaks, handle abbreviations
- [x] Fix Pass 2 prompt generation: must reference exact schema field names, output flat JSON matching schema, no nested objects for array fields
- [x] Fix glossary generation: focus on actual abbreviations/shorthand/terms from handwriting, not concept definitions
- [x] Ensure generated prompts align with how the transcription engine actually processes them
- [x] Robust JSON parser handles malformed LLM responses (reasoning outside object, markdown fences)
- [x] Model name post-processing: Arabic handwriting always gets gemini-3.1-pro-preview

## Features (Round 48) — Research Agent ("Codex")

### Database
- [x] Create research_conversations table (id, projectId, userId, title, messages JSON, createdAt, updatedAt)

### Server — Research Agent Backend
- [x] Build researchAgent.ts — multi-step tool-use agent loop with invokeLLM
- [x] Tool: search_archive — full-text + metadata search across project documents
- [x] Tool: aggregate_data — SQL GROUP BY queries (trends over time, counts by field)
- [x] Tool: extract_entities — pull names/places/commodities from transcriptions
- [x] Tool: web_search — external research via Manus data API
- [x] Agent streaming: stream intermediate thinking steps (tool calls, results) to frontend
- [x] Final synthesis: structured report with citations (internal doc IDs + external URLs)
- [x] tRPC endpoints: research.ask (streaming), research.getConversations, research.getConversation, research.deleteConversation

### Frontend — Research Page
- [x] Build /research route within ProjectWorkspace
- [x] Chat interface with message input and conversation history
- [x] "Thinking" panel showing agent tool calls in progress (which docs queried, what sources pulled)
- [x] Visualization rendering: Recharts for time series/bar charts, react-force-graph for networks
- [x] Report output with clickable internal doc citations + external source URLs
- [x] Conversation list sidebar (past research sessions)
- [x] Add Research nav item to project workspace sidebar

## Fixes (Round 48b) — Research Agent Visualization Quality
- [x] Fix duplicate chart rendering (raw JSON in answer text + separate viz render)
- [x] Improve chart styling for dark theme (use proper colors, dark tooltip, no dashed grid)
- [x] Handle long label lists in bar charts (top-N + "others" grouping, horizontal bars)
- [x] Add system prompt instruction to NOT repeat viz JSON in final answer
- [x] Improve agent system prompt with research strategy patterns (timeline, distribution, content, network)
- [x] Add 'timeline' analysis_type to aggregate_data for date-based queries
- [x] Limit count_by_field to top 15 + "Other" bucket

## Features (Round 49) — Export All Documents (including unreviewed)
- [x] Update export endpoints (CSV, JSON, TEI-XML) to include all transcribed documents, not just reviewed
- [x] Add filter toggle in export UI: "All transcribed" vs "Reviewed only"

## Features (Round 50) — Full TEI-XML Transcription Export
- [x] Add teiXmlCorpus export endpoint that wraps each document in proper TEI structure (teiHeader + text/body)
- [x] Include inline entity markup (persName, placeName, orgName) linked to entity authority IDs
- [x] Respect includeAll toggle (reviewed only vs all transcribed)
- [x] Add TEI-XML Corpus export button to Export page alongside existing entity authority export

## Features (Round 51) — Word-Level Error Selection in Validation Tests
- [x] Update validation_responses table/schema to store word-level error data (positions + words)
- [x] Update backend validation endpoint to accept word-level error selections
- [x] Update frontend: when user clicks "Incorrect", line splits into selectable words
- [x] User can tap individual words to mark them as incorrect, then submit
- [x] Store and track word-level error data for analytics

## Features (Round 52) — Arabic-Only Filter Toggle for Validation Sessions
- [x] Add `arabicOnly` boolean field to validation_sessions table (default true for backward compat)
- [x] Add toggle in validation session creation UI
- [x] Pass the flag through to the review portal so it filters lines accordingly
