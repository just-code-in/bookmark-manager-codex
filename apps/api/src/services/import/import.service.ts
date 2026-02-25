import { BookmarkRepository } from "../../repositories/bookmark.repository";
import { validateUrl } from "../url-validation/url-validator";
import { parseBookmarksFromHtml } from "./bookmark-parser";

type ImportRequest = {
  html: string;
  fileName: string;
  source: "chrome" | "safari" | "unknown";
};

type ImportResponse = {
  importId: string;
  source: "chrome" | "safari" | "unknown";
  total: number;
  imported: number;
  duplicates: number;
  live: number;
  redirected: number;
  dead: number;
};

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) continue;
      await worker(item);
    }
  });

  await Promise.all(runners);
}

export class ImportService {
  private readonly repository = new BookmarkRepository();

  async importBookmarks(input: ImportRequest): Promise<ImportResponse> {
    const startedAt = new Date().toISOString();
    const parsed = parseBookmarksFromHtml(input.html);
    const { inserted, duplicates } = await this.repository.upsertBookmarks(parsed);

    let live = 0;
    let redirected = 0;
    let dead = 0;
    const validationUpdates: Array<{
      bookmarkId: string;
      result: Awaited<ReturnType<typeof validateUrl>>;
    }> = [];

    await runWithConcurrency(inserted, 8, async (bookmark) => {
      const validation = await validateUrl(bookmark.url);
      validationUpdates.push({
        bookmarkId: bookmark.id,
        result: validation
      });

      if (validation.status === "live") live += 1;
      if (validation.status === "redirected") redirected += 1;
      if (validation.status === "dead") dead += 1;
    });
    await this.repository.updateValidations(validationUpdates);

    const run = await this.repository.saveImportRun({
      source: input.source,
      fileName: input.fileName,
      startedAt,
      finishedAt: new Date().toISOString(),
      totalBookmarks: parsed.length,
      importedCount: inserted.length,
      duplicateCount: duplicates,
      liveCount: live,
      redirectedCount: redirected,
      deadCount: dead
    });

    return {
      importId: run.id,
      source: input.source,
      total: parsed.length,
      imported: inserted.length,
      duplicates,
      live,
      redirected,
      dead
    };
  }
}
