import { useEffect, useMemo, useState } from "react";

type BookmarkStatus = "live" | "redirected" | "dead" | "untested";
type ReviewAction = "keep" | "archive" | "delete" | "unreviewed";

type OrganizationBookmark = {
  id: string;
  title: string;
  url: string;
  folderPath: string | null;
  status: BookmarkStatus;
  category: string | null;
  tags: string[];
  summary: string | null;
  reviewAction: ReviewAction;
};

type OrganizationOverview = {
  stats: {
    totalBookmarks: number;
    uncategorizedCount: number;
    reviewedCount: number;
    reviewPct: number;
    byCategory: Array<{ category: string; count: number }>;
    byStatus: Array<{ status: BookmarkStatus; count: number }>;
    byReviewAction: Array<{ action: ReviewAction; count: number }>;
  };
};

type SearchResult = {
  bookmarkId: string;
  title: string;
  url: string;
  status: BookmarkStatus;
  category: string | null;
  tags: string[];
  summary: string | null;
  reviewAction: ReviewAction;
  score: number;
  matchReasons: string[];
};

type SearchResponse = {
  model: string;
  totalCandidates: number;
  results: SearchResult[];
};

type ImportResponse = {
  importId: string;
  source: "chrome" | "safari" | "unknown";
  total: number;
  imported: number;
  duplicates: number;
  live: number;
  redirected: number;
  dead: number;
  timedOut: number;
  durationMs: number;
};

type TriageRuntimeStatus = {
  runId: string;
  status: "running" | "completed" | "failed";
  stage:
    | "idle"
    | "preparing"
    | "discovering_categories"
    | "categorizing"
    | "summarizing"
    | "finalizing"
    | "completed"
    | "failed";
  startedAt: string;
  finishedAt: string | null;
  totalBookmarks: number;
  preparedCount: number;
  processedCount: number;
  cachedCount: number;
  categorizedCount: number;
  uncategorizedCount: number;
  failedCount: number;
  apiCalls: number;
  promptTokens: number;
  completionTokens: number;
  missingOutputRetriesAttempted: number;
  missingOutputRetriesRecovered: number;
  estimatedCostUsd: number;
  lastError: string | null;
};

type SortBy = "date_added" | "title" | "category";

const API_BASE = "http://127.0.0.1:4040";

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string; message?: string };
    return payload.error ?? payload.message ?? fallback;
  } catch {
    return fallback;
  }
}

function formatStatusLabel(status: BookmarkStatus) {
  return status === "redirected" ? "redirect" : status;
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatTriageStage(stage: TriageRuntimeStatus["stage"]): string {
  return stage.replace(/_/g, " ");
}

export function App() {
  const [overview, setOverview] = useState<OrganizationOverview | null>(null);
  const [bookmarks, setBookmarks] = useState<OrganizationBookmark[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);

  const [statusFilter, setStatusFilter] = useState<"all" | BookmarkStatus>("all");
  const [reviewFilter, setReviewFilter] = useState<"all" | ReviewAction>("all");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("date_added");
  const [uncategorizedOnly, setUncategorizedOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [syncingEmbeddings, setSyncingEmbeddings] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResponse | null>(null);
  const [triageStatus, setTriageStatus] = useState<TriageRuntimeStatus | null>(null);
  const [triaging, setTriaging] = useState(false);

  const [bulkAction, setBulkAction] = useState<"keep" | "archive" | "delete" | "unreviewed">("keep");
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkTag, setBulkTag] = useState("");

  const [renameFrom, setRenameFrom] = useState("");
  const [renameTo, setRenameTo] = useState("");
  const [mergeFrom, setMergeFrom] = useState("");
  const [mergeTo, setMergeTo] = useState("");
  const [deleteCategory, setDeleteCategory] = useState("");

  const selectedLabel = useMemo(() => `${selectedIds.length} selected`, [selectedIds]);

  async function fetchOverview() {
    const response = await fetch(`${API_BASE}/organization/overview`);
    if (!response.ok) throw new Error("Failed to load organisation overview.");
    setOverview((await response.json()) as OrganizationOverview);
  }

  async function fetchBookmarks() {
    const params = new URLSearchParams();
    params.set("status", statusFilter);
    params.set("reviewAction", reviewFilter);
    params.set("sortBy", sortBy);
    params.set("sortDirection", "desc");
    if (categoryFilter.trim()) params.set("category", categoryFilter.trim());
    if (tagFilter.trim()) params.set("tag", tagFilter.trim());
    if (uncategorizedOnly) params.set("uncategorizedOnly", "true");

    const response = await fetch(`${API_BASE}/organization/bookmarks?${params.toString()}`);
    if (!response.ok) throw new Error("Failed to load bookmarks.");
    const payload = (await response.json()) as { results: OrganizationBookmark[] };
    setBookmarks(payload.results);
  }

  async function refreshAll() {
    setLoading(true);
    try {
      await Promise.all([fetchOverview(), fetchBookmarks(), fetchTriageStatus()]);
      setError(null);
    } catch (apiError) {
      setError(apiError instanceof Error ? apiError.message : "Failed to refresh.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshAll();
  }, []);

  useEffect(() => {
    void fetchBookmarks().catch((apiError) => {
      setError(apiError instanceof Error ? apiError.message : "Failed to load bookmarks.");
    });
  }, [statusFilter, reviewFilter, categoryFilter, tagFilter, sortBy, uncategorizedOnly]);

  useEffect(() => {
    const ids = new Set(bookmarks.map((bookmark) => bookmark.id));
    setSelectedIds((previous) => previous.filter((id) => ids.has(id)));
  }, [bookmarks]);

  useEffect(() => {
    if (!triageStatus || triageStatus.status !== "running") return;

    const timer = window.setInterval(() => {
      void fetchTriageStatus()
        .then((status) => {
          if (status?.status === "completed" || status?.status === "failed") {
            void refreshAll();
          }
        })
        .catch(() => undefined);
    }, 2500);

    return () => window.clearInterval(timer);
  }, [triageStatus]);

  function toggleSelected(bookmarkId: string) {
    setSelectedIds((previous) =>
      previous.includes(bookmarkId)
        ? previous.filter((id) => id !== bookmarkId)
        : [...previous, bookmarkId]
    );
  }

  async function patchBookmark(
    bookmarkId: string,
    updates: { category?: string | null; tags?: string[]; summary?: string | null; reviewAction?: ReviewAction }
  ) {
    setWorking(true);
    try {
      const response = await fetch(`${API_BASE}/organization/bookmarks/${bookmarkId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates)
      });
      if (!response.ok) throw new Error("Failed to update bookmark.");
      await refreshAll();
    } catch (apiError) {
      setError(apiError instanceof Error ? apiError.message : "Failed to update bookmark.");
    } finally {
      setWorking(false);
    }
  }

  async function bulkUpdate(payload: Record<string, unknown>) {
    if (selectedIds.length === 0) {
      setError("Select at least one bookmark.");
      return;
    }

    setWorking(true);
    try {
      const response = await fetch(`${API_BASE}/organization/bookmarks/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookmarkIds: selectedIds, ...payload })
      });
      if (!response.ok) throw new Error("Bulk update failed.");
      await refreshAll();
    } catch (apiError) {
      setError(apiError instanceof Error ? apiError.message : "Bulk update failed.");
    } finally {
      setWorking(false);
    }
  }

  async function reTriageSelected() {
    if (selectedIds.length === 0) {
      setError("Select bookmarks to re-triage.");
      return;
    }

    setWorking(true);
    try {
      const response = await fetch(`${API_BASE}/triage/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookmarkIds: selectedIds, ignoreCache: true })
      });
      if (!response.ok && response.status !== 409) throw new Error("Failed to start re-triage run.");
      await refreshAll();
    } catch (apiError) {
      setError(apiError instanceof Error ? apiError.message : "Failed to re-triage.");
    } finally {
      setWorking(false);
    }
  }

  async function mutateCategory(path: string, method: "POST" | "DELETE", body?: object) {
    setWorking(true);
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method,
        headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
      if (!response.ok) throw new Error("Category action failed.");
      await refreshAll();
    } catch (apiError) {
      setError(apiError instanceof Error ? apiError.message : "Category action failed.");
    } finally {
      setWorking(false);
    }
  }

  async function runSearch() {
    if (!searchQuery.trim()) {
      setError("Enter a search query first.");
      return;
    }

    setSearching(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/search/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: searchQuery,
          scope: {
            category: categoryFilter.trim() || undefined,
            tag: tagFilter.trim() || undefined,
            status: statusFilter,
            reviewAction: reviewFilter
          },
          limit: 20
        })
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Search failed."));
      }
      setSearchResults((await response.json()) as SearchResponse);
    } catch (apiError) {
      setError(apiError instanceof Error ? apiError.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  }

  async function fetchTriageStatus(): Promise<TriageRuntimeStatus | null> {
    const response = await fetch(`${API_BASE}/triage/status`);
    if (!response.ok) throw new Error("Failed to load triage status.");
    const payload = (await response.json()) as { status: TriageRuntimeStatus | null };
    setTriageStatus(payload.status);
    return payload.status;
  }

  async function startTriage(bookmarkIds?: string[]) {
    setTriaging(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/triage/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ignoreCache: true,
          bookmarkIds
        })
      });

      if (!response.ok && response.status !== 409) {
        throw new Error(await readErrorMessage(response, "Failed to start triage."));
      }

      await fetchTriageStatus();
      await refreshAll();
    } catch (apiError) {
      setError(apiError instanceof Error ? apiError.message : "Failed to start triage.");
    } finally {
      setTriaging(false);
    }
  }

  async function handleImport() {
    if (!importFile) {
      setError("Choose a bookmarks HTML file first.");
      return;
    }

    setImporting(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", importFile);

      const response = await fetch(`${API_BASE}/imports`, {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Import failed."));
      }

      const payload = (await response.json()) as ImportResponse;
      setImportResult(payload);
      setImportFile(null);
      await refreshAll();
    } catch (apiError) {
      setError(apiError instanceof Error ? apiError.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  async function handleGenerateEmbeddings() {
    setSyncingEmbeddings(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/search/embeddings/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Embedding generation failed."));
      }
    } catch (apiError) {
      setError(apiError instanceof Error ? apiError.message : "Embedding generation failed.");
    } finally {
      setSyncingEmbeddings(false);
    }
  }

  return (
    <main className="app-shell">
      <h1 className="app-title">Bookmark Manager</h1>
      <p className="app-subtitle">
        Import, triage, organize, and search bookmarks with a calm, focused workspace.
      </p>

      {error ? <p className="error">{error}</p> : null}

      <section className="results">
        <h2 className="section-title">Import Bookmarks</h2>
        <article className="result-card">
          <div className="filters">
            <input
              type="file"
              accept=".html,text/html"
              onChange={(event) => setImportFile(event.currentTarget.files?.[0] ?? null)}
            />
            <button type="button" onClick={handleImport} disabled={importing}>
              {importing ? "Importing..." : "Import file"}
            </button>
          </div>
          <p className="muted">Choose a Safari or Chrome bookmarks export in HTML format.</p>
          {importFile ? <p>Selected: {importFile.name}</p> : null}
          {importResult ? (
            <p>
              Imported {importResult.imported} of {importResult.total} bookmarks
              {importResult.duplicates > 0 ? `, skipped ${importResult.duplicates} duplicates` : ""}.
            </p>
          ) : null}
        </article>
      </section>

      <section className="results">
        <h2 className="section-title">AI Triage</h2>
        <article className="result-card">
          <div className="filters">
            <button type="button" onClick={() => void startTriage()} disabled={triaging || importing || overview?.stats.totalBookmarks === 0}>
              {triaging || triageStatus?.status === "running" ? "Categorizing..." : "Categorize all bookmarks"}
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={() => void startTriage(selectedIds)}
              disabled={triaging || selectedIds.length === 0}
            >
              Categorize selected
            </button>
          </div>
          <p className="muted">
            Generate categories, tags, and summaries for imported bookmarks using your OpenAI API key.
          </p>
          {triageStatus ? (
            <p>
              <strong>Status:</strong> {triageStatus.status} | <strong>Stage:</strong>{" "}
              {formatTriageStage(triageStatus.stage)} | <strong>Processed:</strong> {triageStatus.processedCount}/
              {triageStatus.totalBookmarks} | <strong>Categorized:</strong> {triageStatus.categorizedCount}
            </p>
          ) : (
            <p>No triage run started yet.</p>
          )}
          {triageStatus?.lastError ? (
            <p className="error">{triageStatus.lastError}</p>
          ) : null}
        </article>
      </section>

      <section className="results">
        <h2 className="section-title">Organisation Dashboard</h2>
        {loading && !overview ? <p className="muted">Loading dashboard…</p> : null}
        {overview ? (
          <>
            <article className="result-card result-card--highlight">
              <p>
                <strong>Total:</strong> {overview.stats.totalBookmarks} | <strong>Reviewed:</strong>{" "}
                {overview.stats.reviewedCount} ({formatPercent(overview.stats.reviewPct)})
              </p>
              <p>
                <strong>Uncategorized queue:</strong> {overview.stats.uncategorizedCount}
              </p>
              <button type="button" className="button-secondary" onClick={() => setUncategorizedOnly(true)}>
                Focus uncategorized (316 currently expected)
              </button>
            </article>

            <article className="result-card">
              <h3>Browse categories</h3>
              {overview.stats.byCategory.map((item) => (
                <p key={item.category} className="stat-row">
                  <strong>{item.category}</strong>
                  <span>{item.count}</span>
                </p>
              ))}
            </article>
          </>
        ) : null}
      </section>

      <section className="results">
        <h2 className="section-title">Natural Language Search</h2>
        <article className="result-card">
          <div className="filters">
            <input
              placeholder="e.g. recipes I saved from YouTube"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
            />
            <button type="button" className="button-secondary" onClick={handleGenerateEmbeddings} disabled={syncingEmbeddings}>
              {syncingEmbeddings ? "Generating..." : "Generate embeddings"}
            </button>
            <button type="button" onClick={runSearch} disabled={searching}>
              {searching ? "Searching..." : "Search"}
            </button>
          </div>
        </article>

        {searchResults ? (
          <>
            <article className="result-card">
              <p>
                <strong>Model:</strong> {searchResults.model} | <strong>Candidates:</strong>{" "}
                {searchResults.totalCandidates}
              </p>
              {searchResults.model === "keyword-fallback" ? (
                <p className="muted">
                  Semantic embeddings are unavailable right now, so search is using title, tag, category, summary,
                  and URL matching instead.
                </p>
              ) : null}
            </article>
            {searchResults.results.map((result) => (
              <article key={result.bookmarkId} className="result-card bookmark-card">
                <header className="bookmark-head">
                  <a href={result.url} target="_blank" rel="noreferrer">
                    {result.title}
                  </a>
                  <span className={`status-badge status-${result.status}`}>{formatStatusLabel(result.status)}</span>
                </header>
                <p className="bookmark-url">{result.url}</p>
                <p>
                  <strong>Relevance:</strong> {(result.score * 100).toFixed(1)}%
                </p>
                <p>
                  <strong>Category:</strong> {result.category ?? "Uncategorized"} | <strong>Action:</strong>{" "}
                  {result.reviewAction}
                </p>
                <p>
                  <strong>Summary:</strong> {result.summary ?? "No summary"}
                </p>
                <p>
                  <strong>Why matched:</strong>{" "}
                  {result.matchReasons.length > 0 ? result.matchReasons.join("; ") : "semantic similarity"}
                </p>
              </article>
            ))}
            {searchResults.results.length === 0 ? (
              <article className="result-card empty-state">
                <p>No results found for this query.</p>
                <p className="muted">Try a broader query or remove category/tag constraints.</p>
              </article>
            ) : null}
          </>
        ) : (
          <article className="result-card empty-state">
            <p>Search results will appear here.</p>
            <p className="muted">Try a natural language query like “articles about investing”.</p>
          </article>
        )}
      </section>

      <section className="results">
        <h2 className="section-title">Organisation Workspace</h2>
        <article className="result-card">
          <div className="filters">
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.currentTarget.value as "all" | BookmarkStatus)}>
              <option value="all">Any status</option>
              <option value="live">Live</option>
              <option value="redirected">Redirected</option>
              <option value="dead">Dead</option>
              <option value="untested">Untested</option>
            </select>
            <select value={reviewFilter} onChange={(event) => setReviewFilter(event.currentTarget.value as "all" | ReviewAction)}>
              <option value="all">Any triage action</option>
              <option value="unreviewed">Unreviewed</option>
              <option value="keep">Keep</option>
              <option value="archive">Archive</option>
              <option value="delete">Delete</option>
            </select>
            <input placeholder="Category" value={categoryFilter} onChange={(event) => setCategoryFilter(event.currentTarget.value)} />
            <input placeholder="Tag" value={tagFilter} onChange={(event) => setTagFilter(event.currentTarget.value)} />
            <select value={sortBy} onChange={(event) => setSortBy(event.currentTarget.value as SortBy)}>
              <option value="date_added">Sort by date</option>
              <option value="title">Sort by title</option>
              <option value="category">Sort by category</option>
            </select>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={uncategorizedOnly}
                onChange={(event) => setUncategorizedOnly(event.currentTarget.checked)}
              />
              Uncategorized only
            </label>
          </div>
        </article>

        <article className="result-card">
          <p>{selectedLabel}</p>
          <div className="filters">
            <select value={bulkAction} onChange={(event) => setBulkAction(event.currentTarget.value as "keep" | "archive" | "delete" | "unreviewed")}>
              <option value="keep">Keep</option>
              <option value="archive">Archive</option>
              <option value="delete">Delete</option>
              <option value="unreviewed">Unreviewed</option>
            </select>
            <button type="button" disabled={working} onClick={() => void bulkUpdate({ reviewAction: bulkAction })}>
              Bulk set action
            </button>
            <input
              placeholder="Bulk category (empty = uncategorized)"
              value={bulkCategory}
              onChange={(event) => setBulkCategory(event.currentTarget.value)}
            />
            <button type="button" disabled={working} onClick={() => void bulkUpdate({ category: bulkCategory.trim() || null })}>
              Bulk move category
            </button>
            <input placeholder="Bulk tag" value={bulkTag} onChange={(event) => setBulkTag(event.currentTarget.value)} />
            <button type="button" disabled={working} onClick={() => void bulkUpdate({ addTag: bulkTag.trim() })}>
              Bulk add tag
            </button>
            <button type="button" disabled={working} onClick={reTriageSelected}>
              Re-triage selected
            </button>
          </div>
        </article>

        <article className="result-card">
          <h3>Category overrides</h3>
          <div className="filters">
            <input placeholder="Rename from" value={renameFrom} onChange={(event) => setRenameFrom(event.currentTarget.value)} />
            <input placeholder="Rename to" value={renameTo} onChange={(event) => setRenameTo(event.currentTarget.value)} />
            <button type="button" disabled={working} onClick={() => void mutateCategory("/organization/categories/rename", "POST", { from: renameFrom, to: renameTo })}>
              Rename category
            </button>
          </div>
          <div className="filters">
            <input
              placeholder="Merge from (comma-separated)"
              value={mergeFrom}
              onChange={(event) => setMergeFrom(event.currentTarget.value)}
            />
            <input placeholder="Merge into" value={mergeTo} onChange={(event) => setMergeTo(event.currentTarget.value)} />
            <button
              type="button"
              disabled={working}
              onClick={() =>
                void mutateCategory("/organization/categories/merge", "POST", {
                  sourceCategories: mergeFrom
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean),
                  targetCategory: mergeTo
                })
              }
            >
              Merge categories
            </button>
          </div>
          <div className="filters">
            <input
              placeholder="Delete category"
              value={deleteCategory}
              onChange={(event) => setDeleteCategory(event.currentTarget.value)}
            />
            <button
              type="button"
              disabled={working}
              onClick={() =>
                void mutateCategory(`/organization/categories/${encodeURIComponent(deleteCategory)}`, "DELETE")
              }
            >
              Delete category
            </button>
          </div>
        </article>

        {bookmarks.length === 0 ? (
          <article className="result-card empty-state">
            <p>No bookmarks match the current filters.</p>
            <p className="muted">Try clearing category/tag filters or disabling uncategorized-only mode.</p>
          </article>
        ) : null}

        {bookmarks.map((bookmark) => (
          <BookmarkCard
            key={bookmark.id}
            bookmark={bookmark}
            selected={selectedIds.includes(bookmark.id)}
            working={working}
            onToggleSelected={toggleSelected}
            onSave={patchBookmark}
          />
        ))}
      </section>

    </main>
  );
}

function BookmarkCard(props: {
  bookmark: OrganizationBookmark;
  selected: boolean;
  working: boolean;
  onToggleSelected: (bookmarkId: string) => void;
  onSave: (
    bookmarkId: string,
    updates: { category?: string | null; tags?: string[]; summary?: string | null; reviewAction?: ReviewAction }
  ) => Promise<void>;
}) {
  const { bookmark, selected, working, onToggleSelected, onSave } = props;
  const [category, setCategory] = useState(bookmark.category ?? "");
  const [tags, setTags] = useState(bookmark.tags.join(", "));
  const [summary, setSummary] = useState(bookmark.summary ?? "");
  const [reviewAction, setReviewAction] = useState<ReviewAction>(bookmark.reviewAction);

  useEffect(() => {
    setCategory(bookmark.category ?? "");
    setTags(bookmark.tags.join(", "));
    setSummary(bookmark.summary ?? "");
    setReviewAction(bookmark.reviewAction);
  }, [bookmark]);

  return (
    <article className="result-card bookmark-card">
      <header className="bookmark-head">
        <label className="checkbox-row">
          <input type="checkbox" checked={selected} onChange={() => onToggleSelected(bookmark.id)} />
          <a href={bookmark.url} target="_blank" rel="noreferrer">
            {bookmark.title}
          </a>
        </label>
        <span className={`status-badge status-${bookmark.status}`}>{formatStatusLabel(bookmark.status)}</span>
      </header>

      <p className="bookmark-url">{bookmark.url}</p>
      <p className="bookmark-meta">
        <strong>Category:</strong> {bookmark.category ?? "Uncategorized"} | <strong>Action:</strong>{" "}
        {bookmark.reviewAction}
      </p>

      <div className="triage-controls">
        <input value={category} onChange={(event) => setCategory(event.currentTarget.value)} placeholder="Category" />
        <input value={tags} onChange={(event) => setTags(event.currentTarget.value)} placeholder="Tags (comma-separated)" />
        <textarea value={summary} onChange={(event) => setSummary(event.currentTarget.value)} rows={3} />
        <select value={reviewAction} onChange={(event) => setReviewAction(event.currentTarget.value as ReviewAction)}>
          <option value="unreviewed">Unreviewed</option>
          <option value="keep">Keep</option>
          <option value="archive">Archive</option>
          <option value="delete">Delete</option>
        </select>
        <button
          type="button"
          disabled={working}
          onClick={() =>
            void onSave(bookmark.id, {
              category: category.trim() || null,
              tags: tags
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
              summary: summary.trim() || null,
              reviewAction
            })
          }
        >
          Save overrides
        </button>
      </div>
    </article>
  );
}
