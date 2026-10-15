import path from "node:path";

// Repo root, three folders up from apps/api/src
export const rootDir = path.resolve(import.meta.dirname, "../../..");

// Node can read .env files by itself (no `dotenv` package needed).
// A missing .env is fine during early development: the defaults below apply.
try {
  process.loadEnvFile(path.join(rootDir, ".env"));
} catch {
  // no .env yet
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  /** Folder with the seed CSV files: the app's "database". */
  seedDir: path.resolve(rootDir, process.env.SEED_DIR ?? "data/seed"),
  /**
   * The app's "today". Fixed (the day after the seed data ends) so every
   * number in the demo is the same each time it runs, whatever the real date is.
   */
  today: process.env.DEMO_TODAY ?? "2026-10-12",
  /** Checking never planned below this (until mandates exist; then the mandate's floor is used). */
  defaultBalanceFloorCents: 20_000,
  /**
   * The audit log is also appended to this file (wiped on Render restarts; that's fine).
   * Off while tests run (Vitest sets VITEST), so tests don't write files.
   */
  auditFile: process.env.VITEST ? null : path.resolve(rootDir, process.env.AUDIT_FILE ?? "runtime/audit.jsonl"),
  /**
   * The built frontend (`npm run build -w @mandate/web` creates it). When this folder
   * exists, Express serves the website too, so Render needs only one service.
   * Off while tests run, so tests behave the same whether or not you've built it.
   */
  webDistDir: process.env.VITEST ? null : path.resolve(rootDir, process.env.WEB_DIST_DIR ?? "apps/web/dist"),
};
