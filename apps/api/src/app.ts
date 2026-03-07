import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify from "fastify";

import { registerHealthRoutes } from "./routes/health";
import { registerImportRoutes } from "./routes/import";
import { registerOrganizationRoutes } from "./routes/organization";
import { registerSearchRoutes } from "./routes/search";
import { registerTriageRoutes } from "./routes/triage";

export async function buildApp() {
  const app = Fastify({
    logger: {
      transport:
        process.env.NODE_ENV === "development"
          ? { target: "pino-pretty" }
          : undefined
    }
  });

  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  await registerHealthRoutes(app);
  await registerImportRoutes(app);
  await registerTriageRoutes(app);
  await registerOrganizationRoutes(app);
  await registerSearchRoutes(app);

  return app;
}
