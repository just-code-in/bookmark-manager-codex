import { randomUUID } from "node:crypto";

import { db } from "../db/client";
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
  sourceImportId: string;
};

type ImportRun = {
  id: string;
  source: string;
  fileName: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  totalBookmarks: number;
  importedCount: number;
  duplicateCount: number;
  liveCount: number;
  redirectedCount: number;
  deadCount: number;
  timeoutCount: number;
};

type UpsertResult = {
  inserted: StoredBookmark[];
  duplicates: number;
};

type SaveImportRunInput = ImportRun;
type CreateImportRunInput = {
  id: string;
  source: string;
  fileName: string;
  startedAt: string;
};

export class BookmarkRepository {
  async createImportRun(input: CreateImportRunInput): Promise<void> {
    db.prepare(
      `
      INSERT INTO imports (
        id, source, file_name, started_at, finished_at, duration_ms, total_bookmarks,
        imported_count, duplicate_count, live_count, redirected_count, dead_count, timeout_count
      )
      VALUES (?, ?, ?, ?, NULL, 0, 0, 0, 0, 0, 0, 0, 0)
    `
    ).run(input.id, input.source, input.fileName, input.startedAt);
  }

  async upsertBookmarks(
    bookmarks: ParsedBookmark[],
    sourceImportId: string
  ): Promise<UpsertResult> {
    const inserted: StoredBookmark[] = [];
    let duplicates = 0;

    const insert = db.prepare(`
      INSERT INTO bookmarks (
        id, url, title, folder_path, date_added, source_import_id,
        url_status, final_url, http_status_code, checked_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = db.transaction(() => {
      for (const bookmark of bookmarks) {
        const existing = db
          .prepare("SELECT id FROM bookmarks WHERE url = ?")
          .get(bookmark.url) as { id: string } | undefined;
        if (existing) {
          duplicates += 1;
          continue;
        }

        const now = new Date().toISOString();
        const row: StoredBookmark = {
          id: randomUUID(),
          url: bookmark.url,
          title: bookmark.title,
          folderPath: bookmark.folderPath,
          dateAdded: bookmark.dateAdded,
          sourceImportId,
          createdAt: now,
          updatedAt: now,
          status: null,
          finalUrl: null,
          httpStatusCode: null,
          checkedAt: null
        };

        insert.run(
          row.id,
          row.url,
          row.title,
          row.folderPath,
          row.dateAdded,
          row.sourceImportId,
          row.status,
          row.finalUrl,
          row.httpStatusCode,
          row.checkedAt,
          row.createdAt,
          row.updatedAt
        );
        inserted.push(row);
      }
    });

    tx();
    return { inserted, duplicates };
  }

  async updateValidations(
    updates: Array<{ bookmarkId: string; result: UrlValidationResult }>
  ): Promise<void> {
    if (updates.length === 0) return;

    const update = db.prepare(`
      UPDATE bookmarks
      SET url_status = ?, final_url = ?, http_status_code = ?, checked_at = ?, updated_at = ?
      WHERE id = ?
    `);

    const tx = db.transaction(() => {
      for (const { bookmarkId, result } of updates) {
        update.run(
          result.status,
          result.finalUrl,
          result.statusCode,
          result.checkedAt,
          new Date().toISOString(),
          bookmarkId
        );
      }
    });

    tx();
  }

  async saveImportRun(input: SaveImportRunInput): Promise<ImportRun> {
    const run = input;
    db.prepare(
      `
      UPDATE imports
      SET finished_at = ?, duration_ms = ?, total_bookmarks = ?, imported_count = ?,
          duplicate_count = ?, live_count = ?, redirected_count = ?, dead_count = ?,
          timeout_count = ?
      WHERE id = ?
    `
    ).run(
      run.finishedAt,
      run.durationMs,
      run.totalBookmarks,
      run.importedCount,
      run.duplicateCount,
      run.liveCount,
      run.redirectedCount,
      run.deadCount,
      run.timeoutCount,
      run.id
    );

    return run;
  }
}
