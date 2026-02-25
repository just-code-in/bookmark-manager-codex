import { useState } from "react";

type ImportSummary = {
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

export function App() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ImportSummary[]>([]);

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
        <h2>Import Results</h2>
        {results.length === 0 ? <p>No imports yet.</p> : null}
        {results.map((result) => (
          <article key={result.importId} className="result-card">
            <p>
              <strong>Source:</strong> {result.source}
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
    </main>
  );
}
