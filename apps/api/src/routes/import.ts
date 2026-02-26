import type { FastifyInstance } from "fastify";

import { BookmarkRepository } from "../repositories/bookmark.repository";
import { ImportService } from "../services/import/import.service";

function detectSource(fileName: string, html: string): "chrome" | "safari" | "unknown" {
  const haystack = `${fileName} ${html.slice(0, 500)}`.toLowerCase();
  if (haystack.includes("chrome")) return "chrome";
  if (haystack.includes("safari")) return "safari";
  return "unknown";
}

export async function registerImportRoutes(app: FastifyInstance) {
  const importService = new ImportService();
  const repository = new BookmarkRepository();

  app.post("/imports", async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: "Missing bookmark HTML file." });
    }

    const html = (await file.toBuffer()).toString("utf-8");
    const source = detectSource(file.filename, html);

    const response = await importService.importBookmarks({
      html,
      fileName: file.filename,
      source
    });

    return reply.code(200).send(response);
  });

  app.get("/imports", async (request, reply) => {
    const query = request.query as { limit?: string };
    const parsedLimit = Number(query.limit ?? "20");
    const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(100, parsedLimit)) : 20;
    const runs = await repository.listImportRuns(limit);
    return reply.code(200).send({ results: runs });
  });

  app.get("/bookmarks", async (request, reply) => {
    const query = request.query as { status?: string };
    const status =
      query.status === "live" || query.status === "dead" || query.status === "all"
        ? query.status
        : "all";
    const bookmarks = await repository.listBookmarks(status);
    return reply.code(200).send({ results: bookmarks });
  });
}
