import type { Forecast, ForecastDay, Transaction } from "@mandate/shared";
import { addDays, shortDate } from "../lib/dates";
import { usd } from "../lib/money";
import { ONE_OFF_CENTS, inAnySeries } from "./payCycle";
import { type Series, dailyAverage, upcomingDates } from "./recurring";

interface Projection {
  days: ForecastDay[];
  /** Predicted dated payments per day, for explaining dips ("after rent"). */
  events: Map<string, { label: string; cents: number }[]>;
}

/**
 * Projects the checking balance day by day, starting with today:
 *  - dated recurring items (pay, rent, bills, card payment, savings transfer)
 *  - daily recurring items spread evenly (e.g. gig payouts)
 *  - optionally, everyday spending: the average daily amount of everything
 *    else that left checking in the last 90 days (minus one-offs over $500)
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
  const onChecking = series.filter((s) => s.accountId === checkingId);

  const events = new Map<string, { label: string; cents: number }[]>();
  for (const s of onChecking.filter((s) => s.cadence !== "daily")) {
    for (const date of upcomingDates(s, today, end)) {
      (events.get(date) ?? events.set(date, []).get(date)!).push({ label: s.merchant, cents: s.typicalCents });
    }
  }
  const perDay = onChecking.filter((s) => s.cadence === "daily").reduce((sum, s) => sum + dailyAverage(s, today), 0);

  let everyday = 0;
  if (opts.includeEverydaySpending) {
    const since = addDays(today, -90);
    everyday = Math.round(
      transactions
        .filter((t) => t.accountId === checkingId && t.amountCents < 0 && t.date >= since && t.date < today)
        .filter((t) => !inAnySeries(series, t) && -t.amountCents < ONE_OFF_CENTS)
        .reduce((sum, t) => sum + t.amountCents, 0) / 90,
    );
  }

  let balance = opts.startBalance;
  const result: ForecastDay[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    balance += perDay + everyday + (events.get(date) ?? []).reduce((sum, e) => sum + e.cents, 0);
    result.push({ date, balanceCents: balance });
  }
  return { days: result, events };
}

/** The 30-day forecast shown on the dashboard, with a warning if checking dips below the floor. */
export function buildForecast(projection: Projection, floorCents: number): Forecast {
  const lowestPoint = projection.days.reduce((low, d) => (d.balanceCents < low.balanceCents ? d : low));
  const warnings: string[] = [];
  if (lowestPoint.balanceCents < floorCents) {
    const biggest = (projection.events.get(lowestPoint.date) ?? []).filter((e) => e.cents < 0).sort((a, b) => a.cents - b.cents)[0];
    const after = biggest ? ` after ${biggest.label} (${usd(-biggest.cents)})` : "";
    warnings.push(
      lowestPoint.balanceCents < 0
        ? `Checking could go overdrawn on ${shortDate(lowestPoint.date)}${after}.`
        : `Checking may drop below ${usd(floorCents)} on ${shortDate(lowestPoint.date)}${after}.`,
    );
  }
  return { days: projection.days, lowestPoint, warnings };
}

/**
 * The most you can spend per day, starting today, without the planned balance
 * ever going below the floor in the next 30 days. Uses only income and
 * commitments you can count on (no everyday spending: that's what this number is FOR).
 *
 * For each future day d: (planned balance on day d − floor) ÷ number of days so far.
 * The smallest of those is the safe daily amount.
 */
export function safeToSpendToday(commitmentsOnly: Projection, floorCents: number): number {
  const perDay = commitmentsOnly.days.map((d, i) => (d.balanceCents - floorCents) / (i + 1));
  return Math.max(0, Math.floor(Math.min(...perDay)));
}
