import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFilePath);
const repoRoot = resolve(currentDir, "..", "..", "..", "..");

const DB_PATH = resolve(repoRoot, "db", "bookmark-manager.sqlite");
const SCHEMA_PATH = resolve(currentDir, "schema.sql");

const dbDir = resolve(repoRoot, "db");
mkdirSync(dbDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const schemaSql = readFileSync(SCHEMA_PATH, "utf-8");
db.exec(schemaSql);

function ensureTriageRunColumn(name: string, sqlType: string, defaultValue: string): void {
  const columns = db.prepare("PRAGMA table_info(triage_runs)").all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === name)) return;
  db.exec(
    `ALTER TABLE triage_runs ADD COLUMN ${name} ${sqlType} NOT NULL DEFAULT ${defaultValue}`
  );
}

ensureTriageRunColumn("missing_output_retries_attempted", "INTEGER", "0");
ensureTriageRunColumn("missing_output_retries_recovered", "INTEGER", "0");

export { db };
