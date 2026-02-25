import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import type { ParsedBookmark } from "../services/import/bookmark-parser";
import type { UrlValidationResult } from "../services/url-validation/url-validator";

type StoredBookmark = ParsedBookmark & {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "live" | "redirected" | "dead" | null;
  finalUrl: string | null;
  httpStatusCode: number | null;
  checkedAt: string | null;
};

type ImportRun = {
  id: string;
  source: string;
  fileName: string;
  startedAt: string;
  finishedAt: string;
  totalBookmarks: number;
  importedCount: number;
  duplicateCount: number;
  liveCount: number;
  redirectedCount: number;
  deadCount: number;
};

type JsonStore = {
  bookmarks: StoredBookmark[];
  imports: ImportRun[];
};

type UpsertResult = {
  inserted: StoredBookmark[];
  duplicates: number;
};

const STORE_PATH = resolve(process.cwd(), "db", "store.json");

async function ensureStoreFile() {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  try {
    await readFile(STORE_PATH, "utf-8");
  } catch {
    const initial: JsonStore = { bookmarks: [], imports: [] };
    await writeFile(STORE_PATH, JSON.stringify(initial, null, 2), "utf-8");
  }
}

async function readStore(): Promise<JsonStore> {
  await ensureStoreFile();
  const raw = await readFile(STORE_PATH, "utf-8");
  return JSON.parse(raw) as JsonStore;
}

async function writeStore(store: JsonStore) {
  await writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

export class BookmarkRepository {
  async upsertBookmarks(bookmarks: ParsedBookmark[]): Promise<UpsertResult> {
    const store = await readStore();
    const existing = new Set(store.bookmarks.map((bookmark) => bookmark.url));
    const seenInBatch = new Set<string>();
    const inserted: StoredBookmark[] = [];
    let duplicates = 0;

    for (const bookmark of bookmarks) {
      if (existing.has(bookmark.url) || seenInBatch.has(bookmark.url)) {
        duplicates += 1;
        continue;
      }

      seenInBatch.add(bookmark.url);
      const now = new Date().toISOString();
      const record: StoredBookmark = {
        ...bookmark,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
        status: null,
        finalUrl: null,
        httpStatusCode: null,
        checkedAt: null
      };

      inserted.push(record);
      store.bookmarks.push(record);
    }

    await writeStore(store);
    return { inserted, duplicates };
  }

  async updateValidations(
    updates: Array<{ bookmarkId: string; result: UrlValidationResult }>
  ): Promise<void> {
    if (updates.length === 0) return;
    const store = await readStore();
    const byId = new Map(updates.map((entry) => [entry.bookmarkId, entry.result]));

    store.bookmarks = store.bookmarks.map((bookmark) => {
      const result = byId.get(bookmark.id);
      if (!result) return bookmark;

      return {
        ...bookmark,
        status: result.status,
        finalUrl: result.finalUrl,
        httpStatusCode: result.statusCode,
        checkedAt: result.checkedAt,
        updatedAt: new Date().toISOString()
      };
    });

    await writeStore(store);
  }

  async saveImportRun(input: Omit<ImportRun, "id">): Promise<ImportRun> {
    const store = await readStore();
    const run: ImportRun = {
      id: randomUUID(),
      ...input
    };
    store.imports.push(run);
    await writeStore(store);
    return run;
  }
}
