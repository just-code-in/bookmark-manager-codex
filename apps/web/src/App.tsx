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

function formatStatusLabel(status: BookmarkStatus) {
  if (status === "redirected") return "redirect";
  return status;
}

function deadReason(bookmark: BookmarkRecord): string {
  if (bookmark.status !== "dead") return "";
  if (bookmark.httpStatusCode !== null) return `HTTP ${bookmark.httpStatusCode}`;
  return "No HTTP response (timeout or connection refused)";
}

export function App() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingBookmarks, setLoadingBookmarks] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ImportSummary[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

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

  useEffect(() => {
    async function loadInitial() {
      try {
        setError(null);
        await Promise.all([loadImportResults(), loadBookmarks(statusFilter)]);
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
              <strong>Total:</strong> {result.total} | <strong>Imported:</strong>{" "}
              {result.imported} | <strong>Duplicates:</strong> {result.duplicates}
            </p>
            <p>
              <strong>Live:</strong> {result.live} | <strong>Redirected:</strong>{" "}
              {result.redirected} | <strong>Dead:</strong> {result.dead}
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
