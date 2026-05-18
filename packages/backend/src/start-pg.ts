/**
 * Starts embedded PostgreSQL for local development (no Docker needed).
 * Run once: `pnpm tsx src/start-pg.ts`
 * Then in a separate terminal: `pnpm dev`
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import EmbeddedPostgres from "embedded-postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const pg = new EmbeddedPostgres({
  databaseDir: path.join(root, ".pg-data"),
  user: "scis",
  password: "scis_password",
  port: 5432,
  persistent: true,
  // Force UTF-8 encoding regardless of system locale
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

async function main() {
  console.log("[pg] Initialising embedded PostgreSQL...");
  await pg.initialise();
  console.log("[pg] Starting on port 5432...");
  await pg.start();
  console.log("[pg] PostgreSQL ready at postgresql://scis:scis_password@localhost:5432/scis");

  try {
    await pg.createDatabase("scis");
    console.log("[pg] Database 'scis' created.");
  } catch {
    console.log("[pg] Database 'scis' already exists.");
  }

  console.log("[pg] Running in foreground. Press Ctrl+C to stop.");

  const stop = async () => {
    console.log("\n[pg] Stopping...");
    await pg.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());

  // Keep process alive
  setInterval(() => {}, 60_000);
}

main().catch((err) => {
  console.error("[pg] Fatal:", err);
  process.exit(1);
});
