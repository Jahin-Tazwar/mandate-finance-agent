# Learning Notes

What we built, why we chose it, and what we avoided. These notes also become raw material for `ARCHITECTURE.md` and for answering judges' questions.

---

## Day 1: Scaffolding (Oct 12)

### Monorepo with npm workspaces

**What:** one Git repo with three packages: `apps/api` (Express), `apps/web` (React), `packages/shared` (data formats). The root `package.json` lists them under `"workspaces"`, so one `npm install` installs everything.

**Why:**
- The web app and the API both need to agree on what an "Account" or a "Tier" is. With a shared package, that's defined **once** (`packages/shared`) and both import it as `@mandate/shared`. If the API changes a shape, the web app fails type-checking immediately instead of breaking at demo time.
- One repo = one GitHub link for the submission.

**Avoided:** separate repos (shapes drift apart, two links to submit); tools like Turborepo or Nx (powerful but extra concepts we don't need for 2 apps).

### TypeScript everywhere

**Why:** one language for frontend and backend, so you only need to learn one. Types catch mistakes like `account.balence` or passing dollars where cents are expected *before* running the code.

**How we run it:** `tsx` runs `.ts` files directly; there's no separate build step for the API. `tsc` (the TypeScript compiler) is only used to *check* types (`npm run typecheck`).

**Avoided:** compiling the API to JavaScript first. That matters for production servers, but for a demo it adds a step and a `dist/` folder to keep in sync.

### Zod for data shapes (`packages/shared/src`)

**What:** `const Account = z.object({ ... })` describes the shape once and gives us:
1. a **runtime check**: `Account.parse(data)` throws if data is wrong (important for anything coming from users or the AI)
2. a **TypeScript type**: `z.infer<typeof Account>`

**Why:** TypeScript types disappear when the code runs, so they can't check data that arrives at runtime (a request body, an AI's answer). Zod can. This is the basis of "never trust LLM output".

**Avoided:** writing types and validation separately (they drift apart).

### Money as integer cents

**What:** `$12.34` is stored as `1234`. See `Cents` in `entities.ts`.

**Why:** computers store decimals in binary, so `0.1 + 0.2 = 0.30000000000000004`. In a ledger, those tiny errors add up and balances stop matching. Integers are exact. Real banking systems do the same.

**Avoided:** storing money as JS numbers with decimals, or as strings.

### Dates as `YYYY-MM-DD` text

**Why:** a date like "May 3" has no time zone. Storing it as a full timestamp can shift it to May 2 depending on where the computer is. Plain text dates sort correctly and never shift.

### Express 5 server (`apps/api/src/index.ts`)

- `/api/health`: "is the server alive?" Every server should have one; it's the first thing to check when debugging.
- `/api/meta`: returns the tier list from `@mandate/shared`, proving the shared package works end to end.
- **404 handler** for unknown `/api` routes: returns JSON, not an HTML error page, so the frontend can always parse responses.
- **Error handler**: one place that turns thrown errors into JSON. Zod errors become `400 Invalid request`; anything else becomes `500` and is logged. Express 5 forwards errors from `async` handlers here automatically (Express 4 didn't, which caused hanging requests).

### Config from `.env` (`apps/api/src/config.ts`)

**Why:** secrets (the OpenRouter key) and settings (port) live outside the code, in `.env`, which is git-ignored. `.env.example` shows what's needed without real values.

**How:** Node has `process.loadEnvFile()` built in, so we don't need the `dotenv` package. One fewer dependency.

### React + Vite (`apps/web`)

**Why Vite:** starts in under a second, reloads instantly on save, and needs almost no configuration.

**Proxy (`vite.config.ts`):** the browser calls `/api/...` on the web app's own address (port 5173), and Vite forwards it to Express (port 4000). To the browser, it's all one site, so we avoid **CORS**, the browser rule that blocks a page from calling a different address unless the server explicitly allows it.

**Avoided:** Next.js. It's great when it *is* the backend, but we already have Express. Using both means two servers with overlapping jobs.

### Templates for the team (`data/templates/`, `docs/team/TEAM_GUIDE.md`)

**Why CSV:** everyone can edit it in Excel or Google Sheets, and code can read it easily. The teammates' data becomes the app's real data and test cases, so their work is part of the product.

**Why the strict rules** (negative = money out, fixed categories, `YYYY-MM-DD`): the importer will reject rows that don't follow them, so mistakes surface immediately instead of producing weird charts.

### Design decisions made later on Day 1 (not built yet)

**CSV files as the database, loaded into memory.** The data is fake, so we don't need a real database. On startup, the server reads the CSV files in `data/seed/`, checks every row with Zod, and keeps everything in memory (JavaScript `Map`s). Restarting gives you clean demo data again.
- *Why not write changes back into the CSV files?* A transfer changes several things at once (two balances, a new transaction, an audit entry). If the server stopped halfway through writing a file, the file would be corrupted. CSV also can't store nested data like a policy cleanly.
- *Why is memory safe?* Node.js runs one piece of your code at a time. If a transfer is done inside one function without `await` in the middle, nothing else can run halfway through it, so it can't half-happen.
- *Why not SQLite?* On Render's free plan, files written while the server runs are deleted on every restart anyway, so SQLite would give us extra setup (native module, ORM, migrations) for no benefit.
- *Escape hatch:* all data access goes through one folder (`store/`). If we ever need a real database, only that folder changes.

**Hosting on Render's free plan (stretch).** One web service runs Express, which serves both the API and the built frontend. That means one URL and no CORS. Trade-offs: the server sleeps after 15 minutes without visitors and takes about a minute to wake, and data resets on restart. We solve the first with a **keep-alive pinger** that sends `HEAD /api/health` every ~10 minutes (a `HEAD` request is a `GET` without the response body, so it's as cheap as a request can be; Express answers it automatically for any `GET` route). The second is fine for a demo.

*Why not Supabase?* A keep-alive and a database solve different problems: the pinger stops the server sleeping, a database keeps data across restarts and redeploys (every `git push` redeploys and wipes memory). We only need persistence for the audit log behind the on-chain anchors, so that's an optional stretch, not a reason to move everything.

**Wishes: money math in code, not in the AI.** The plan (how much per payday), the status and the ETA are plain functions with unit tests. The AI only explains the result in words. Same principle as the policy engine: anything that has to be correct every time is deterministic code.

### Design decision: demo authentication (Oct 13, built Oct 15)

**Authentication vs. authorization.** Authentication = *who are you?* (sign-in). Authorization = *are you allowed to do this?* (only your own account). Most real-world API breaches are authorization bugs: the user is signed in, but the server forgets to check that `/personas/daniel/...` belongs to them. That's OWASP's #1 API risk, *broken object-level authorization*. We check ownership in one middleware for every persona-scoped route, so no route can forget.

**Why a PIN on top of the session?** A session proves you signed in at some point; it doesn't prove *you* clicked approve just now. Banks ask for a second factor before moving money (strong customer authentication). It also makes the agent safe by construction: the agent has no PIN and no approve tool, so it can't approve its own proposals, even if a prompt injection tells it to.

**Why scrypt for passwords and PINs?** It's deliberately slow and memory-hungry, so trying millions of guesses is expensive. Normal hashes like SHA-256 are designed to be fast, which is good for the audit chain but bad for passwords. Node includes scrypt, so no extra library.

**Why a signed cookie instead of server-side sessions?** The cookie carries the persona id plus an HMAC signature made with `SESSION_SECRET`. The server can verify it without storing anything, so sessions survive a Render restart. `HttpOnly` stops page JavaScript (and any injected script) from reading it.

**Why are the demo passwords public?** The data is fake, and judges need to get in quickly. The security value is in the *checks*, which are real. We say this openly in the security self-assessment instead of pretending.

### Things to try yourself (scaffolding)

1. Run `npm run dev`, open http://localhost:5173 and see "API connected".
2. Open http://localhost:4000/api/meta in the browser.
3. In `packages/shared/src/policy.ts`, add `"L4"` to `Tier`. Refresh the web page and the new tier appears. Then run `npm run typecheck`. Remove it afterwards.
4. Stop the API (Ctrl+C) and refresh the web page to see the error state.

---

## Day 1b: CSV store + first endpoints (Oct 12)

### How a request flows now

```
GET /api/personas/maya/transactions?category=dining
  → app.ts            routes /api/* to the route files
  → routes/personas.ts  checks the query with Zod (bad input → 400)
  → store/index.ts    queryTransactions(): filters the in-memory list
  → JSON response     { total, items }
```

### `app.ts` vs `index.ts`

**What:** `createApp()` in `app.ts` builds the Express app; `index.ts` loads the data and calls `.listen()`.

**Why:** tests can import `createApp()` and send requests straight to it (with Supertest) without starting a real server on a port. This split is standard in Express projects.

### The store is the only door to the data (`src/store/`)

| File | Job |
|---|---|
| `csv.ts` | Read a CSV file; check every row; money and date helpers |
| `seed.ts` | Turn the seed files into the in-memory bank (personas, accounts, balances, transactions, wishes) |
| `index.ts` | The functions everyone else calls: `listPersonas()`, `listAccounts()`, `queryTransactions()`, `resetStore()` |

**Why one door:** if routes read `state` directly, switching to a real database later would mean changing every route. Now only `store/` would change.

**Balances aren't stored in the CSV.** They're computed: starting balance + every transaction on that account. One source of truth means the balance can never disagree with the history.

### Validating the team's spreadsheets

- Every row is checked with a Zod schema (`PersonaRow`, `TransactionRow`, `WishRow` in `seed.ts`).
- **All** problems are collected and reported together, with the file and the **row number as Excel shows it** (header = row 1). Your teammates fix everything in one go instead of one error at a time.
- If anything is wrong, the server refuses to start (`index.ts`). Failing loudly at startup beats serving wrong numbers in a demo.
- `bom: true`: Excel's "CSV UTF-8" adds an invisible character at the start of the file; without this option the first column name would silently not match.

### `parseMoney`: money without floating point

`"42.18"` is split into `42` and `18` with a regular expression and combined as `42 * 100 + 18`. It never becomes the decimal number `42.18`, so there's no rounding error at all. The tests check that `0.10 + 0.20 === 0.30` in cents (it isn't in normal JavaScript).

### Placeholder data (`scripts/generate-placeholder-data.ts`)

- Each persona has a **day-by-day script**: rent on the 1st, pay every Friday, groceries about twice a week… That's easy to read and tune.
- **Seeded randomness:** the generator uses a fixed seed, so it produces the *same* "random" data every run. Demos and tests are repeatable.
- It refuses to overwrite existing files unless you pass `--force`, so it can never destroy your teammate's real spreadsheets.
- Tuned so every checking account stays positive, with Maya dipping to **$39.70 on Aug 13** (the "nearly $0" demo moment).

### Stable IDs

`acc_maya_chk`, `tx_maya_0042`, `wish_maya_1`: built from the data, not random. After a reset, the same transaction has the same ID, so the frontend's links and the tests keep working.

### Query parameters are always text

`?limit=5` arrives as the string `"5"`. `z.coerce.number()` converts it, then checks it's an integer between 1 and 500. Bad values give a 400 with the exact reasons (`issues`), not a crash.

### Tests (`apps/api/test/`, run with `npm test`)

| File | Kind | What it proves |
|---|---|---|
| `csv.test.ts` | Unit test | Money parsing is exact and rejects `$12`, `1,200`, `12.345` |
| `seed.test.ts` | Unit test | Balances add up; bad rows are reported with file + row number |
| `api.test.ts` | API test (Supertest) | Endpoints return the contract's shape, filter correctly, 404/400 properly; `HEAD /api/health` works for the pinger |

`beforeEach(() => initStore())` reloads fresh data before every test, so tests can't affect each other.

### Things to try yourself (store)

1. `npm test` and read the output.
2. In `data/seed/transactions/maya.csv`, change one amount to `$12.00`, then run `npm run dev:api`. Read the error, then undo it.
3. Open http://localhost:4000/api/personas/daniel/transactions?category=shopping&from=2026-09-14&to=2026-09-14 and find the duplicate TechStore charge.
4. Break the rule on purpose: in `routes/personas.ts`, change `.max(500)` to `.max(100)` and run `npm test`. One test fails and tells you why. Undo it.

---

## Day 2: first real data from the team (Oct 13)

The teammate's three transaction files arrived. Two kinds of checking, and they catch different problems:

| Check | Done by | Found |
|---|---|---|
| **Format**: right columns, valid dates, amounts, categories | The loader (`seed.ts`), automatically, at every startup | Missing `merchant` / `memo` columns; Aisha's `insurance` and `maintenance` categories |
| **Content**: does the data tell the story the demo needs? | An analysis script (balances over time, income gaps, duplicates) | Maya overdrawn by $3,066; Daniel over his card limit and no duplicate charge; Aisha paid every ~2 weeks instead of daily/weekly |

**Lesson:** valid data isn't the same as *useful* data. Code can enforce the format; whether the content fits the product needs someone to look at it with the product in mind.

**Improvement made:** the loader now checks the header once per file. A missing column used to produce one error per row (hundreds of lines); now it's one line: `transactions/maya.csv row 1: missing column(s): merchant, memo`. There's a test for it (`seed.test.ts`).

**Decision:** keep the placeholder data live, move the team's files to `data/team-submissions/2026-10-13/` (never delete someone's work), and send them `FEEDBACK.md` with what to fix and a cheat sheet of the live data, so their next deliverables (bills, scenarios, wishes) match what the app actually uses.

---

## Day 2b: Analytics engine (Oct 13)

Five endpoints now answer "how am I doing?": `pay-cycle`, `subscriptions`, `bills`, `forecast`, `budget`. **All plain math, no AI.** The AI will later *explain* these numbers; it never computes them.

### Everything builds on one idea: recurring series (`analytics/recurring.ts`)

Group transactions by **account + merchant + money in/out**, then ask: do they repeat on a schedule?

| Rule | Why |
|---|---|
| At least 3 occurrences | Two points always look like a pattern |
| Typical gap (median) decides the cadence: 1–2 days daily, 6–8 weekly, 13–16 biweekly, 27–33 monthly | Months are 28–31 days; pay can shift a day |
| ≥ 60% of the gaps must fit | A café visited "roughly every two weeks" shouldn't become a "biweekly bill" |
| Outgoing amounts must be stable (variation ≤ 25%) | Electricity varies a bit; groceries vary a lot |
| Groceries, dining, shopping, entertainment are never commitments | A real bug we hit: random StyleHub shopping looked "monthly" by coincidence |
| A series that stopped is dropped | A cancelled subscription shouldn't be predicted forever |
| Typical amount = **median** of the last 3 | A real bug we hit: Maya's family sent $2,500 once for tuition; the average said $1,233/month, the median says $600 |

### What's built on it

| Feature | How it works |
|---|---|
| **Pay cycle** | Income series bringing ≥ 25% of income; the most frequent wins (Aisha: daily payouts beat weekly). Income/surplus averaged over 90 days |
| **Surplus** | Income − *all* normal spending per pay cycle (one-offs over $500 and savings transfers excluded). It's what someone can actually save, so wish plans use it |
| **Subscriptions** | Recurring "subscriptions" series + a usage file → "unused for 163 days" |
| **Bills** | Other recurring payments, predicted for the next 30 days; monthly ones keep their day (rent stays on the 1st) |
| **Duplicates** | Same account + merchant + amount + day, twice |
| **Forecast** | Start from today's balance; add predicted pay and bills on their dates, daily income spread per day, and average everyday spending |
| **Safe to spend today** | See below |
| **Budget** | Each category = average of the last 3 full months, one-offs excluded, rounded up to $5 |

### The safe-to-spend formula

Project checking for 30 days using **only** money you can count on (pay, bills, commitments), with no everyday spending. Then for each future day *d*:

```
(planned balance on day d − $200 floor) ÷ (number of days up to d)
```

The **smallest** value is the answer: if you spend that much every day, you never drop below $200 on *any* day. Example: Maya has $474 after today's phone bill, gets paid Friday, and rent comes on Nov 1. The tightest point gives **$34.45 a day**.

### A fixed "today"

`config.today = 2026-10-12` (the day after the data ends), not the real clock. Otherwise every number would change daily and tests would break next week. Production code uses the real date; demos and tests need a frozen one. Override with `DEMO_TODAY` in `.env`.

### Checking the numbers against the story

After the first version, the output was printed for all 3 personas and read like a user would. That caught three bugs no test had: rent "ahead of pace", a $935/month education budget from a one-off tuition bill, and an inflated income from a one-off gift. **Tests check that code does what you meant; reading the output checks that you meant the right thing.** Each bug now has a test.

### Things to try yourself (analytics)

1. Open http://localhost:4000/api/personas/maya/budget and find the FitZone insight.
2. Compare http://localhost:4000/api/personas/aisha/pay-cycle with Maya's: daily vs weekly.
3. In `.env`, set `DEMO_TODAY=2026-10-30` and restart the API. Watch Maya's safe-to-spend and bills change (rent is now 2 days away). Remove it afterwards.
4. In `analytics/budget.ts`, delete the line `if (skipOneOffs && isOneOff(opts.series, t)) continue;` and run `npm test`. The "one-off doesn't create an education budget" test fails: that's the tuition bug coming back. Undo it.
