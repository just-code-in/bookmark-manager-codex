import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

import { buildApp } from "./app";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootEnvPath = path.resolve(__dirname, "../../../.env");
dotenv.config({ path: rootEnvPath });

async function main() {
  const app = await buildApp();
  const port = Number(process.env.PORT ?? 4040);

  try {
    await app.listen({ host: "127.0.0.1", port });
    app.log.info(`API listening on http://127.0.0.1:${port}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void main();
