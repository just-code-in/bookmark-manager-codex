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

export type BookmarkListItem = {
  id: string;
  url: string;
  title: string;
  folderPath: string | null;
  status: "live" | "redirected" | "dead" | "untested";
  httpStatusCode: number | null;
  checkedAt: string | null;
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

export type ImportRunSummary = {
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

  async listImportRuns(limit = 20): Promise<ImportRunSummary[]> {
    const rows = db
      .prepare(
        `
        SELECT
          id,
          source,
          file_name,
          started_at,
          finished_at,
          total_bookmarks,
          imported_count,
          duplicate_count,
          live_count,
          redirected_count,
          dead_count,
          timeout_count,
          duration_ms
        FROM imports
        ORDER BY started_at DESC
        LIMIT ?
      `
      )
      .all(limit) as Array<{
      id: string;
      source: "chrome" | "safari" | "unknown";
      file_name: string;
      started_at: string;
      finished_at: string | null;
      total_bookmarks: number;
      imported_count: number;
      duplicate_count: number;
      live_count: number;
      redirected_count: number;
      dead_count: number;
      timeout_count: number;
      duration_ms: number;
    }>;

    return rows.map((row) => ({
      importId: row.id,
      source: row.source,
      fileName: row.file_name,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      total: row.total_bookmarks,
      imported: row.imported_count,
      duplicates: row.duplicate_count,
      live: row.live_count,
      redirected: row.redirected_count,
      dead: row.dead_count,
      timedOut: row.timeout_count,
      durationMs: row.duration_ms
    }));
  }

  async listBookmarks(status: "all" | "live" | "dead" = "all"): Promise<BookmarkListItem[]> {
    const statusClause =
      status === "all"
        ? ""
        : "WHERE (url_status = ?)";
    const query = `
      SELECT id, url, title, folder_path, url_status, http_status_code, checked_at
      FROM bookmarks
      ${statusClause}
      ORDER BY updated_at DESC
    `;

    const rows =
      status === "all"
        ? (db.prepare(query).all() as Array<{
            id: string;
            url: string;
            title: string;
            folder_path: string | null;
            url_status: "live" | "redirected" | "dead" | null;
            http_status_code: number | null;
            checked_at: string | null;
          }>)
        : (db.prepare(query).all(status) as Array<{
            id: string;
            url: string;
            title: string;
            folder_path: string | null;
            url_status: "live" | "redirected" | "dead" | null;
            http_status_code: number | null;
            checked_at: string | null;
          }>);

    return rows.map((row) => ({
      id: row.id,
      url: row.url,
      title: row.title,
      folderPath: row.folder_path,
      status: row.url_status ?? "untested",
      httpStatusCode: row.http_status_code,
      checkedAt: row.checked_at
    }));
  }
}
