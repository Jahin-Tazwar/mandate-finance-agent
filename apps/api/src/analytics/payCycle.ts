import type { Category, PayCycle, Transaction } from "@mandate/shared";
import { WEEKDAYS, addDays, dayOfMonth, weekdayOf } from "../lib/dates";
import { CADENCE_DAYS, type RegularCadence, type Series, upcomingDates } from "./recurring";

/** Money moving that isn't spending: pay, and moves between your own accounts. */
const NOT_SPENDING: ReadonlySet<Category> = new Set(["income", "transfer"]);

/** When several incomes qualify, the most frequent one sets the pay cycle. */
const SHORTEST_FIRST: RegularCadence[] = ["daily", "weekly", "biweekly", "monthly"];

/** A non-repeating payment of $500+ is a one-off (e.g. tuition), not a habit. */
export const ONE_OFF_CENTS = 50_000;

/** 1 → "1st", 2 → "2nd", 3 → "3rd", 11 → "11th", 25 → "25th" */
function ordinal(n: number): string {
  // 11, 12, 13 are special: "11th", not "11st"
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  if (n % 10 === 1) return `${n}st`;
  if (n % 10 === 2) return `${n}nd`;
  if (n % 10 === 3) return `${n}rd`;
  return `${n}th`;
}

/** True if the transaction is part of one of the detected recurring series. */
export function inAnySeries(series: Series[], t: Transaction): boolean {
  return series.some(
    (s) => s.accountId === t.accountId && s.merchant === t.merchant && s.occurrences.some((o) => o.date === t.date),
  );
}

/**
 * A one-off: a big payment ($500+) that isn't part of a recurring pattern,
 * like a tuition bill. Left out of averages so one event doesn't skew "normal".
 */
export function isOneOff(series: Series[], t: Transaction): boolean {
  return Math.abs(t.amountCents) >= ONE_OFF_CENTS && !inAnySeries(series, t);
}

/**
 * How often this person is paid, and what they usually have left each payday.
 * Looks at the last 90 days of income.
 */
export function detectPayCycle(
  transactions: readonly Transaction[],
  series: Series[],
  checkingId: string,
  today: string,
): PayCycle {
  const since = addDays(today, -90);
  const inWindow = (date: string) => date >= since && date < today;

  // Regular income into checking: pay, payouts, family support
  const incomes = series.filter((s) => s.direction === "in" && s.category === "income" && s.accountId === checkingId);

  // Money earned from one income in the last 90 days, skipping unusual spikes
  // e.g. family usually sends $600; a one-time $2,500 for tuition is skipped (more than 2 × $600)
  const earned = (s: Series) =>
    s.occurrences
      .filter((o) => inWindow(o.date) && o.cents <= 2 * s.typicalCents)
      .reduce((sum, o) => sum + o.cents, 0);
  const totalIncome = incomes.reduce((sum, s) => sum + earned(s), 0);

  // The main income: brings at least 25% of the money; if several do, the most frequent wins
  // e.g. Aisha: daily ride payouts (63%) beat weekly courier payouts → she plans day by day
  const bigEnough = incomes.filter((s) => totalIncome > 0 && earned(s) / totalIncome >= 0.25);
  const main = bigEnough.sort((a, b) => SHORTEST_FIRST.indexOf(a.cadence) - SHORTEST_FIRST.indexOf(b.cadence))[0];
  const cadence = main?.cadence ?? "irregular";

  // Defaults when there's no regular income
  let payday = "irregularly";
  let nextPayday = addDays(today, 7);

  if (main && cadence === "daily") {
    // Daily earners: the next payday is tomorrow
    payday = "almost every day";
    nextPayday = addDays(today, 1);
  } else if (main) {
    // Weekly / biweekly / monthly: predict the next one and describe the day
    nextPayday = upcomingDates(main, today, addDays(today, 62))[0] ?? nextPayday;
    if (cadence === "monthly") {
      payday = `the ${ordinal(dayOfMonth(main.lastDate))}`; // e.g. "the 25th"
    } else {
      const weekday = WEEKDAYS[weekdayOf(main.lastDate)]!; // e.g. "friday"
      const name = weekday[0]!.toUpperCase() + weekday.slice(1); // "Friday"
      payday = cadence === "weekly" ? `${name}s` : `every other ${name}`;
    }
  }

  // All normal spending in the same 90 days, from every account (card purchases count).
  // Not counted: card payments and savings transfers (not spending), and one-offs.
  const spending = transactions
    .filter((t) => inWindow(t.date) && t.amountCents < 0 && !NOT_SPENDING.has(t.category) && !isOneOff(series, t))
    .reduce((sum, t) => sum - t.amountCents, 0);

  // Turn 90-day totals into "per pay cycle", e.g. weekly: 90 ÷ 7 ≈ 12.9 cycles
  const cycles = 90 / CADENCE_DAYS[cadence];
  return {
    cadence,
    payday,
    nextPayday,
    avgIncomePerCycleCents: Math.round(totalIncome / cycles),
    avgSurplusPerCycleCents: Math.round((totalIncome - spending) / cycles),
  };
}
