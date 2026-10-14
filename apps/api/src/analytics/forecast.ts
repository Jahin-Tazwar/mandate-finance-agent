import type { Forecast, ForecastDay, Transaction } from "@mandate/shared";
import { addDays, shortDate } from "../lib/dates";
import { usd } from "../lib/money";
import { ONE_OFF_CENTS, inAnySeries } from "./payCycle";
import { type Series, dailyAverage, upcomingDates } from "./recurring";

/** A predicted payment on a day, e.g. { label: "Greenview Student Housing", cents: -75000 } */
interface PlannedItem {
  label: string;
  cents: number;
}

interface Projection {
  /** Predicted end-of-day balance for each day, starting today. */
  days: ForecastDay[];
  /** Predicted payments per date, used to explain dips ("after rent"). */
  events: Map<string, PlannedItem[]>;
}

/**
 * Walks the checking balance forward day by day, starting today. Each day adds:
 *  - predicted pay, rent, bills, card payment, savings transfer (on their dates)
 *  - daily income spread evenly (e.g. gig payouts)
 *  - optionally, average everyday spending (food, shopping...)
 */
export function projectChecking(opts: {
  transactions: readonly Transaction[];
  series: Series[];
  checkingId: string;
  startBalance: number;
  today: string;
  days?: number;
  includeEverydaySpending: boolean;
}): Projection {
  const { transactions, series, checkingId, today, days = 30 } = opts;
  const end = addDays(today, days - 1);

  // Only checking matters here (card purchases hit checking later, as the card payment)
  const onChecking = series.filter((s) => s.accountId === checkingId);

  // Put every predicted payment on its date, e.g. "2026-11-01" → [rent -750, transit -60, family +600]
  const events = new Map<string, PlannedItem[]>();
  for (const s of onChecking) {
    // Skip: daily items have no fixed date; they're spread per day below
    if (s.cadence === "daily") continue;

    for (const date of upcomingDates(s, today, end)) {
      let itemsThatDay = events.get(date);
      if (!itemsThatDay) {
        itemsThatDay = [];
        events.set(date, itemsThatDay);
      }
      itemsThatDay.push({ label: s.merchant, cents: s.typicalCents });
    }
  }

  // Daily items as an average amount per day, e.g. Aisha's ride payouts ≈ +$55/day
  const dailyIncome = onChecking
    .filter((s) => s.cadence === "daily")
    .reduce((sum, s) => sum + dailyAverage(s, today), 0);

  // Everyday spending: average per day of everything else that left checking in the
  // last 90 days. Not counted: recurring items (already planned above) and one-offs ($500+).
  let everydayPerDay = 0;
  if (opts.includeEverydaySpending) {
    const since = addDays(today, -90);
    const spent = transactions
      .filter((t) => t.accountId === checkingId && t.amountCents < 0 && t.date >= since && t.date < today)
      .filter((t) => !inAnySeries(series, t) && -t.amountCents < ONE_OFF_CENTS)
      .reduce((sum, t) => sum + t.amountCents, 0);
    everydayPerDay = Math.round(spent / 90); // negative, e.g. -2100 = $21 a day
  }

  // Walk forward: each day's balance = yesterday's + daily income + everyday spending + that day's items
  let balance = opts.startBalance;
  const result: ForecastDay[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    const plannedToday = (events.get(date) ?? []).reduce((sum, e) => sum + e.cents, 0);
    balance += dailyIncome + everydayPerDay + plannedToday;
    result.push({ date, balanceCents: balance });
  }
  return { days: result, events };
}

/** The 30-day forecast for the dashboard, with a warning if checking dips below the floor. */
export function buildForecast(projection: Projection, floorCents: number): Forecast {
  // The lowest balance in the 30 days (the first one, if there's a tie)
  const lowestPoint = projection.days.reduce((low, d) => (d.balanceCents < low.balanceCents ? d : low));

  // No warning needed: the balance never goes below the floor
  const warnings: string[] = [];
  if (lowestPoint.balanceCents >= floorCents) return { days: projection.days, lowestPoint, warnings };

  // Name the biggest payment on that day, e.g. " after Greenview Student Housing ($750)"
  const paymentsThatDay = (projection.events.get(lowestPoint.date) ?? []).filter((e) => e.cents < 0);
  const biggest = paymentsThatDay.sort((a, b) => a.cents - b.cents)[0];
  const after = biggest ? ` after ${biggest.label} (${usd(-biggest.cents)})` : "";

  // Below zero is worse than below the floor, so say so
  const when = shortDate(lowestPoint.date);
  warnings.push(
    lowestPoint.balanceCents < 0
      ? `Checking could go overdrawn on ${when}${after}.`
      : `Checking may drop below ${usd(floorCents)} on ${when}${after}.`,
  );
  return { days: projection.days, lowestPoint, warnings };
}

/**
 * The most you can spend per day from today without the planned balance going below
 * the floor on any of the next 30 days. Expects a projection WITHOUT everyday spending
 * (this number is the everyday-spending allowance, so counting it would be double).
 */
export function safeToSpendToday(commitmentsOnly: Projection, floorCents: number): number {
  // For each day: (planned balance − floor) ÷ days so far
  // e.g. Maya, day 25 (Nov 5): ($1,061.37 − $200) ÷ 25 = $34.45
  const perDay = commitmentsOnly.days.map((d, i) => (d.balanceCents - floorCents) / (i + 1));

  // The tightest day decides; never below zero
  return Math.max(0, Math.floor(Math.min(...perDay)));
}
