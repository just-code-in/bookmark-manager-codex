# Bookmark Manager — Product Requirements Document

*Version 1.0 — 19 February 2026*
*This document is the shared specification for two parallel builds: one using Claude Code, one using Codex. It is identical in both repositories.*

---

## 1. Overview

### Problem

Over time, most people accumulate browser bookmarks with some loose sense of organisation but little rigour. The result is a large collection of links — many dead, many forgotten, some genuinely useful — with no practical way to find anything or assess what's worth keeping. Standard browser bookmark tools (folders, basic keyword search) don't scale beyond a few dozen bookmarks.

### Solution

A localhost web application that imports bookmarks from Safari and Chrome, uses AI to automatically categorise and summarise each one, and provides intelligent natural-language search across the entire collection.

### One-paragraph description

*A local app that imports your browser bookmarks, uses AI to categorise and summarise them, and lets you search them in plain English — so instead of scrolling through folders, you can ask "that article about productivity systems I saved last year" and find it.*

---

## 2. Principles

1. **AI-forward.** The AI features are the point, not an add-on. Every core interaction (categorisation, summarisation, search) is powered by AI.
2. **Local-first.** All data stays on the user's machine. No deployment, no cloud hosting, no accounts. The app runs on localhost and opens in the user's browser.
3. **Free to follow.** All dependencies must be free or open-source. The only cost is the AI API key, and usage should be minimised through batching, caching, and model selection.
4. **Tool-agnostic.** This spec describes *what* the app does, not *how* it's built. The implementing tool (Claude Code or Codex) chooses its own tech stack, frameworks, and libraries.
5. **Honest about costs.** API call counts and approximate costs should be logged and reportable, so the user (and the reader of the content series) can see what this actually costs to run.

---

## 3. Users

**Primary user:** A non-technical professional with hundreds or thousands of browser bookmarks accumulated over years, who wants to make sense of what they have and find things more easily.

**Technical context:** The user is comfortable running a command in a terminal (e.g., `npm start`) but is not a developer. Setup instructions should assume no prior development experience beyond installing Node.js or Python and obtaining an API key.

---

## 4. Features

### 4.1 Import

**Purpose:** Get the user's existing bookmarks into the app from their browser.

**Requirements:**

- Accept bookmark export files from **Safari** (HTML format) and **Chrome** (HTML format). Both browsers export in the Netscape Bookmark File Format.
- Parse each bookmark into a standard internal record containing at minimum: URL, title (as saved by the user), folder path (if any), and date added (if available).
- **Validate URLs** — attempt to reach each bookmark and classify as "live", "redirected", or "dead". Store the status.
- **Handle dead links gracefully.** Dead bookmarks are not errors — they're part of the collection. Retain the URL, original title, and any folder context. Mark as dead but do not discard.
- Support **multiple imports** without creating duplicates (match on URL).
- Display a summary after import: total bookmarks imported, live/dead/redirected counts, any duplicates skipped.

**Out of scope:** Real-time browser integration, browser extensions, automatic bookmark syncing.

### 4.2 Triage (AI Categorisation & Summarisation)

**Purpose:** Use AI to make sense of the bookmark collection — categorise, tag, and summarise each bookmark so the user doesn't have to.

**Requirements:**

- For each bookmark, the AI should generate:
  - **Category** — a high-level grouping (e.g., "Software Development", "Cooking", "Finance"). Categories are AI-generated from the collection itself, not from a predefined list. The AI should infer a sensible taxonomy based on what it finds.
  - **Tags** — 2–5 descriptive tags per bookmark (e.g., "python", "tutorial", "machine-learning").
  - **Summary** — a 1–2 sentence description of what the page is about.
- For **live bookmarks**, the AI should fetch and analyse the page content (or a meaningful excerpt) to inform its categorisation and summary.
- For **dead bookmarks**, the AI should work from the URL, original title, and folder path. The summary should note that the page is no longer available.
- For **redirected bookmarks**, follow the redirect and analyse the destination page.
- The triage process should run as a **batch operation** with progress indication (e.g., "Processing bookmark 47 of 312...").
- **Minimise API costs:** Batch API calls where possible. Cache results so re-running triage doesn't reprocess already-categorised bookmarks. Consider using a smaller/cheaper model for initial categorisation and a more capable one for summaries if the cost difference is meaningful.
- After triage, display a summary: categories created, bookmarks per category, any bookmarks that couldn't be categorised (with reasons).

**Out of scope:** User-defined category templates, integration with external knowledge bases.

### 4.3 Organisation

**Purpose:** Let the user browse, review, and manage their bookmarks now that they've been categorised.

**Requirements:**

- **Browse by category.** Display bookmarks grouped by their AI-assigned category. Each bookmark shows: title, URL, summary, tags, and status (live/dead/redirected).
- **Manual overrides.** The user can:
  - Move a bookmark to a different category
  - Rename, merge, or delete categories
  - Edit tags on any bookmark
  - Edit the AI-generated summary
- **Triage actions.** For each bookmark, the user can mark it as:
  - **Keep** — confirmed useful, stays in the active collection
  - **Archive** — not actively needed but worth retaining
  - **Delete** — remove from the collection entirely
- **Bulk actions.** Select multiple bookmarks and apply the same action (keep/archive/delete, move to category, add tag).
- **Filter and sort.** Filter by category, tag, status (live/dead), or triage action (keep/archive/delete/unreviewed). Sort by date added, title, or category.
- **Statistics.** Display overall collection stats: total bookmarks, by category, by status, by triage action, percentage reviewed.

**Out of scope:** Sharing, exporting to other formats, folder hierarchy (categories are flat, not nested).

### 4.4 Search

**Purpose:** Let the user find bookmarks using natural language instead of keyword matching.

**Requirements:**

- **Natural language search.** The user types a query in plain English (e.g., "that article about using AI for beekeeping" or "recipes I saved from YouTube") and the app returns the most relevant bookmarks.
- **Semantic matching.** Search should match on meaning, not just keywords. This requires vector embeddings of bookmark summaries, tags, and titles, stored in a local vector store.
- **Results display.** Show results ranked by relevance, with the summary and relevance indicator visible. The user should understand *why* a result matched.
- **Scope filtering.** Allow the user to constrain search to a specific category, tag, or status if desired.
- **Performance.** Search should return results within 2 seconds for collections of up to 2,000 bookmarks.
- **Embedding generation.** Embeddings should be generated during the triage phase (or immediately after) and stored locally. New or re-categorised bookmarks should have their embeddings updated.

**Nice-to-have (not required for v1):**

- **Contextual suggestions.** The app proactively surfaces bookmarks related to recent searches or browsing patterns.
- **Similar bookmarks.** "You might also be interested in..." based on vector similarity.

**Out of scope:** Full-text search of the original web pages (only summaries/tags/titles are searchable).

---

## 5. Technical Constraints

- **Localhost only.** The app runs locally — no server deployment, no cloud hosting.
- **Free dependencies.** All libraries, frameworks, and tools must be free or open-source.
- **AI API key required.** The user must supply their own API key for AI features (categorisation, summarisation, embeddings). The app should support at least one major provider (e.g., OpenAI, Anthropic). Supporting multiple providers is a bonus.
- **Cost transparency.** The app should track and display approximate API costs incurred during triage and search.
- **No prescribed stack.** The implementing tool chooses its own tech stack. This spec does not mandate any particular language, framework, database, or vector store.
- **Setup simplicity.** A non-developer should be able to get the app running by following a README with no more than 5 steps (install prerequisites, clone repo, install dependencies, add API key, start app).

---

## 6. Acceptance Criteria

The app is considered complete when:

1. A user can export bookmarks from Safari or Chrome and import them into the app.
2. The app correctly identifies live, dead, and redirected bookmarks.
3. AI categorisation assigns every importable bookmark to a category with tags and a summary.
4. The user can browse bookmarks by category, search in natural language, and get relevant results.
5. The user can keep, archive, or delete bookmarks individually or in bulk.
6. The app runs entirely on localhost with no external hosting.
7. Setup takes fewer than 10 minutes for a non-developer following the README.
8. API costs for processing 500 bookmarks are documented and reasonable (target: under $5).

---

## 7. What This Spec Does Not Cover

- Visual design or UI polish (functional is fine for v1)
- Browser extension or real-time sync
- Multi-user or sharing features
- Export to other bookmark formats
- Mobile support
- Automated testing requirements (though tests are welcome)

---

## 8. Notes for the Builder

This spec will be given to two AI coding tools (Claude Code and Codex) independently. Each tool should:

1. Read this spec and propose a tech stack before writing code.
2. Explain its architectural choices (why this framework, why this vector store, etc.).
3. Build incrementally — import first, then triage, then organisation, then search.
4. Document any deviations from the spec and the reasoning behind them.

The builds will be compared publicly. Differences in approach, quality, and trade-offs are expected and welcome.

---

*End of specification.*
