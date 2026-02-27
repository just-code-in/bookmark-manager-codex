# Bookmark Manager — Codex Build

Part of the **Built Twice** series. See [PRD.md](./PRD.md) for the shared specification.

## Current status

Import + triage foundations are implemented:

- `apps/web`: React + Vite UI shell
- `apps/api`: Fastify API with `POST /imports` multipart upload endpoint
- `packages/shared`: shared types/contracts between UI and API
- `db/`: local data files and migrations folder
- `docs/architecture.md`: stack and architecture decisions

Implemented so far:

1. Netscape bookmark HTML parsing (`url`, `title`, `folderPath`, `dateAdded`).
2. URL-based dedupe across multiple imports using a local repository store.
3. URL health checks with `live | redirected | dead` classification.
4. Import summary response with totals and duplicate/status counts.
5. Triage batch pipeline:
   - AI-inferred category generation from collection signals
   - Per-bookmark categorization, 2-5 tags, and 1-2 sentence summaries
   - Content sourcing for live/redirected URLs and metadata fallback for dead/unsupported URLs
   - Cache-aware reruns keyed by source hash + prompt/model versions
   - Run status, progress, category counts, uncategorized reasons, and API token/cost telemetry

## Next steps

1. Add retry tooling for failed bookmark fetch/extract cases.
2. Add integration tests for triage endpoint and caching behavior.
3. Add category review/edit UX in the web app.
