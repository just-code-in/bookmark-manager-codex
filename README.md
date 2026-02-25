# Bookmark Manager — Codex Build

Part of the **Built Twice** series. See [PRD.md](./PRD.md) for the shared specification.

## Current status

Import phase is partially implemented:

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

## Next steps

1. Replace JSON repository backend with SQLite.
2. Add import history/list endpoints in UI.
3. Add automated tests for parser and URL status classification.
