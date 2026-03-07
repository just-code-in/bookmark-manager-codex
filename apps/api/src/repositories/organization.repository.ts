import { createHash } from "node:crypto";

import { db } from "../db/client";

type BookmarkStatus = "live" | "redirected" | "dead" | "untested";
export type ReviewAction = "keep" | "archive" | "delete" | "unreviewed";

export type OrganizationBookmark = {
  id: string;
  title: string;
  url: string;
  folderPath: string | null;
  dateAdded: string | null;
  status: BookmarkStatus;
  httpStatusCode: number | null;
  checkedAt: string | null;
  category: string | null;
  tags: string[];
  summary: string | null;
  reviewAction: ReviewAction;
  updatedAt: string;
};

export type OrganizationBookmarkFilters = {
  category?: string;
  tag?: string;
  status?: "all" | BookmarkStatus;
  reviewAction?: "all" | ReviewAction;
  uncategorizedOnly?: boolean;
  sortBy?: "date_added" | "title" | "category";
  sortDirection?: "asc" | "desc";
};

export type OrganizationStats = {
  totalBookmarks: number;
  uncategorizedCount: number;
  reviewedCount: number;
  reviewPct: number;
  byCategory: Array<{ category: string; count: number }>;
  byStatus: Array<{ status: BookmarkStatus; count: number }>;
  byReviewAction: Array<{ action: ReviewAction; count: number }>;
};

export type EmbeddingSourceBookmark = {
  bookmarkId: string;
  title: string;
  url: string;
  status: BookmarkStatus;
  category: string | null;
  tags: string[];
  summary: string | null;
  reviewAction: ReviewAction;
  contentHash: string;
  contentForEmbedding: string;
};

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function toBookmarkStatus(status: "live" | "redirected" | "dead" | null): BookmarkStatus {
  if (status === null) return "untested";
  return status;
}

function hashEmbeddingContent(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function buildEmbeddingContent(input: {
  title: string;
  category: string | null;
  tags: string[];
  summary: string | null;
}): string {
  return [
    `Title: ${input.title}`,
    `Category: ${input.category ?? "Uncategorized"}`,
    `Tags: ${input.tags.join(", ")}`,
    `Summary: ${input.summary ?? ""}`
  ]
    .join("\n")
    .trim();
}

export class OrganizationRepository {
  async syncFromTriage(bookmarkIds?: string[], force = false): Promise<void> {
    const now = new Date().toISOString();

    const where: string[] = [];
    const params: unknown[] = [now];
    if (bookmarkIds && bookmarkIds.length > 0) {
      const uniqueIds = [...new Set(bookmarkIds)];
      where.push(`b.id IN (${uniqueIds.map(() => "?").join(", ")})`);
      params.push(...uniqueIds);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    if (!force) {
      db.prepare(
        `
        INSERT INTO bookmark_organization (bookmark_id, category, tags_json, summary, review_action, updated_at)
        SELECT
          b.id,
          bt.category,
          COALESCE(bt.tags_json, '[]'),
          bt.summary,
          'unreviewed',
          ?
        FROM bookmarks b
        LEFT JOIN bookmark_triage bt ON bt.bookmark_id = b.id
        LEFT JOIN bookmark_organization bo ON bo.bookmark_id = b.id
        ${whereClause}${whereClause ? " AND" : " WHERE"} bo.bookmark_id IS NULL
      `
      ).run(...params);
      return;
    }

    db.prepare(
      `
      INSERT INTO bookmark_organization (bookmark_id, category, tags_json, summary, review_action, updated_at)
      SELECT
        b.id,
        bt.category,
        COALESCE(bt.tags_json, '[]'),
        bt.summary,
        'unreviewed',
        ?
      FROM bookmarks b
      LEFT JOIN bookmark_triage bt ON bt.bookmark_id = b.id
      ${whereClause}
      ON CONFLICT(bookmark_id) DO UPDATE SET
        category = excluded.category,
        tags_json = excluded.tags_json,
        summary = excluded.summary,
        updated_at = excluded.updated_at
    `
    ).run(...params);
  }

  async listCategories(): Promise<Array<{ category: string; count: number }>> {
    return db
      .prepare(
        `
      SELECT category, COUNT(*) AS count
      FROM bookmark_organization
      WHERE category IS NOT NULL AND TRIM(category) != ''
      GROUP BY category
      ORDER BY count DESC, category ASC
    `
      )
      .all()
      .map((row) => {
        const typed = row as { category: string; count: number };
        return { category: typed.category, count: typed.count };
      });
  }

  async listBookmarks(filters: OrganizationBookmarkFilters): Promise<OrganizationBookmark[]> {
    const where: string[] = [];
    const params: unknown[] = [];

    if (filters.category) {
      where.push("bo.category = ?");
      params.push(filters.category);
    }

    if (filters.tag) {
      where.push("LOWER(bo.tags_json) LIKE ?");
      params.push(`%${filters.tag.toLowerCase()}%`);
    }

    if (filters.status && filters.status !== "all") {
      if (filters.status === "untested") {
        where.push("b.url_status IS NULL");
      } else {
        where.push("b.url_status = ?");
        params.push(filters.status);
      }
    }

    if (filters.reviewAction && filters.reviewAction !== "all") {
      where.push("bo.review_action = ?");
      params.push(filters.reviewAction);
    }

    if (filters.uncategorizedOnly) {
      where.push("(bo.category IS NULL OR TRIM(bo.category) = '')");
    }

    const orderBy =
      filters.sortBy === "title"
        ? "b.title"
        : filters.sortBy === "category"
          ? "COALESCE(bo.category, '')"
          : "COALESCE(b.date_added, b.created_at)";
    const direction = filters.sortDirection === "asc" ? "ASC" : "DESC";
    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    return db
      .prepare(
        `
      SELECT
        b.id,
        b.title,
        b.url,
        b.folder_path,
        b.date_added,
        b.url_status,
        b.http_status_code,
        b.checked_at,
        bo.category,
        bo.tags_json,
        bo.summary,
        bo.review_action,
        bo.updated_at
      FROM bookmarks b
      JOIN bookmark_organization bo ON bo.bookmark_id = b.id
      ${whereClause}
      ORDER BY ${orderBy} ${direction}, b.title ASC
    `
      )
      .all(...params)
      .map((row) => {
        const typed = row as {
          id: string;
          title: string;
          url: string;
          folder_path: string | null;
          date_added: string | null;
          url_status: "live" | "redirected" | "dead" | null;
          http_status_code: number | null;
          checked_at: string | null;
          category: string | null;
          tags_json: string;
          summary: string | null;
          review_action: ReviewAction;
          updated_at: string;
        };

        return {
          id: typed.id,
          title: typed.title,
          url: typed.url,
          folderPath: typed.folder_path,
          dateAdded: typed.date_added,
          status: toBookmarkStatus(typed.url_status),
          httpStatusCode: typed.http_status_code,
          checkedAt: typed.checked_at,
          category: typed.category,
          tags: parseTags(typed.tags_json),
          summary: typed.summary,
          reviewAction: typed.review_action,
          updatedAt: typed.updated_at
        };
      });
  }

  async getStats(): Promise<OrganizationStats> {
    const totalBookmarks =
      (db.prepare("SELECT COUNT(*) AS count FROM bookmark_organization").get() as { count: number } | undefined)
        ?.count ?? 0;

    const uncategorizedCount =
      (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM bookmark_organization WHERE category IS NULL OR TRIM(category) = ''"
          )
          .get() as { count: number } | undefined
      )?.count ?? 0;

    const reviewedCount =
      (
        db
          .prepare("SELECT COUNT(*) AS count FROM bookmark_organization WHERE review_action != 'unreviewed'")
          .get() as { count: number } | undefined
      )?.count ?? 0;

    const reviewPct = totalBookmarks === 0 ? 0 : Number(((reviewedCount / totalBookmarks) * 100).toFixed(1));

    const byCategory = db
      .prepare(
        `
      SELECT COALESCE(NULLIF(TRIM(category), ''), 'Uncategorized') AS category, COUNT(*) AS count
      FROM bookmark_organization
      GROUP BY COALESCE(NULLIF(TRIM(category), ''), 'Uncategorized')
      ORDER BY count DESC, category ASC
    `
      )
      .all()
      .map((row) => {
        const typed = row as { category: string; count: number };
        return { category: typed.category, count: typed.count };
      });

    const byStatus = db
      .prepare(
        `
      SELECT COALESCE(b.url_status, 'untested') AS status, COUNT(*) AS count
      FROM bookmark_organization bo
      JOIN bookmarks b ON b.id = bo.bookmark_id
      GROUP BY COALESCE(b.url_status, 'untested')
      ORDER BY count DESC
    `
      )
      .all()
      .map((row) => {
        const typed = row as {
          status: "live" | "redirected" | "dead" | "untested";
          count: number;
        };
        return { status: typed.status, count: typed.count };
      });

    const byReviewAction = db
      .prepare(
        `
      SELECT review_action AS action, COUNT(*) AS count
      FROM bookmark_organization
      GROUP BY review_action
      ORDER BY count DESC
    `
      )
      .all()
      .map((row) => {
        const typed = row as { action: ReviewAction; count: number };
        return { action: typed.action, count: typed.count };
      });

    return {
      totalBookmarks,
      uncategorizedCount,
      reviewedCount,
      reviewPct,
      byCategory,
      byStatus,
      byReviewAction
    };
  }

  async updateBookmark(input: {
    bookmarkId: string;
    category?: string | null;
    tags?: string[];
    summary?: string | null;
    reviewAction?: ReviewAction;
  }): Promise<void> {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (input.category !== undefined) {
      updates.push("category = ?");
      params.push(input.category && input.category.trim().length > 0 ? input.category.trim() : null);
    }

    if (input.tags !== undefined) {
      updates.push("tags_json = ?");
      params.push(JSON.stringify(input.tags));
    }

    if (input.summary !== undefined) {
      updates.push("summary = ?");
      params.push(input.summary && input.summary.trim().length > 0 ? input.summary.trim() : null);
    }

    if (input.reviewAction !== undefined) {
      updates.push("review_action = ?");
      params.push(input.reviewAction);
    }

    if (updates.length === 0) return;

    updates.push("updated_at = ?");
    params.push(new Date().toISOString(), input.bookmarkId);

    db.prepare(`UPDATE bookmark_organization SET ${updates.join(", ")} WHERE bookmark_id = ?`).run(...params);
  }

  async applyBulkAction(input: {
    bookmarkIds: string[];
    reviewAction?: ReviewAction;
    category?: string | null;
    addTag?: string;
  }): Promise<void> {
    if (input.bookmarkIds.length === 0) return;

    const ids = [...new Set(input.bookmarkIds)];
    const placeholders = ids.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `
      SELECT bookmark_id, tags_json
      FROM bookmark_organization
      WHERE bookmark_id IN (${placeholders})
    `
      )
      .all(...ids) as Array<{ bookmark_id: string; tags_json: string }>;

    const tagToAdd = input.addTag?.trim();
    const now = new Date().toISOString();
    const update = db.prepare(
      `
      UPDATE bookmark_organization
      SET category = ?, tags_json = ?, review_action = ?, updated_at = ?
      WHERE bookmark_id = ?
    `
    );

    const transaction = db.transaction(() => {
      for (const row of rows) {
        const existingTags = parseTags(row.tags_json);
        const nextTags =
          tagToAdd && !existingTags.includes(tagToAdd) ? [...existingTags, tagToAdd] : existingTags;

        const existing = db
          .prepare(
            `
          SELECT category, review_action
          FROM bookmark_organization
          WHERE bookmark_id = ?
        `
          )
          .get(row.bookmark_id) as { category: string | null; review_action: ReviewAction } | undefined;

        if (!existing) continue;

        update.run(
          input.category !== undefined
            ? input.category && input.category.trim().length > 0
              ? input.category.trim()
              : null
            : existing.category,
          JSON.stringify(nextTags),
          input.reviewAction ?? existing.review_action,
          now,
          row.bookmark_id
        );
      }
    });

    transaction();
  }

  async renameCategory(fromCategory: string, toCategory: string): Promise<void> {
    const from = fromCategory.trim();
    const to = toCategory.trim();
    if (!from || !to) return;

    db.prepare(
      `
      UPDATE bookmark_organization
      SET category = ?, updated_at = ?
      WHERE category = ?
    `
    ).run(to, new Date().toISOString(), from);
  }

  async mergeCategories(sourceCategories: string[], targetCategory: string): Promise<void> {
    const sources = sourceCategories.map((item) => item.trim()).filter(Boolean);
    if (sources.length === 0) return;

    const placeholders = sources.map(() => "?").join(", ");
    db.prepare(
      `
      UPDATE bookmark_organization
      SET category = ?, updated_at = ?
      WHERE category IN (${placeholders})
    `
    ).run(targetCategory.trim(), new Date().toISOString(), ...sources);
  }

  async deleteCategory(category: string): Promise<void> {
    db.prepare(
      `
      UPDATE bookmark_organization
      SET category = NULL, updated_at = ?
      WHERE category = ?
    `
    ).run(new Date().toISOString(), category.trim());
  }

  async listBookmarksForEmbeddings(bookmarkIds?: string[]): Promise<EmbeddingSourceBookmark[]> {
    const where: string[] = [];
    const params: unknown[] = [];

    if (bookmarkIds && bookmarkIds.length > 0) {
      const uniqueIds = [...new Set(bookmarkIds)];
      where.push(`b.id IN (${uniqueIds.map(() => "?").join(", ")})`);
      params.push(...uniqueIds);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    return db
      .prepare(
        `
      SELECT
        b.id,
        b.title,
        b.url,
        b.url_status,
        bo.category,
        bo.tags_json,
        bo.summary,
        bo.review_action
      FROM bookmarks b
      JOIN bookmark_organization bo ON bo.bookmark_id = b.id
      ${whereClause}
      ORDER BY b.created_at ASC
    `
      )
      .all(...params)
      .map((row) => {
        const typed = row as {
          id: string;
          title: string;
          url: string;
          url_status: "live" | "redirected" | "dead" | null;
          category: string | null;
          tags_json: string;
          summary: string | null;
          review_action: ReviewAction;
        };

        const tags = parseTags(typed.tags_json);
        const contentForEmbedding = buildEmbeddingContent({
          title: typed.title,
          category: typed.category,
          tags,
          summary: typed.summary
        });

        return {
          bookmarkId: typed.id,
          title: typed.title,
          url: typed.url,
          status: toBookmarkStatus(typed.url_status),
          category: typed.category,
          tags,
          summary: typed.summary,
          reviewAction: typed.review_action,
          contentHash: hashEmbeddingContent(contentForEmbedding),
          contentForEmbedding
        };
      });
  }
}
