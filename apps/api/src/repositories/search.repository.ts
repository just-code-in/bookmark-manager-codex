import { db } from "../db/client";
import type { ReviewAction } from "./organization.repository";

type BookmarkStatus = "live" | "redirected" | "dead" | "untested";

export type SearchScope = {
  category?: string;
  tag?: string;
  status?: "all" | BookmarkStatus;
  reviewAction?: "all" | ReviewAction;
};

export type SearchCandidate = {
  bookmarkId: string;
  title: string;
  url: string;
  status: BookmarkStatus;
  category: string | null;
  tags: string[];
  summary: string | null;
  reviewAction: ReviewAction;
  embeddingModel: string;
  embedding: number[];
};

type UpsertEmbeddingInput = {
  bookmarkId: string;
  model: string;
  contentHash: string;
  vector: number[];
};

type ExistingEmbedding = {
  bookmarkId: string;
  contentHash: string;
  model: string;
};

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function parseVector(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is number => typeof item === "number");
  } catch {
    return [];
  }
}

function toStatus(raw: "live" | "redirected" | "dead" | null): BookmarkStatus {
  if (!raw) return "untested";
  return raw;
}

export class SearchRepository {
  async getExistingEmbeddings(bookmarkIds: string[]): Promise<Map<string, ExistingEmbedding>> {
    if (bookmarkIds.length === 0) return new Map();

    const uniqueIds = [...new Set(bookmarkIds)];
    const rows = db
      .prepare(
        `
      SELECT bookmark_id, content_hash, model
      FROM bookmark_embeddings
      WHERE bookmark_id IN (${uniqueIds.map(() => "?").join(", ")})
    `
      )
      .all(...uniqueIds) as Array<{
      bookmark_id: string;
      content_hash: string;
      model: string;
    }>;

    const map = new Map<string, ExistingEmbedding>();
    for (const row of rows) {
      map.set(row.bookmark_id, {
        bookmarkId: row.bookmark_id,
        contentHash: row.content_hash,
        model: row.model
      });
    }
    return map;
  }

  async upsertEmbeddings(rows: UpsertEmbeddingInput[]): Promise<void> {
    if (rows.length === 0) return;

    const now = new Date().toISOString();
    const stmt = db.prepare(
      `
      INSERT INTO bookmark_embeddings (bookmark_id, model, content_hash, vector_json, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(bookmark_id) DO UPDATE SET
        model = excluded.model,
        content_hash = excluded.content_hash,
        vector_json = excluded.vector_json,
        updated_at = excluded.updated_at
    `
    );

    const transaction = db.transaction(() => {
      for (const row of rows) {
        stmt.run(row.bookmarkId, row.model, row.contentHash, JSON.stringify(row.vector), now);
      }
    });

    transaction();
  }

  async listSearchCandidates(scope: SearchScope): Promise<SearchCandidate[]> {
    const where: string[] = [];
    const params: unknown[] = [];

    if (scope.category) {
      where.push("bo.category = ?");
      params.push(scope.category);
    }

    if (scope.tag) {
      where.push("LOWER(bo.tags_json) LIKE ?");
      params.push(`%${scope.tag.toLowerCase()}%`);
    }

    if (scope.status && scope.status !== "all") {
      if (scope.status === "untested") {
        where.push("b.url_status IS NULL");
      } else {
        where.push("b.url_status = ?");
        params.push(scope.status);
      }
    }

    if (scope.reviewAction && scope.reviewAction !== "all") {
      where.push("bo.review_action = ?");
      params.push(scope.reviewAction);
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
        bo.review_action,
        be.model,
        be.vector_json
      FROM bookmarks b
      JOIN bookmark_organization bo ON bo.bookmark_id = b.id
      JOIN bookmark_embeddings be ON be.bookmark_id = b.id
      ${whereClause}
      ORDER BY b.title ASC
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
          model: string;
          vector_json: string;
        };

        return {
          bookmarkId: typed.id,
          title: typed.title,
          url: typed.url,
          status: toStatus(typed.url_status),
          category: typed.category,
          tags: parseTags(typed.tags_json),
          summary: typed.summary,
          reviewAction: typed.review_action,
          embeddingModel: typed.model,
          embedding: parseVector(typed.vector_json)
        };
      })
      .filter((row) => row.embedding.length > 0);
  }
}
