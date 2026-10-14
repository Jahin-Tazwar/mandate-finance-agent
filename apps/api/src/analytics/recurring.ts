import type { Category, PayCadence, Transaction } from "@mandate/shared";
import { addDays, addMonths, dayOfMonth, daysBetween } from "../lib/dates";

/**
 * Finds things that repeat on a schedule: paychecks, rent, bills, subscriptions,
 * card payments. Plain math over transactions, no AI.
 */

/** Every cadence except "irregular". */
export type RegularCadence = Exclude<PayCadence, "irregular">;

/** How many days apart two occurrences may be, for each cadence. */
const GAP_WINDOW: Record<RegularCadence, [number, number]> = {
  daily: [1, 2],
  weekly: [6, 8], // pay can shift a day: Friday → Saturday → Friday
  biweekly: [13, 16],
  monthly: [27, 33], // months are 28–31 days
};

/** Spending you choose. It can repeat often, but it's never a bill or commitment. */
const DISCRETIONARY: ReadonlySet<Category> = new Set(["groceries", "dining", "shopping", "entertainment"]);

/** Average length of one cycle, in days. */
export const CADENCE_DAYS: Record<PayCadence, number> = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 30.44, // average month length (365.25 ÷ 12)
  irregular: 30.44,
};

/** One recurring pattern, e.g. "Maya pays Greenview Student Housing $750 every month". */
export interface Series {
  merchant: string;
  accountId: string;
  category: Category;
  direction: "in" | "out";
  cadence: RegularCadence;
  /** Every time it happened, oldest first. */
  occurrences: { date: string; cents: number }[];
  /** Usual amount: median of the last 3, so a one-off spike doesn't distort it. Negative = money out. */
  typicalCents: number;
  lastDate: string;
}

/** Middle value after sorting, e.g. [600, 2500, 600] → 600 (the average would be 1233). */
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  // Odd count: the middle one. Even count: halfway between the two middle ones.
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/**
 * Decides the cadence of a list of dates (oldest first), or "irregular".
 * e.g. rent on May 1, Jun 1, Jul 1 → gaps 31, 30 → "monthly".
 */
export function classifyCadence(dates: string[]): PayCadence {
  // Reject: 2 dates always look like a pattern, so we need at least 3
  if (dates.length < 3) return "irregular";

  // Days between each date and the one before it, e.g. [31, 30, 31]
  const gaps = dates.slice(1).map((date, i) => daysBetween(dates[i]!, date));
  const typical = median(gaps);

  // Find the cadence whose window the typical gap falls into
  for (const [cadence, [min, max]] of Object.entries(GAP_WINDOW) as [RegularCadence, [number, number]][]) {
    if (typical < min || typical > max) continue;

    // Reject: at least 60% of the gaps must fit, so a café visited "about every
    // two weeks" doesn't become a biweekly bill
    const fitting = gaps.filter((gap) => gap >= min && gap <= max).length;
    return fitting / gaps.length >= 0.6 ? cadence : "irregular";
  }

  // Reject: the typical gap fits no cadence (e.g. 20 days)
  return "irregular";
}

/**
 * How much amounts jump around: standard deviation ÷ average.
 * e.g. rent [750, 750, 750] → 0; electricity [90, 140, 120] → about 0.18.
 */
function variation(cents: number[]): number {
  const amounts = cents.map(Math.abs);
  const mean = amounts.reduce((sum, a) => sum + a, 0) / amounts.length;
  if (mean === 0) return 0;

  const variance = amounts.reduce((sum, a) => sum + (a - mean) ** 2, 0) / amounts.length;
  return Math.sqrt(variance) / mean;
}

/**
 * Sorts transactions into piles and keeps the piles that repeat on a schedule.
 * Income may vary freely; payments must be steady amounts and not discretionary.
 */
export function detectSeries(transactions: readonly Transaction[], today: string): Series[] {
  // Put each transaction into a pile: same account + same merchant + same direction
  // e.g. "acc_maya_chk|Greenview Student Housing|out"
  const piles = new Map<string, Transaction[]>();
  for (const t of transactions) {
    const key = `${t.accountId}|${t.merchant}|${t.amountCents > 0 ? "in" : "out"}`;
    let pile = piles.get(key);
    if (!pile) {
      pile = [];
      piles.set(key, pile);
    }
    pile.push(t);
  }

  const series: Series[] = [];
  for (const pile of piles.values()) {
    // Oldest first, so the gaps between dates make sense
    const sorted = [...pile].sort((a, b) => a.date.localeCompare(b.date));
    const first = sorted[0]!;
    const last = sorted.at(-1)!;

    // Skip: doesn't repeat on a schedule
    const cadence = classifyCadence(sorted.map((t) => t.date));
    if (cadence === "irregular") continue;

    const direction = first.amountCents > 0 ? "in" : "out";

    // Skip: dining, shopping etc. are choices, never commitments
    if (direction === "out" && DISCRETIONARY.has(first.category)) continue;

    // Skip: amounts jump around too much (over 25%), so it's not a bill
    if (direction === "out" && variation(sorted.map((t) => t.amountCents)) > 0.25) continue;

    // Skip: it stopped a while ago (e.g. a cancelled subscription)
    // e.g. monthly: 30.44 × 1.5 → 46 + 2 = 48 days without it means it's over
    const staleAfterDays = Math.ceil(CADENCE_DAYS[cadence] * 1.5) + 2;
    if (daysBetween(last.date, today) > staleAfterDays) continue;

    // Keep it: a real recurring pattern
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
 * Predicts when a series happens next, between `from` and `to` (inclusive).
 * Monthly series keep their usual day, e.g. rent on the 1st stays on the 1st.
 */
export function upcomingDates(s: Series, from: string, to: string): string[] {
  // Reject: daily series (e.g. gig payouts) are spread per day instead; see dailyAverage()
  if (s.cadence === "daily") throw new Error("daily series are spread per day, not dated");

  // The usual day of the month, from the last 3 times (e.g. 1 for rent)
  const usualDay = median(s.occurrences.slice(-3).map((o) => dayOfMonth(o.date)));

  // Step forward from the last occurrence: +1 month, +2 months... (or +7 days, +14 days...)
  const dates: string[] = [];
  for (let step = 1; step < 400; step++) {
    const next =
      s.cadence === "monthly"
        ? addMonths(s.lastDate, step, usualDay)
        : addDays(s.lastDate, step * CADENCE_DAYS[s.cadence]);

    // Stop: past the end of the period we're asked about
    if (next > to) break;

    // Keep only dates inside the period
    if (next >= from) dates.push(next);
  }
  return dates;
}

/**
 * Average amount per day of a daily series over the last `days` days.
 * e.g. Aisha's ride-share payouts: ~$74 most days, ~$55/day on average (some days off).
 */
export function dailyAverage(s: Series, today: string, days = 90): number {
  const since = addDays(today, -days);
  const total = s.occurrences
    .filter((o) => o.date >= since && o.date < today)
    .reduce((sum, o) => sum + o.cents, 0);
  return Math.round(total / days);
}
