import { OrganizationRepository } from "../../repositories/organization.repository";
import { type SearchScope, SearchRepository } from "../../repositories/search.repository";

type EmbeddingRow = {
  embedding: number[];
};

type EmbeddingResponse = {
  data: EmbeddingRow[];
};

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const EMBEDDING_MODEL = process.env.SEARCH_EMBEDDING_MODEL ?? "text-embedding-3-small";
const EMBEDDING_BATCH_SIZE = Number(process.env.SEARCH_EMBEDDING_BATCH_SIZE ?? 64);
const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "to",
  "of",
  "for",
  "in",
  "on",
  "with",
  "by",
  "at",
  "from",
  "about",
  "that",
  "this",
  "is",
  "are",
  "be"
]);

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function dot(a: number[], b: number[]): number {
  let sum = 0;
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    sum += (a[index] ?? 0) * (b[index] ?? 0);
  }
  return sum;
}

function magnitude(vector: number[]): number {
  return Math.sqrt(dot(vector, vector));
}

function cosineSimilarity(a: number[], b: number[]): number {
  const denominator = magnitude(a) * magnitude(b);
  if (denominator === 0) return 0;
  return dot(a, b) / denominator;
}

function extractQueryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && !STOP_WORDS.has(item));
}

function keywordSignals(
  query: string,
  bookmark: {
    title: string;
    url: string;
    category: string | null;
    summary: string | null;
    tags: string[];
  }
): { score: number; reasons: string[] } {
  const words = extractQueryTerms(query);
  const phrase = query.trim().toLowerCase();
  const tagsLower = bookmark.tags.map((tag) => tag.toLowerCase());
  const titleLower = bookmark.title.toLowerCase();
  const urlLower = bookmark.url.toLowerCase();
  const categoryLower = (bookmark.category ?? "").toLowerCase();
  const summaryLower = (bookmark.summary ?? "").toLowerCase();
  const reasons = new Set<string>();
  let score = 0;

  if (words.length === 0) return { score: 0, reasons: [] };

  if (phrase.length >= 3) {
    if (titleLower.includes(phrase)) {
      score += 6;
      reasons.add("title includes the full phrase");
    }
    if (summaryLower.includes(phrase)) {
      score += 4;
      reasons.add("summary includes the full phrase");
    }
    if (categoryLower.includes(phrase)) {
      score += 3;
      reasons.add("category includes the full phrase");
    }
    if (tagsLower.some((tag) => tag.includes(phrase))) {
      score += 3;
      reasons.add("tag includes the full phrase");
    }
    if (urlLower.includes(phrase)) {
      score += 1;
      reasons.add("URL includes the full phrase");
    }
  }

  for (const word of words) {
    if (titleLower.includes(word)) {
      score += 2;
      reasons.add(`title includes "${word}"`);
    }
    if (summaryLower.includes(word)) {
      score += 1.5;
      reasons.add(`summary includes "${word}"`);
    }
    if (categoryLower.includes(word)) {
      score += 1.5;
      reasons.add(`category includes "${word}"`);
    }
    if (tagsLower.some((tag) => tag.includes(word))) {
      score += 1.5;
      reasons.add(`tag includes "${word}"`);
    }
    if (urlLower.includes(word)) {
      score += 0.5;
      reasons.add(`URL includes "${word}"`);
    }
  }

  const normalizedScore = Math.min(score / Math.max(words.length * 3, 6), 1);
  return { score: normalizedScore, reasons: [...reasons] };
}

function canonicalUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${host}${path}`;
  } catch {
    return rawUrl.trim().toLowerCase();
  }
}

export class SearchService {
  private readonly organizationRepository = new OrganizationRepository();
  private readonly searchRepository = new SearchRepository();

  async syncEmbeddings(input?: {
    bookmarkIds?: string[];
    force?: boolean;
  }): Promise<{ total: number; generated: number; skipped: number; model: string }> {
    await this.organizationRepository.syncFromTriage();

    const sourceRows = await this.organizationRepository.listBookmarksForEmbeddings(input?.bookmarkIds);
    const existing = await this.searchRepository.getExistingEmbeddings(sourceRows.map((row) => row.bookmarkId));

    const targetRows = sourceRows.filter((row) => {
      if (input?.force) return true;
      const current = existing.get(row.bookmarkId);
      if (!current) return true;
      return current.contentHash !== row.contentHash || current.model !== EMBEDDING_MODEL;
    });

    if (targetRows.length === 0) {
      return {
        total: sourceRows.length,
        generated: 0,
        skipped: sourceRows.length,
        model: EMBEDDING_MODEL
      };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required for embedding generation.");
    }

    const upserts: Array<{ bookmarkId: string; model: string; contentHash: string; vector: number[] }> = [];

    for (const batch of chunk(targetRows, EMBEDDING_BATCH_SIZE)) {
      const vectors = await this.generateEmbeddings(
        batch.map((row) => row.contentForEmbedding),
        apiKey
      );

      for (let index = 0; index < batch.length; index += 1) {
        const row = batch[index];
        const vector = vectors[index];
        if (!row || !vector) continue;
        upserts.push({
          bookmarkId: row.bookmarkId,
          model: EMBEDDING_MODEL,
          contentHash: row.contentHash,
          vector
        });
      }
    }

    await this.searchRepository.upsertEmbeddings(upserts);

    return {
      total: sourceRows.length,
      generated: upserts.length,
      skipped: sourceRows.length - upserts.length,
      model: EMBEDDING_MODEL
    };
  }

  async search(input: {
    query: string;
    scope?: SearchScope;
    limit?: number;
  }): Promise<{
    model: string;
    totalCandidates: number;
    results: Array<{
      bookmarkId: string;
      title: string;
      url: string;
      status: "live" | "redirected" | "dead" | "untested";
      category: string | null;
      tags: string[];
      summary: string | null;
      reviewAction: "keep" | "archive" | "delete" | "unreviewed";
      score: number;
      matchReasons: string[];
    }>;
  }> {
    const query = input.query.trim();
    if (!query) {
      return { model: EMBEDDING_MODEL, totalCandidates: 0, results: [] };
    }

    await this.organizationRepository.syncFromTriage();

    const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
    const fallbackCandidates = await this.searchRepository.listSearchCandidates(input.scope ?? {});
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return this.keywordFallbackSearch(query, fallbackCandidates, limit);
    }

    try {
      await this.syncEmbeddings();

      const [queryVector] = await this.generateEmbeddings([query], apiKey);
      if (!queryVector) {
        return this.keywordFallbackSearch(query, fallbackCandidates, limit);
      }

      const candidates = (await this.searchRepository.listSearchCandidates(input.scope ?? {})).filter(
        (candidate) => candidate.embedding.length > 0
      );
      const ranked = candidates
      .map((candidate) => {
        const semanticScore = Math.max(cosineSimilarity(queryVector, candidate.embedding), 0);
        const keyword = keywordSignals(query, {
          title: candidate.title,
          url: candidate.url,
          category: candidate.category,
          summary: candidate.summary,
          tags: candidate.tags
        });
        const score = Math.min(semanticScore * 0.85 + keyword.score * 0.15, 1);

        return {
          bookmarkId: candidate.bookmarkId,
          title: candidate.title,
          url: candidate.url,
          status: candidate.status,
          category: candidate.category,
          tags: candidate.tags,
          summary: candidate.summary,
          reviewAction: candidate.reviewAction,
          score,
          matchReasons: keyword.reasons
        };
      })
      .sort((a, b) => b.score - a.score);

      const deduped = new Map<string, (typeof ranked)[number]>();
      for (const result of ranked) {
        const key = `${canonicalUrl(result.url)}|${result.title.trim().toLowerCase()}`;
        if (!deduped.has(key)) {
          deduped.set(key, result);
        }
      }

      const limited = [...deduped.values()].slice(0, limit);

      return {
        model: EMBEDDING_MODEL,
        totalCandidates: candidates.length,
        results: limited
      };
    } catch {
      return this.keywordFallbackSearch(query, fallbackCandidates, limit);
    }
  }

  private async generateEmbeddings(texts: string[], apiKey: string): Promise<number[][]> {
    const response = await fetch(OPENAI_EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: texts
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Embedding API failed (${response.status}): ${errorText}`);
    }

    const payload = (await response.json()) as EmbeddingResponse;
    return payload.data.map((item) => item.embedding);
  }

  private keywordFallbackSearch(
    query: string,
    candidates: Awaited<ReturnType<SearchRepository["listSearchCandidates"]>>,
    limit: number
  ) {
    const ranked = candidates
      .map((candidate) => {
        const keyword = keywordSignals(query, {
          title: candidate.title,
          url: candidate.url,
          category: candidate.category,
          summary: candidate.summary,
          tags: candidate.tags
        });

        return {
          bookmarkId: candidate.bookmarkId,
          title: candidate.title,
          url: candidate.url,
          status: candidate.status,
          category: candidate.category,
          tags: candidate.tags,
          summary: candidate.summary,
          reviewAction: candidate.reviewAction,
          score: keyword.score,
          matchReasons: keyword.reasons
        };
      })
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

    const deduped = new Map<string, (typeof ranked)[number]>();
    for (const result of ranked) {
      const key = `${canonicalUrl(result.url)}|${result.title.trim().toLowerCase()}`;
      if (!deduped.has(key)) {
        deduped.set(key, result);
      }
    }

    return {
      model: "keyword-fallback",
      totalCandidates: candidates.length,
      results: [...deduped.values()].slice(0, limit)
    };
  }
}
