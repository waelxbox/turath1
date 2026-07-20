# TURATH — تراث

**A multi-tenant platform for AI-powered archival transcription.**

TURATH lets researchers, archives, and digital librarians create their own custom AI transcription pipelines — without writing a single line of code or managing any infrastructure. Upload a handful of sample documents alongside your ideal transcriptions, and the platform's onboarding agent learns your archive's language, schema, and conventions. From that point forward, it processes your entire collection automatically.

---

## What it does

Most archival transcription tools are either too generic (they don't understand your document type) or too rigid (they require a developer to customise). TURATH sits in between: it provides a shared, production-grade transcription engine, but lets every researcher **fork their own configuration** from it by teaching the AI with 3–5 representative samples.

The platform was built from two real archival projects — the **Brovarski Index Cards Collection** and the **Selim Hassan Papers** — whose Python transcription scripts shared identical underlying logic but completely different system prompts, JSON schemas, and metadata conventions. TURATH generalises that pattern into a multi-tenant application where every project runs on the same codebase but with fully isolated configurations and data.

---

## Core features

### Multi-tenant workspace isolation
Every project lives in its own isolated workspace. All database queries are scoped by `project_id` and `user_id` — a bug in the application layer cannot leak data between projects. Projects carry their own system prompt, JSON schema, glossary, pipeline type, and model selection.

### AI onboarding wizard
The "Fork Your Own" flow guides a researcher through uploading 3–5 sample document images alongside plain-text transcriptions (no JSON required). The Meta-AI onboarding agent analyses the samples and generates:
- A tailored **system prompt** with persona, instructions, and domain context
- A **JSON schema** that matches the researcher's desired output structure
- A **domain glossary** of specialist terms, place names, and titles extracted from the samples
- **Post-processing rules** (e.g. Hijri-to-Gregorian date conversion, `[illegible]` handling)
- A **pipeline recommendation** (single-pass or two-pass)

### Validation before deployment
Before a project goes live, the generated configuration is tested against a held-out sample. The UI shows a field-by-field diff between the AI's output and the researcher's manual transcription. If fields are missing or hallucinated, the researcher can provide natural-language feedback and trigger a refinement loop — up to three rounds — before activating the project.

### Universal transcription engine
A single parameterised engine handles all projects. It supports two pipeline modes:

| Mode | Flow | Best for |
|---|---|---|
| **Single-pass** | Image → JSON | Documents in a single language with structured metadata |
| **Two-pass** | Image → verbatim text → translation + JSON | Documents requiring translation (e.g. Arabic/French → English) |

The engine calls the Google AI API directly when a Gemini model is selected, giving full access to any model including `gemini-2.5-pro`, `gemini-2.5-pro-preview-03-25`, and `gemini-3.1-pro-preview`.

### Dynamic schema-driven review UI
The review interface renders form fields dynamically from each project's JSON schema stored in the database. A project with a `hieroglyphs_present` field gets a toggle. A project with an `english_translation` field gets a full textarea. No code changes are needed when a schema changes.

### Document status workflow
Documents move through a defined lifecycle: `pending → processing → needs_review → reviewed / flagged / error`. The review page shows all documents with filtering by status, and each document can be approved, flagged for follow-up, or re-transcribed.

### Bulk upload and batch transcription
The upload page accepts multiple images in a single drop. A background job queue processes documents with configurable concurrency. Individual documents can also be transcribed on demand from the review page.

### Multi-format export
Reviewed transcriptions can be exported as:
- **CSV** — dynamic columns matching the project's schema, one row per document
- **JSON ZIP** — one JSON file per document, preserving the full structured output

TEI-XML export is planned for a future release.

### Skip onboarding — manual configuration
Experienced users can bypass the wizard entirely. Clicking "Skip — configure manually" on the first step of the wizard marks the project as active and navigates directly to the Settings page, where the system prompt, JSON schema, glossary, pipeline type, and model can be edited by hand.

---

## Tech stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19, Tailwind CSS 4, shadcn/ui, Wouter |
| **Backend** | Express 4, tRPC 11, Drizzle ORM |
| **Database** | MySQL / TiDB (via `DATABASE_URL`) |
| **AI** | Google Gemini API (direct), Manus Forge proxy (fallback) |
| **File storage** | S3-compatible object storage via `storagePut` / `storageGet` |
| **Auth** | Manus OAuth (session cookie, JWT-signed) |
| **Testing** | Vitest — 17 tests, 0 TypeScript errors |

---

## Project structure

```
turath/
├── client/
│   └── src/
│       ├── pages/
│       │   ├── Home.tsx              # Landing page
│       │   ├── Dashboard.tsx         # Project list
│       │   ├── Onboarding.tsx        # Fork-Your-Own wizard
│       │   ├── ProjectWorkspace.tsx  # Workspace shell + nested routing
│       │   └── project/
│       │       ├── ProjectOverview.tsx   # Stats + recent activity
│       │       ├── UploadPage.tsx        # Bulk document upload
│       │       ├── ReviewPage.tsx        # Schema-driven review UI
│       │       ├── ExportPage.tsx        # CSV / JSON export
│       │       └── ProjectSettings.tsx   # Prompt, schema, model config
│       └── index.css                 # Design tokens (dark scholarly theme)
├── server/
│   ├── routers.ts                    # All tRPC procedures
│   ├── db.ts                         # Drizzle query helpers
│   ├── transcriptionEngine.ts        # Universal single/two-pass engine
│   ├── onboardingAgent.ts            # Meta-AI config generation
│   ├── geminiClient.ts               # Direct Google AI API client
│   ├── storage.ts                    # S3 helpers
│   └── turath.test.ts                # Vitest test suite
├── drizzle/
│   └── schema.ts                     # Database schema (6 tables)
└── todo.md                           # Feature and bug tracking
```

---

## Database schema

```
users              — Auth identities (Manus OAuth)
projects           — Tenant workspaces with AI configuration
onboarding_samples — Sample document/transcription pairs used for training
documents          — Uploaded archival documents per project
transcriptions     — AI-generated outputs with raw + reviewed JSON
jobs               — Background batch transcription job queue
```

All tables are scoped by `project_id`. The `projects` table stores the full AI configuration as JSON columns: `systemPrompt`, `jsonSchema`, `glossary`, `postProcessingRules`, `pipelineType`, and `modelName`.

---

## Environment variables

The following environment variables are required. In the Manus hosting environment, system variables are injected automatically. For self-hosting, create a `.env` file at the project root.

| Variable | Description |
|---|---|
| `DATABASE_URL` | MySQL connection string |
| `JWT_SECRET` | Session cookie signing secret |
| `GOOGLE_AI_API_KEY` | Google AI API key for direct Gemini model access |
| `VITE_APP_ID` | Manus OAuth application ID |
| `OAUTH_SERVER_URL` | Manus OAuth backend base URL |
| `VITE_OAUTH_PORTAL_URL` | Manus login portal URL (frontend) |
| `BUILT_IN_FORGE_API_KEY` | Manus built-in LLM API key (server-side fallback) |
| `BUILT_IN_FORGE_API_URL` | Manus built-in LLM API base URL |
| `VITE_FRONTEND_FORGE_API_KEY` | Manus built-in LLM API key (frontend) |
| `VITE_FRONTEND_FORGE_API_URL` | Manus built-in LLM API URL (frontend) |

---

## Getting started (local development)

```bash
# 1. Clone the repository
git clone https://github.com/waelxbox/turath.git
cd turath

# 2. Install dependencies
pnpm install

# 3. Set up environment variables
cp .env.example .env
# Edit .env with your DATABASE_URL, GOOGLE_AI_API_KEY, etc.

# 4. Run database migrations
pnpm drizzle-kit generate
pnpm drizzle-kit migrate

# 5. Start the development server
pnpm dev
```

The app runs on `http://localhost:3000`.

---

## Running tests

```bash
pnpm test
```

17 tests across 2 test files. Zero TypeScript errors (`pnpm check`).

---

## Supported AI models

The model dropdown in Project Settings includes:

**Google Gemini**
- `gemini-3.1-pro-preview` ✦ Recommended
- `gemini-2.5-pro-preview-03-25`
- `gemini-2.5-pro`
- `gemini-2.5-flash-preview-04-17`
- `gemini-2.5-flash`
- `gemini-2.0-flash`
- `gemini-2.0-flash-lite`
- `gemini-1.5-pro`
- `gemini-1.5-flash`

**OpenAI**
- `gpt-4o`
- `gpt-4o-mini`
- `o4-mini`

Gemini models call the Google AI API directly using `GOOGLE_AI_API_KEY`. OpenAI models route through the Manus Forge proxy.

---

## Roadmap

- [ ] Real-time batch transcription progress bar (polling on the jobs table)
- [ ] PDF upload support with server-side page extraction
- [ ] TEI-XML export for academic publishing workflows
- [ ] Invite collaborators to a project workspace
- [ ] Per-document confidence scoring and auto-flagging
- [ ] Webhook notifications on batch completion

---

## Background

TURATH was designed around two real archival transcription projects:

**Brovarski Index Cards Collection** — a set of Egyptological index cards requiring structured metadata extraction (site, object type, dynasty, hieroglyphic presence) in a single-pass pipeline.

**Selim Hassan Papers** — administrative correspondence from the Egyptian Antiquities Service in French and Arabic, requiring a two-pass pipeline: first extracting verbatim text, then producing an English translation alongside structured metadata.

Both projects used nearly identical Python scripts (`transcribe.py` and `transcribe_selim.py`) that differed only in their hardcoded `SYSTEM_PROMPT`, `json_schema`, and pipeline type. TURATH replaces those hardcoded strings with dynamic database lookups, allowing any number of archival projects to run on the same engine.

---

## License

MIT
