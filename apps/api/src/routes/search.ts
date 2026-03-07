import type { FastifyInstance } from "fastify";

import { SearchService } from "../services/search/search.service";

const searchService = new SearchService();

export async function registerSearchRoutes(app: FastifyInstance) {
  app.post("/search/embeddings/sync", async (request, reply) => {
    const body = (request.body ?? {}) as { bookmarkIds?: string[]; force?: boolean };
    const bookmarkIds = Array.isArray(body.bookmarkIds)
      ? body.bookmarkIds.filter((item): item is string => typeof item === "string")
      : undefined;

    const result = await searchService.syncEmbeddings({
      bookmarkIds,
      force: body.force === true
    });

    return reply.code(200).send(result);
  });

  app.post("/search/query", async (request, reply) => {
    const body = (request.body ?? {}) as {
      query?: string;
      scope?: {
        category?: string;
        tag?: string;
        status?: "all" | "live" | "redirected" | "dead" | "untested";
        reviewAction?: "all" | "keep" | "archive" | "delete" | "unreviewed";
      };
      limit?: number;
    };

    const query = body.query?.trim() ?? "";
    if (!query) {
      return reply.code(400).send({ error: "query is required." });
    }

    const result = await searchService.search({
      query,
      scope: body.scope,
      limit: typeof body.limit === "number" ? body.limit : undefined
    });

    return reply.code(200).send(result);
  });
}
