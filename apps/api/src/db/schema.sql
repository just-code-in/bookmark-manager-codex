CREATE TABLE IF NOT EXISTS imports (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  file_name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  total_bookmarks INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  live_count INTEGER NOT NULL DEFAULT 0,
  redirected_count INTEGER NOT NULL DEFAULT 0,
  dead_count INTEGER NOT NULL DEFAULT 0,
  timeout_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  folder_path TEXT,
  date_added TEXT,
  source_import_id TEXT NOT NULL,
  url_status TEXT CHECK(url_status IN ('live', 'redirected', 'dead')),
  final_url TEXT,
  http_status_code INTEGER,
  checked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (source_import_id) REFERENCES imports(id)
);

CREATE TABLE IF NOT EXISTS triage_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  total_bookmarks INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  cached_count INTEGER NOT NULL DEFAULT 0,
  categorized_count INTEGER NOT NULL DEFAULT 0,
  uncategorized_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  category_model TEXT NOT NULL,
  summary_model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  api_calls INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS bookmark_triage (
  bookmark_id TEXT PRIMARY KEY,
  triage_run_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  source_type TEXT NOT NULL,
  category TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  summary TEXT,
  reason_code TEXT,
  confidence REAL,
  categorized_at TEXT NOT NULL,
  category_model TEXT NOT NULL,
  summary_model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id),
  FOREIGN KEY (triage_run_id) REFERENCES triage_runs(id)
);
