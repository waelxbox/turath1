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
