# Mandate

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
| `npm test` | Run the automated tests |
| `npm run typecheck` | Check types across all packages |
| `npm run seed:placeholder` | Generate placeholder seed data (won't overwrite existing files; add `-- --force` to overwrite) |
