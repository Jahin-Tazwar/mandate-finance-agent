import { randomBytes } from "node:crypto";
import path from "node:path";

// Repo root, three folders up from apps/api/src
export const rootDir = path.resolve(import.meta.dirname, "../../..");

// Node can read .env files by itself (no `dotenv` package needed).
// A missing .env is fine during early development: the defaults below apply.
// Skipped while tests run: tests must give the same result on every machine,
// whatever keys someone has in their own .env (e.g. ADMIN_KEY).
if (!process.env.VITEST) {
  try {
    process.loadEnvFile(path.join(rootDir, ".env"));
  } catch {
    // no .env yet
  }
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

  /**
   * Signs the session cookies. Missing → a random one per run: everyone is signed
   * out when the server restarts, which is fine because the demo data resets too.
   */
  sessionSecret: process.env.SESSION_SECRET || randomBytes(32).toString("hex"),
  /**
   * TEMPORARY, for the few days until the frontend has its sign-in screen:
   * AUTH_DISABLED=true lets requests without a session through. Never on in tests.
   */
  authDisabled: process.env.AUTH_DISABLED === "true" && !process.env.VITEST,
  /** POST /api/admin/reset needs this key in the `x-admin-key` header when it's set. Read live (tests change it). */
  get adminKey(): string | null {
    return process.env.ADMIN_KEY || null;
  },

  /**
   * The AI model, through OpenRouter. No key = chat answers "AI isn't set up".
   * Never used while tests run (they use a scripted fake model, and must not cost money).
   */
  llm: {
    apiKey: process.env.VITEST ? null : process.env.OPENROUTER_API_KEY || null,
    model: process.env.LLM_MODEL || null,
    fallbackModel: process.env.LLM_FALLBACK_MODEL || null,
    /**
     * DEVELOPMENT ONLY: true lets providers that may store or train on prompts answer,
     * which is what most free models need. Off by default, and keep it off on Render
     * and for the demo: the privacy promise is "providers that don't keep our data".
     */
    allowProviderTraining: process.env.LLM_ALLOW_PROVIDER_TRAINING === "true",
  },
};
