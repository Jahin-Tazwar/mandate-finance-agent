# MoneyWise

A personal finance agent that manages your money inside rules you sign.
Built for the 2026 FinTechathon (WeBank), International Track, Topic A.

**The AI proposes. The policy engine decides.** See [PRODUCT.md](PRODUCT.md) for the full plan.

## Requirements

- Node.js 20.19+ (developed on Node 24)
- npm 10+

## Run it

```bash
npm install
cp .env.example .env
npm run dev
```

The API loads its data from the CSV files in `data/seed/` at startup (see `PRODUCT.md` §7.1). If you change a CSV, restart the API or call `POST /api/admin/reset`.

- Web app: http://localhost:5173
- API: http://localhost:4000/api/health
- Sign in with one of the public demo accounts. Chat and rule-help AI need `OPENROUTER_API_KEY` and `LLM_MODEL`; without them the app shows the server's setup message instead of pretending an AI reply succeeded.

## Deploy (Render, one web service)

Express serves the API **and** the built website from the same address, so the browser's `/api/...` calls need no CORS setup.

| Render setting | Value |
|---|---|
| Build command | `npm ci --include=dev && npm run build` |
| Start command | `node --max-old-space-size=320 --import tsx apps/api/src/index.ts` |
| Health check path | `/api/health` |

Environment variables on Render (Settings → Environment):

| Variable | Value |
|---|---|
| `SESSION_SECRET` | a long random string (signs the sign-in cookies) |
| `ADMIN_KEY` | a long random string (protects "reset demo") |
| `OPENROUTER_API_KEY`, `LLM_MODEL`, `LLM_FALLBACK_MODEL` | for the chat agent |
| `AUTH_DISABLED` | leave empty/false to require sign-in; `true` is for local development only and must not be enabled when hosted |
| `ANCHOR_PRIVATE_KEY` | the **test** wallet for on-chain anchoring (create it with `npm run anchor:wallet`, copy the value from your `.env`) |
| `LLM_ALLOW_PROVIDER_TRAINING` | `true` only while using free models in development. **Before the demo:** remove it and switch to paid models (free providers may keep prompts) |

**Why not `npm start` on Render:** `npm start` keeps extra npm processes running (measured: 4 Node processes, about 300 MB at idle, against the free plan's 512 MB; on Oct 17 the server ran out of memory). Running Node directly is one process, about 135 MB. `--max-old-space-size=320` makes Node clean up its memory well before the 512 MB limit.

`npm run build` puts the website in `apps/web/dist/`. When that folder exists, the API serves it: real files (scripts, styles) directly, and any other page address (e.g. `/wishes/new`) gets `index.html` so React picks the screen. Unknown `/api/...` addresses still get a JSON 404. Locally, `npm run build && npm start` runs it the same way at http://localhost:4000.

## Project layout

```
apps/api         Express backend (TypeScript)
apps/web         React + Vite frontend
packages/shared  Zod schemas + types shared by both apps
data/seed        THE DATABASE: personas.csv, wishes.csv, transactions/<persona>.csv
data/templates   CSV templates for persona data, wishes, scenarios, attacks, UI text, bugs
docs/            API contract, team guide, learning notes, (later) architecture + security docs
```

## Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | Start API and web app together |
| `npm run dev:api` / `npm run dev:web` | Start one of them |
| `npm run evidence` | Run the demo story + attack list against a running server (default `http://localhost:4000`, or pass a URL after `--`); writes `docs/evidence/<date>/report.md`. Add `--only A08,A17` to re-run just some attacks (the free AI allows about 50 requests a day) |
| `npm run anchor:wallet` | Create (or show) the test wallet for on-chain anchoring and its test ETH balance |
| `npm run build` / `npm start` | Build the website, then run API + website on one port (what Render does) |
| `npm test` | Run the automated tests |
| `npm run typecheck` | Check types across all packages |
| `npm run seed:placeholder` | Generate placeholder seed data (won't overwrite existing files; add `-- --force` to overwrite) |
