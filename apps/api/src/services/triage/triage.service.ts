import { createHash, randomUUID } from "node:crypto";

import {
  type BookmarkForTriage,
  type CategoryCount,
  type UncategorizedReason,
  TriageRepository
} from "../../repositories/triage.repository";

type Stage =
  | "idle"
  | "preparing"
  | "discovering_categories"
  | "categorizing"
  | "summarizing"
  | "finalizing"
  | "completed"
  | "failed";

type RunStatus = "running" | "completed" | "failed";

type StartRunInput = {
  ignoreCache?: boolean;
};

type CollectionSummary = {
  topDomains: Array<{ domain: string; count: number }>;
  topFolders: Array<{ folder: string; count: number }>;
  sampleTitles: string[];
};

type PreparedBookmark = {
  id: string;
  url: string;
  title: string;
  folderPath: string | null;
  status: "live" | "redirected" | "dead" | null;
  finalUrl: string | null;
  httpStatusCode: number | null;
  sourceType: "live" | "redirected" | "dead" | "unsupported";
  targetUrl: string;
  excerpt: string;
  sourceHash: string;
};

type CategoryResult = {
  id: string;
  category: string | null;
  tags: string[];
  confidence: number | null;
  reasonCode: string | null;
};

type SummaryResult = {
  id: string;
  summary: string;
};

type OpenAiUsage = {
  promptTokens: number;
  completionTokens: number;
};

type OpenAiJsonResponse<T> = {
  data: T;
  usage: OpenAiUsage;
};

type RuntimeStatus = {
  runId: string;
  status: RunStatus;
  stage: Stage;
  startedAt: string;
  finishedAt: string | null;
  totalBookmarks: number;
  processedCount: number;
  cachedCount: number;
  categorizedCount: number;
  uncategorizedCount: number;
  failedCount: number;
  apiCalls: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  lastError: string | null;
};

type RunResultSummary = {
  run: {
    id: string;
    status: RunStatus;
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
  categories: CategoryCount[];
  uncategorized: UncategorizedReason[];
};

type ModelPrice = {
  inputUsdPer1m: number;
  outputUsdPer1m: number;
};

const PROMPT_VERSION = "triage-v1";
const CATEGORY_MODEL = process.env.TRIAGE_CATEGORY_MODEL ?? "gpt-4.1-nano";
const SUMMARY_MODEL = process.env.TRIAGE_SUMMARY_MODEL ?? "gpt-4.1-mini";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

const MODEL_PRICES: Record<string, ModelPrice> = {
  "gpt-4.1-nano": { inputUsdPer1m: 0.1, outputUsdPer1m: 0.4 },
  "gpt-4.1-mini": { inputUsdPer1m: 0.4, outputUsdPer1m: 1.6 }
};

const CATEGORY_BATCH_SIZE = 24;
const SUMMARY_BATCH_SIZE = 16;

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function extractDomain(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return "invalid-url";
  }
}

function stripHtml(rawHtml: string): string {
  const noScripts = rawHtml
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const withoutTags = noScripts
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"');

  return normalizeWhitespace(withoutTags);
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) continue;
      await worker(next);
    }
  });
  await Promise.all(runners);
}

export class TriageService {
  private readonly repository = new TriageRepository();
  private activeStatus: RuntimeStatus | null = null;

  async startRun(input: StartRunInput): Promise<{ runId: string; alreadyRunning: boolean }> {
    if (this.activeStatus?.status === "running") {
      return { runId: this.activeStatus.runId, alreadyRunning: true };
    }

    const bookmarks = await this.repository.listBookmarksForTriage();
    const runId = randomUUID();
    const startedAt = new Date().toISOString();

    await this.repository.createRun({
      id: runId,
      startedAt,
      totalBookmarks: bookmarks.length,
      categoryModel: CATEGORY_MODEL,
      summaryModel: SUMMARY_MODEL,
      promptVersion: PROMPT_VERSION
    });

    this.activeStatus = {
      runId,
      status: "running",
      stage: "preparing",
      startedAt,
      finishedAt: null,
      totalBookmarks: bookmarks.length,
      processedCount: 0,
      cachedCount: 0,
      categorizedCount: 0,
      uncategorizedCount: 0,
      failedCount: 0,
      apiCalls: 0,
      promptTokens: 0,
      completionTokens: 0,
      estimatedCostUsd: 0,
      lastError: null
    };

    void this.executeRun(runId, bookmarks, input);

    return { runId, alreadyRunning: false };
  }

  async getRuntimeStatus(): Promise<RuntimeStatus | null> {
    if (this.activeStatus) return this.activeStatus;
    const latest = await this.repository.getLatestRun();
    if (!latest) return null;

    return {
      runId: latest.id,
      status: latest.status,
      stage: latest.status === "completed" ? "completed" : latest.status === "failed" ? "failed" : "idle",
      startedAt: latest.startedAt,
      finishedAt: latest.finishedAt,
      totalBookmarks: latest.totalBookmarks,
      processedCount: latest.processedCount,
      cachedCount: latest.cachedCount,
      categorizedCount: latest.categorizedCount,
      uncategorizedCount: latest.uncategorizedCount,
      failedCount: latest.failedCount,
      apiCalls: latest.apiCalls,
      promptTokens: latest.promptTokens,
      completionTokens: latest.completionTokens,
      estimatedCostUsd: latest.estimatedCostUsd,
      lastError: latest.errorMessage
    };
  }

  async getLatestSummary(): Promise<RunResultSummary | null> {
    const latest = await this.repository.getLatestRun();
    if (!latest) return null;

    const categories = await this.repository.listCategoryCounts(latest.id);
    const uncategorized = await this.repository.listUncategorized(latest.id, 100);

    return {
      run: latest,
      categories,
      uncategorized
    };
  }

  private async executeRun(
    runId: string,
    bookmarks: BookmarkForTriage[],
    input: StartRunInput
  ): Promise<void> {
    const startedAtMs = Date.now();

    try {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error("OPENAI_API_KEY is not set. Add it to your environment before running triage.");
      }

      const cache = await this.repository.getCachedTriages();
      const prepared = await this.prepareBookmarks(bookmarks);
      const now = new Date().toISOString();

      const cacheRows: Array<{
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
      }> = [];
      const toProcess: PreparedBookmark[] = [];

      for (const bookmark of prepared) {
        const cached = cache.get(bookmark.id);
        const cacheValid =
          !input.ignoreCache &&
          cached &&
          cached.sourceHash === bookmark.sourceHash &&
          cached.categoryModel === CATEGORY_MODEL &&
          cached.summaryModel === SUMMARY_MODEL &&
          cached.promptVersion === PROMPT_VERSION;

        if (cacheValid && cached) {
          cacheRows.push({
            bookmarkId: bookmark.id,
            triageRunId: runId,
            sourceHash: bookmark.sourceHash,
            sourceType: bookmark.sourceType,
            category: cached.category,
            tags: cached.tags,
            summary: cached.summary,
            reasonCode: cached.reasonCode,
            confidence: cached.confidence,
            categorizedAt: now,
            categoryModel: CATEGORY_MODEL,
            summaryModel: SUMMARY_MODEL,
            promptVersion: PROMPT_VERSION
          });

          this.bumpCounts({
            processed: 1,
            cached: 1,
            categorized: cached.category ? 1 : 0,
            uncategorized: cached.category ? 0 : 1
          });
        } else {
          toProcess.push(bookmark);
        }
      }

      await this.repository.upsertBookmarkTriages(cacheRows);
      await this.persistProgress(runId);

      this.setStage("discovering_categories");
      const collectionSummary = this.buildCollectionSummary(bookmarks);
      const categories = await this.discoverCategories(apiKey, collectionSummary);

      this.setStage("categorizing");
      const categoryAssignments = await this.runCategorization(apiKey, categories, toProcess);

      this.setStage("summarizing");
      const summaries = await this.runSummaries(apiKey, toProcess, categoryAssignments);

      const completedAt = new Date().toISOString();
      const rows = toProcess.map((bookmark) => {
        const assignment = categoryAssignments.get(bookmark.id);
        const summary = summaries.get(bookmark.id) ?? this.localFallbackSummary(bookmark);

        return {
          bookmarkId: bookmark.id,
          triageRunId: runId,
          sourceHash: bookmark.sourceHash,
          sourceType: bookmark.sourceType,
          category: assignment?.category ?? null,
          tags: assignment?.tags ?? [],
          summary,
          reasonCode: assignment?.reasonCode ?? null,
          confidence: assignment?.confidence ?? null,
          categorizedAt: completedAt,
          categoryModel: CATEGORY_MODEL,
          summaryModel: SUMMARY_MODEL,
          promptVersion: PROMPT_VERSION
        };
      });

      await this.repository.upsertBookmarkTriages(rows);
      await this.persistProgress(runId);

      this.setStage("finalizing");
      const finishedAt = new Date().toISOString();
      const durationMs = Date.now() - startedAtMs;

      await this.repository.completeRun({
        id: runId,
        finishedAt,
        durationMs,
        processedCount: this.activeStatus?.processedCount ?? 0,
        cachedCount: this.activeStatus?.cachedCount ?? 0,
        categorizedCount: this.activeStatus?.categorizedCount ?? 0,
        uncategorizedCount: this.activeStatus?.uncategorizedCount ?? 0,
        failedCount: this.activeStatus?.failedCount ?? 0,
        apiCalls: this.activeStatus?.apiCalls ?? 0,
        promptTokens: this.activeStatus?.promptTokens ?? 0,
        completionTokens: this.activeStatus?.completionTokens ?? 0,
        estimatedCostUsd: this.activeStatus?.estimatedCostUsd ?? 0
      });

      if (this.activeStatus) {
        this.activeStatus.status = "completed";
        this.activeStatus.stage = "completed";
        this.activeStatus.finishedAt = finishedAt;
      }
    } catch (error) {
      const finishedAt = new Date().toISOString();
      const durationMs = Date.now() - startedAtMs;
      const message = error instanceof Error ? error.message : "Unexpected triage error";

      await this.repository.failRun({
        id: runId,
        finishedAt,
        durationMs,
        processedCount: this.activeStatus?.processedCount ?? 0,
        cachedCount: this.activeStatus?.cachedCount ?? 0,
        categorizedCount: this.activeStatus?.categorizedCount ?? 0,
        uncategorizedCount: this.activeStatus?.uncategorizedCount ?? 0,
        failedCount: (this.activeStatus?.failedCount ?? 0) + 1,
        apiCalls: this.activeStatus?.apiCalls ?? 0,
        promptTokens: this.activeStatus?.promptTokens ?? 0,
        completionTokens: this.activeStatus?.completionTokens ?? 0,
        estimatedCostUsd: this.activeStatus?.estimatedCostUsd ?? 0,
        errorMessage: message
      });

      if (this.activeStatus) {
        this.activeStatus.status = "failed";
        this.activeStatus.stage = "failed";
        this.activeStatus.finishedAt = finishedAt;
        this.activeStatus.failedCount += 1;
        this.activeStatus.lastError = message;
      }
    }
  }

  private async prepareBookmarks(bookmarks: BookmarkForTriage[]): Promise<PreparedBookmark[]> {
    this.setStage("preparing");
    const prepared: PreparedBookmark[] = [];

    await runWithConcurrency(bookmarks, 6, async (bookmark) => {
      const sourceType = this.resolveSourceType(bookmark);
      const targetUrl = bookmark.status === "redirected" ? bookmark.finalUrl ?? bookmark.url : bookmark.url;

      let excerpt = "";
      if (sourceType === "live" || sourceType === "redirected") {
        excerpt = await this.fetchPageExcerpt(targetUrl);
      }

      const sourceHash = createHash("sha256")
        .update(`${bookmark.url}|${bookmark.title}|${bookmark.folderPath ?? ""}|${bookmark.status ?? ""}|${bookmark.finalUrl ?? ""}|${excerpt.slice(0, 1000)}`)
        .digest("hex");

      prepared.push({
        ...bookmark,
        sourceType,
        targetUrl,
        excerpt,
        sourceHash
      });
    });

    return prepared;
  }

  private buildCollectionSummary(bookmarks: BookmarkForTriage[]): CollectionSummary {
    const domainCounts = new Map<string, number>();
    const folderCounts = new Map<string, number>();

    for (const bookmark of bookmarks) {
      const domain = extractDomain(bookmark.finalUrl ?? bookmark.url);
      domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);

      const folder = bookmark.folderPath?.trim();
      if (folder) {
        folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1);
      }
    }

    const topDomains = [...domainCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([domain, count]) => ({ domain, count }));

    const topFolders = [...folderCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([folder, count]) => ({ folder, count }));

    const sampleTitles = bookmarks
      .slice(0, 150)
      .map((bookmark) => normalizeWhitespace(bookmark.title).slice(0, 140))
      .filter((title) => title.length > 0);

    return {
      topDomains,
      topFolders,
      sampleTitles
    };
  }

  private async discoverCategories(apiKey: string, summary: CollectionSummary): Promise<string[]> {
    const response = await this.callOpenAiJson<{ categories: Array<{ name: string }> }>({
      apiKey,
      model: CATEGORY_MODEL,
      systemPrompt:
        "You are categorizing a personal bookmark collection. Infer sensible high-level categories from the collection itself, with no predefined taxonomy.",
      userPrompt: JSON.stringify({
        task: "Return 8 to 16 category names only. Keep names concise.",
        collection: summary
      }),
      temperature: 0.2
    });

    this.recordUsage(CATEGORY_MODEL, response.usage);

    const categories = response.data.categories
      .map((entry) => normalizeWhitespace(entry.name))
      .filter((entry) => entry.length > 0)
      .slice(0, 16);

    if (categories.length > 0) {
      return categories;
    }

    return ["Reference", "Engineering", "Learning", "News", "Tools", "Entertainment"];
  }

  private async runCategorization(
    apiKey: string,
    categories: string[],
    bookmarks: PreparedBookmark[]
  ): Promise<Map<string, CategoryResult>> {
    const results = new Map<string, CategoryResult>();
    const batches = chunk(bookmarks, CATEGORY_BATCH_SIZE);

    for (const batch of batches) {
      const payload = {
        categories,
        bookmarks: batch.map((bookmark) => ({
          id: bookmark.id,
          title: bookmark.title,
          url: bookmark.url,
          finalUrl: bookmark.finalUrl,
          folderPath: bookmark.folderPath,
          sourceType: bookmark.sourceType,
          excerpt: bookmark.excerpt.slice(0, 1000)
        }))
      };

      try {
        const response = await this.callOpenAiJson<{ items: CategoryResult[] }>({
          apiKey,
          model: CATEGORY_MODEL,
          systemPrompt:
            "Assign one category from the provided list, 2-5 descriptive tags, and a reason code when uncategorizable. Return strict JSON.",
          userPrompt: JSON.stringify(payload),
          temperature: 0.1
        });

        this.recordUsage(CATEGORY_MODEL, response.usage);

        const byId = new Map(response.data.items.map((item) => [item.id, item]));
        for (const bookmark of batch) {
          const assigned = byId.get(bookmark.id);
          const normalized = this.normalizeCategoryResult(assigned, categories);
          results.set(bookmark.id, normalized);
          this.bumpCounts({
            processed: 1,
            categorized: normalized.category ? 1 : 0,
            uncategorized: normalized.category ? 0 : 1
          });
        }
      } catch {
        for (const bookmark of batch) {
          results.set(bookmark.id, {
            id: bookmark.id,
            category: null,
            tags: [],
            confidence: null,
            reasonCode: "categorization_failed"
          });
          this.bumpCounts({ processed: 1, uncategorized: 1, failed: 1 });
        }
      }

      await this.persistProgress(this.activeStatus?.runId ?? "");
    }

    return results;
  }

  private async runSummaries(
    apiKey: string,
    bookmarks: PreparedBookmark[],
    assignments: Map<string, CategoryResult>
  ): Promise<Map<string, string>> {
    const summaries = new Map<string, string>();

    for (const bookmark of bookmarks) {
      if (bookmark.sourceType === "dead") {
        summaries.set(bookmark.id, this.localFallbackSummary(bookmark));
      }
      if (bookmark.sourceType === "unsupported") {
        summaries.set(
          bookmark.id,
          `${bookmark.title} appears to use an unsupported URL scheme (${bookmark.url.split(":")[0]}://). Summary inferred from title and folder metadata.`
        );
      }
    }

    const pending = bookmarks.filter((bookmark) => !summaries.has(bookmark.id));
    const batches = chunk(pending, SUMMARY_BATCH_SIZE);

    for (const batch of batches) {
      const payload = {
        bookmarks: batch.map((bookmark) => ({
          id: bookmark.id,
          title: bookmark.title,
          url: bookmark.url,
          targetUrl: bookmark.targetUrl,
          folderPath: bookmark.folderPath,
          category: assignments.get(bookmark.id)?.category,
          tags: assignments.get(bookmark.id)?.tags ?? [],
          excerpt: bookmark.excerpt.slice(0, 2200)
        }))
      };

      try {
        const response = await this.callOpenAiJson<{ items: SummaryResult[] }>({
          apiKey,
          model: SUMMARY_MODEL,
          systemPrompt:
            "Write concise 1-2 sentence summaries for bookmarks using the supplied excerpt and metadata. Return strict JSON.",
          userPrompt: JSON.stringify(payload),
          temperature: 0.2
        });

        this.recordUsage(SUMMARY_MODEL, response.usage);

        const byId = new Map(response.data.items.map((item) => [item.id, item.summary]));
        for (const bookmark of batch) {
          const summary = byId.get(bookmark.id);
          summaries.set(bookmark.id, this.normalizeSummary(summary, bookmark));
        }
      } catch {
        for (const bookmark of batch) {
          summaries.set(bookmark.id, this.localFallbackSummary(bookmark));
          this.bumpCounts({ failed: 1 });
        }
      }

      await this.persistProgress(this.activeStatus?.runId ?? "");
    }

    return summaries;
  }

  private normalizeCategoryResult(
    item: CategoryResult | undefined,
    categories: string[]
  ): CategoryResult {
    if (!item) {
      return {
        id: "",
        category: null,
        tags: [],
        confidence: null,
        reasonCode: "missing_model_output"
      };
    }

    const category = item.category && categories.includes(item.category) ? item.category : null;
    const tags = Array.isArray(item.tags)
      ? item.tags
          .map((tag) => normalizeWhitespace(tag))
          .filter((tag) => tag.length > 0)
          .slice(0, 5)
      : [];
    const confidence =
      typeof item.confidence === "number" && Number.isFinite(item.confidence)
        ? Math.min(1, Math.max(0, item.confidence))
        : null;

    return {
      id: item.id,
      category,
      tags,
      confidence,
      reasonCode: category ? null : item.reasonCode ?? "not_enough_signal"
    };
  }

  private normalizeSummary(rawSummary: string | undefined, bookmark: PreparedBookmark): string {
    if (!rawSummary) return this.localFallbackSummary(bookmark);
    const normalized = normalizeWhitespace(rawSummary);
    if (normalized.length < 12) return this.localFallbackSummary(bookmark);
    return normalized.slice(0, 420);
  }

  private localFallbackSummary(bookmark: PreparedBookmark): string {
    if (bookmark.sourceType === "dead") {
      return `${bookmark.title} could not be fetched because the page is no longer available. Summary inferred from URL and folder metadata.`;
    }

    if (bookmark.sourceType === "unsupported") {
      return `${bookmark.title} could not be content-fetched due to an unsupported URL scheme. Summary inferred from title and URL metadata.`;
    }

    if (bookmark.excerpt.length > 0) {
      return `${bookmark.title} appears to cover content related to ${extractDomain(bookmark.targetUrl)}. Summary generated from a limited excerpt.`;
    }

    return `${bookmark.title} could not be fully analyzed from live content, so summary is based on available metadata.`;
  }

  private resolveSourceType(
    bookmark: BookmarkForTriage
  ): "live" | "redirected" | "dead" | "unsupported" {
    const url = bookmark.finalUrl ?? bookmark.url;
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return "unsupported";
    }

    if (bookmark.status === "dead") return "dead";
    if (bookmark.status === "redirected") return "redirected";
    return "live";
  }

  private async fetchPageExcerpt(url: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent": "bookmark-manager-triage/1.0"
        }
      });

      if (!response.ok) {
        return "";
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
        return "";
      }

      const raw = await response.text();
      const stripped = stripHtml(raw);
      return stripped.slice(0, 3000);
    } catch {
      return "";
    } finally {
      clearTimeout(timeout);
    }
  }

  private async callOpenAiJson<T>(input: {
    apiKey: string;
    model: string;
    systemPrompt: string;
    userPrompt: string;
    temperature: number;
  }): Promise<OpenAiJsonResponse<T>> {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: input.model,
        temperature: input.temperature,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: input.systemPrompt },
          { role: "user", content: input.userPrompt }
        ]
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenAI request failed (${response.status}): ${errorBody.slice(0, 200)}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new Error("OpenAI response did not include JSON content.");
    }

    return {
      data: parseJson<T>(content),
      usage: {
        promptTokens: payload.usage?.prompt_tokens ?? 0,
        completionTokens: payload.usage?.completion_tokens ?? 0
      }
    };
  }

  private recordUsage(model: string, usage: OpenAiUsage): void {
    if (!this.activeStatus) return;
    this.activeStatus.apiCalls += 1;
    this.activeStatus.promptTokens += usage.promptTokens;
    this.activeStatus.completionTokens += usage.completionTokens;

    const pricing = MODEL_PRICES[model];
    if (!pricing) return;

    const inputCost = (usage.promptTokens / 1_000_000) * pricing.inputUsdPer1m;
    const outputCost = (usage.completionTokens / 1_000_000) * pricing.outputUsdPer1m;
    this.activeStatus.estimatedCostUsd += inputCost + outputCost;
  }

  private async persistProgress(runId: string): Promise<void> {
    if (!runId || !this.activeStatus) return;
    await this.repository.updateRunProgress({
      id: runId,
      processedCount: this.activeStatus.processedCount,
      cachedCount: this.activeStatus.cachedCount,
      categorizedCount: this.activeStatus.categorizedCount,
      uncategorizedCount: this.activeStatus.uncategorizedCount,
      failedCount: this.activeStatus.failedCount,
      apiCalls: this.activeStatus.apiCalls,
      promptTokens: this.activeStatus.promptTokens,
      completionTokens: this.activeStatus.completionTokens,
      estimatedCostUsd: this.activeStatus.estimatedCostUsd
    });
  }

  private setStage(stage: Stage): void {
    if (!this.activeStatus) return;
    this.activeStatus.stage = stage;
  }

  private bumpCounts(input: {
    processed?: number;
    cached?: number;
    categorized?: number;
    uncategorized?: number;
    failed?: number;
  }): void {
    if (!this.activeStatus) return;
    this.activeStatus.processedCount += input.processed ?? 0;
    this.activeStatus.cachedCount += input.cached ?? 0;
    this.activeStatus.categorizedCount += input.categorized ?? 0;
    this.activeStatus.uncategorizedCount += input.uncategorized ?? 0;
    this.activeStatus.failedCount += input.failed ?? 0;
  }
}
