import { buildApp } from "./app";

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
