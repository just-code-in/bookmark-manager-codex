import type { FastifyInstance } from "fastify";

import { ImportService } from "../services/import/import.service";

function detectSource(fileName: string, html: string): "chrome" | "safari" | "unknown" {
  const haystack = `${fileName} ${html.slice(0, 500)}`.toLowerCase();
  if (haystack.includes("chrome")) return "chrome";
  if (haystack.includes("safari")) return "safari";
  return "unknown";
}

export async function registerImportRoutes(app: FastifyInstance) {
  const importService = new ImportService();

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
}
