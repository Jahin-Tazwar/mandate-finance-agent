# MoneyWise API Contract (v3.9)

The agreement between the backend (Tech Lead) and the frontend (Frontend Developer).
**The frontend can build every screen today using the example responses below as mock data**, then switch to the real API as each endpoint goes live.

> Status: ✅ live · 🛠 planned (target date). If you need a change, ask the Tech Lead; don't work around it. Changes are noted in the changelog at the bottom.

---

## Conventions

| Topic | Rule |
|---|---|
| Base URL | `/api` (dev: the frontend proxies `/api` to `http://localhost:4000`) |
| Format | JSON in, JSON out (except SSE streams and file upload) |
| **Money** | Always **integer cents**: `balanceCents: 184050` = **$1,840.50**. Format on the frontend: `(cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })` |
| Dates | `"2026-10-12"` (date) or `"2026-10-12T09:15:00.000Z"` (timestamp, UTC) |
| Persona | Most routes start with `/api/personas/:personaId/...` (`maya`, `daniel`, `aisha`) |
| **Auth** (✅ live) | Sign in with `POST /api/auth/login`; the server sets an `HttpOnly` session cookie that the browser sends automatically (same origin, so plain `fetch` works; use `credentials: "include"` only if you ever call the API from another origin). **Every** `/api/personas/:personaId/*`, `/api/wishes/*`, `/api/actions/*` and `GET /api/audit` needs it: not signed in → `401`; another persona's data (or a persona that doesn't exist) → `403`. Public: `/api/health`, `/api/meta`, `/api/personas`, `/api/auth/*`, `/api/audit/verify`. Sessions last 8 hours. **Transition:** until the sign-in screen ships, the hosted server may run with `AUTH_DISABLED=true`, which lets requests *without* a session through (signed-in requests are still checked, and PINs are still required). |
| **PIN** (from Oct 15) | Three risky actions need the persona's 4-digit `pin` in the request body: **approving** an action, **signing** a mandate, turning the agent **on**. Wrong PIN → `403` with `attemptsLeft`; 5 failures → `429` with `retryAfterSeconds` |
| Errors | Non-2xx responses always return `{ "error": "message", "issues"?: [...], "attemptsLeft"?: n, "retryAfterSeconds"?: n }`. Broken JSON → `400 { "error": "Invalid JSON" }`. Deciding an action that's already decided → `409`. |
| Types | TypeScript types for every shape live in `packages/shared` (`@mandate/shared`) and can be imported directly by the frontend |

### Shared value lists

- `AccountType`: `checking` · `savings` · `credit`
- `Category`: `income` · `housing` · `utilities` · `groceries` · `dining` · `transport` · `subscriptions` · `shopping` · `education` · `health` · `entertainment` · `transfer` · `fees` · `other`
- `Tier`: `L0` observe · `L1` recommend · `L2` act with approval · `L3` autonomous
- `Decision`: `allow` · `require_approval` · `deny`
- `ActionStatus`: `executed` · `pending_approval` · `denied` · `rejected`
- `ActionSource`: `user` · `agent` · `untrusted`
- `PayCadence`: `daily` · `weekly` · `biweekly` · `monthly` · `irregular`
- `WishCategory`: `gadget` · `vehicle` · `property` · `travel` · `education` · `luxury` · `other`
- `WishStatus`: `on_track` · `tight` · `not_realistic` · `achieved` · `paused`

> **Data resets on restart.** The backend keeps data in memory, loaded from CSV files. Restarting the server (or `POST /api/admin/reset`) restores the original demo data. The hosted version is kept awake by a pinger, but if it ever does sleep, the first request can take about a minute, so show a friendly loading state.

---

## System

### ✅ `GET /api/health` (also `HEAD`)
Used by the keep-alive pinger (`HEAD`) and the frontend's waking-up check (`GET`).
```json
{ "ok": true, "service": "moneywise-api", "time": "2026-10-12T15:27:27.423Z" }
```

### ✅ `GET /api/meta`
```json
{ "tiers": ["L0", "L1", "L2", "L3"] }
```

### ✅ `POST /api/admin/reset`
Reloads all demo data from the CSV seed files (also clears sign-in lockouts). From Oct 15 it needs the header `x-admin-key: <ADMIN_KEY>` when `ADMIN_KEY` is set on the server (always on the hosted version; open in local dev). Returns `{ "ok": true, "resetAt": "2026-10-13T10:00:00.000Z" }`. Use it from a hidden "Reset demo" button.

---

## Auth (Oct 15)

### ✅ `GET /api/auth/demo-accounts`
Public list for the sign-in screen. The credentials are fake and intentionally public; showing them lets judges sign in with one click.
```json
[
  { "personaId": "maya", "name": "Maya Chen", "profile": "International student…", "username": "maya", "password": "maya-demo", "pin": "1111" },
  { "personaId": "daniel", "...": "password daniel-demo, pin 2222" },
  { "personaId": "aisha", "...": "password aisha-demo, pin 3333" }
]
```

### ✅ `POST /api/auth/login`
Request: `{ "username": "maya", "password": "maya-demo" }` → `200` with the `Persona` and a `Set-Cookie` header.
Wrong credentials → `401 { "error": "Wrong username or password", "attemptsLeft": 4 }` (an unknown username gets the same message). The 5th wrong try locks that username for 5 minutes → `429 { "error": "Too many attempts", "retryAfterSeconds": 300 }`. Sign-ins and failed sign-ins are recorded in the audit log.

### ✅ `GET /api/auth/me`
→ `{ "persona": Persona }` when signed in, `401` otherwise. Call it on app start to decide between the sign-in screen and the app.

### ✅ `POST /api/auth/logout`
→ `204`, clears the cookie. "Switch demo account" = logout + login as another persona.

---

## Bank data

### ✅ `GET /api/personas`
```json
[
  { "id": "maya", "name": "Maya Chen", "profile": "International student, part-time cafe job", "currency": "USD" },
  { "id": "daniel", "name": "Daniel Okafor", "profile": "Young professional, many subscriptions", "currency": "USD" },
  { "id": "aisha", "name": "Aisha Rahman", "profile": "Gig worker with weekly income", "currency": "USD" }
]
```

### ✅ `GET /api/personas/:personaId/accounts`
```json
[
  { "id": "acc_maya_chk", "personaId": "maya", "type": "checking", "name": "Everyday checking", "balanceCents": 64210 },
  { "id": "acc_maya_sav", "personaId": "maya", "type": "savings", "name": "Savings", "balanceCents": 35000 }
]
```

### ✅ `GET /api/personas/:personaId/transactions`
Query (all optional): `from`, `to` (dates), `category`, `account` (AccountType), `limit` (default 50, max 500), `offset`. Sorted newest first. Invalid values → `400` with `issues`. Response type: `TransactionPage` from `@mandate/shared`.
```json
{
  "total": 214,
  "items": [
    {
      "id": "tx_8f2a",
      "accountId": "acc_maya_chk",
      "date": "2026-10-09",
      "description": "Weekly pay",
      "merchant": "Campus Cafe Payroll",
      "amountCents": 24550,
      "category": "income",
      "memo": null
    }
  ]
}
```

### ✅ `GET /api/personas/:personaId/budget`
Current month by default; `?month=2026-09` for another (invalid → `400`). Each category's budget = average of the last 3 full months (one-off payments over $500 excluded), rounded up to $5. `spentCents` = this month so far. `insights` are ready-to-show sentences. Real example (Maya):
```json
{
  "month": "2026-10",
  "safeToSpendTodayCents": 3445,
  "categories": [
    {
      "category": "housing",
      "budgetCents": 75000,
      "spentCents": 75000
    },
    {
      "category": "groceries",
      "budgetCents": 39500,
      "spentCents": 5306
    },
    {
      "category": "dining",
      "budgetCents": 17500,
      "spentCents": 7785
    },
    {
      "category": "shopping",
      "budgetCents": 10500,
      "spentCents": 9135
    },
    {
      "category": "utilities",
      "budgetCents": 8000,
      "spentCents": 0
    },
    {
      "category": "subscriptions",
      "budgetCents": 6000,
      "spentCents": 5747
    },
    {
      "category": "transport",
      "budgetCents": 6000,
      "spentCents": 6000
    }
  ],
  "insights": [
    "Dining is ahead of pace: $77.85 of $175 spent already.",
    "Shopping is ahead of pace: $91.35 of $105 spent already.",
    "You haven't used FitZone since you started paying (163 days). It costs $29.99 a month."
  ]
}
```

`safeToSpendTodayCents`: the most she can spend per day from today without her planned checking balance (pay + bills + commitments, next 30 days) ever dropping below $200.

### ✅ `GET /api/personas/:personaId/forecast`
30 days of projected checking balance, starting today, including typical everyday spending. Real example (Maya, first 3 of 30 days shown):
```json
{
  "days": [
    {
      "date": "2026-10-12",
      "balanceCents": 45233
    },
    {
      "date": "2026-10-13",
      "balanceCents": 43074
    },
    {
      "date": "2026-10-14",
      "balanceCents": 40915
    }
  ],
  "lowestPoint": {
    "date": "2026-10-15",
    "balanceCents": 38756
  },
  "warnings": []
}
```
`warnings` is empty when the balance stays above $200; otherwise e.g. `"Checking may drop below $200 on Nov 1 after Greenview Student Housing ($750)."`

### ✅ `GET /api/personas/:personaId/subscriptions`
Sorted by `unusedDays` (least used first). `lastUsed: null` + a number in `unusedDays` = never used since the first charge; `unusedDays: null` = no usage data. Real example (Maya):
```json
[
  {
    "id": "sub_maya_fitzone",
    "merchant": "FitZone",
    "amountCents": 2999,
    "cadence": "monthly",
    "accountId": "acc_maya_chk",
    "lastCharged": "2026-10-02",
    "nextCharge": "2026-11-02",
    "lastUsed": null,
    "unusedDays": 163,
    "status": "active"
  },
  {
    "id": "sub_maya_netflix",
    "merchant": "Netflix",
    "amountCents": 1549,
    "cadence": "monthly",
    "accountId": "acc_maya_chk",
    "lastCharged": "2026-10-09",
    "nextCharge": "2026-11-09",
    "lastUsed": "2026-10-09",
    "unusedDays": 3,
    "status": "active"
  },
  {
    "id": "sub_maya_spotify",
    "merchant": "Spotify",
    "amountCents": 1199,
    "cadence": "monthly",
    "accountId": "acc_maya_chk",
    "lastCharged": "2026-10-05",
    "nextCharge": "2026-11-05",
    "lastUsed": "2026-10-11",
    "unusedDays": 1,
    "status": "active"
  }
]
```

### ✅ `GET /api/personas/:personaId/bills`
Predicted bills due in the next 30 days, soonest first. Real example (Maya):
```json
[
  {
    "id": "bill_maya_mobi-telecom_20261012",
    "payee": "Mobi Telecom",
    "amountCents": 3500,
    "dueDate": "2026-10-12",
    "status": "due",
    "source": "bank",
    "accountId": "acc_maya_chk"
  },
  {
    "id": "bill_maya_greenview-utilities_20261020",
    "payee": "Greenview Utilities",
    "amountCents": 4251,
    "dueDate": "2026-10-20",
    "status": "due",
    "source": "bank",
    "accountId": "acc_maya_chk"
  },
  {
    "id": "bill_maya_greenview-student-housing_20261101",
    "payee": "Greenview Student Housing",
    "amountCents": 75000,
    "dueDate": "2026-11-01",
    "status": "due",
    "source": "bank",
    "accountId": "acc_maya_chk"
  },
  {
    "id": "bill_maya_city-transit_20261101",
    "payee": "City Transit",
    "amountCents": 6000,
    "dueDate": "2026-11-01",
    "status": "due",
    "source": "bank",
    "accountId": "acc_maya_chk"
  }
]
```
`status`: `due` · `paid` · `overdue`. `source`: `bank` (predicted from history) or `document` (uploaded PDF, from Oct 17).

### ✅ `GET /api/personas/:personaId/pay-cycle`
Detected from income history. `payday` is a ready-to-show label: `"Fridays"`, `"the 25th"`, `"almost every day"`. Real example (Maya):
```json
{
  "cadence": "weekly",
  "payday": "Fridays",
  "nextPayday": "2026-10-16",
  "avgIncomePerCycleCents": 41611,
  "avgSurplusPerCycleCents": 4706
}
```
`avgSurplusPerCycleCents` = what's typically left each pay cycle after **all** normal spending (one-offs and savings transfers excluded). Wish plans are checked against it. For daily earners (Aisha) everything is per day.

---

## Wishes

All wishes of a persona are planned **together, in priority order**: each wish only gets what's left over after the wishes above it. Plans save a fixed amount **every payday** (daily, weekly or monthly, from `pay-cycle`).

### The `Wish` object
Real example (Maya's iPhone):
```json
{
  "personaId": "maya",
  "title": "iPhone 17",
  "category": "gadget",
  "targetCents": 120000,
  "savedCents": 15000,
  "targetDate": "2027-04-12",
  "priority": 1,
  "autoSave": true,
  "paused": false,
  "status": "tight",
  "progressPct": 12.5,
  "plan": {
    "cadence": "weekly",
    "perPaydayCents": 4039,
    "paydaysLeft": 26,
    "nextContributionDate": "2026-10-16"
  },
  "eta": {
    "date": "2027-04-09",
    "daysVsTarget": -3
  },
  "advice": [
    "Saving $40.39 each Friday uses 86% of what you usually have left over.",
    "Spending $21 less on dining a week would make this comfortable."
  ],
  "id": "wish_maya_1",
  "createdAt": "2026-10-14T15:23:30.866Z"
}
```
- `status`: `on_track` (uses ≤ 60% of what's left over), `tight` (≤ 100%), `not_realistic` (more, or the date is before the next payday), `achieved`, `paused`.
- `eta`: when it's reached at the pace that's actually affordable. `daysVsTarget` negative = early, positive = late. `null` = can't be reached at the current pace (or paused).
- `plan.nextContributionDate`: `null` when achieved, paused, or the date is too soon.
- `advice`: ready-to-show sentences (how much of the surplus it uses; a spending cut if tight; a realistic date if not).

### ✅ `GET /api/personas/:personaId/wishes`
Wishes sorted by `priority`, plus whether they fit together. Real example (Maya, iPhone shortened):
```json
{
  "wishes": [
    {
      "...": "iPhone 17 (above)"
    },
    {
      "personaId": "maya",
      "title": "Trip to Kyoto",
      "category": "travel",
      "targetCents": 50000,
      "savedCents": 24000,
      "targetDate": "2026-12-20",
      "priority": 2,
      "autoSave": true,
      "paused": false,
      "status": "not_realistic",
      "progressPct": 48,
      "plan": {
        "cadence": "weekly",
        "perPaydayCents": 2600,
        "paydaysLeft": 10,
        "nextContributionDate": "2026-10-16"
      },
      "eta": {
        "date": "2027-07-09",
        "daysVsTarget": 201
      },
      "advice": [
        "Saving $26 each Friday is more than the $6.67 you usually have left over.",
        "At what you can afford ($6.67 each Friday), you'd reach it around Jul 9, 2027. Move the date, or lower the target."
      ],
      "id": "wish_maya_2",
      "createdAt": "2026-10-14T15:23:30.866Z"
    }
  ],
  "totalPerPaydayCents": 6639,
  "surplusPerPaydayCents": 4706,
  "overCommitted": true
}
```

### ✅ `POST /api/personas/:personaId/wishes/preview`
Live plan for the "new wish" form. **Saves nothing.** Call it as the user types (debounce ~300 ms). The draft is planned *after* the existing wishes unless you send a `priority`.
Request:
```json
{ "title": "Laptop", "category": "gadget", "targetCents": 90000, "targetDate": "2027-06-01" }
```
Optional: `savedCents` (default 0), `priority`, `autoSave` (default true). Response: a `Wish` without `id` / `createdAt`. `targetDate` must be after today → otherwise `400`.

### ✅ `POST /api/personas/:personaId/wishes`
Same body as preview → `201` with the saved `Wish` (id like `wish_maya_3`).

### ✅ `GET /api/wishes/:wishId`
The `Wish`, its saving history, and a projection for a chart (one point per payday; long plans are thinned to ~60 points). Real example (Maya's iPhone, first 3 projection points shown):
```json
{
  "wish": {
    "...": "Wish"
  },
  "contributions": [],
  "projection": [
    {
      "date": "2026-10-16",
      "savedCents": 19039
    },
    {
      "date": "2026-10-23",
      "savedCents": 23078
    },
    {
      "date": "2026-10-30",
      "savedCents": 27117
    }
  ]
}
```
`contributions` lists every top-up and auto-save, oldest first, e.g. `{ "id": "wc_1", "date": "2026-10-12", "amountCents": 4039, "source": "agent", "actionId": "act_3" }`.

### ✅ `PATCH /api/wishes/:wishId`
Any of: `title`, `targetCents`, `targetDate`, `priority`, `autoSave`, `paused` → the updated `Wish` with a recalculated plan. Unknown fields → `400`. Pausing a wish frees its money for the wishes below it.

### ✅ `DELETE /api/wishes/:wishId`
Removes the wish → `204`. Money already saved stays in savings.

### ✅ `POST /api/wishes/:wishId/contribute`
Manual top-up from checking to savings. Request: `{ "amountCents": 2000 }` → `201` with an `Action`. It goes through the policy engine like everything else: the user's own top-up is `executed`, unless it would break the $200 floor or there isn't enough money (then `denied`). The wish's `savedCents` goes up and the top-up appears in `GET /wishes/:id` → `contributions`:
```json
[{ "id": "wc_1", "date": "2026-10-12", "amountCents": 2000, "source": "user", "actionId": "act_1" }]
```

### ✅ `GET /api/personas/:personaId/wishes/impact?amountCents=6000`
"What does this purchase do to my wishes?" Money spent is money not saved, so the top wish that's currently receiving money arrives later. Real example (Maya):
```json
{
  "amountCents": 6000,
  "impacts": [
    {
      "wishId": "wish_maya_1",
      "title": "iPhone 17",
      "delayDays": 11
    }
  ],
  "message": "Spending $60 delays your iPhone 17 by 11 days."
}
```
Also included automatically in payment `Action`s as `wishImpact` (same shape as `impacts`).

---

## Agent & actions

### ✅ `POST /api/personas/:personaId/chat`: **Server-Sent Events stream**
Request: `{ "message": "Can I afford a $60 concert ticket this week?" }`
The response is a stream of events (read with `fetch` + a stream reader):
```
event: text      data: {"delta":"Yes. Your safe-to-spend today is $23.50, but "}
event: tool      data: {"name":"get_forecast","status":"done"}
event: action    data: { ...Action (see below) }
event: done      data: {}
event: error     data: {"error":"..."}
```
`tool` arrives twice per tool (`"status":"running"`, then `"done"`): show "Checking your bills…" while it runs. Append each `text` `delta` to the chat bubble: the answer arrives **word by word** as the AI writes it (a `delta` may also be `"\n\n"` between paragraphs). Every chat ends with `done`. Problems arrive as an `error` event (e.g. the AI isn't configured, or the model is down), never as a broken stream. Before the stream starts: empty message → `400`; a reply still running for this persona → `429`.

What the agent can do: look things up (balances, bills, subscriptions, budget, forecast, rules, wishes, transactions, wish impact) and **propose** payments, transfers, wish savings, cancellations and disputes. It has no way to move money itself: every proposal becomes an `Action` decided by the policy engine, and is sent as an `action` event. At most 3 actions per message. Personal data (emails, card/account numbers, phone and ID numbers) is redacted before anything reaches the model.

### The `Action` object (used by chat, approvals and the timeline)
Real example (Daniel's agent proposes the power bill):
```json
{
  "id": "act_1",
  "personaId": "daniel",
  "type": "payment",
  "summary": "Pay CityPower $132.80",
  "params": { "fromAccount": "checking", "payee": "CityPower", "amountCents": 13280 },
  "source": "agent",
  "tier": "L2",
  "decision": "require_approval",
  "status": "pending_approval",
  "reasons": ["$132.80 is over your $100 limit per payment."],
  "agentRationale": "The power bill is due Oct 15 and checking can cover it.",
  "createdAt": "2026-10-15T16:48:08.998Z",
  "decidedAt": null,
  "approvedBy": null,
  "executedAt": null,
  "wishImpact": [{ "wishId": "wish_daniel_1", "title": "Car down payment", "delayDays": 15 }]
}
```
- `type`: `payment` · `transfer` · `cancel_subscription` · `dispute` · `wish_contribution`
- `status`: `executed` (done) · `pending_approval` (waiting for the user) · `denied` (blocked by the rules) · `rejected` (the user said no)
- `params` by type: payment `{ fromAccount, payee, amountCents, billId? }` · transfer `{ fromAccount, toAccount, amountCents }` · wish_contribution `{ wishId, amountCents }` · cancel_subscription `{ subscriptionId, merchant }` · dispute `{ transactionId }`
- `reasons[0]` is the deciding reason: show it on the card. `agentRationale` is `null` for the user's own actions. `wishImpact` is present on payments only (empty array if no wish is affected, and always empty on a `denied` payment: blocked money delays nothing).

### ✅ `GET /api/personas/:personaId/approvals`
Returns `Action[]` with `status: "pending_approval"`.

### ✅ `POST /api/actions/:actionId/decision`
Request: `{ "decision": "approve", "pin": "2222" }` or `{ "decision": "reject" }` (rejecting never needs a PIN) → `200` with the updated `Action`.

- Approved → `"status": "executed"` with `approvedBy`, `decidedAt` and `executedAt` set.
- The rules are checked **again** when approving (the balance may have changed). If it would now break the floor, there isn't enough money, or the same payment was already made meanwhile → `"status": "denied"` and `reasons[0]` starts with `"Can't do this any more: …"`, e.g. `"Can't do this any more: You already paid CityPower $132.80 today. MoneyWise won't pay the same bill twice."` Show that reason.
- Wrong PIN → `403 { "error": "Wrong PIN", "attemptsLeft": 4 }`; the 5th wrong PIN → `429 { "retryAfterSeconds": 300 }`. Each PIN lock in a row is longer (300 → 900 → 1800 → 3600 seconds, then 3600 each time); only a correct PIN resets it. Show `retryAfterSeconds` as minutes, never a fixed "5 minutes".
- Already decided → `409`. Someone else's action → `403`. Unknown id → `404`.

### ✅ `GET /api/personas/:personaId/actions`
All actions, newest first (`?limit=50`). For the action timeline's history.

### ✅ `GET /api/personas/:personaId/timeline`: **SSE stream**
Open it once (with `fetch` + a stream reader, or `EventSource`, which sends the cookie automatically on the same site). First `event: ready`, then an `event: action` with the full `Action` every time one of this persona's actions is **created or changes status** (approved, rejected, blocked at approval). Use it to update Approvals, the badge and Activity live. Lines starting with `:` are keep-alives; ignore them. The stream stays open until you close it.

### ✅ `POST /api/personas/:personaId/agent/run`
Request: `{ "trigger": "payday" }` → `{ "paycheck": Transaction | null, "actions": Action[] }`. Powers the **Run payday** button. The pay lands (a copy of the persona's last pay, once per reset), then the agent proposes, and the rules decide each one:

1. bills due before the next payday
2. auto-save for wishes (the planned amount)
3. cancelling subscriptions unused for 30+ days
4. disputing duplicate charges

Real result (Maya): `executed: Pay Mobi Telecom $35` · `executed: Save $40.39 for iPhone 17` · `executed: Save $6.67 for Trip to Kyoto` · `pending_approval: Cancel FitZone`. Running it again → `{ "paycheck": null, "actions": [] }` (nothing is done twice). With the kill switch on, the pay still lands but every action is `denied`. Then open Activity / show the actions.

### ✅ `GET` / `POST /api/personas/:personaId/killswitch`
`enabled` means **the kill switch is ON (the agent only watches)**. `GET` → `{ "enabled": false }`.

- Stop the agent: `{ "enabled": true }` → `{ "enabled": true }` (never needs a PIN).
- Start it again: `{ "enabled": false, "pin": "1111" }` → `{ "enabled": false }`. Wrong or missing PIN → `403` with `attemptsLeft`.

While it's on, every agent action (chat, payday) is `denied` with "The agent is switched off…"; the user's own actions still work.

---

## Mandate (the rules the user signs)

### ✅ `GET /api/personas/:personaId/mandate`
The persona's signed rules: the plain-English text, the rules as data (amounts in cents), and one sentence per rule. Every persona starts with version 1. Real example (Maya):
```json
{
  "version": 1,
  "naturalLanguage": "Never let my checking go below $200. Ask me before any payment over $100 or to anyone new. Save up to $80 for my wishes every payday. Never move more than $500 a day.",
  "signedAt": "2026-10-14T17:14:26.218Z",
  "policy": {
    "defaultTier": "L2",
    "rules": [
      {
        "type": "balance_floor",
        "account": "checking",
        "minCents": 20000
      },
      {
        "type": "amount_cap",
        "perTxCents": 10000,
        "aboveTier": "L2"
      },
      {
        "type": "new_payee",
        "tier": "L2",
        "cooldownHours": 24
      },
      {
        "type": "daily_cap",
        "maxCents": 50000
      },
      {
        "type": "wish_autosave",
        "trigger": "income_detected",
        "maxPerPaydayCents": 8000,
        "tier": "L3"
      }
    ]
  },
  "summary": [
    "Checking never goes below $200.",
    "Payments over $100 happen only with your approval.",
    "Paying someone new happens only with your approval, and they count as new for 24 hours.",
    "The agent can move at most $500 a day.",
    "On payday, up to $80 goes to your wishes automatically.",
    "Anything else happens only with your approval."
  ]
}
```
Rule types: `balance_floor`, `amount_cap`, `new_payee`, `daily_cap`, `sweep`, `wish_autosave` (see `Rule` in `@mandate/shared`).

### ✅ `POST /api/personas/:personaId/policy/check` (dry run)
"Would the agent be allowed to do this?" The policy engine decides and the check is written to the audit log, but **nothing is executed**. Useful for showing the rules in action, the red-team tests, and manual attack testing before the agent exists.
Request: a `ProposedAction` (see `@mandate/shared`): `type` = `payment` · `transfer` · `wish_contribution` · `cancel_subscription` · `dispute`, plus `source` = `user` · `agent` · `untrusted`.
Real example: an injected payment from a bill PDF (Daniel):
```json
{
  "action": {
    "source": "untrusted",
    "type": "payment",
    "fromAccount": "checking",
    "payee": "Account 99-1234",
    "amountCents": 50000
  },
  "decision": "deny",
  "tier": "L0",
  "reasons": [
    "A document asked to pay Account 99-1234, someone you've never paid. Documents can't add new payees; if this is a real new biller, add them yourself."
  ]
}
```
Real example: the agent wants to pay Daniel's electricity bill:
```json
{
  "action": {
    "source": "agent",
    "type": "payment",
    "fromAccount": "checking",
    "payee": "CityPower",
    "amountCents": 13280
  },
  "decision": "require_approval",
  "tier": "L2",
  "reasons": [
    "$132.80 is over your $100 limit per payment."
  ]
}
```
`decision`: `allow` (L3, do it) · `require_approval` (L2/L1, ask the user) · `deny` (blocked). The first reason is always the deciding one.

### ✅ `POST /api/personas/:personaId/mandate/compile`
Request: `{ "text": "Never let my checking go below $300. Ask me before any payment over $20 or to anyone new." }` → `{ "policy": {...}, "summary": ["Checking never goes below $300.", ...], "warnings": [], "notUnderstood": [] }`. **Saves nothing**: show `summary` and `warnings` for review. The text is read by plain code, not by the AI (so a prompt injection can never rewrite the rules). Sentences it doesn't understand come back as warnings (`Not understood, so it was left out: "…"`) **and** in `notUnderstood` (just the sentences: when it's not empty, offer "Get help" → `mandate/explain`), and risky rules come back as warnings too (no minimum balance, no daily limit, "everything else automatically").

What it understands (examples): "Never let my checking go below $200" · "Keep at least $500 in checking" · "Ask me before any payment over $100" · "Never pay more than $1,000 at once" (= blocked) · "…or to anyone new" · "New payees wait 48 hours" · "Never move more than $500 a day" · "Save up to $80 for my wishes every payday" · "On payday, move checking above $2,000 into savings" · "Ask me about everything else".

### ✅ `POST /api/personas/:personaId/mandate/explain`
**AI help** for the sentences in `notUnderstood`. Request: `{ "sentences": ["Don't let me go broke", ...] }` (1–10 sentences, each up to 300 characters) → `{ "suggestions": [...] }`, one per sentence, in order. **Saves and applies nothing.**

How it stays safe: the AI only writes **English**. Every rewrite is run through the same rule checker on the server; one it still can't read is dropped (`rewrite: null`). A rewrite that passes comes with `summary` (what it would mean) and `warnings` (its risks), so the user sees exactly what they'd be agreeing to. "Use this" puts the rewrite into the editor text → compile again → signing still needs the PIN.

Real output (free model, Oct 17), Maya:
```json
{
  "suggestions": [
    {
      "original": "Don't let me go broke",
      "rewrite": "Never let my checking go below $0.",
      "explanation": "The checker didn't understand the vague phrase; this rewrite expresses it as a minimum-balance rule.",
      "summary": [
        "Checking never goes below $0."
      ],
      "warnings": [
        "A minimum balance of $0 is very low."
      ]
    },
    {
      "original": "No more than $200 a month on dining",
      "rewrite": null,
      "explanation": "MoneyWise can't enforce monthly limits on specific categories like dining yet.",
      "summary": [],
      "warnings": []
    }
  ]
}
```
Show each suggestion under its sentence: the explanation; if there's a rewrite, the rewrite + its `summary` + any `warnings` (highlighted) + a **Use this** button. If the AI isn't available, every `rewrite` is `null` and the explanation lists 3 example sentences (still `200`). Errors: empty list, more than 10, or a sentence over 300 characters → `400`.

### ✅ `POST /api/personas/:personaId/mandate/sign`
Request: `{ "naturalLanguage": "...", "pin": "1111" }` → the saved `Mandate` (`version` + 1, `signedAt`, `signedBy`) plus `warnings`. The server compiles the text **again** and signs that; any `policy` you send is ignored. The new rules apply immediately. Wrong PIN → `403` with `attemptsLeft`.

---

## Documents

### ✅ `POST /api/personas/:personaId/documents`
`multipart/form-data` with a `file` field (PDF, max 5 MB) → `201`. Real result for the white-text bill (`data/bills/bill_03_MALICIOUS_white_text.pdf`):
```json
{
  "billId": "bill_doc_1",
  "extracted": { "payee": "CityPower", "amountCents": 13280, "dueDate": "2026-10-20", "accountNumber": "CP-88213" },
  "untrusted": true,
  "warnings": [
    "This document contains text that tells the assistant to ignore its rules. It was treated as data and ignored.",
    "It asked to send $500 to Account 99-1234, someone you've never paid. That was blocked."
  ],
  "actions": [
    { "summary": "Pay CityPower $132.80", "source": "untrusted", "status": "pending_approval", "...": "Action" },
    { "summary": "Pay Account 99-1234 $500", "source": "untrusted", "status": "denied", "...": "Action" }
  ]
}
```
- Show `warnings` prominently (red banner): **this is the injection demo**.
- The bill itself always waits for approval (it came from a document).
- Any extra payment the document asks for is run through the rules *as if the AI had obeyed*: the `denied` action proves the block.
- The uploaded bill also appears in `GET bills` with `"source": "document"`, and becomes `"paid"` once approved.
- Errors: no file / not a PDF → `400`; over 5 MB → `413`; no payee or amount found → `422` (with `warnings`).
- Demo files: `data/bills/` has 2 normal bills and 4 malicious ones (white text, tiny footer, fake "new bank details", and `bill_06_MALICIOUS_maya_phone.pdf` for Maya's demo).

---

## Audit & on-chain

### ✅ `GET /api/audit`
Needs a session: you see **only your own persona's entries**, newest first. Optional `?limit=100` (max 1000); `?personaId=` for someone else → `403`. Real example (the blocked attack above):
```json
[
  {
    "personaId": "daniel",
    "eventType": "policy_check",
    "actor": {
      "type": "agent",
      "personaId": "daniel"
    },
    "summary": "Needs approval for payment of $132.80 to CityPower (source: agent).",
    "payload": {
      "action": {
        "source": "agent",
        "type": "payment",
        "fromAccount": "checking",
        "payee": "CityPower",
        "amountCents": 13280
      },
      "decision": "require_approval",
      "tier": "L2",
      "reasons": [
        "$132.80 is over your $100 limit per payment."
      ]
    },
    "seq": 3,
    "ts": "2026-10-14T17:14:26.296Z",
    "prevHash": "fa41fae02edad301e2b0ace4d45ab92a4c4d6e386eeb4db433d6837445303061",
    "hash": "67389801e02aa248dc9c93f873b966b669ad138799ae22cc769d112ec2a6640f"
  }
]
```
`eventType`: `seed_loaded`, `signed_in`, `sign_in_failed`, `policy_check`, `wish_created`, `wish_updated`, `wish_deleted`, `action_executed`, `action_pending_approval`, `action_denied`, `action_approved`, `action_rejected`, `payday_run`, `agent_stopped`, `agent_started`, `document_uploaded`, `mandate_signed`, `mandate_explained` (counts only), `audit_anchored`, `agent_chat` (one per chat message: tools used, actions proposed, how many items of personal data were redacted; never the message text). `actor.type`: `user` · `agent` · `system`. Each entry's `prevHash` is the previous entry's `hash`; a reset starts a fresh chain.

### ✅ `GET /api/audit/verify`
```json
{
  "valid": true,
  "entries": 3,
  "brokenAt": null
}
```
If any entry was changed or removed: `{ "valid": false, "entries": 42, "brokenAt": 17 }` (the first broken entry).

### ✅ On-chain anchors
The audit log's latest fingerprint is published on a public **test** blockchain (Base Sepolia), so anyone can check the log wasn't rewritten later. It happens every 15 minutes when there's something new, or on demand. Anchoring is only on when the server has a test wallet (`GET /api/anchors/status`).

- `GET /api/anchors/status` (public) → `{ "enabled": true, "chain": "base-sepolia" }`
- `GET /api/anchors` (public, newest first):
```json
[
  {
    "seq": 42,
    "hash": "5be1…(64 hex)",
    "chain": "base-sepolia",
    "txHash": "0xa41f…",
    "explorerUrl": "https://sepolia.basescan.org/tx/0xa41f…",
    "anchoredAt": "2026-10-17T09:30:00.000Z",
    "matchesLog": true
  }
]
```
`seq` 42 means "the whole log up to entry #42". `matchesLog`: entry #42 in the log still has this hash.

- `POST /api/audit/anchor` (signed in) → `{ "anchor": Anchor }`, or `{ "anchor": null }` if nothing happened since the last one. Not set up → `503`; less than a minute since the last → `429` with `retryAfterSeconds`; the network refused (e.g. no test ETH) → `502`.
- `GET /api/anchors/:txHash/check` (public) → reads the transaction **from the blockchain itself** and compares it with the log: `{ "txHash", "onChain": true, "seq": 42, "hash": "5be1…", "matchesLog": true }`.

UI (Audit log screen): a "Verified on-chain" badge with a **View transaction** link (`explorerUrl`) on anchored entries, and an "Anchor now" button. On the explorer, the transaction's input data, viewed as UTF-8, reads `moneywise-audit:v1:42:5be1…`.

---

## Screens → endpoints

| Screen | Uses |
|---|---|
| Sign-in | `auth/demo-accounts`, `auth/login`, `auth/me` |
| Persona switcher ("switch demo account") | `auth/logout` + `auth/login` |
| Dashboard | `accounts`, `budget`, `forecast`, `subscriptions`, `bills`, `wishes`, `transactions?limit=10` |
| Wishes list | `wishes`, `pay-cycle` |
| New / edit wish | `wishes/preview` (live), `POST wishes`, `PATCH /wishes/:id` |
| Wish detail | `GET /wishes/:id`, `POST /wishes/:id/contribute`, `DELETE /wishes/:id` |
| Chat | `POST chat` (SSE) |
| Approvals | `approvals`, `POST /actions/:id/decision`, `timeline` (SSE); show `wishImpact` on each card |
| Action timeline | `actions`, `timeline` (SSE), `POST agent/run` (payday button) |
| Rules (mandate) editor | `mandate`, `mandate/compile`, `mandate/sign`; optional "try an action" box using `policy/check` |
| Bill upload | `POST documents` |
| Audit log | `audit`, `audit/verify`, `anchors` |
| Header | `killswitch` (GET + POST) |

---

## Changelog
- **v3.9 (Oct 18):** new hard rule, **no duplicate payments**. The agent (or a document) can't pay the same bill twice: a payment with the same bill id, or the same payee and amount, as one already `executed` or `pending_approval` → `denied` with `reasons[0]` = `"You already paid Mobi Telecom $35 today. MoneyWise won't pay the same bill twice."` or `"A payment of CityPower $132.80 is already waiting for your approval. MoneyWise won't pay the same bill twice."` The user's own repeat payment is still `executed`, with a second reason `"Heads up: You already paid …"`. Approving re-checks it too (see `decision`). Effect on the demo: after **Run payday** has paid Maya's $35 phone bill, uploading her phone bill shows that $35 card as **denied** ("already paid"), not waiting. Also: cancelling the same subscription or disputing the same charge again → `denied` (`"Cancelling FitZone is already waiting for your approval."` / `"… was already done."`); wish auto-save's per-payday limit now counts all of that payday's agent top-ups (`"This would make $80.78 saved for wishes this payday, over your $80 limit."`); disputing money coming in, or a cancel whose `merchant` isn't the subscription's → `422`. **PIN lockouts escalate:** PIN locks last 5, 15, 30, then 60 minutes in a row (`retryAfterSeconds` 300 / 900 / 1800 / 3600). Sign-in locks stay at 5 minutes (usernames are public, so a growing lock would let anyone lock a real user out).
- **v3.8 (Oct 17):** product renamed **MoneyWise** (the signed rules are still "your mandate" and the `/mandate` endpoints keep their names). `GET /api/health` → `"service": "moneywise-api"`; on-chain text is now `moneywise-audit:v1:…`; executed transactions' memo says `MoneyWise act_N`. When a document asks to pay someone new, that reason now comes first even if a money limit would also block it. New demo bill for Maya.
- **v3.7 (Oct 16):** on-chain anchors are live: `GET anchors`, `GET anchors/status`, `POST audit/anchor`, `GET anchors/:txHash/check`. An anchor is the log's latest entry (`seq` + `hash`), not a daily Merkle root (the hash chain already covers every earlier entry).
- **v3.6 (Oct 16):** `mandate/compile` gains `notUnderstood`. New `POST mandate/explain`: AI explains sentences the checker didn't understand and suggests rewrites, each checked by the checker before it's shown (saves nothing).
- **v3.5 (Oct 16):** live: **Run payday** (`agent/run`, now also returns `paycheck`), **kill switch**, **bill upload** (`documents`, now also returns `actions`), **timeline** (SSE), **rules editor** (`mandate/compile`, `mandate/sign`; sign takes `naturalLanguage` + `pin` and ignores any `policy`), chat answers **word by word**. `Mandate` gained `signedBy`. Bills include uploaded ones (`source: "document"`). New audit event types.
- **v3.4 (Oct 15):** **sign-in is live** (`auth/*`, session cookie, `401`/`403`, PIN with lockout, `x-admin-key` on reset when set). **Actions are live**: chat (SSE), approvals, decision, actions history, wish top-up (`contribute`), contributions in wish detail. `Action.params` uses `payee` (a name), not `payeeId`; `Action` gained `decidedAt`, `approvedBy`, `executedAt`; `agentRationale` can be `null`. `GET /api/audit` is now scoped to the signed-in persona. Unknown personas in URLs give `403` (not `404`) when signed in. Temporary `AUTH_DISABLED` switch for the hosted server until the sign-in screen ships.
- **v3.3 (Oct 14):** policy engine and audit log are **live**: `GET mandate`, new `POST policy/check` (dry run), `GET /api/audit`, `GET /api/audit/verify`. Audit entries gained `personaId` and `payload`. Mandate summary amounts are written like `$200` (no `.00`).
- **v3.2 (Oct 14):** wishes are **live** (list, preview, create, detail, patch, delete, impact; examples are real output). Wish ids are `wish_<persona>_<n>`; `Wish` gained `paused`; `plan.nextContributionDate` can be `null`. Only `contribute` is still pending (needs the policy engine).
- **v3.1 (Oct 13):** budget, forecast, subscriptions, bills and pay-cycle are **live** (examples are real output). `payday` is now a display label (`"Fridays"`); subscriptions gained `accountId`, `lastCharged`, `nextCharge`; bills gained `accountId`; `avgSurplusPerCycleCents` now means left over after *all* normal spending.
- **v3 (Oct 13):** demo auth: `/api/auth/*`, session cookie, `401`/`403` on persona-scoped routes, `pin` on approve / sign / agent-on, `x-admin-key` on reset, `actor` on audit entries. Takes effect **Oct 15**; until then everything stays open.
- **v2.1 (Oct 12):** personas, accounts, transactions and admin reset are live. IDs are stable across resets (`acc_maya_chk`, `tx_maya_0001`…).
- **v2 (Oct 12):** added Wishes (`/wishes…`, `pay-cycle`, `wishImpact` on actions), `POST /api/admin/reset`, data-reset and cold-start notes; action type `create_goal` replaced by `wish_contribution`.
- **v1 (Oct 12):** first version.
