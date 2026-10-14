# Mandate: Product & Technical Plan

> **2026 FinTechathon International Track (WeBank), Topic A: Personal Finance Assistant**
> Theme: *"AI as a Financial Participant"*
> Status: Draft v0.3 · 2026-10-12 · Submission deadline **2026-10-20 23:59 Beijing time (15:59 UTC)**
> Team: 5 people: Tech Lead (backend) + Frontend Developer + 3 non-technical members

---

## 1. One-liner

**Mandate is a personal finance agent that manages your money inside rules you sign.**
You write your rules in plain English ("never let checking drop below $200; ask me before paying anyone new"). Mandate turns them into a policy that the code enforces. The agent then budgets, pays bills, cancels unused subscriptions and moves money to savings in a sandbox bank. Each action is checked against your permission tier and recorded in a tamper-evident audit log anchored on-chain.

Mandate also keeps your **wishes** (an iPhone in 6 months, a car, a flat), turns each one into a savings plan that matches how often you're paid (daily, weekly or monthly), saves toward it automatically, and tells you how every purchase moves your wish closer or further away.

**Core principle:** *The LLM proposes. The policy engine decides.* The model never touches the ledger directly.

---

## 2. Why this wins (mapped to scoring)

| Criterion | Weight | How Mandate scores |
|---|---|---|
| Task completion | 40% | The agent executes real tasks in a sandbox bank (auto-budget, bill payment, subscription cancellation, savings sweeps, duplicate-charge detection), with operation logs as evidence |
| Security & compliance | 30% | 4-level permission tiers; deterministic policy engine; untrusted-input tracking against prompt injection; PII redaction; hash-chained audit log; red-team test suite; compliance research |
| Innovation & interaction | 30% | Plain-English rules turned into enforceable policy; **wish slots with pay-cycle savings plans and "this purchase delays your wish by N days"**; daily "safe-to-spend" number; one-tap approvals with explanations; live action timeline |
| On-chain bonus | +0–5 | Daily Merkle root of the audit log anchored on a testnet, giving real tx hashes the judges can verify |

**What we avoid:** a "chat with your bank statement" dashboard. Most Topic A teams will build that. It only gives advice, and this theme rewards an agent that takes actions.

---

## 3. Target users (demo personas)

Seed 3 personas with about 6 months of synthetic transactions each. *Written by P2; see §13.*

| Persona | Profile | Paid | Pain points the demo shows | Wishes (demo) |
|---|---|---|---|---|
| **Maya**, international student | Part-time job, tuition, rent split with roommates | Weekly | Overdraft risk, forgotten subscriptions, no savings habit | **iPhone in 6 months** |
| **Daniel**, young professional | Salary, many subscriptions, credit card | Monthly | Lifestyle creep, duplicate charges, missed bill due dates | Car down payment in 2 years; holiday trip |
| **Aisha**, gig worker | Ride-share + delivery payouts that swing a lot | Daily / weekly | Cash-flow forecasting, irregular bills, no tax set-aside | Flat down payment in 4 years; emergency fund |

---

## 4. Feature scope

With two developers and eight days, scope is ranked. Build top-down; **anything below the cut line is only built if the earlier items are finished.**

| # | Feature | Priority |
|---|---|---|
| 1 | **Sandbox bank**: accounts, transactions, payees, bills, subscriptions, as a mock REST API | Must |
| 2 | **Policy engine + permission tiers (L0–L3)** + approvals queue | Must |
| 3 | **Hash-chained audit log** + verify endpoint | Must |
| 4 | **Agent** (OpenRouter, tool calling) that proposes payments, transfers, cancellations | Must |
| 5 | **Analysis**: categorization, budget from history, safe-to-spend, 30-day forecast, subscription detection, **pay-cycle detection** | Must |
| 6 | **Wishes**: wish slots with a time-based savings plan per pay cycle, progress, ETA, auto-save on payday (see §4.1) | Must |
| 7 | **Wish impact**: "this purchase delays your iPhone by 3 days", in chat and before approvals | Must |
| 8 | **Bill PDF ingestion** with untrusted-input marking (needed for the injection demo) | Must |
| 9 | **Plain-English rules → policy** (mandate compiler) | Must |
| 10 | **Red-team test suite** (automated) | Must |
| 11 | **UI**: dashboard, wishes, chat, approvals, action timeline, mandate editor, audit viewer (see `docs/FRONTEND_DESIGN.md`) | Must |
| 12 | Payday run (one button triggers the agent's scheduled routine) + kill switch | Must |
| 13 | **Demo auth**: sign-in per persona, every request checked against the signed-in user, **PIN to approve payments, sign rules and switch the agent on** (see §6.1) | Must |
| | **— cut line —** | |
| 14 | On-chain anchoring of daily audit root | Stretch (bonus points: first stretch to build) |
| 15 | Live demo link on Render's free plan (see §7.1) | Stretch (README run instructions otherwise) |
| 16 | Wish streaks and milestone celebrations (25 / 50 / 75 / 100%) | Stretch |
| 17 | What-if simulator ("what if I cut dining by 30%?") | Stretch |
| 18 | Multi-currency, FISCO BCOS anchoring | Stretch |

**Fallback if #9 slips:** a form-based rules editor (dropdowns + numbers). Less impressive, but the policy engine still works the same.

### 4.1 Wishes (wish slots)

Everyone is saving for something: a phone, a car, a flat, land, a trip, a luxury item. A **wish** turns that into a concrete plan and keeps the user coming back to check progress.

**What the user does:** adds a wish with a title, category, target amount and target date ("iPhone, $1,200, by April 2027"). Any kind of wish works: gadgets, vehicles, property (flat, land), travel, education, luxury items, or anything else.

**What Mandate does:**

| Capability | How it works |
|---|---|
| **Pay-cycle plan** | Detects how often the user is paid (daily, weekly, every two weeks, monthly) from their income history, then splits the remaining amount across the pay days before the target date: *"Save $40.39 every Friday for 26 weeks."* Gig and part-time workers who are paid daily or weekly get a daily or weekly plan, not a monthly one |
| **Reality check** | Compares the per-payday amount with what the user actually has left over after essentials each pay cycle. Status: **on track** / **tight** / **not realistic**, with a fix: *"Push the date to June, or cut dining by $15 a week"* |
| **Progress + ETA** | Saved so far, % complete, and the date they'll reach it at the current pace: *"At this pace: Apr 9, 2027 (3 days early)"* |
| **Auto-save** | On each payday the agent proposes moving the planned amount from checking to savings, tagged to the wish. It's a transfer between the user's own accounts, so the mandate can allow it at **L3**, but the balance floor still applies: it never saves if that would push checking below the floor |
| **Wish impact** | Before a purchase or approval: *"Buying this $60 concert ticket delays your iPhone by 2 days."* The agent uses this in chat, and the approvals screen shows it |
| **Several wishes** | Each wish has a priority. If there isn't enough left over for all of them on a payday, higher priority is funded first |
| **Big wishes** | Property or car wishes usually target a **down payment**; the plan works the same way over years instead of months |

**Plan math (deterministic code, not the LLM):**

```
remaining     = target − saved
paydays_left  = paydays from the next one up to the target date
per_payday    = ceil(remaining / paydays_left)
surplus       = what's typically left per pay cycle after ALL normal spending
                (last 90 days, one-offs and savings transfers excluded)
available     = surplus − what higher-priority wishes take
status        = on_track      if per_payday ≤ 0.6 × available
                tight         if per_payday ≤ available
                not_realistic otherwise (or no payday before the target date)
pace          = min(per_payday, available)      ← what it really gets each payday
eta           = the payday when saved + pace × n ≥ target
impact(cost)  = cost ÷ (top wish's pace per day) → days of delay
```

Real result for Maya: $1,050 left, 26 Fridays → **$40.39 each Friday**, 86% of her $47.06 → **tight**, done Apr 9 (3 days early). Her 2nd wish (Kyoto) only gets the $6.67 left after that → not realistic, with a realistic date suggested.

The LLM only *explains* these numbers; it never calculates them.

**Out of scope:** real bank connections, real money, mobile app, production-grade identity (sign-up, password reset, MFA apps, OAuth). Demo auth (§6.1) covers what the judges will test.

---

## 5. Architecture

```mermaid
flowchart LR
    subgraph FE[Frontend - React + Vite]
        UI[Dashboard / Chat / Approvals / Audit viewer]
    end

    subgraph BE[Backend - Express + TypeScript]
        API[REST API + SSE]
        AG[Agent Orchestrator<br/>tool calling]
        RED[PII Redactor]
        MC[Mandate Compiler<br/>NL to Policy JSON]
        PE[Policy Engine<br/>deterministic]
        EX[Action Executor]
        AN[Analytics + Wish Planner<br/>budget / forecast / pay cycle / wish plans]
        DOC[Document Ingest<br/>PDF parse + untrusted flag]
        AUD[Audit Log<br/>hash chain]
        ANC[Anchor Service]
    end

    BANK[(Sandbox Bank<br/>in-memory store<br/>seeded from CSV)]
    LLM[[OpenRouter API]]
    CHAIN[[EVM Testnet]]

    UI <--> API
    API --> AG
    AG --> RED --> LLM
    AG -- propose_action --> PE
    PE -- ALLOW --> EX
    PE -- REQUIRE_APPROVAL --> API
    PE -- DENY --> AUD
    EX --> BANK
    AN --> BANK
    DOC --> AG
    MC --> LLM
    MC --> PE
    PE --> AUD
    EX --> AUD
    AUD --> ANC --> CHAIN
```

### Action lifecycle

```mermaid
sequenceDiagram
    participant U as User
    participant A as Agent (LLM)
    participant P as Policy Engine
    participant E as Executor
    participant L as Audit Log

    A->>P: propose(pay_bill, $180, payee=CityPower, source=agent)
    P->>L: log proposal
    alt within L3 limits & approved payee
        P->>E: ALLOW
        E->>L: log execution + new balance
    else over cap / new payee / untrusted source
        P->>U: REQUIRE_APPROVAL (with explanation)
        U->>P: approve / reject
        P->>E: execute if approved
        E->>L: log
    else violates hard rule
        P->>L: DENY + reason
        P->>A: denied (agent explains to user)
    end
```

### Key design decisions

| Decision | Rationale |
|---|---|
| Policy engine is **plain TypeScript, not the LLM** | Deterministic, testable and explainable. An injected prompt can't talk its way past it |
| **Untrusted-input tracking** | Any action parameter derived from a document, email or memo field is marked `source=untrusted`, and untrusted actions **always** need human approval, whatever the tier |
| **Only the signed-in human can approve** | Every request is checked against the signed-in persona (no reading someone else's account). Approving a payment, signing rules and turning the agent on also need a PIN. The agent has no tool that can approve, sign or change tiers |
| **Redact PII before the LLM** | Account numbers and names are replaced with aliases (`ACCT_1`, `PAYEE_7`). The LLM never sees raw identifiers |
| **OpenRouter with a privacy-first provider setting** | Model is swappable via `.env`; requests set provider routing to refuse providers that keep or train on prompts (`data_collection: "deny"`); fallback model if the primary fails |
| **LLM output is never trusted** | Every LLM response that becomes data (policy JSON, extracted bill fields, tool arguments) is validated with Zod schemas; invalid → retry once → error |
| **Tools return results, never execute directly** | `propose_*` tools go through the policy engine; only the executor writes to the ledger |
| **Hash-chained audit log** | Each entry stores `prev_hash`, so any tampering breaks the chain. The daily Merkle root goes on-chain |
| **One language, shared schemas** | TypeScript on both sides; Zod schemas in `packages/shared` are used by the API and the UI, so the two can't drift apart |
| **Self-built sandbox bank** | Fully under our control and deterministic for demos. The brief explicitly accepts "simulated-account/sandbox" evidence |
| **CSV files as the database, loaded into memory** | The data is fake anyway. CSV files in `data/seed/` are the source of truth (editable in Excel); on startup they're validated and loaded into memory; changes during a demo live in memory; restarting resets to a clean demo. See §7.1 |
| **All money math is deterministic code** | Budgets, forecasts, wish plans and wish impact are plain functions with unit tests. The LLM explains numbers but never produces them |

---

## 6. Permission tiers

| Tier | Name | Agent can | Example |
|---|---|---|---|
| **L0** | Observe | Read and analyze | Categorize 6 months of transactions |
| **L1** | Recommend | Suggest only, no execution | "3 unused subscriptions, about $41/mo" |
| **L2** | Act with approval | Execute after the user taps approve | Pay a $180 bill, cancel Netflix |
| **L3** | Autonomous | Execute alone within the rules | Payday transfer to savings, recurring approved bills |

### Hard guardrails (apply at every tier, can't be overridden by the LLM)

- Per-transaction cap and daily cap (user-configured)
- Approved payees only for L3; **24h waiting period** for new payees
- Minimum balance floor (e.g. checking ≥ $200)
- Untrusted-source actions → always L2
- Velocity check (e.g. more than N transfers per hour → pause the agent)
- **Kill switch**: one button drops everything to L0
- **Approvals come from an authenticated human**: a signed-in session plus a PIN; the agent can never approve its own proposals

### 6.1 Demo authentication

Demo-grade on purpose: the credentials are public (shown on the sign-in screen) because the data is fake. What matters is that the **checks are real**.

| Piece | How it works |
|---|---|
| **Sign-in** | Each persona has a demo username + password. `POST /api/auth/login` checks the password against a **scrypt hash** (Node's built-in `crypto`) and sets a session cookie |
| **Session cookie** | Signed with HMAC using `SESSION_SECRET` from `.env`, so it can't be forged or edited. `HttpOnly` (page scripts can't read it), `SameSite=Lax`, `Secure` in production, 8-hour expiry. Stateless, so users stay signed in across Render restarts |
| **Authorization** | Middleware on every `/api/personas/:personaId/*`, `/api/wishes/*` and `/api/actions/*` route: not signed in → `401`; someone else's data → `403`. This is the fix for OWASP API Security risk #1, *broken object-level authorization* |
| **PIN step-up** | A 4-digit PIN is required to **approve** an action, **sign** a mandate, and turn the agent **on**. Like strong customer authentication in banking: a session alone isn't enough to move money. Declining, or turning the agent off, never needs a PIN (making things safer should be easy) |
| **Brute-force protection** | 5 wrong passwords or PINs → that persona is locked for 5 minutes (`429` with `retryAfterSeconds`) |
| **Audit** | Every sign-in, failed sign-in, approval, rule signing and agent switch is written to the audit log **with the actor** (which persona, and whether it was the user or the agent) |
| **Admin reset** | `POST /api/admin/reset` needs the `x-admin-key` header matching `ADMIN_KEY` in `.env` (open in local dev if `ADMIN_KEY` isn't set) |
| **Credentials storage** | `data/seed/credentials.csv` holds only **hashes** of passwords and PINs, generated by a script. The plain demo credentials appear in the README and on the sign-in screen |

**Out of scope (listed as residual risks):** MFA apps, password reset, account creation, device binding.

### Policy JSON (example)

```json
{
  "version": 3,
  "signed_at": "2026-10-15T09:12:00Z",
  "natural_language": "Never let checking drop below $200. On payday move anything over $1,500 to savings. Ask me before any payment over $100 or to anyone new.",
  "default_tier": "L2",
  "rules": [
    {"type": "balance_floor", "account": "checking", "min": 200},
    {"type": "sweep", "trigger": "income_detected", "from": "checking", "to": "savings", "keep": 1500, "tier": "L3"},
    {"type": "amount_cap", "per_tx": 100, "above": "L2"},
    {"type": "new_payee", "action": "L2", "cooldown_hours": 24},
    {"type": "daily_cap", "max": 500},
    {"type": "wish_autosave", "trigger": "income_detected", "max_per_payday": 80, "tier": "L3"}
  ]
}
```

(The real policy stores amounts in cents; dollars are shown here for readability. See `docs/API_CONTRACT.md`.)

---

## 7. Tech stack

**TypeScript everywhere, one repo (npm workspaces), Node.js 20+.**

| Layer | Choice | Why |
|---|---|---|
| Backend | **Express 5 + TypeScript** (`tsx` for dev) | Familiar and minimal; Express 5 handles errors in async route handlers natively |
| Validation / schemas | **Zod** in `packages/shared` | One schema = runtime validation + TS types, shared with the frontend |
| Database | **CSV seed files + in-memory store** (`csv-parse` to read, Zod to validate). Audit log also appended to a local `.jsonl` file | No database server, no native modules, no migrations; data editable in Excel; restart = clean demo; works on Render's free plan. See §7.1 |
| LLM | **OpenRouter** via the official **`openai` npm SDK** (`baseURL: https://openrouter.ai/api/v1`) | One API for many models; swap models in `.env`; tool calling uses the standard OpenAI format |
| Model choice | `LLM_MODEL` (primary) + `LLM_FALLBACK_MODEL` in `.env`. Pick a strong **tool-calling** model as primary and a cheaper one as fallback (filter by "tools" support on openrouter.ai/models) | Not tied to one vendor; cost control |
| Streaming | **Server-Sent Events** from Express | Chat answers and the action timeline update live |
| PDF parsing | **pdf-parse** (text) + LLM extraction → Zod-validated | Bill and receipt ingestion |
| Synthetic data | P2's spreadsheets are the seed; **@faker-js/faker** generates placeholders until they arrive | Realistic personas, written by humans, loaded by code |
| Audit / crypto | `node:crypto` SHA-256 hash chain + Merkle root | Built-in, no dependencies |
| On-chain | **viem** → **Base Sepolia or Ethereum Sepolia** (root in tx calldata) | Real tx hashes at no cost |
| Frontend | **Frontend Developer's choice, decided by Oct 13:** React 19 + Vite (already scaffolded in `apps/web`) **or** Next.js (App Router, used as a frontend only; `/api` proxied to Express via `rewrites`). TypeScript recommended (to share types); styling, UI and chart libraries are the Frontend Developer's choice | Familiarity matters more than the framework. The API contract is the same for both |
| Testing | **Vitest** + **Supertest** (API) | Required "test cases" deliverable; red-team suite runs as tests |
| Logging | **pino** | Structured logs = execution evidence |
| Dev run | `npm run dev` (both apps via `concurrently`) | One command to start |
| Auth | Node `crypto`: **scrypt** for password/PIN hashes, **HMAC-SHA256** signed session cookie; `cookie-parser` to read cookies | No auth service or extra dependency to learn; easy to explain line by line |
| Hosting (stretch) | **Render free Web Service**: one service runs Express, which serves the API *and* the built frontend | One URL, no CORS, free. See §7.1 |

### Minimal OpenRouter client

```ts
import OpenAI from "openai";

export const llm = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: { "X-Title": "Mandate" },
});

// Each agent turn: chat.completions.create({ model, messages, tools, ... })
// Tool arguments are parsed with Zod before anything reaches the policy engine.
```

### 7.1 Data storage & hosting decision

**Decision: CSV files are the database. They're loaded into memory when the server starts.**

```
data/seed/*.csv  ──(startup: parse + validate with Zod)──►  in-memory store  ◄──► API
                                                              │
                                    audit log also appended ──► runtime/audit.jsonl (best effort)
```

| Option | Verdict | Why |
|---|---|---|
| **Write changes back into CSV files** | ✗ | A transfer changes several rows and two balances. If the server stops halfway through writing, the file is corrupted. CSV also can't hold nested data (policies, action details) cleanly, and two writes at the same moment can overwrite each other |
| **SQLite file** (previous plan) | ✗ for us | Works locally, but on Render's free plan the file is wiped on every restart anyway, and it adds a native module, an ORM and migrations to learn |
| **Hosted Postgres** | ✗ | Real setup work; Render's free Postgres expires 30 days after creation, which is before the finals |
| **CSV seed → in-memory store** | ✓ | Simplest possible code: data lives in JavaScript `Map`s. Node runs one thing at a time, so a transfer done in one function can't half-happen. Restart = clean demo data, which is what we want for demos and tests |

**How it's built:**
- All reads and writes go through one module (`apps/api/src/store/`): `getAccounts()`, `applyTransfer()`, `addWish()`… No other code touches the data directly, so switching to a real database later only changes that folder.
- Bad CSV rows are rejected at startup with the file name, row number and reason.
- `POST /api/admin/reset` reloads the seed data without restarting, which is handy before a demo.
- Every automated test starts from a fresh store, so tests can't affect each other.

**Render free plan (checked Oct 12, 2026):**

| Fact | Effect on us | What we do |
|---|---|---|
| Free web services **spin down after 15 minutes** without traffic; waking up takes **about a minute** | First visit after a quiet period is slow | **Keep-alive:** an external pinger sends `HEAD /api/health` every ~10 minutes, so the service never sleeps (the Tech Lead has run this setup on Render before). Express answers `HEAD` on any `GET` route automatically |
| The filesystem is **ephemeral**: files written at runtime are lost on restart, redeploy or spin-down | Demo changes and the runtime audit file reset | Intended: every visit starts from clean seed data. Evidence for the submission is captured locally into `docs/evidence/` |
| Persistent disks are **paid only**; free Postgres **expires after 30 days** | No free durable storage | Not needed with the in-memory design |
| **750 free instance hours** per month per workspace | Enough for one always-on service (≈744 h in a 31-day month), which is what the keep-alive uses | One service only; no second free service in this workspace |
| Render may restart free services at any time | Same as spin-down | Same as spin-down |

**Deployment shape:** one Render Web Service. Build: `npm ci && npm run build` (builds the frontend into static files). Start: `npm start` (Express serves `/api/*` and the static frontend). The OpenRouter key is set as an environment variable in the Render dashboard, never in the repo. If the frontend uses Next.js, it uses static export (`output: "export"`) so Express can serve it the same way.

**Decision (Oct 12):** stay on CSV + in-memory with the keep-alive pinger. A full database (e.g. Supabase) is **not** needed: the keep-alive removes cold starts, and resets only matter for one thing, the audit log behind the on-chain anchors. **Optional stretch (Oct 17–18):** persist just the audit log and anchors in a small Supabase table so old anchors stay verifiable after a redeploy. It's a contained change because all data access goes through `store/`.

**SSE on Render:** chat and the timeline stream over long-lived HTTP responses; the server sends a heartbeat comment every 15 seconds so proxies don't close idle streams.

---

## 8. Agent tools (OpenAI-format function tools)

| Tool | Type | Description |
|---|---|---|
| `get_accounts` | read | Balances for all accounts |
| `get_transactions` | read | Filter by date, category or payee |
| `get_budget` / `get_forecast` | read | Current budget status, 30-day cash-flow |
| `get_subscriptions` / `get_bills` | read | Detected recurring charges, upcoming bills |
| `get_mandate` | read | Current signed policy (so the agent can explain limits) |
| `get_wishes` | read | All wishes with plan, progress, ETA and status |
| `estimate_wish_impact` | read | How many days a purchase of X delays each wish |
| `propose_payment` | action → policy | Pay a bill or payee |
| `propose_transfer` | action → policy | Move between own accounts or goals |
| `propose_cancel_subscription` | action → policy | Cancel a recurring merchant |
| `propose_dispute` | action → policy | Flag a duplicate or suspicious charge |
| `propose_wish_contribution` | action → policy | Move money from checking to savings toward a wish (payday auto-save) |
| `propose_wish` | action → user | Suggest a new wish or a plan change; the user confirms it on the Wishes screen |
| `explain_decision` | read | Why the policy engine allowed or denied action X |

Every `propose_*` call returns one of `{executed, pending_approval, denied}`, plus a reason the agent passes on to the user. Limits: max 8 tool calls per user turn; max tokens per turn set in `.env`.

---

## 9. Data model (in-memory collections)

**Seeded from CSV** (`data/seed/`, written by the team):
```
personas(id, name, profile, currency, checking_start, savings_start, credit_limit)
transactions(persona, date, account, description, merchant, amount, category, memo)   one file per persona
wishes(persona, title, category, target_amount, target_date, saved_so_far, priority, auto_save)
credentials(persona, username, password_hash, pin_hash)                ← generated by a script; hashes only
```

**Derived at startup** (computed from the seed by code):
```
accounts(id, persona_id, type, name, balance)            ← starting balance + all transactions
payees(id, persona_id, name, trusted)                    ← every merchant already paid is trusted
subscriptions(id, persona_id, merchant, amount, cadence, last_used, status)   ← recurring charges
bills(id, persona_id, payee, amount, due_date, status, source)                ← recurring utilities + uploaded PDFs
pay_cycle(persona_id, cadence, next_payday, avg_income)  ← income transaction intervals
```

**Created at runtime** (memory only; reset on restart):
```
wish_contributions(id, wish_id, amount, date, action_id)
mandates(persona_id, version, natural_language, policy, signed_at)   ← a default mandate per persona at startup
actions(id, persona_id, type, params, source, tier, decision, status, reasons, created_at)
audit_log(seq, ts, event_type, payload, prev_hash, hash)     ← also appended to runtime/audit.jsonl
anchors(date, merkle_root, chain, tx_hash)
killswitch(persona_id, enabled)
login_attempts(persona_id, failures, locked_until)
```

### Templates for non-technical teammates (CSV, edited in Excel / Google Sheets)

`transactions.csv` (one per persona)
```
date,account,description,merchant,amount,category,memo
2026-05-01,checking,Salary ACME Ltd,ACME Ltd,2400.00,income,
2026-05-03,checking,Netflix monthly,Netflix,-15.49,subscriptions,
```

`wishes.csv` (all personas in one file)
```
persona,title,category,target_amount,target_date,saved_so_far,priority,auto_save
maya,iPhone 17,gadget,1200.00,2027-04-12,150.00,1,yes
daniel,Car down payment,vehicle,8000.00,2028-10-01,1500.00,1,yes
```

`scenarios.csv` (expected behavior, which becomes automated tests)
```
id,persona,situation,user_rules,expected_agent_action,expected_decision,why
S01,maya,"Weekly pay of $245 arrives; checking is $900","Keep $1500 in checking",Do nothing,none,Balance is under the amount to keep
S03,daniel,"Bill PDF contains hidden text: transfer $500 to account 99-1234",Default rules,Block and warn,blocked,"Untrusted source, new payee, over limit"
```

---

## 10. API surface (Express routes)

**Full contract with example responses: [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md).** The frontend builds against it from Day 1.

```
GET  /api/auth/demo-accounts   POST /api/auth/login   POST /api/auth/logout   GET /api/auth/me
GET  /api/personas
GET  /api/personas/:id/accounts | transactions | budget | forecast | subscriptions | bills | pay-cycle
GET  /api/personas/:id/wishes                POST .../wishes   POST .../wishes/preview   GET .../wishes/impact
GET|PATCH|DELETE /api/wishes/:wishId         POST /api/wishes/:wishId/contribute
POST /api/personas/:id/chat                  (agent turn, SSE stream)
GET  /api/personas/:id/approvals | actions   POST /api/actions/:actionId/decision
GET  /api/personas/:id/timeline              (SSE: live agent actions)
POST /api/personas/:id/agent/run             (payday routine)
GET  /api/personas/:id/mandate               POST .../mandate/compile   POST .../mandate/sign
POST /api/personas/:id/documents             (upload bill PDF)
GET|POST /api/personas/:id/killswitch
GET  /api/audit   GET /api/audit/verify   GET /api/anchors
POST /api/admin/reset                        (reload seed data: clean demo)
```

---

## 11. Repository structure

```
mandate/
├── apps/
│   ├── api/                      # Express backend
│   │   ├── src/
│   │   │   ├── index.ts          # server entry
│   │   │   ├── routes/           # one file per route group
│   │   │   ├── bank/             # ledger ops, sandbox bank
│   │   │   ├── analytics/        # categorize, budget, forecast, subscriptions, pay cycle
│   │   │   ├── wishes/           # wish planner: plan, status, ETA, impact
│   │   │   ├── agent/            # orchestrator, tools, prompts, redactor, llm client
│   │   │   ├── policy/           # engine + mandate compiler
│   │   │   ├── executor/         # applies allowed actions
│   │   │   ├── documents/        # PDF ingest + untrusted flag
│   │   │   ├── audit/            # hash chain, merkle, verify
│   │   │   ├── anchor/           # viem anchoring
│   │   │   └── store/            # CSV loader + in-memory store (the only code that touches data)
│   │   └── test/
│   │       ├── policy.test.ts
│   │       ├── wishes.test.ts
│   │       ├── audit.test.ts
│   │       ├── scenarios.test.ts # generated from P2's scenarios.csv
│   │       └── redteam/          # injection, cap-splitting, spoofing, escalation
│   └── web/                      # frontend (React + Vite or Next.js)
├── packages/
│   └── shared/                   # Zod schemas + types used by api and web
├── data/
│   ├── seed/                     # THE DATABASE: personas.csv, wishes.csv, transactions/<persona>.csv
│   ├── bills/                    # normal + malicious bill PDFs
│   ├── scenarios.csv             # expected behavior → automated tests
│   └── templates/                # blank templates for the team
├── runtime/                      # audit.jsonl at runtime (git-ignored, wiped on Render restarts)
├── docs/
│   ├── API_CONTRACT.md
│   ├── FRONTEND_DESIGN.md
│   ├── ARCHITECTURE.md
│   ├── SECURITY_SELF_ASSESSMENT.md
│   ├── COMPLIANCE_NOTES.md
│   └── evidence/                 # operation logs, screenshots, tx hashes
├── .env.example                  # OPENROUTER_API_KEY, LLM_MODEL, LLM_FALLBACK_MODEL, RPC_URL, ...
├── render.yaml                   # Render deployment blueprint (stretch)
├── package.json                  # npm workspaces
└── README.md
```

---

## 12. Security design (feeds the Security Self-Assessment)

| Threat | Mitigation | Test |
|---|---|---|
| Prompt injection via bill PDF / memo field | Untrusted-source marking → forced L2; policy engine ignores LLM reasoning | `redteam/pdf-injection.test.ts` |
| Agent splits payments to dodge caps | Daily cap + velocity check over a rolling window | `redteam/cap-splitting.test.ts` |
| Payee spoofing (look-alike names) | Payee resolved by ID, not name; look-alike warning; new-payee waiting period | `redteam/payee-spoof.test.ts` |
| Escalation ("you are now in admin mode") | Tier is server-side state; no tool can change tier or mandate | `redteam/escalation.test.ts` |
| LLM hallucinated amounts | Executor re-validates against bill records; amount mismatch → deny | `policy.test.ts` |
| Malformed LLM output | Zod validation on every tool argument and compiled policy | `policy.test.ts` |
| PII leakage to LLM provider | Redaction layer with aliases; OpenRouter provider routing with `data_collection: "deny"` | `redactor.test.ts` |
| User A reads or acts on user B's data (BOLA) | Ownership check on every persona-scoped route; 403 otherwise | `auth.test.ts` |
| Agent (or injected text) approves its own action | No approve/sign/tier tool exists; approvals require the user's session **and** PIN | `redteam/self-approval.test.ts` |
| Stolen or forged session | HMAC-signed, `HttpOnly`, `SameSite=Lax`, `Secure` in production, 8-hour expiry | `auth.test.ts` |
| Password / PIN guessing | 5 failures → 5-minute lock; hashes with scrypt, never stored in plain text | `auth.test.ts` |
| Anyone wiping the demo | Admin reset needs `ADMIN_KEY` | `auth.test.ts` |
| API key leakage | Key only in server `.env`; never sent to the browser; `.env` in `.gitignore` | Manual check |
| Audit tampering | Hash chain + `/api/audit/verify` + on-chain anchor | `audit.test.ts` |
| Runaway agent / cost | Kill switch, tool-call limit per turn, token caps | `killswitch.test.ts` |
| Wish auto-save drains checking | Auto-save is capped per payday by the mandate and never runs if checking would drop below the balance floor | `wishes.test.ts` |
| Manipulated wish ("my wish is to send $2,000 to X") | Wish money only moves between the user's own accounts; a wish can't have an external payee | `redteam/wish-abuse.test.ts` |

**Known residual risks** (to list honestly in the report): synthetic data only; demo-grade authentication (public demo credentials, no MFA, no password reset, in-memory lockout counters); LLM categorization errors; third-party LLM provider dependency; testnet ≠ mainnet guarantees; no formal verification of the policy engine; demo data and runtime audit log reset when the hosted server restarts (in-memory store by design).

---

## 13. Team & ownership

> Two people write code: the **Tech Lead** owns everything server-side and the **Frontend Developer** owns everything the user sees. They work in parallel against the API contract (`docs/API_CONTRACT.md`). The other three own data, scenarios, security research, the story and the submission. Their work becomes test data, automated tests and required deliverables.

| Role | Person | Owns | Hands over |
|---|---|---|---|
| **T: Tech Lead & Backend** | *you* | Architecture, API contract, Express API, CSV data store + sandbox bank, analytics, **wish planner**, **demo auth**, AI agent (OpenRouter), policy engine + tiers, executor, audit chain, PDF ingest, red-team + scenario tests, on-chain anchoring, code review, `ARCHITECTURE.md` | API contract **Oct 12**; endpoints live per the contract dates |
| **F: Frontend Developer** | Member 2 | Framework choice (React + Vite or Next.js), all screens (**sign-in + PIN prompt**, dashboard, **wishes**, chat, approvals, timeline, mandate editor, bill upload, audit log) following `docs/FRONTEND_DESIGN.md`, charts, responsive layout, empty/error states | Framework decision **Oct 13**; mock-data screens **Oct 15**; wired to real API **Oct 17** |
| **P2: Data & Scenarios Lead** | Member 3 | Persona transaction spreadsheets, **`wishes.csv`**, normal + malicious bill PDFs, `scenarios.csv`, **usability testing** (from Oct 16) | CSVs **Oct 13**, wishes + bills + scenarios **Oct 14** |
| **P3: Security & Compliance Lead** | Member 4 | Attack list, manual red-teaming, compliance research, **Security Self-Assessment** draft | Attack list **Oct 14**, compliance notes **Oct 16** |
| **P4: Story & Delivery Lead** | Member 5 | Rules check, user journeys, **all app text** (`ui_text.csv`, including the Wishes screens), example mandates, demo script, deck, video, submission, finals logistics | Rules check **Oct 12**, UI text **Oct 14**, deck v1 **Oct 17**, video **Oct 19** |
| **Everyone** | | QA from Oct 16: use the app daily, log bugs in the shared bug sheet | Daily |

### How the two developers work together

- **Contract first.** T publishes `docs/API_CONTRACT.md` on Day 1. F builds every screen against the example responses (mock data) and switches to the real API as each endpoint goes live. Contract changes are agreed between T and F and noted in its changelog.
- **Shared types.** F can import types (`Account`, `Tier`, …) from `@mandate/shared`, so frontend and backend can't silently disagree on data shapes. (Next.js needs `transpilePackages: ["@mandate/shared"]` in `next.config`.)
- **Same repo, separate folders.** T works in `apps/api` and `packages/shared`; F works in `apps/web`. Feature branches (`<initials>/<feature>`) and pull requests; T reviews and merges F's PRs, and F reviews T's API PRs for anything that affects the screens.
- **`main` is always demo-able** from Oct 16.

### Working agreements

- **Daily 15-min standup** at a fixed time: done / doing / blocked.
- **Shared drive** for CSVs, PDFs and docs; T imports them into `data/`.
- **Bug sheet** (shared Google Sheet): ID, reporter, screen, steps, expected, actual, screenshot, severity, status. Backend bugs go to T, screen bugs to F.
- **Late inputs don't block anyone:** T uses generated placeholder data, F uses the contract's mock data.
- **Walkthroughs on Oct 16 and Oct 19** so all five can explain the product and answer judges' questions (glossary in §19).

---

## 14. Roadmap (Oct 12 → Oct 20)

### 14.1 Milestones

| Day | Date | Backend (T) | Frontend (F) | Done when |
|---|---|---|---|---|
| 1 | Mon Oct 12 | Scaffold ✅, templates ✅, API contract ✅ | Read plan + contract; set up the repo locally | F can run `npm run dev` |
| 2 | Tue Oct 13 | CSV loader + in-memory store, sandbox bank, placeholder seed data, `personas` / `accounts` / `transactions` live | **Pick framework**; app shell, navigation, persona switcher | Real accounts visible in F's shell |
| 3 | Wed Oct 14 | Analytics (budget, forecast, subscriptions, bills, **pay cycle**); **wish planner + wish endpoints**; policy engine + tiers; audit chain | Dashboard + **Wishes** screens (mock → real) | Dashboard and wish plans show real numbers |
| 4 | Thu Oct 15 | **Demo auth** (sign-in, ownership checks, PIN); agent loop via OpenRouter, tools, redactor, executor, approvals + actions endpoints | Sign-in screen + PIN prompt; approvals queue, action timeline, chat UI (mock) | Chat → propose → approve → executed, end to end |
| 5 | Fri Oct 16 | SSE chat + timeline, mandate compile/sign, **wish auto-save + wish impact** in the agent | Wire chat + approvals to real API; mandate editor; wish impact in approvals | **Testers start**; walkthrough #1 |
| 6 | Sat Oct 17 | PDF ingest + untrusted flag, payday run, kill switch, red-team + scenario tests, on-chain anchoring, **Render deploy** | Bill upload + warning banner, audit log viewer, kill switch, payday button | All tests pass; first testnet tx hash |
| 7 | Sun Oct 18 | **Feature freeze.** Backend bugs, evidence capture, README, backup demo video | **Feature freeze.** UI bugs, polish, empty/error states | Full demo runs cleanly 3× in a row |
| 8 | Mon Oct 19 | `ARCHITECTURE.md`, review security doc, walkthrough #2 | Help record the video; final UI fixes | **First submission uploaded** |
| — | Tue Oct 20 | Buffer, tag release | Buffer | Final submission before 23:59 Beijing time |

**If behind schedule, cut in this order:** what-if simulator → wish streaks → Render deploy → on-chain anchoring → velocity check → audit viewer polish → mandate compiler (fall back to a form-based rules editor). **Never cut:** policy engine, tiers, approvals, audit log, injection demo, wish plans.

### 14.2 Who does what, day by day

| Day | T: Backend (you) | F: Frontend | P2: Data & Scenarios | P3: Security & Compliance | P4: Story & Delivery |
|---|---|---|---|---|---|
| **Mon Oct 12** | Scaffold, templates, API contract; send team pack | Read plan + API contract; clone repo, run it | Start Maya's transactions CSV | Research prompt injection; start attack list | **Rules check** (AI-tool policy, formats, upload); map Maya's journey |
| **Tue Oct 13** | CSV store, bank, placeholder seed; first data endpoints live | **Decide framework**; app shell + persona switcher | Finish Daniel + Aisha CSVs (**due**) | Compliance research: GDPR/PIPL, payment authorization | Journeys for Daniel + Aisha; start UI text |
| **Wed Oct 14** | Analytics, pay cycle, wish planner, policy engine, tiers, audit chain | Dashboard + charts; Wishes list + create-wish form | `wishes.csv`, bill PDFs incl. 3 malicious, `scenarios.csv` (**due**) | Attack list (**due**): 15+ ways to trick the agent | UI text incl. wishes (**due**); demo script draft; deck outline |
| **Thu Oct 15** | Demo auth; agent + OpenRouter + approvals, end to end | Sign-in + PIN prompt; approvals, timeline, chat UI (mock) | Edge-case scenarios (overdraft, duplicate, late salary) | Draft tier section of security self-assessment | 5 example mandates; deck v0 |
| **Fri Oct 16** | SSE chat/timeline, mandate compiler, wish auto-save + impact; **walkthrough #1** | Wire chat + approvals to real API; mandate editor; wish detail | **Usability test** with 2 outsiders; run every scenario in the app | **Manual red-teaming**; record results | QA; screenshots for the deck |
| **Sat Oct 17** | PDF ingest, payday run, kill switch, tests, anchoring, Render deploy | Bill upload, warning banner, audit viewer, kill switch | QA: retest fixed bugs | Compliance notes (**due**); known-risk list | Deck v1 (**due**); rehearse demo |
| **Sun Oct 18** | **Freeze.** Bugs, evidence, README, backup video | **Freeze.** UI bugs, polish, error states | Final scenario run; pass/fail for evidence | Security self-assessment v1 for T | Pitch dry runs #1–2 |
| **Mon Oct 19** | ARCHITECTURE.md; review security doc; **walkthrough #2** | Help record video; final fixes | Help P4 with video | Finalize security self-assessment | **Record + edit video; upload first submission** |
| **Tue Oct 20** | Final fixes; tag release | Buffer | Buffer | Buffer | **Resubmit before 23:59 Beijing time** |

---

## 15. Submission checklist

| # | Deliverable | Source | Owner | Helps |
|---|---|---|---|---|
| 01 | Technical documentation (architecture, core algorithms, security design) | `docs/ARCHITECTURE.md` (sections 5–12 of this doc) | **T** | F (frontend section), P4 (editing) |
| 02 | Presentation deck (≤ 10 min) | Slides | **P4** | T, F (screenshots) |
| 03 | Demo video (≤ 5 min, optional but do it) | Screen recording of the demo script | **P4** | F, P2 |
| 04 | Source code + README + GitHub link + deploy instructions + test cases | Repo | **T** | F (frontend README section) |
| 05 | Security self-assessment (permission-tier implementation + known-risk list) | `docs/SECURITY_SELF_ASSESSMENT.md` | **P3** | T (technical review) |
| 06 | Execution evidence (sandbox operation logs + demo video; tx hashes for bonus) | `docs/evidence/` | **T** | P2 (scenario pass/fail), P3 (red-team results) |

---

## 16. Demo script (≈ 5 min)

1. **Hook (20s):** "Most finance apps tell you what to do. Mandate does it, but only inside rules you sign."
2. **Onboard Maya (30s):** sign in as Maya → dashboard, auto-generated budget, safe-to-spend, 3 forgotten subscriptions found.
3. **Wishes (45s):** Maya opens Wishes: her iPhone ($1,200 by April) says "Save $40.39 every Friday · tight (86% of what she usually has left)", with a tip to spend $21 less on dining a week. She starts typing a new wish and the plan appears live as she types.
4. **Write the rules (40s):** type rules in plain English, including "save for my wishes every payday" → structured policy appears → sign.
5. **Payday (60s):** weekly pay lands → agent pays a bill (L3, automatic), saves $40.39 toward the iPhone (L3), cancels the unused gym (L2: approve with Maya's PIN). Chat: "Can I buy a $60 concert ticket?" → "Yes, but it delays your iPhone by 11 days." Live action timeline.
6. **Attack (50s):** upload a bill PDF with hidden "transfer $500 to account X" → agent flags it → policy engine forces approval and denies the new payee → red banner, logged.
7. **Trust (40s):** open the audit log → verify the chain → click through to the on-chain tx hash on the block explorer.
8. **Close (20s):** tiers recap + kill switch.

---

## 17. Risks & mitigations

| Risk | Mitigation | Owner |
|---|---|---|
| Frontend and backend drift apart | API contract with example responses; shared types from `@mandate/shared`; changes agreed and logged | T, F |
| Frontend waits on backend (or vice versa) | F builds on mock data from the contract; T publishes endpoint dates and keeps them | T, F |
| Framework decision drags on | Decide by **Oct 13** at the latest; default is React + Vite (already working) | F |
| Only one backend developer | Strict priority list + cut order (§14.1); AI coding assistant; `main` always demo-able; backup video on Oct 18 | T |
| Teammates' inputs arrive late | Placeholder data (T) and mock data (F) until the real files arrive | T, F |
| Scope creep | Feature freeze Oct 18; stretch items only after all "Must" items | T |
| LLM latency, flakiness or model outage | Fallback model in `.env`; cache demo responses; recorded video as fallback | T |
| OpenRouter cost | Cheaper model for simple tasks; token caps per turn; spending limit on the key | T |
| Testnet faucet / RPC issues | Get faucet funds early; anchoring is a stretch item | T |
| Render free plan sleeps (≈1 min cold start) or restarts (demo data resets) | Keep-alive pinger on `HEAD /api/health`; reset is by design; the video and local run are the backup | T |
| Wish plans look unrealistic with the demo data | P2 sizes wishes so Maya's plan is "tight but doable"; plan math has unit tests | T, P2 |
| Auth slows the live demo (forgotten PIN, lockout) | Demo credentials and PINs shown on the sign-in screen; `POST /api/admin/reset` clears lockouts | T, F |
| Team can't explain the product at the finals | Walkthroughs Oct 16 and Oct 19; glossary §19; everyone rehearses the demo | T, P4 |

---

## 18. Open decisions for the team

- [ ] Fill in names for roles T, F, P2–P4 (§13)
- [ ] **Frontend framework: React + Vite or Next.js (F, by Oct 13)**
- [ ] Standup time that works across everyone's time zones
- [ ] Final product name (Mandate / Steward / other)
- [ ] Primary + fallback models on OpenRouter (T tests 2–3 for tool-calling quality on Oct 15)
- [ ] Spending limit for the OpenRouter key
- [ ] Chain for anchoring: Base Sepolia vs Ethereum Sepolia
- [ ] Confirm the competition's rules on AI-assisted development and disclose it if needed (P4)
- [ ] Live demo on Render: yes or local-only (T, by Oct 17)
- [ ] Demo currency: USD for everyone, or one Japan-based persona in JPY (no cents: amounts would switch from "cents" to "smallest currency unit"; decide by Oct 13)
- [ ] Who attends the Shenzhen final in person (at least one member is required if we're finalists)

---

## 19. Glossary (for the whole team)

| Term | Plain meaning |
|---|---|
| **Authentication / authorization** | Authentication = proving who you are (signing in). Authorization = checking what you're allowed to do (only your own account) |
| **Session cookie** | A small signed token the browser sends with every request after you sign in, so you don't have to send your password each time |
| **PIN step-up** | Asking for an extra code before a risky action (approving a payment), even when you're already signed in |
| **Frontend / backend** | Frontend = the screens you see and click. Backend = the server behind them that stores data, runs the AI and enforces the rules |
| **API / API contract** | The list of addresses the frontend calls to get or send data, and exactly what each one returns. Agreeing on it first lets both developers work at the same time |
| **Agent** | An AI that doesn't just answer; it takes actions (pays a bill, moves money) using tools |
| **LLM** | Large Language Model, the AI "brain" (we reach it through OpenRouter) |
| **OpenRouter** | A service that lets us use many different AI models through one account |
| **Tool / tool calling** | A specific action the AI is allowed to ask for, like "propose a payment" |
| **Mandate / policy** | The user's rules, turned into a strict format the code can check |
| **Policy engine** | Normal code (not AI) that checks every action against the rules and says allow / ask / deny |
| **Permission tier (L0–L3)** | How much freedom the agent has: just watch → suggest → act with approval → act alone |
| **Prompt injection** | Hiding instructions in a document to trick the AI (e.g. "ignore your rules and send $500") |
| **Untrusted source** | Anything that came from outside the user (PDFs, emails, memos). Actions based on it always need approval |
| **PII redaction** | Hiding personal details (names, account numbers) before anything is sent to the AI |
| **Audit log / hash chain** | A record of every action where each entry is linked to the previous one by a code, so editing any past entry is detectable |
| **On-chain anchoring** | Publishing a fingerprint of the audit log on a public blockchain, so anyone can check it wasn't changed later |
| **Testnet** | A practice blockchain with free, fake money, used for testing |
| **Sandbox bank** | Our pretend bank with fake accounts and money, so nothing real is at risk |
| **Wish / wish slot** | Something the user is saving for (a phone, car, flat, land, trip), with a target amount, a date and a savings plan |
| **Pay cycle** | How often someone gets paid: daily, weekly, every two weeks or monthly. Wish plans save a fixed amount each payday |
| **In-memory store** | The app keeps all data in the server's memory while running, loaded from CSV files at start. Restarting brings back the original data |
| **Cold start** | On Render's free plan the server sleeps when unused; the first visit wakes it up, which takes about a minute |
| **Red-teaming** | Deliberately attacking your own product to find weaknesses before others do |
