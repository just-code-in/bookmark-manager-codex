CREATE TABLE IF NOT EXISTS imports (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  file_name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  total_bookmarks INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  live_count INTEGER NOT NULL DEFAULT 0,
  redirected_count INTEGER NOT NULL DEFAULT 0,
  dead_count INTEGER NOT NULL DEFAULT 0
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
