import { useEffect, useMemo, useState } from "react";

type ImportSummary = {
  importId: string;
  source: "chrome" | "safari" | "unknown";
  fileName: string;
  startedAt: string;
  finishedAt: string | null;
  total: number;
  imported: number;
  duplicates: number;
  live: number;
  redirected: number;
  dead: number;
  timedOut: number;
  durationMs: number;
};

type BookmarkStatus = "live" | "redirected" | "dead" | "untested";
type StatusFilter = "all" | "live" | "dead";

type BookmarkRecord = {
  id: string;
  url: string;
  title: string;
  folderPath: string | null;
  status: BookmarkStatus;
  httpStatusCode: number | null;
  checkedAt: string | null;
};

type TriageStatus = {
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
  processedCount: number;
  cachedCount: number;
  categorizedCount: number;
  uncategorizedCount: number;
  failedCount: number;
  apiCalls: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  lastError: string | null;
};

type TriageCategory = {
  category: string;
  count: number;
};

type TriageUncategorized = {
  bookmarkId: string;
  title: string;
  url: string;
  reasonCode: string;
};

type TriageSummary = {
  run: {
    id: string;
    status: "running" | "completed" | "failed";
    startedAt: string;
    finishedAt: string | null;
    durationMs: number;
    totalBookmarks: number;
    processedCount: number;
    cachedCount: number;
    categorizedCount: number;
    uncategorizedCount: number;
    failedCount: number;
    categoryModel: string;
    summaryModel: string;
    promptVersion: string;
    apiCalls: number;
    promptTokens: number;
    completionTokens: number;
    estimatedCostUsd: number;
    errorMessage: string | null;
  };
  categories: TriageCategory[];
  uncategorized: TriageUncategorized[];
};

function formatStatusLabel(status: BookmarkStatus) {
  if (status === "redirected") return "redirect";
  return status;
}

function formatTriageStage(stage: TriageStatus["stage"]): string {
  return stage.replaceAll("_", " ");
}

function deadReason(bookmark: BookmarkRecord): string {
  if (bookmark.status !== "dead") return "";
  if (bookmark.httpStatusCode !== null) return `HTTP ${bookmark.httpStatusCode}`;
  return "No HTTP response (timeout or connection refused)";
}

function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

export function App() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingBookmarks, setLoadingBookmarks] = useState(false);
  const [runningTriage, setRunningTriage] = useState(false);
  const [ignoreCache, setIgnoreCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ImportSummary[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [triageStatus, setTriageStatus] = useState<TriageStatus | null>(null);
  const [triageSummary, setTriageSummary] = useState<TriageSummary | null>(null);

  const latestImport = useMemo(() => results[0] ?? null, [results]);

  async function loadImportResults() {
    const response = await fetch("http://127.0.0.1:4040/imports?limit=30");
    if (!response.ok) {
      throw new Error("Failed to load import summaries.");
    }
    const payload = (await response.json()) as { results: ImportSummary[] };
    setResults(payload.results);
  }

  async function loadBookmarks(filter: StatusFilter) {
    setLoadingBookmarks(true);
    try {
      const response = await fetch(`http://127.0.0.1:4040/bookmarks?status=${filter}`);
      if (!response.ok) {
        throw new Error("Failed to load bookmarks.");
      }
      const payload = (await response.json()) as { results: BookmarkRecord[] };
      setBookmarks(payload.results);
    } finally {
      setLoadingBookmarks(false);
    }
  }

  async function loadTriageStatus() {
    const response = await fetch("http://127.0.0.1:4040/triage/status");
    if (!response.ok) {
      throw new Error("Failed to load triage status.");
    }
    const payload = (await response.json()) as { status: TriageStatus | null };
    setTriageStatus(payload.status);
    setRunningTriage(payload.status?.status === "running");
  }

  async function loadTriageSummary() {
    const response = await fetch("http://127.0.0.1:4040/triage/runs/latest");
    if (!response.ok) {
      throw new Error("Failed to load triage summary.");
    }
    const payload = (await response.json()) as { summary: TriageSummary | null };
    setTriageSummary(payload.summary);
  }

  useEffect(() => {
    async function loadInitial() {
      try {
        setError(null);
        await Promise.all([
          loadImportResults(),
          loadBookmarks(statusFilter),
          loadTriageStatus(),
          loadTriageSummary()
        ]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data.");
      }
    }
    void loadInitial();
  }, []);

  useEffect(() => {
    async function refreshBookmarksForFilter() {
      try {
        setError(null);
        await loadBookmarks(statusFilter);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load bookmarks.");
      }
    }
    void refreshBookmarksForFilter();
  }, [statusFilter]);

  useEffect(() => {
    const interval = setInterval(() => {
      void (async () => {
        try {
          await loadTriageStatus();
          if (runningTriage) {
            await loadTriageSummary();
          }
        } catch {
          // Keep polling; surface API failures in explicit actions.
        }
      })();
    }, 3000);

    return () => clearInterval(interval);
  }, [runningTriage]);

  async function handleImport() {
    if (!file) {
      setError("Choose a bookmarks HTML file first.");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append("file", file, file.name);

      const response = await fetch("http://127.0.0.1:4040/imports", {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Import failed.");
      }

      const summary = (await response.json()) as ImportSummary;
      setResults((prev) => [summary, ...prev]);
      setFile(null);
      await loadBookmarks(statusFilter);
      await loadImportResults();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleStartTriage() {
    setError(null);
    setRunningTriage(true);

    try {
      const response = await fetch("http://127.0.0.1:4040/triage/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ignoreCache })
      });

      if (!response.ok && response.status !== 409) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Failed to start triage run.");
      }

      await loadTriageStatus();
      await loadTriageSummary();
    } catch (err) {
      setRunningTriage(false);
      setError(err instanceof Error ? err.message : "Failed to start triage run.");
    }
  }

  const progressPct =
    triageStatus && triageStatus.totalBookmarks > 0
      ? Math.min(100, Math.round((triageStatus.processedCount / triageStatus.totalBookmarks) * 100))
      : 0;

  return (
    <main className="app-shell">
      <h1>Bookmark Manager</h1>
      <p>Import Safari/Chrome bookmark exports and review results.</p>

      <section className="panel">
        <input
          type="file"
          accept=".html,text/html"
          onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
        />
        <button type="button" onClick={handleImport} disabled={loading || !file}>
          {loading ? "Importing..." : "Run Import"}
        </button>
        {error ? <p className="error">{error}</p> : null}
      </section>

      <section className="results">
        <h2>Triage</h2>
        <article className="result-card">
          <div className="triage-controls">
            <button
              type="button"
              onClick={handleStartTriage}
              disabled={runningTriage || bookmarks.length === 0}
            >
              {runningTriage ? "Triage Running..." : "Run Triage"}
            </button>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={ignoreCache}
                onChange={(event) => setIgnoreCache(event.currentTarget.checked)}
                disabled={runningTriage}
              />
              Ignore cache and reprocess all bookmarks
            </label>
          </div>
          {triageStatus ? (
            <>
              <p>
                <strong>Stage:</strong> {formatTriageStage(triageStatus.stage)}
              </p>
              <p>
                <strong>Progress:</strong> {triageStatus.processedCount} / {triageStatus.totalBookmarks} ({progressPct}%)
              </p>
              <p>
                <strong>Cache hits:</strong> {triageStatus.cachedCount} | <strong>Categorized:</strong>{" "}
                {triageStatus.categorizedCount} | <strong>Uncategorized:</strong>{" "}
                {triageStatus.uncategorizedCount}
              </p>
              <p>
                <strong>API calls:</strong> {triageStatus.apiCalls} | <strong>Prompt tokens:</strong>{" "}
                {triageStatus.promptTokens} | <strong>Completion tokens:</strong>{" "}
                {triageStatus.completionTokens}
              </p>
              <p>
                <strong>Estimated cost:</strong> {formatUsd(triageStatus.estimatedCostUsd)}
              </p>
              {triageStatus.lastError ? (
                <p className="error">
                  <strong>Last error:</strong> {triageStatus.lastError}
                </p>
              ) : null}
            </>
          ) : (
            <p>No triage run yet.</p>
          )}
        </article>

        {triageSummary ? (
          <article className="result-card">
            <p>
              <strong>Latest run:</strong> {triageSummary.run.id}
            </p>
            <p>
              <strong>Status:</strong> {triageSummary.run.status} | <strong>Duration:</strong>{" "}
              {triageSummary.run.durationMs}ms
            </p>
            <p>
              <strong>Models:</strong> {triageSummary.run.categoryModel} (categorization),{" "}
              {triageSummary.run.summaryModel} (summary)
            </p>
            <h3>Categories</h3>
            {triageSummary.categories.length === 0 ? <p>No categories generated yet.</p> : null}
            {triageSummary.categories.map((item) => (
              <p key={item.category}>
                <strong>{item.category}:</strong> {item.count}
              </p>
            ))}

            <h3>Couldn&apos;t Categorize</h3>
            {triageSummary.uncategorized.length === 0 ? <p>None.</p> : null}
            {triageSummary.uncategorized.slice(0, 20).map((item) => (
              <p key={item.bookmarkId}>
                <strong>{item.title}</strong> ({item.reasonCode})
              </p>
            ))}
          </article>
        ) : null}
      </section>

      <section className="results">
        <h2>Import Summary</h2>
        {latestImport ? (
          <article className="result-card result-card--highlight">
            <p>
              <strong>Last Import:</strong> {latestImport.fileName}
            </p>
            <p>
              <strong>Total Imported File Entries:</strong> {latestImport.total}
            </p>
            <p>
              <strong>Inserted:</strong> {latestImport.imported} |{" "}
              <strong>Duplicates Skipped:</strong> {latestImport.duplicates}
            </p>
            <p>
              <strong>Live:</strong> {latestImport.live} | <strong>Redirect:</strong>{" "}
              {latestImport.redirected} | <strong>Dead:</strong> {latestImport.dead}
            </p>
          </article>
        ) : null}

        <h3>Recent Imports</h3>
        {results.length === 0 ? <p>No imports yet.</p> : null}
        {results.map((result) => (
          <article key={result.importId} className="result-card">
            <p>
              <strong>Source:</strong> {result.source} | <strong>File:</strong> {result.fileName}
            </p>
            <p>
              <strong>Total:</strong> {result.total} | <strong>Imported:</strong> {result.imported} |{" "}
              <strong>Duplicates:</strong> {result.duplicates}
            </p>
            <p>
              <strong>Live:</strong> {result.live} | <strong>Redirected:</strong> {result.redirected} |{" "}
              <strong>Dead:</strong> {result.dead}
            </p>
            <p>
              <strong>Timed Out:</strong> {result.timedOut} | <strong>Duration:</strong>{" "}
              {result.durationMs}ms
            </p>
          </article>
        ))}
      </section>

      <section className="results">
        <h2>Bookmarks</h2>
        <div className="filters" role="group" aria-label="Filter bookmarks by status">
          <button
            type="button"
            className={statusFilter === "all" ? "filter-button active" : "filter-button"}
            onClick={() => setStatusFilter("all")}
          >
            All
          </button>
          <button
            type="button"
            className={statusFilter === "live" ? "filter-button active" : "filter-button"}
            onClick={() => setStatusFilter("live")}
          >
            Live
          </button>
          <button
            type="button"
            className={statusFilter === "dead" ? "filter-button active" : "filter-button"}
            onClick={() => setStatusFilter("dead")}
          >
            Dead
          </button>
        </div>

        {loadingBookmarks ? <p>Loading bookmarks...</p> : null}
        {!loadingBookmarks && bookmarks.length === 0 ? <p>No bookmarks for this filter.</p> : null}
        {bookmarks.map((bookmark) => (
          <article key={bookmark.id} className="result-card bookmark-card">
            <header className="bookmark-head">
              <a href={bookmark.url} target="_blank" rel="noreferrer">
                {bookmark.title}
              </a>
              <span className={`status-badge status-${bookmark.status}`}>
                {formatStatusLabel(bookmark.status)}
              </span>
            </header>
            <p className="bookmark-url">{bookmark.url}</p>
            {bookmark.folderPath ? (
              <p>
                <strong>Folder:</strong> {bookmark.folderPath}
              </p>
            ) : null}
            {bookmark.status === "dead" ? (
              <p className="dead-reason">
                <strong>Reason:</strong> {deadReason(bookmark)}
              </p>
            ) : null}
          </article>
        ))}
      </section>
    </main>
  );
}
