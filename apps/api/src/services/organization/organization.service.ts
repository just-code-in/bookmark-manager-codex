import {
  OrganizationRepository,
  type OrganizationBookmarkFilters,
  type ReviewAction
} from "../../repositories/organization.repository";
import { SearchService } from "../search/search.service";

function parseTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export class OrganizationService {
  private readonly repository = new OrganizationRepository();
  private readonly searchService = new SearchService();

  async getOverview(): Promise<{
    stats: Awaited<ReturnType<OrganizationRepository["getStats"]>>;
    categories: Awaited<ReturnType<OrganizationRepository["listCategories"]>>;
    uncategorized: Awaited<ReturnType<OrganizationRepository["listBookmarks"]>>;
  }> {
    await this.repository.syncFromTriage();

    const [stats, categories, uncategorized] = await Promise.all([
      this.repository.getStats(),
      this.repository.listCategories(),
      this.repository.listBookmarks({
        uncategorizedOnly: true,
        sortBy: "date_added",
        sortDirection: "desc"
      })
    ]);

    return {
      stats,
      categories,
      uncategorized: uncategorized.slice(0, 50)
    };
  }

  async listBookmarks(filters: OrganizationBookmarkFilters) {
    await this.repository.syncFromTriage();
    return this.repository.listBookmarks(filters);
  }

  async updateBookmark(input: {
    bookmarkId: string;
    category?: string | null;
    tags?: unknown;
    summary?: string | null;
    reviewAction?: ReviewAction;
  }): Promise<{ embeddingUpdated: boolean; embeddingError: string | null }> {
    await this.repository.syncFromTriage();

    await this.repository.updateBookmark({
      bookmarkId: input.bookmarkId,
      category: input.category,
      tags: input.tags !== undefined ? parseTags(input.tags) : undefined,
      summary: input.summary,
      reviewAction: input.reviewAction
    });

    try {
      await this.searchService.syncEmbeddings({ bookmarkIds: [input.bookmarkId] });
      return { embeddingUpdated: true, embeddingError: null };
    } catch (error) {
      return {
        embeddingUpdated: false,
        embeddingError: error instanceof Error ? error.message : "Failed to update embedding."
      };
    }
  }

  async bulkUpdate(input: {
    bookmarkIds: string[];
    reviewAction?: ReviewAction;
    category?: string | null;
    addTag?: string;
  }): Promise<{ embeddingUpdated: boolean; embeddingError: string | null }> {
    await this.repository.syncFromTriage();
    await this.repository.applyBulkAction(input);

    try {
      await this.searchService.syncEmbeddings({ bookmarkIds: input.bookmarkIds });
      return { embeddingUpdated: true, embeddingError: null };
    } catch (error) {
      return {
        embeddingUpdated: false,
        embeddingError: error instanceof Error ? error.message : "Failed to update embeddings."
      };
    }
  }

  async renameCategory(fromCategory: string, toCategory: string) {
    await this.repository.renameCategory(fromCategory, toCategory);
    await this.searchService.syncEmbeddings();
  }

  async mergeCategories(sourceCategories: string[], targetCategory: string) {
    await this.repository.mergeCategories(sourceCategories, targetCategory);
    await this.searchService.syncEmbeddings();
  }

  async deleteCategory(category: string) {
    await this.repository.deleteCategory(category);
    await this.searchService.syncEmbeddings();
  }
}
