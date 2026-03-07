import type { FastifyInstance } from "fastify";

import type { ReviewAction } from "../repositories/organization.repository";
import { OrganizationService } from "../services/organization/organization.service";

const organizationService = new OrganizationService();

function isReviewAction(value: unknown): value is ReviewAction {
  return value === "keep" || value === "archive" || value === "delete" || value === "unreviewed";
}

export async function registerOrganizationRoutes(app: FastifyInstance) {
  app.get("/organization/overview", async (_request, reply) => {
    const overview = await organizationService.getOverview();
    return reply.code(200).send(overview);
  });

  app.get("/organization/bookmarks", async (request, reply) => {
    const query = request.query as {
      category?: string;
      tag?: string;
      status?: string;
      reviewAction?: string;
      uncategorizedOnly?: string;
      sortBy?: string;
      sortDirection?: string;
    };

    const results = await organizationService.listBookmarks({
      category: query.category?.trim() ? query.category.trim() : undefined,
      tag: query.tag?.trim() ? query.tag.trim() : undefined,
      status:
        query.status === "all" ||
        query.status === "live" ||
        query.status === "redirected" ||
        query.status === "dead" ||
        query.status === "untested"
          ? query.status
          : "all",
      reviewAction:
        query.reviewAction === "all" || isReviewAction(query.reviewAction)
          ? query.reviewAction
          : "all",
      uncategorizedOnly: query.uncategorizedOnly === "true",
      sortBy:
        query.sortBy === "date_added" || query.sortBy === "title" || query.sortBy === "category"
          ? query.sortBy
          : "date_added",
      sortDirection: query.sortDirection === "asc" || query.sortDirection === "desc" ? query.sortDirection : "desc"
    });

    return reply.code(200).send({ results });
  });

  app.patch("/organization/bookmarks/:bookmarkId", async (request, reply) => {
    const params = request.params as { bookmarkId: string };
    const body = (request.body ?? {}) as {
      category?: string | null;
      tags?: unknown;
      summary?: string | null;
      reviewAction?: ReviewAction;
    };

    const result = await organizationService.updateBookmark({
      bookmarkId: params.bookmarkId,
      category: body.category,
      tags: body.tags,
      summary: body.summary,
      reviewAction: isReviewAction(body.reviewAction) ? body.reviewAction : undefined
    });

    return reply.code(200).send({ ok: true, ...result });
  });

  app.post("/organization/bookmarks/bulk", async (request, reply) => {
    const body = (request.body ?? {}) as {
      bookmarkIds?: string[];
      reviewAction?: ReviewAction;
      category?: string | null;
      addTag?: string;
    };

    const bookmarkIds = Array.isArray(body.bookmarkIds)
      ? body.bookmarkIds.filter((item): item is string => typeof item === "string")
      : [];

    if (bookmarkIds.length === 0) {
      return reply.code(400).send({ error: "bookmarkIds is required." });
    }

    const result = await organizationService.bulkUpdate({
      bookmarkIds,
      reviewAction: isReviewAction(body.reviewAction) ? body.reviewAction : undefined,
      category: body.category,
      addTag: typeof body.addTag === "string" ? body.addTag : undefined
    });

    return reply.code(200).send({ ok: true, ...result });
  });

  app.post("/organization/categories/rename", async (request, reply) => {
    const body = (request.body ?? {}) as { from?: string; to?: string };
    if (!body.from?.trim() || !body.to?.trim()) {
      return reply.code(400).send({ error: "from and to are required." });
    }

    await organizationService.renameCategory(body.from, body.to);
    return reply.code(200).send({ ok: true });
  });

  app.post("/organization/categories/merge", async (request, reply) => {
    const body = (request.body ?? {}) as { sourceCategories?: string[]; targetCategory?: string };
    const sourceCategories = Array.isArray(body.sourceCategories)
      ? body.sourceCategories.filter((item): item is string => typeof item === "string")
      : [];

    if (sourceCategories.length === 0 || !body.targetCategory?.trim()) {
      return reply.code(400).send({ error: "sourceCategories and targetCategory are required." });
    }

    await organizationService.mergeCategories(sourceCategories, body.targetCategory);
    return reply.code(200).send({ ok: true });
  });

  app.delete("/organization/categories/:category", async (request, reply) => {
    const params = request.params as { category: string };
    if (!params.category.trim()) {
      return reply.code(400).send({ error: "category is required." });
    }

    await organizationService.deleteCategory(params.category);
    return reply.code(200).send({ ok: true });
  });
}
