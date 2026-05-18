/**
 * Development bootstrap: starts embedded PostgreSQL, runs Prisma migrations + seed,
 * then launches the main backend process. Use this instead of `tsx watch src/index.ts`
 * when Docker is not available.
 *
 * Usage: tsx src/dev-bootstrap.ts
 */
import { execSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import EmbeddedPostgres from "embedded-postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const PG_PORT = 5432;
const PG_USER = "scis";
const PG_PASSWORD = "scis_password";
const PG_DB = "scis";

const pg = new EmbeddedPostgres({
  databaseDir: path.join(root, ".pg-data"),
  user: PG_USER,
  password: PG_PASSWORD,
  port: PG_PORT,
  persistent: true,
});

async function main() {
  console.log("[bootstrap] Starting embedded PostgreSQL on port", PG_PORT, "...");
  await pg.initialise();
  await pg.start();
  console.log("[bootstrap] PostgreSQL started.");

  // Create database if not exists
  try {
    await pg.createDatabase(PG_DB);
    console.log("[bootstrap] Database created.");
  } catch {
    // Database already exists
  }

  const dbUrl = `postgresql://${PG_USER}:${PG_PASSWORD}@localhost:${PG_PORT}/${PG_DB}?schema=public`;
  process.env.DATABASE_URL = dbUrl;

  // Run Prisma migrate + seed
  console.log("[bootstrap] Running Prisma migrations...");
  try {
    execSync("pnpm prisma migrate deploy", {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: dbUrl },
    });
    console.log("[bootstrap] Running seed...");
    execSync("tsx prisma/seed.ts", {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: dbUrl },
    });
  } catch (e) {
    console.warn("[bootstrap] Migrate/seed warning (may already be done):", (e as Error).message?.slice(0, 120));
  }

  // Start the backend
  console.log("[bootstrap] Starting backend server...");
  const backend = spawn("tsx", ["watch", "src/index.ts"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: dbUrl },
    shell: true,
  });

  const onExit = async () => {
    console.log("[bootstrap] Shutting down PostgreSQL...");
    backend.kill();
    await pg.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void onExit());
  process.on("SIGTERM", () => void onExit());
  backend.on("exit", () => void onExit());
}

main().catch((err) => {
  console.error("[bootstrap] Fatal:", err);
  process.exit(1);
});
