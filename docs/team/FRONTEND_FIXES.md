# MoneyWise: frontend fixes after the Oct 18 check

> **For:** Rafsan. **From:** the Tech Lead. **Date:** Sun Oct 18.
> **Status: all 7 done by the Tech Lead on Oct 18** (Rafsan was unwell), tested in the browser. Kept as a record of what changed and why.
>
> Apni, I tested the new UI against the API (locally with sign-in on, and the live Render site). **The whole demo story works**: sign-in, overview numbers, Run payday, PIN approval, the poisoned bill upload, audit log, rules, chat. The list below is what's left, most important first. How it looks is your call; this only says what it should **do** and **say**.

---

## Must do before the video

### 1. Balance forecast chart (Overview): it doesn't explain itself

Right now it's a line with no numbers. You can't tell what it is, what the dashed line means, or why it goes up and down, and **hovering shows nothing**.

What the chart really is: **checking balance for each of the next 30 days**, predicted from usual spending, bills and pay. Maya is paid **every Friday**, so the line is a saw: down all week, up on payday. Her lowest point (**$387.56 on Oct 15**) is the **day before payday**. That's the story the chart should tell.

| # | Change | Where the data comes from |
|---|---|---|
| a | **One sentence under the title:** "Your checking balance each day for the next 30 days, if your usual spending, bills and pay continue." | — |
| b | **Hover (and tap on phones) shows the day's amount**, e.g. "Thu Oct 15 · $387.56" | `forecast.days[i]` (`date`, `balanceCents`) |
| c | **Replace the dashed bottom line with the safety floor**, labelled "Safety floor $200". Today the dashed line is just the bottom of the drawing, but it looks like a limit | `GET /personas/:id/mandate` → `policy.rules`, the rule with `type: "balance_floor"` and `account: "checking"` → `minCents` |
| d | **Label the lowest dot:** "Lowest: $387.56 on Oct 15" (add "the day before payday" when the next day is a payday) | `forecast.lowestPoint`; `pay-cycle.nextPayday` |
| e | **Mark why it jumps:** paydays ("Pay +$284.75") and bigger bills ("Rent −$750") | Paydays: days where the balance goes **up** (the difference is the pay), or `pay-cycle` (`nextPayday`, `cadence`). Bills: `bills` with `dueDate` in the 30 days |
| f | **Two dollar labels on the side** (highest and lowest), so the height means something. The scale doesn't start at $0, so small dips look dramatic without them | `forecast.days` |

### 2. On-chain anchors (Audit log): say that it's automatic

The server already publishes the log's fingerprint **by itself every 15 minutes** when the log has new entries. **Anchor now** only does it immediately (handy in the video). The screen doesn't say this, so it looks manual.

- Under "On-chain anchors": *"Published automatically every 15 minutes when the log has new entries. **Anchor now** publishes right away."*
- Empty state (when anchoring is on): *"Nothing published yet. The first anchor appears within 15 minutes of new activity."* (The log lives in memory, so after every Render restart the list starts empty.)

### 3. Run payday toast: show the pay

Now: *"Payday complete: 4 actions recorded."* The video script uses the pay amount, and the response already has it.

- Suggested: *"Payday: +$284.75 landed. 4 actions: 3 done automatically, 1 waiting for you."*
- Data: `POST agent/run` returns `{ paycheck: Transaction | null, actions: Action[] }` → `paycheck.amountCents`, and count `actions` by `status`.

### 4. Chat: Enter should send

Enter currently adds a new line; only the Send button sends. Usual chat behaviour: **Enter sends, Shift+Enter makes a new line** (`ChatPage.tsx`, the message box).

---

## Small fixes

5. **PIN / sign-in error text:** "Wrong PIN 4 attempts left." → "Wrong PIN. 4 attempts left." (`Dialogs.tsx` around line 96, `SignInPage.tsx` around line 31: a full stop between the error and the count).
6. **Profile switcher in the header** (Maya / Daniel / Aisha): it signs out and back in with the public demo password, which is fine. Label it **"Switch demo profile"** so a judge doesn't think you can change user without a password.
7. **Sidebar buttons have no names for screen readers** (they show as unnamed buttons). Add an `aria-label` (e.g. "Overview") where the text label is hidden, e.g. when the sidebar collapses to icons.

---

## Backend changes today (nothing for you to do, just so you know)

- **New "blocked" reasons** your cards already show well: *"You already paid Mobi Telecom $35 today. MoneyWise won't pay the same bill twice."*, *"…is already waiting for your approval."*, *"Cancelling FitZone was already done."*
- **Demo change:** after **Run payday**, uploading Maya's phone bill now shows the $35 card as **blocked** (payday already paid it), next to the blocked $500. Two attacks stopped in one upload.
- **Blocked payments have no wish delay any more** (`wishImpact` is `[]`), so the card no longer says "the blocked $500 delays your iPhone by 91 days". No change needed on your side.
- **PIN locks get longer** (5, 15, 30, then 60 minutes); sign-in locks stay at 5. Your screens already use `retryAfterSeconds`, so this already works. ✅

## Checked and working ✅

Demo sign-in (survives reload) · overview numbers ($34.45 safe-to-spend) · Run payday → Activity · PIN dialog with attempts left · approving Cancel FitZone · bill upload with the red banner and both blocked cards · audit log "Verified" · rules page · chat with live tool steps and suggestion buttons · lock messages · Maya can't read Daniel's data (403) · nothing loads without sign-in (401).

Questions → ask me. Thank you, apni!
