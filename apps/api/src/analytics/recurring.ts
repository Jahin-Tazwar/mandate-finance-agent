import type { Category, PayCadence, Transaction } from "@mandate/shared";
import { addDays, addMonths, dayOfMonth, daysBetween } from "../lib/dates";

/**
 * Finds things that repeat on a schedule: paychecks, rent, bills, subscriptions,
 * card payments. Pure functions over transactions; no AI involved.
 */

export type RegularCadence = Exclude<PayCadence, "irregular">;

/** Allowed gap (in days) between two occurrences for each cadence. */
const GAP_WINDOW: Record<RegularCadence, [number, number]> = {
  daily: [1, 2],
  weekly: [6, 8],
  biweekly: [13, 16],
  monthly: [27, 33],
};

/** Spending that varies by choice. It can be frequent, but it's never a "commitment". */
const DISCRETIONARY: ReadonlySet<Category> = new Set(["groceries", "dining", "shopping", "entertainment"]);

export const CADENCE_DAYS: Record<PayCadence, number> = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 30.44, // average month length
  irregular: 30.44,
};

export interface Series {
  merchant: string;
  accountId: string;
  category: Category;
  direction: "in" | "out";
  cadence: RegularCadence;
  /** Oldest first. */
  occurrences: { date: string; cents: number }[];
  /** Typical amount (signed): median of the last 3 occurrences, so a one-off spike doesn't distort it. */
  typicalCents: number;
  lastDate: string;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/**
 * Decides the cadence of a list of dates (oldest first), or "irregular".
 * Needs 3+ dates, and most gaps (≥ 60%) must fit the cadence's window, so a
 * café you visit "about every two weeks" doesn't look like a biweekly bill.
 */
export function classifyCadence(dates: string[]): PayCadence {
  if (dates.length < 3) return "irregular";
  const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i]!, d));
  const typical = median(gaps);
  for (const [cadence, [min, max]] of Object.entries(GAP_WINDOW) as [RegularCadence, [number, number]][]) {
    if (typical >= min && typical <= max) {
      const fitting = gaps.filter((g) => g >= min && g <= max).length;
      return fitting / gaps.length >= 0.6 ? cadence : "irregular";
    }
  }
  return "irregular";
}

/** How much amounts vary (standard deviation ÷ average). 0 = always the same. */
function variation(cents: number[]): number {
  const abs = cents.map(Math.abs);
  const mean = abs.reduce((a, b) => a + b, 0) / abs.length;
  const sd = Math.sqrt(abs.reduce((a, b) => a + (b - mean) ** 2, 0) / abs.length);
  return mean === 0 ? 0 : sd / mean;
}

/**
 * Groups transactions by (account, merchant, money in/out) and keeps the groups
 * that repeat on a regular schedule. Outgoing payments must also have fairly
 * stable amounts (bills vary a bit) and can't be discretionary spending like
 * dining or shopping. Income may vary freely.
 * Series that stopped a while ago (e.g. a cancelled subscription) are dropped.
 */
export function detectSeries(transactions: readonly Transaction[], today: string): Series[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    const key = `${t.accountId}|${t.merchant}|${t.amountCents > 0 ? "in" : "out"}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }

  const series: Series[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));
    const cadence = classifyCadence(sorted.map((t) => t.date));
    if (cadence === "irregular") continue;

    const direction = sorted[0]!.amountCents > 0 ? "in" : "out";
    if (direction === "out" && DISCRETIONARY.has(sorted[0]!.category)) continue;
    if (direction === "out" && variation(sorted.map((t) => t.amountCents)) > 0.25) continue;

    const last = sorted.at(-1)!;
    const staleAfter = Math.ceil(CADENCE_DAYS[cadence] * 1.5) + 2;
    if (daysBetween(last.date, today) > staleAfter) continue;

    series.push({
      merchant: last.merchant,
      accountId: last.accountId,
      category: last.category,
      direction,
      cadence,
      occurrences: sorted.map((t) => ({ date: t.date, cents: t.amountCents })),
      typicalCents: Math.round(median(sorted.slice(-3).map((t) => t.amountCents))),
      lastDate: last.date,
    });
  }
  return series;
}

/**
 * Predicted dates of a (non-daily) series between `from` and `to`, inclusive.
 * Monthly series keep their usual day of the month (rent on the 1st stays on the 1st).
 */
export function upcomingDates(s: Series, from: string, to: string): string[] {
  if (s.cadence === "daily") throw new Error("daily series are spread per day, not dated");
  const dates: string[] = [];
  const usualDay = median(s.occurrences.slice(-3).map((o) => dayOfMonth(o.date)));
  let next = s.lastDate;
  for (let i = 1; i < 400; i++) {
    next = s.cadence === "monthly" ? addMonths(s.lastDate, i, usualDay) : addDays(s.lastDate, i * CADENCE_DAYS[s.cadence]);
    if (next > to) break;
    if (next >= from) dates.push(next);
  }
  return dates;
}

/** Average amount per day of a daily series over the last `days` days (e.g. gig payouts). */
export function dailyAverage(s: Series, today: string, days = 90): number {
  const since = addDays(today, -days);
  const total = s.occurrences.filter((o) => o.date >= since && o.date < today).reduce((sum, o) => sum + o.cents, 0);
  return Math.round(total / days);
}
