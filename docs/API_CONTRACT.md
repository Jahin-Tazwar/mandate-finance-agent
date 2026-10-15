# Mandate API Contract (v3)

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
| **Auth** (from Oct 15) | Sign in with `POST /api/auth/login`; the server sets an `HttpOnly` session cookie that the browser sends automatically (same origin through the proxy; with `fetch`, use `credentials: "include"` if you ever call the API from another origin). **Every** `/api/personas/:personaId/*`, `/api/wishes/*` and `/api/actions/*` route needs it: not signed in → `401`; another persona's data → `403`. Public: `/api/health`, `/api/meta`, `/api/personas`, `/api/auth/*` |
| **PIN** (from Oct 15) | Three risky actions need the persona's 4-digit `pin` in the request body: **approving** an action, **signing** a mandate, turning the agent **on**. Wrong PIN → `403` with `attemptsLeft`; 5 failures → `429` with `retryAfterSeconds` |
| Errors | Non-2xx responses always return `{ "error": "message", "issues"?: [...], "attemptsLeft"?: n, "retryAfterSeconds"?: n }` |
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
{ "ok": true, "service": "mandate-api", "time": "2026-10-12T15:27:27.423Z" }
```

### ✅ `GET /api/meta`
```json
{ "tiers": ["L0", "L1", "L2", "L3"] }
```

### ✅ `POST /api/admin/reset`
Reloads all demo data from the CSV seed files (also clears sign-in lockouts). From Oct 15 it needs the header `x-admin-key: <ADMIN_KEY>` when `ADMIN_KEY` is set on the server (always on the hosted version; open in local dev). Returns `{ "ok": true, "resetAt": "2026-10-13T10:00:00.000Z" }`. Use it from a hidden "Reset demo" button.

---

## Auth (Oct 15)

### 🛠 `GET /api/auth/demo-accounts`
Public list for the sign-in screen. The credentials are fake and intentionally public; showing them lets judges sign in with one click.
```json
[
  { "personaId": "maya", "name": "Maya Chen", "profile": "International student…", "username": "maya", "password": "maya-demo", "pin": "1111" }
]
```

### 🛠 `POST /api/auth/login`
Request: `{ "username": "maya", "password": "maya-demo" }` → `200` with the `Persona` and a `Set-Cookie` header.
Wrong credentials → `401 { "error": "Wrong username or password", "attemptsLeft": 4 }`. Locked → `429 { "error": "Too many attempts", "retryAfterSeconds": 300 }`.

### 🛠 `GET /api/auth/me`
→ `{ "persona": Persona }` when signed in, `401` otherwise. Call it on app start to decide between the sign-in screen and the app.

### 🛠 `POST /api/auth/logout`
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
`contributions` stays empty until auto-save runs (from Oct 16–17); each item will look like `{ "id": "wc_1", "date": "2026-10-16", "amountCents": 4039, "source": "agent", "actionId": "act_77aa" }`.

### ✅ `PATCH /api/wishes/:wishId`
Any of: `title`, `targetCents`, `targetDate`, `priority`, `autoSave`, `paused` → the updated `Wish` with a recalculated plan. Unknown fields → `400`. Pausing a wish frees its money for the wishes below it.

### ✅ `DELETE /api/wishes/:wishId`
Removes the wish → `204`. Money already saved stays in savings.

### 🛠 `POST /api/wishes/:wishId/contribute` (Oct 15–16)
Manual top-up from checking to savings. Request: `{ "amountCents": 2000 }` → returns an `Action` (it goes through the policy engine like everything else, so it can be `executed`, `pending_approval` or `denied`).

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

### 🛠 `POST /api/personas/:personaId/chat` (Oct 15): **Server-Sent Events stream**
Request: `{ "message": "Can I afford a $60 concert ticket this week?" }`
The response is a stream of events (read with `fetch` + a stream reader):
```
event: text      data: {"delta":"Yes. Your safe-to-spend today is $23.50, but "}
event: tool      data: {"name":"get_forecast","status":"done"}
event: action    data: { ...Action (see below) }
event: done      data: {}
event: error     data: {"error":"..."}
```
`text` arrives in small pieces; append each `delta` to the chat bubble.

### The `Action` object (used by chat, approvals and the timeline)
```json
{
  "id": "act_31c9",
  "personaId": "daniel",
  "type": "payment",
  "summary": "Pay CityPower $180.00 (power bill due Oct 16)",
  "params": { "payeeId": "payee_citypower", "amountCents": 18000, "fromAccount": "checking" },
  "source": "agent",
  "tier": "L2",
  "decision": "require_approval",
  "status": "pending_approval",
  "reasons": ["Amount is over your $100 approval limit."],
  "agentRationale": "The bill is due in 4 days and checking can cover it.",
  "wishImpact": [{ "wishId": "wish_daniel_1", "title": "Car down payment", "delayDays": 7 }],
  "createdAt": "2026-10-12T09:15:00.000Z"
}
```
`type`: `payment` · `transfer` · `cancel_subscription` · `dispute` · `wish_contribution`
`wishImpact` is present on payments (empty array if no wishes are affected). For `wish_contribution`, `params` includes `wishId`.

### 🛠 `GET /api/personas/:personaId/approvals` (Oct 15)
Returns `Action[]` with `status: "pending_approval"`.

### 🛠 `POST /api/actions/:actionId/decision` (Oct 15)
Request: `{ "decision": "approve", "pin": "1111" }` or `{ "decision": "reject" }` (rejecting never needs a PIN) → returns the updated `Action`. Approved actions record who approved them (`approvedBy`, `approvedAt`).

### 🛠 `GET /api/personas/:personaId/actions` (Oct 15)
All actions, newest first (`?limit=50`). For the action timeline's history.

### 🛠 `GET /api/personas/:personaId/timeline` (Oct 16): **SSE stream**
Pushes `event: action` with an `Action` whenever one is created or changes status. Use it to update the timeline and approvals badge live.

### 🛠 `POST /api/personas/:personaId/agent/run` (Oct 17)
Request: `{ "trigger": "payday" }` → `{ "actions": Action[] }`. Powers the "Run payday" demo button.

### 🛠 `POST /api/personas/:personaId/killswitch` (Oct 17)
Request: `{ "enabled": true }` → `{ "enabled": true }`. While enabled, the agent is limited to L0 (observe only). Turning the agent back **on** (`{ "enabled": false, "pin": "1111" }`) needs the PIN; stopping it never does. `GET` returns the current state.

---

## Mandate (user rules)

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

### 🛠 `POST /api/personas/:personaId/mandate/compile` (Oct 16)
Request: `{ "text": "Never let checking drop below $200..." }` → `{ "policy": {...}, "summary": [...], "warnings": [] }` (not saved yet: show it to the user for review).

### 🛠 `POST /api/personas/:personaId/mandate/sign` (Oct 16)
Request: `{ "naturalLanguage": "...", "policy": {...}, "pin": "1111" }` → the saved mandate (new `version`, `signedBy`).

---

## Documents

### 🛠 `POST /api/personas/:personaId/documents` (Oct 17)
`multipart/form-data` with a `file` field (PDF, max 5 MB).
```json
{
  "billId": "bill_doc_7",
  "extracted": { "payee": "CityPower", "amountCents": 18000, "dueDate": "2026-10-20", "accountNumber": "CP-88213" },
  "untrusted": true,
  "warnings": ["This document contains instructions addressed to an AI assistant. They were ignored."]
}
```
Show `warnings` prominently (red banner). This is the injection demo.

---

## Audit & on-chain

### ✅ `GET /api/audit`
Newest first. Optional `?personaId=daniel&limit=100` (max 1000). Real example (the blocked attack above):
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
`eventType` so far: `seed_loaded`, `policy_check`, `wish_created`, `wish_updated`, `wish_deleted` (more from Oct 15: actions, approvals, sign-ins). `actor.type`: `user` · `agent` · `system`. Each entry's `prevHash` is the previous entry's `hash`; a reset starts a fresh chain.

### ✅ `GET /api/audit/verify`
```json
{
  "valid": true,
  "entries": 3,
  "brokenAt": null
}
```
If any entry was changed or removed: `{ "valid": false, "entries": 42, "brokenAt": 17 }` (the first broken entry).

### 🛠 `GET /api/anchors` (Oct 17, stretch)
```json
[
  { "date": "2026-10-17", "merkleRoot": "0x5be1…", "chain": "base-sepolia", "txHash": "0xa41f…", "explorerUrl": "https://sepolia.basescan.org/tx/0xa41f…" }
]
```

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
- **v3.3 (Oct 14):** policy engine and audit log are **live**: `GET mandate`, new `POST policy/check` (dry run), `GET /api/audit`, `GET /api/audit/verify`. Audit entries gained `personaId` and `payload`. Mandate summary amounts are written like `$200` (no `.00`).
- **v3.2 (Oct 14):** wishes are **live** (list, preview, create, detail, patch, delete, impact; examples are real output). Wish ids are `wish_<persona>_<n>`; `Wish` gained `paused`; `plan.nextContributionDate` can be `null`. Only `contribute` is still pending (needs the policy engine).
- **v3.1 (Oct 13):** budget, forecast, subscriptions, bills and pay-cycle are **live** (examples are real output). `payday` is now a display label (`"Fridays"`); subscriptions gained `accountId`, `lastCharged`, `nextCharge`; bills gained `accountId`; `avgSurplusPerCycleCents` now means left over after *all* normal spending.
- **v3 (Oct 13):** demo auth: `/api/auth/*`, session cookie, `401`/`403` on persona-scoped routes, `pin` on approve / sign / agent-on, `x-admin-key` on reset, `actor` on audit entries. Takes effect **Oct 15**; until then everything stays open.
- **v2.1 (Oct 12):** personas, accounts, transactions and admin reset are live. IDs are stable across resets (`acc_maya_chk`, `tx_maya_0001`…).
- **v2 (Oct 12):** added Wishes (`/wishes…`, `pay-cycle`, `wishImpact` on actions), `POST /api/admin/reset`, data-reset and cold-start notes; action type `create_goal` replaced by `wish_contribution`.
- **v1 (Oct 12):** first version.
