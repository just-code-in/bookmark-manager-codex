import type { FastifyInstance } from "fastify";

import { TriageService } from "../services/triage/triage.service";

const triageService = new TriageService();

export async function registerTriageRoutes(app: FastifyInstance) {
  app.post("/triage/runs", async (request, reply) => {
    const body = (request.body ?? {}) as { ignoreCache?: boolean };
    const started = await triageService.startRun({ ignoreCache: body.ignoreCache === true });

    return reply.code(started.alreadyRunning ? 409 : 202).send({
      runId: started.runId,
      alreadyRunning: started.alreadyRunning
    });
  });

  app.get("/triage/status", async (_request, reply) => {
    const status = await triageService.getRuntimeStatus();
    if (!status) {
      return reply.code(200).send({ status: null });
    }

    return reply.code(200).send({ status });
  });

  app.get("/triage/runs/latest", async (_request, reply) => {
    const summary = await triageService.getLatestSummary();
    if (!summary) {
      return reply.code(200).send({ summary: null });
    }

    return reply.code(200).send({ summary });
  });
}
