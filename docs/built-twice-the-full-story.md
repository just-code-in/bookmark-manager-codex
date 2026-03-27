# Built Twice: The Full Story

*One spec. Two AI coding tools. A bookmark manager you probably need too.*

*This is the complete, long-form account of the Built Twice experiment: every phase, every decision, every surprise. The LinkedIn posts give you the highlights; this document gives you everything.*

> [!TIP]
> **Want to try the app?** The Claude Code build works end-to-end and is public on GitHub: [bookmark-manager-claude](https://github.com/just-code-in/bookmark-manager-claude). The Codex build is preserved as a comparison artifact but does not run reliably.

---

## The Problem

Export your browser bookmarks and count them. Go on, I'll wait.

Mine came to 1,129. I recognised perhaps forty of them. The rest were a digital archaeological dig: articles I'd saved in 2019, tools I'd trialled and forgotten, and a surprising number of links to pages that no longer exist. Seventeen percent of my bookmarks were dead. Gone. The internet had moved on without telling me.

If your collection looks anything like mine, you already know the frustration: years of "I'll read this later" with no practical way to find anything or work out what's worth keeping. Standard browser bookmark systems don't scale. Folders help for a while, then the folders themselves become unmanageable, and eventually you stop trying.

I wanted something better. Not a web app that requires an account and sends my data to someone else's server. Not a browser extension that might disappear when the developer loses interest. A proper, local application that imports my bookmarks, checks every link, uses AI to categorise and summarise what's there, and then lets me search the whole collection in plain English.

So I wrote a spec for one. And then, because I was curious about something else entirely, I gave that spec to two AI coding tools and told them to build it independently.

---

## The Experiment

### Why build it twice?

You've probably heard of vibe coding by now: building software by describing what you want in plain English and letting AI write the code. The pitch is appealing: anyone can build software, no technical background required. The reality is more nuanced, and I wanted to understand exactly how nuanced.

Rather than reviewing tools in the abstract, I decided to give two leading AI coding tools the same brief and see what happened. Same requirements, same starting document, same constraints. Each tool builds the app independently, making its own choices about architecture, technology, and approach. Then I write about what I observe, honestly, including the failures.

The two tools:

- **Claude Code** (Anthropic's coding tool, used via the Cursor IDE)
- **Codex** (OpenAI's coding tool, used via the standalone Codex app)

### The brief

The spec (a Product Requirements Document, or PRD) describes four features:

1. **Import:** Parse bookmark exports from Safari and Chrome. Handle dead links gracefully.
2. **Triage:** AI scans each bookmark, generates a category, tags, and a short summary. Categories are AI-generated from the collection itself, not a predefined list.
3. **Organisation:** Browse by category. Manually adjust, merge, or rename. Mark bookmarks as keep, archive, or delete.
4. **Search:** Natural language search across summaries, tags, and categories using embeddings.

The spec deliberately doesn't prescribe a technology stack. Each tool chooses its own. No social features, no browser extension, no deployment to the cloud, no user accounts. Everything runs locally. All dependencies must be free or open-source. The only cost is the AI API key, and those costs should be tracked and reported honestly.

The identical PRD was placed in two public GitHub repositories: `bookmark-manager-claude` and `bookmark-manager-codex`. The repos start identically and then diverge as each tool makes different choices. Those differences are the content.

### The ground rules

- **Tool-agnostic spec.** The PRD describes *what*, never *how*. Each tool recommends its own approach.
- **Plan before building.** Both tools were asked to propose their approach before writing code. This captures the planning differences as content.
- **Real data from the start.** My actual Safari export (1,129 bookmarks) and Chrome export (29 bookmarks), not synthetic test data.
- **Honest reporting.** Wins, failures, costs, miscategorisations. All of it.

---

## Phase 1: Import (The Graveyard of Dead Links)

### Day 1: First impressions

Both tools received identical opening prompts: *Read the PRD. Propose your tech stack. Explain your architectural choices. Then scaffold the project.*

The personality difference was visible within minutes.

**Claude Code** spent considerable time researching options and checking latest versions before responding. When it did, the proposal read like a technical design document: data flow diagrams, database schema, verification steps, implementation order. It chose Next.js 15 as a single-process monolith: one command to start, one process to run. SQLite from the start. A component library. Server-sent events for streaming progress to the browser.

**Codex** decided in about thirty seconds. It chose a monorepo with separate frontend and backend applications (React with Vite for the UI, Fastify for the API, shared type contracts between them). Clean separation of concerns, conventional architecture. It started with a JSON file for storage instead of a database, behind an abstraction layer, and flagged the deviation itself.

Two prompts each. Claude Code delivered a working application; you could drag and drop a bookmark file and see results in a browser. Codex delivered a solid backend pipeline but no working frontend, no database, and dependencies that weren't installed yet.

If you've ever hired two consultants to solve the same problem, you'll recognise the dynamic. One delivers a meticulous proposal and a polished first draft. The other arrives with a rough sketch and says "let me show you something."

### Day 2: Real data

This is where things get interesting. Synthetic test data is forgiving. Real data (my actual 1,129 Safari bookmarks accumulated over years) is not.

**Claude Code found a critical bug in its own parser.** The Safari export format has no outer wrapping element for its sections; Favourites, Reading List, and custom folders are siblings at the document root. Claude Code's parser had been reading only the first section and silently dropping roughly 85% of the bookmarks. It identified the problem, explained it, proposed a fix, and implemented it, all without being asked. One file changed, about 35 lines. Everything else from Day 1 worked correctly with real data.

**Codex's parser handled Safari correctly from the start.** Its line-by-line approach happened to work with the sibling structure. But Codex had a different task for Day 2: closing all the gaps from Day 1. The JSON storage was replaced with SQLite. The frontend was made functional. Dependencies were installed. Four bugs were found and fixed during real-data testing (database path resolution, foreign key constraints, TypeScript parsing errors, and a sandbox permission issue). All normal for a first encounter with real data.

By the end of Day 2, both tools had working import pipelines tested against the same real bookmark files.

The numbers told their own story:

<details>
<summary><strong>Import phase results</strong></summary>

| Metric | Claude Code | Codex |
|--------|-------------|-------|
| Safari bookmarks parsed | 1,129 | 1,138 |
| Live links | 517 (51%) | 477 (45%) |
| Redirected | 328 (32%) | 288 (27%) |
| Dead | 170 (17%) | 287 (27%) |
| Validation time | ~62 seconds | ~143 seconds |

The 9-bookmark difference? Claude Code filters out `feed://` URLs (legacy RSS subscriptions that aren't web bookmarks) and one `about:blank`. Codex includes the feeds but misses one multiline HTML anchor tag. Both capture all 1,129 actual web URLs correctly. A design decision, not a bug.

</details>

### Day 3: Polish and close-out

Both tools added dead link visibility to the UI (status badges, filters, summary panels). But the *how* diverged again.

Claude Code extracted a reusable `BookmarkTable` component. More architectural overhead, but it meant the same table could be extended with category columns during Triage without rebuilding anything.

Codex bolted the features directly onto the existing UI. Faster to implement, less abstraction. It also proactively added a pre-commit hook to scan for accidentally committed API keys, a nice defensive touch that Claude Code didn't do.

A small moment worth noting: GitHub's secret scanner flagged a Google API key in Claude Code's repository. It turned out to be Stanford's Firebase key embedded inside a bookmark URL in the real Safari export. Not a project credential, but a reminder that real bookmark exports can carry other people's API keys in OAuth callback URLs.

**Import phase: complete.** Both tools had fully functional import pipelines, tested against real data, with status visibility, filtering, and summary panels. Ready for Triage.

---

## Phase 2: Triage (Teaching AI to Read My Mind)

### The setup

Both tools were given identical prompts: implement AI categorisation and summarisation. For each bookmark, generate a category (inferred from the collection, not a predefined list), descriptive tags, and a short summary. Source content from live pages where possible; for dead links, work from whatever metadata exists. Log API costs.

Both were asked to propose their approach before building. This was deliberate; the planning differences are themselves content.

### The plans

**Codex responded within minutes** with a concise plan. Two-pass approach: discover categories first, then assign bookmarks to them. OpenAI's gpt-4.1-nano for categorisation, gpt-4.1-mini for summaries. Budget vs quality mode offered. Caching strategy included.

**Claude Code delivered a thesis.** Same fundamental approach (two-pass category generation) but the plan was dramatically more detailed. Eight new files. An SSE streaming pipeline for real-time progress. An error handling framework. A verification checklist. It explicitly planned to reuse the `BookmarkTable` component, the concurrency pool, and the SSE pattern from the Import phase.

The provider convergence was striking: both tools independently chose OpenAI. Neither was prompted to. Both independently designed a two-pass taxonomy system. Same conclusion, different paths to it.

### The builds

Codex delivered end-to-end in a single pass. Six files changed. Schema updates, a repository layer, background batch processing, API routes, and UI updates. All in one go. Working code, ready to test.

Claude Code delivered twelve new files and four modifications. A deeply modular pipeline: separate files for types, prompts, the OpenAI client, content fetching, taxonomy generation, and bookmark triaging. Each component isolated, each testable independently. The architectural investment from Import was paying off; the same patterns were being extended, not rebuilt.

### Testing: where it fell apart (for one of them)

**Claude Code's first Triage run worked.** 1,034 bookmarks categorised out of 1,129. Twenty-three categories generated. Total API cost: $0.18. Zero failures. GPT-4o-mini handled everything, including dead links, without a single error.

The taxonomy was impressive in its specificity. The AI didn't just create generic buckets; it found categories that were specific to my collection: Beekeeping (12 bookmarks), Genealogy (20), Drones (2), Microbusiness Support (14). No "Technology" mega-bucket; it split sensibly into AI & Machine Learning (318), Cybersecurity (8), Python Programming (13), Financial Technology (26). "Microbusiness Support" was an interesting inference: the AI spotted a pattern across bookmarks that I hadn't consciously grouped myself.

The main quality question: "Other" at 217 bookmarks (21%). And a second catch-all, "Miscellaneous" (7), sitting alongside it. Some tail categories ("Technology and Innovation" at 3, "Education and Online Learning" at 2, "Business and Entrepreneurship" at 1) should probably have been absorbed into larger parent categories. Room for improvement, but broadly useful from the first run.

**Codex's first run did not work.**

> [!CAUTION]
> Four bugs needed fixing before Codex could complete a single Triage run:
>
> 1. `dotenv` wasn't wired up. The app couldn't read the `.env` file at all; no API key, no AI calls.
> 2. Silent error swallowing. All categorisation batches failed, but the run reported as "completed" with zero bookmarks categorised. No error messages surfaced.
> 3. JSON parsing failure. The AI model (gpt-4.1-nano) returned valid JSON, but not in the shape the parser expected.
> 4. Model quality. gpt-4.1-nano proved too unreliable for structured output and produced a generic, unhelpful taxonomy. Upgraded to gpt-4.1-mini.

After all four fixes, plus additional hardening (reduced batch sizes, retry logic, a second-pass resolver for uncategorised items, deterministic pre-rules for dead links and known domains), the Codex build completed a full Triage run.

<details>
<summary><strong>Triage phase results</strong></summary>

| Metric | Claude Code | Codex |
|--------|-------------|-------|
| Bookmarks categorised | 1,034 (92%) | 736 (70%) |
| Categories generated | 23 | 12 |
| Uncategorised | 95 (8%) | 316 (30%) |
| API cost | $0.18 | $0.43 |
| API calls | n/a | 205 |
| Duration | n/a | ~32 minutes |
| Bugs before successful run | 0 | 4 |
| Model | GPT-4o-mini | gpt-4.1-mini |

Claude Code: 92% coverage, 23 categories, $0.18, worked first time.
Codex: 70% coverage, 12 categories, $0.43 (2.4x more expensive), needed four bug fixes across multiple iterations.

Claude Code's taxonomy was more granular; niche categories emerged naturally. Codex's was more opinionated but lost specificity, with broader buckets and no niche categories at all.

</details>

### What this revealed about model selection

Both tools chose OpenAI independently. But their model choices diverged, and that divergence mattered.

Claude Code picked GPT-4o-mini: reliable structured output, handled dead links, produced a specific taxonomy.

Codex initially picked gpt-4.1-nano (cheaper, faster, and unable to reliably produce structured JSON or meaningful categories). After upgrading to gpt-4.1-mini, results improved but still fell short: 17 missing-output retries were needed during the run, and the taxonomy was less granular.

Model selection is itself a design decision with real consequences. The "cheapest model that works" isn't always the one the tool reaches for first.

---

## Phase 3: Organisation (Where the Irony Lives)

### The delivery gap widens

Codex shipped Organisation and Search in a single pass, both phases at once. Thirteen files changed, nearly 1,800 lines added. Category browsing, manual overrides (rename, merge, delete categories), keep/archive/delete actions, bulk actions, filtering and sorting, plus the complete search feature. Everything in `App.tsx`.

Claude Code was still presenting its implementation blueprint. Nineteen new files planned, seven modifications. A three-panel Organisation UI: stats dashboard, category sidebar, bookmark list. Sixteen dedicated components. The plan was detailed, thorough, and delivered hours after Codex had already shipped.

This was the most dramatic demonstration of the personality difference. Codex had finished both phases while Claude Code was asking permission to start.

### But then the builds complete

When Claude Code finally built, it delivered twenty-three files with zero bugs. Every feature worked on the first test:

- Stats panel showing totals, live/dead/redirected counts, triage progress, and review completion
- Category sidebar with click-to-filter, inline rename, merge dialog, and category removal
- Filter and sort bar for URL status, triage action, text search, and multiple sort options
- Bookmark cards with title links, summaries, tags, status badges, inline editing for summaries and tags, and category reassignment
- Bulk actions for keep/archive/delete, move to category, and select-all
- All mutations optimistic (the UI updates immediately, before the server confirms)

Codex's build worked, but needed four fixes during QA:

1. **Re-triage bug:** scoped re-triage ran but categorised zero bookmarks (a hard stop prevented dead/unsupported bookmarks from being recategorised, and organisation sync didn't force-upsert)
2. **No category browse panel:** the dashboard listed categories with counts, but they weren't clickable
3. **No embedding sync button:** embeddings couldn't be regenerated after changes
4. **Search noise:** matching on stop words ("and", "the") and returning duplicate results

All four were fixed and verified. But the pattern was now confirmed across three phases: Claude Code's planning overhead produces clean first builds; Codex's speed produces working builds that need iteration.

### The irony of the uncategorised bookmarks

> [!NOTE]
> Here's the twist that makes this story more interesting than a simple scorecard.

Codex's Triage weakness (316 uncategorised bookmarks, nearly a third of the collection) forced it to build a better Organisation feature. The uncategorised items are surfaced prominently, there's a "Focus uncategorised" filter, and a re-triage flow lets you select specific bookmarks for another attempt. The weakness drove a useful capability.

Claude Code didn't have this problem; only 95 uncategorised items from Triage, and so it didn't build specific uncategorised handling at all. It didn't need to.

The tool that struggled more built a better feature because of it. That's not something you predict from reading a feature comparison.

### Architectural divergence at its peak

The frontend architecture tells the story visually:

**Codex:** Everything in `App.tsx`. Organisation, Search, all UI logic in a single file (roughly 1,765 lines after this phase). Monolithic, fast to build, increasingly difficult to maintain.

**Claude Code:** Sixteen separate components. A stats dashboard component, a category sidebar, bookmark cards, a bulk actions bar, search results, each in its own file, each testable independently.

Same functionality. Same embedding model (both independently chose `text-embedding-3-small`). Same search approach (in-memory cosine similarity, no external vector database). Convergence on the backend decisions, radical divergence on code structure.

---

## Phase 4: Search (The Magic Moment)

### What "semantic search" means in practice

Both apps now have search that understands meaning, not just keywords. Ask for "articles about investing" and it finds bookmarks about financial planning, stock market analysis, and retirement accounts, even if those exact words don't appear in the titles.

The quality chain is: good summaries → good embeddings → good search. Claude Code's Triage produced more detailed summaries from more bookmarks, so its search has richer material to work with. Codex's search works well within its 70% coverage, but the 316 uncategorised bookmarks are effectively invisible to semantic search.

Both tools embed bookmarks using OpenAI's `text-embedding-3-small` model, store the vectors in memory (at 1,129 bookmarks, the computation is under 50 milliseconds; no external vector database needed), and rank results by cosine similarity.

### QA results

**Claude Code:** 21 out of 21 test cases passed. Embedding generation streamed progress via SSE. "Articles about investing" returned finance results. "Python programming tutorials" returned Python results with 66% confidence on the top hit. Category scope filtering worked. Relevance scores visible and correctly ranked.

**Codex:** 11 out of 15 passed initially. The four failures were the bugs described above (re-triage, category browse, embedding sync, search noise). After fixes: 15/15 pass.

<details>
<summary><strong>Full QA scorecard (all four phases)</strong></summary>

| Phase | Claude Code | Codex |
|-------|-------------|-------|
| Import | First run ✓ | After Day 1 gaps closed ✓ |
| Triage | First run ✓ | After 4 bug fixes ✓ |
| Organisation | 21/21 ✓ | After 4 bug fixes ✓ |
| Search | 21/21 ✓ | After stop-word + dedupe fixes ✓ |
| Debugging session | Not needed | Broke upload, exposed missing UI |
| **Total fixes needed** | **~1** (env config) | **~8+ (app still non-functional)** |

Claude Code has never needed a post-build bug fix across any phase. The one fix was a `.env.local` configuration file that needed to be in a specific directory, a setup issue, not a code bug.

</details>

---

## Epilogue: One Last Chance

After the four phases were complete and the comparison was locked, I made a decision that went against my own editorial plan.

The original intent was to keep the experiment clean: report what each tool produced independently, without coaching or second chances. But Codex's search gap nagged at me. It had built a search feature, but without embeddings it was essentially keyword matching. It missed roughly 30% of the collection and couldn't find bookmarks by meaning. That's a significant failure in an app whose entire purpose is finding things you've forgotten about.

So I gave Codex a debugging session. Not a new feature request; just: here's the problem, fix it.

### What happened

Codex added semantic search. Embeddings, cosine similarity, the full approach. It worked, briefly. But in the process, the bookmark file upload broke. The import flow that had functioned since Phase 1 was no longer operational.

When I flagged the broken upload and asked Codex to restore it, the response was revealing. After inspecting its own code, Codex reported:

> *"I checked the code, and the current frontend simply does not render any import form at all, even though the API supports file upload at POST /imports. The UI is incomplete."*

The backend route existed. No file picker, no upload button; the frontend had never rendered one. This wasn't a regression from the search fix. The upload UI had been missing all along, masked by the fact that earlier testing had populated the database through other means.

Three failures, stacked: search didn't use embeddings, the fix broke a working feature, and the investigation revealed the frontend had been incomplete from the start.

### What this means for the experiment

The debugging attempt actually strengthened the original comparison rather than muddying it. The independent build told one story (fast, pragmatic, needs iteration). The coached attempt told the same story more emphatically: even with direct guidance on what to fix, Codex introduced a new regression and exposed an existing gap it hadn't noticed during four phases of development.

Claude Code's build has never needed a post-build fix. Codex's build, after independent development plus a guided debugging session, still doesn't have a working end-to-end flow.

The experiment is now locked. Both repositories are preserved as-is. The code, the bugs, and the gaps are the content.

---

## The Numbers

<details>
<summary><strong>Cost comparison</strong></summary>

| Phase | Claude Code | Codex |
|-------|-------------|-------|
| Triage (AI categorisation) | $0.18 | $0.43 |
| Search (embeddings) | Included in Triage | TBD |
| **Total API cost** | **~$0.18** | **~$0.43** |

Both apps are free to run. The only cost is your own OpenAI API key, and both tools logged their costs transparently.

</details>

<details>
<summary><strong>Coverage</strong></summary>

| Metric | Claude Code | Codex |
|--------|-------------|-------|
| Bookmarks imported | 1,129 | 1,138 |
| Bookmarks categorised | 1,034 (92%) | 736 (70%) |
| Categories generated | 23 | 12 |
| Uncategorised | 95 | 316 |

</details>

<details>
<summary><strong>Architecture</strong></summary>

| Aspect | Claude Code | Codex |
|--------|-------------|-------|
| Framework | Next.js 15 (monolith) | Fastify + React/Vite (monorepo) |
| Database | SQLite + Drizzle ORM | SQLite |
| Frontend structure | Multi-component (16+ components) | Monolithic (`App.tsx`) |
| AI provider | OpenAI (GPT-4o-mini) | OpenAI (gpt-4.1-mini) |
| Embedding model | text-embedding-3-small | text-embedding-3-small |
| Search approach | In-memory cosine similarity | In-memory cosine similarity |

</details>

<details>
<summary><strong>Development pattern</strong></summary>

| Aspect | Claude Code | Codex |
|--------|-------------|-------|
| Planning style | Detailed blueprint, asks permission | Quick decision, starts building |
| Delivery speed | Slower to start, clean on delivery | Fast to ship, iterates after |
| Bug count (all phases) | ~1 | ~8+ |
| Code structure | Modular, reusable components | Pragmatic, monolithic |
| Component reuse | Extensive (BookmarkTable, SSE, concurrency pool) | Minimal |

</details>

---

## What I Actually Learned

### Plan-then-build vs ship-then-fix

This is the strongest thread across all four phases. Claude Code researches, plans, and asks permission before writing a line of code. The result is slower delivery but cleaner builds: zero post-build bugs across four phases. Codex decides quickly, ships something working, then iterates. Faster to a first version, but that first version reliably needs fixing.

Neither approach is wrong. They mirror a genuine tension in software development (and consulting, and management, and most fields where people build things). The real question is which fits your situation.

If you're building something where correctness matters from the start (medical software, financial systems, anything with real users), Claude Code's pattern gives you more confidence. If you're prototyping, exploring an idea, or comfortable iterating, Codex's speed is useful.

### The personality is consistent

What surprised me most was the consistency. The same behavioural pattern held from the very first interaction through all four phases: Claude Code deliberate and thorough, Codex fast and instinctive. It's not a random variation. These tools have predictable personalities that affect what they produce.

### Weakness drives capability

The Codex uncategorised bookmarks story is worth remembering. A 30% failure rate in Triage forced the Organisation phase to handle uncategorised items prominently, and the result was a useful feature that Claude Code didn't build because it didn't need to. The tool that struggled more built a better feature because of it.

This maps to a broader principle: when an AI tool fails at something, the failure often points towards the most valuable next feature. Paying attention to what breaks is as important as celebrating what works.

### Model selection matters more than you think

Both tools independently chose OpenAI. But their model choices differed, and that difference cascaded through everything: taxonomy quality, cost, reliability, structured output handling. The cheapest model isn't always the most economical once you account for retries, failures, and reduced quality.

### Backend convergence, frontend divergence

Both tools independently chose the same embedding model, the same search approach, and the same cost-optimisation strategies. The smart engineering decisions converged. Where they diverged (dramatically) was in code structure and user experience. Same backend logic, radically different frontend architecture.

This suggests that the "hard" technical decisions (which AI model, which search approach, which database) are relatively solved problems. The differentiation, and the quality of the end product, comes from how the code is organised and how the user experience is designed.

---

## Try It Yourself

> [!TIP]
> The Claude Code build is public on GitHub and works end-to-end. The repository includes a getting-started guide written for people who have never used GitHub before: what it is, how to navigate it, and how to get the app running on your computer. You'll need Node.js and an OpenAI API key. The guide walks you through both.

- **Claude Code build:** [github.com/just-code-in/bookmark-manager-claude](https://github.com/just-code-in/bookmark-manager-claude)
- **Codex build (non-functional):** [github.com/just-code-in/bookmark-manager-codex](https://github.com/just-code-in/bookmark-manager-codex)

The Codex repository is preserved as a comparison artifact. The code is there to read, but the application does not run end-to-end. See the Epilogue above for what happened.

If you've been curious about vibe coding but haven't tried it, running the Claude Code build is a low-stakes way to start. You'll use a real application built entirely by AI, and if you want to go further, the code is right there to experiment with.

---

## How This Was Built

Every session was logged. The [Discussion Log](00-DISCUSSION-LOG.md) contains the full reasoning trail: every decision, every observation, every comparison point. The [Build Logs](Build-Log/) capture day-by-day session notes for both tools.

The experiment ran over approximately two weeks in late February and early March 2026. The spec was finalised on 19 February. Import was complete by 26 February. Triage ran through early March. Organisation and Search were built on 7 March. The apps have been stable since.

Total development time (Justin's involvement): approximately 10-12 hours of prompting, reviewing, and testing across all four phases. The AI tools did the rest.

---

*Built Twice is an ongoing experiment in building with AI. The apps are real, the data is real, and the repos are public. If you build something with either tool, I'd like to hear about it.*
