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

export { db };
