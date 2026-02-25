# Architecture Decisions (Import Phase)

## Proposed stack

- Runtime: Node.js 20+
- Language: TypeScript (strict mode) across API, UI, and shared contracts
- Frontend: React + Vite
- Backend: Fastify
- Storage: SQLite (local file in `db/`)
- Validation/contracts: Zod + shared TypeScript types
- URL checks: native `fetch` with controlled concurrency worker

## Why this stack

1. Local-first simplicity
- SQLite keeps all data on the user's machine with zero infrastructure.
- Fastify + Vite run locally with simple commands and fast startup.

2. Import-phase fit
- Fastify multipart handling supports direct Safari/Chrome HTML upload.
- Type-safe service/repository boundaries allow us to implement parsing, dedupe, and URL validation independently.

3. Forward compatibility for triage/search
- Shared contracts in `packages/shared` reduce drift between UI/API.
- The API service layout (`import`, `url-validation`, `workers`) maps directly to upcoming triage and embedding pipelines.
- SQLite can later add an embedding table or integrate with a local vector extension without replatforming.

4. Cost and operational transparency
- API layer is the right boundary for logging model calls, token usage, and cost estimates.
- Import and triage runs are modeled as first-class records (`imports` table), enabling user-visible summaries.

## Initial module boundaries

- `routes/`: transport and request/response shape
- `services/import`: HTML parsing, normalization, duplicate detection orchestration
- `services/url-validation`: reachability checks and status classification
- `repositories/`: persistence concerns only
- `workers/`: background/queued processing for URL and AI batch operations

## Planned import flow

1. Upload bookmark HTML file.
2. Parse Netscape bookmark format into normalized records (`url`, `title`, `folderPath`, `dateAdded`).
3. Upsert by canonical URL (skip duplicates).
4. Queue URL validation for new/changed records.
5. Return import summary with live/dead/redirected/duplicate counts.

## Temporary deviation

- The current scaffold uses a JSON file store (`db/store.json`) behind the repository interface for faster iteration.
- The repository contract is designed to be swapped to SQLite without changing route/service logic.
