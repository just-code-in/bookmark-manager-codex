import { db } from "../db/client";

export type BookmarkForTriage = {
  id: string;
  url: string;
  title: string;
  folderPath: string | null;
  status: "live" | "redirected" | "dead" | null;
  finalUrl: string | null;
  httpStatusCode: number | null;
};

export type CachedTriageRecord = {
  bookmarkId: string;
  sourceHash: string;
  category: string | null;
  tags: string[];
  summary: string | null;
  reasonCode: string | null;
  confidence: number | null;
  sourceType: string;
  categoryModel: string;
  summaryModel: string;
  promptVersion: string;
};

export type TriageRunRow = {
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

export type CategoryCount = {
  category: string;
  count: number;
};

export type UncategorizedReason = {
  bookmarkId: string;
  title: string;
  url: string;
  reasonCode: string;
};

export type UpsertTriageRow = {
  bookmarkId: string;
  triageRunId: string;
  sourceHash: string;
  sourceType: string;
  category: string | null;
  tags: string[];
  summary: string | null;
  reasonCode: string | null;
  confidence: number | null;
  categorizedAt: string;
  categoryModel: string;
  summaryModel: string;
  promptVersion: string;
};

export class TriageRepository {
  async createRun(input: {
    id: string;
    startedAt: string;
    totalBookmarks: number;
    categoryModel: string;
    summaryModel: string;
    promptVersion: string;
  }): Promise<void> {
    db.prepare(
      `
      INSERT INTO triage_runs (
        id, status, started_at, total_bookmarks,
        category_model, summary_model, prompt_version
      ) VALUES (?, 'running', ?, ?, ?, ?, ?)
    `
    ).run(
      input.id,
      input.startedAt,
      input.totalBookmarks,
      input.categoryModel,
      input.summaryModel,
      input.promptVersion
    );
  }

  async updateRunProgress(input: {
    id: string;
    processedCount: number;
    cachedCount: number;
    categorizedCount: number;
    uncategorizedCount: number;
    failedCount: number;
    apiCalls: number;
    promptTokens: number;
    completionTokens: number;
    estimatedCostUsd: number;
  }): Promise<void> {
    db.prepare(
      `
      UPDATE triage_runs
      SET processed_count = ?, cached_count = ?, categorized_count = ?,
          uncategorized_count = ?, failed_count = ?,
          api_calls = ?, prompt_tokens = ?, completion_tokens = ?, estimated_cost_usd = ?
      WHERE id = ?
    `
    ).run(
      input.processedCount,
      input.cachedCount,
      input.categorizedCount,
      input.uncategorizedCount,
      input.failedCount,
      input.apiCalls,
      input.promptTokens,
      input.completionTokens,
      input.estimatedCostUsd,
      input.id
    );
  }

  async completeRun(input: {
    id: string;
    finishedAt: string;
    durationMs: number;
    processedCount: number;
    cachedCount: number;
    categorizedCount: number;
    uncategorizedCount: number;
    failedCount: number;
    apiCalls: number;
    promptTokens: number;
    completionTokens: number;
    estimatedCostUsd: number;
  }): Promise<void> {
    db.prepare(
      `
      UPDATE triage_runs
      SET status = 'completed', finished_at = ?, duration_ms = ?,
          processed_count = ?, cached_count = ?, categorized_count = ?,
          uncategorized_count = ?, failed_count = ?,
          api_calls = ?, prompt_tokens = ?, completion_tokens = ?, estimated_cost_usd = ?
      WHERE id = ?
    `
    ).run(
      input.finishedAt,
      input.durationMs,
      input.processedCount,
      input.cachedCount,
      input.categorizedCount,
      input.uncategorizedCount,
      input.failedCount,
      input.apiCalls,
      input.promptTokens,
      input.completionTokens,
      input.estimatedCostUsd,
      input.id
    );
  }

  async failRun(input: {
    id: string;
    finishedAt: string;
    durationMs: number;
    processedCount: number;
    cachedCount: number;
    categorizedCount: number;
    uncategorizedCount: number;
    failedCount: number;
    apiCalls: number;
    promptTokens: number;
    completionTokens: number;
    estimatedCostUsd: number;
    errorMessage: string;
  }): Promise<void> {
    db.prepare(
      `
      UPDATE triage_runs
      SET status = 'failed', finished_at = ?, duration_ms = ?,
          processed_count = ?, cached_count = ?, categorized_count = ?,
          uncategorized_count = ?, failed_count = ?,
          api_calls = ?, prompt_tokens = ?, completion_tokens = ?, estimated_cost_usd = ?,
          error_message = ?
      WHERE id = ?
    `
    ).run(
      input.finishedAt,
      input.durationMs,
      input.processedCount,
      input.cachedCount,
      input.categorizedCount,
      input.uncategorizedCount,
      input.failedCount,
      input.apiCalls,
      input.promptTokens,
      input.completionTokens,
      input.estimatedCostUsd,
      input.errorMessage,
      input.id
    );
  }

  async upsertBookmarkTriages(rows: UpsertTriageRow[]): Promise<void> {
    if (rows.length === 0) return;

    const upsert = db.prepare(`
      INSERT INTO bookmark_triage (
        bookmark_id, triage_run_id, source_hash, source_type, category,
        tags_json, summary, reason_code, confidence, categorized_at,
        category_model, summary_model, prompt_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(bookmark_id) DO UPDATE SET
        triage_run_id = excluded.triage_run_id,
        source_hash = excluded.source_hash,
        source_type = excluded.source_type,
        category = excluded.category,
        tags_json = excluded.tags_json,
        summary = excluded.summary,
        reason_code = excluded.reason_code,
        confidence = excluded.confidence,
        categorized_at = excluded.categorized_at,
        category_model = excluded.category_model,
        summary_model = excluded.summary_model,
        prompt_version = excluded.prompt_version
    `);

    const transaction = db.transaction(() => {
      for (const row of rows) {
        upsert.run(
          row.bookmarkId,
          row.triageRunId,
          row.sourceHash,
          row.sourceType,
          row.category,
          JSON.stringify(row.tags),
          row.summary,
          row.reasonCode,
          row.confidence,
          row.categorizedAt,
          row.categoryModel,
          row.summaryModel,
          row.promptVersion
        );
      }
    });

    transaction();
  }

  async listBookmarksForTriage(): Promise<BookmarkForTriage[]> {
    return db
      .prepare(
        `
      SELECT id, url, title, folder_path, url_status, final_url, http_status_code
      FROM bookmarks
      ORDER BY created_at ASC
    `
      )
      .all()
      .map((row) => {
        const typed = row as {
          id: string;
          url: string;
          title: string;
          folder_path: string | null;
          url_status: "live" | "redirected" | "dead" | null;
          final_url: string | null;
          http_status_code: number | null;
        };
        return {
          id: typed.id,
          url: typed.url,
          title: typed.title,
          folderPath: typed.folder_path,
          status: typed.url_status,
          finalUrl: typed.final_url,
          httpStatusCode: typed.http_status_code
        };
      });
  }

  async getCachedTriages(): Promise<Map<string, CachedTriageRecord>> {
    const rows = db.prepare(
      `
      SELECT
        bookmark_id,
        source_hash,
        category,
        tags_json,
        summary,
        reason_code,
        confidence,
        source_type,
        category_model,
        summary_model,
        prompt_version
      FROM bookmark_triage
    `
    ).all() as Array<{
      bookmark_id: string;
      source_hash: string;
      category: string | null;
      tags_json: string;
      summary: string | null;
      reason_code: string | null;
      confidence: number | null;
      source_type: string;
      category_model: string;
      summary_model: string;
      prompt_version: string;
    }>;

    const map = new Map<string, CachedTriageRecord>();

    for (const row of rows) {
      let tags: string[] = [];
      try {
        const parsed = JSON.parse(row.tags_json) as unknown;
        if (Array.isArray(parsed)) {
          tags = parsed.filter((tag): tag is string => typeof tag === "string");
        }
      } catch {
        tags = [];
      }

      map.set(row.bookmark_id, {
        bookmarkId: row.bookmark_id,
        sourceHash: row.source_hash,
        category: row.category,
        tags,
        summary: row.summary,
        reasonCode: row.reason_code,
        confidence: row.confidence,
        sourceType: row.source_type,
        categoryModel: row.category_model,
        summaryModel: row.summary_model,
        promptVersion: row.prompt_version
      });
    }

    return map;
  }

  async getRunById(id: string): Promise<TriageRunRow | null> {
    const row = db
      .prepare(
        `
      SELECT
        id, status, started_at, finished_at, duration_ms, total_bookmarks,
        processed_count, cached_count, categorized_count, uncategorized_count,
        failed_count, category_model, summary_model, prompt_version,
        api_calls, prompt_tokens, completion_tokens, estimated_cost_usd, error_message
      FROM triage_runs
      WHERE id = ?
    `
      )
      .get(id) as
      | {
          id: string;
          status: "running" | "completed" | "failed";
          started_at: string;
          finished_at: string | null;
          duration_ms: number;
          total_bookmarks: number;
          processed_count: number;
          cached_count: number;
          categorized_count: number;
          uncategorized_count: number;
          failed_count: number;
          category_model: string;
          summary_model: string;
          prompt_version: string;
          api_calls: number;
          prompt_tokens: number;
          completion_tokens: number;
          estimated_cost_usd: number;
          error_message: string | null;
        }
      | undefined;

    if (!row) return null;

    return {
      id: row.id,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      durationMs: row.duration_ms,
      totalBookmarks: row.total_bookmarks,
      processedCount: row.processed_count,
      cachedCount: row.cached_count,
      categorizedCount: row.categorized_count,
      uncategorizedCount: row.uncategorized_count,
      failedCount: row.failed_count,
      categoryModel: row.category_model,
      summaryModel: row.summary_model,
      promptVersion: row.prompt_version,
      apiCalls: row.api_calls,
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
      estimatedCostUsd: row.estimated_cost_usd,
      errorMessage: row.error_message
    };
  }

  async getLatestRun(): Promise<TriageRunRow | null> {
    const row = db
      .prepare(
        `
      SELECT id
      FROM triage_runs
      ORDER BY started_at DESC
      LIMIT 1
    `
      )
      .get() as { id: string } | undefined;

    if (!row) return null;
    return this.getRunById(row.id);
  }

  async listCategoryCounts(runId: string): Promise<CategoryCount[]> {
    return db
      .prepare(
        `
      SELECT category, COUNT(*) AS count
      FROM bookmark_triage
      WHERE triage_run_id = ?
        AND category IS NOT NULL
        AND category != ''
      GROUP BY category
      ORDER BY count DESC, category ASC
    `
      )
      .all(runId)
      .map((row) => {
        const typed = row as { category: string; count: number };
        return { category: typed.category, count: typed.count };
      });
  }

  async listUncategorized(runId: string, limit = 100): Promise<UncategorizedReason[]> {
    return db
      .prepare(
        `
      SELECT b.id, b.title, b.url, bt.reason_code
      FROM bookmark_triage bt
      JOIN bookmarks b ON b.id = bt.bookmark_id
      WHERE bt.triage_run_id = ?
        AND (bt.category IS NULL OR bt.category = '')
      ORDER BY b.updated_at DESC
      LIMIT ?
    `
      )
      .all(runId, limit)
      .map((row) => {
        const typed = row as {
          id: string;
          title: string;
          url: string;
          reason_code: string | null;
        };
        return {
          bookmarkId: typed.id,
          title: typed.title,
          url: typed.url,
          reasonCode: typed.reason_code ?? "unknown"
        };
      });
  }
}
