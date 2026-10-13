# Feedback on the transaction files (Oct 13)

Files: `maya_student.csv`, `daniel_professional.csv`, `aisha_gigworker.csv`

Thank you, these were checked properly. Short version: **for now the app keeps using the placeholder data the Tech Lead generated**, because the demo depends on a few specific patterns that these files don't have yet. Nothing you did is wasted: the checks below are exactly what our automated validator and analysis look for.

---

## What was good

- Correct date format (`2026-05-01`) and date range (May 1 – Oct 11) in all three files
- Amounts as plain numbers, money out negative, money in positive
- Accounts all valid (`checking`, `credit`)
- Maya has **weekly part-time pay** and an **unused gym subscription**: exactly what the demo needs
- Daniel's credit-card payments are correctly written as **two rows** (out of checking, into credit)

## What didn't work

### Format (easy to fix)

1. **Two columns are missing: `merchant` and `memo`.** The header must be exactly:
   `date,account,description,merchant,amount,category,memo`
   (`memo` can be left empty, but the column must exist.)
2. **Aisha: 17 rows use categories that aren't on the list:** `insurance` (6) and `maintenance` (11). Use `transport` for car insurance, car washes and car repairs.

### Content (this is why we can't use them yet)

| Persona | Problem | Why it matters |
|---|---|---|
| **Maya** | She spends **$9,125** but earns **$6,090**, so her checking account is **−$3,066** by October (overdrawn for months) | The demo needs her to come *close* to $0 once and recover. Deep overdraft breaks safe-to-spend and makes her iPhone wish impossible |
| **Daniel** | He pays only ~$500/month on a card he spends ~$1,100/month on, so he owes **$3,590**, over his **$3,000 card limit**, while **$9,000** sits in checking | Unrealistic, and it hides the "lifestyle creep" story. Also **no duplicate charge** (same shop, same amount, same day, twice), which the demo needs |
| **Aisha** | Paid every **~2 weeks** | Her story is **daily and weekly** pay (like many gig and part-time jobs in Japan). The wish plan needs daily/weekly paydays to show "save $6.60 a day" |
| All three | Very regular: about one transaction per day, the same descriptions and identical amounts every month ("Streaming service A", "Fuel - Station X", "Gym membership unused") | Real statements look messier. Use real-sounding shop names in `merchant`, and don't put "unused" in the description (the app should *discover* that) |

---

## What to do now (more useful than redoing these)

Your next deliverables (**wishes, bill PDFs and scenarios, due Oct 14**) must match the data the app actually uses, so please base them on the **live data** below. It's in `data/seed/transactions/maya.csv`, `daniel.csv`, `aisha.csv` if you want to open it in Excel.

### Live data cheat sheet

**Maya** (student, paid **every Friday**)
- Pay: Campus Cafe Payroll, $190–$330 each Friday; family support $600 on the 1st
- Rent $750 (1st), transit pass $60 (1st), phone $35 (12th), utilities share ~$35–$50 (20th)
- Subscriptions: **FitZone gym $29.99 (2nd), never used**, Spotify $11.99 (5th), Netflix $15.49 (9th)
- Moves $50 to savings on the 10th
- Tuition $2,800 on Aug 25 (family sent $2,500 on Aug 20)
- **Lowest point: $39.70 on Aug 13** (after a $180 laptop repair on Aug 12)
- Balances now: checking ~$509, savings $600

**Daniel** (professional, paid **monthly on the 25th**)
- Salary $4,200 (ACME Ltd Payroll); rent $1,450 (1st); saves $500 on the 26th
- Bills from checking: CityPower electricity $90–$140 (15th), Mobi Telecom $55 (18th), FiberNet internet $60 (20th)
- 6 card subscriptions: FitZone Premium $49.99, Netflix $15.49, Spotify $11.99, Disney+ $13.99, CloudBox $9.99, NewsDaily $12.00
- Lots of dining, shopping and rides on the card; **pays the full card balance on the 28th**
- **Duplicate charge: TechStore $129.99 twice on Sep 14**

**Aisha** (gig worker, paid **almost daily + every Monday**)
- RideNow Driver Payout $30–$140 most days; QuickEats Courier $120–$400 every Monday
- Rent $1,100 (5th), SafeDrive car insurance $140 (10th), Mobi Telecom $45 (15th), CityPower $60–$90 (22nd), Spotify $11.99 (6th)
- Fuel twice a week; car repair $380 on Jul 18
- **Saves nothing**: no transfers to savings, no tax set aside

### Suggestions for your Oct 14 files

- **Bills (PDFs):** use the real billers above (CityPower, Mobi Telecom, FiberNet, SafeDrive Insurance) with amounts in the ranges above. The malicious ones can pretend to be one of these billers.
- **Scenarios:** e.g. "Maya's Friday pay arrives", "Daniel's TechStore duplicate", "Maya's unused FitZone gym", "Aisha's checking after rent on the 5th", "Maya buys a $60 ticket the week of Aug 13".
- **Wishes:** check them against this income (e.g. Maya keeps roughly $40–$80 a week after essentials).

## If you want to send a corrected version later

Fix the format (columns + categories), fix the money flow so balances stay realistic, and add the must-haves from the Team Guide (§2a). The Tech Lead can drop it in and the validator will report any remaining problems with row numbers. Priority, though, is the Oct 14 files above.
