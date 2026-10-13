import type { Category, PayCycle, Transaction } from "@mandate/shared";
import { WEEKDAYS, addDays, dayOfMonth, weekdayOf } from "../lib/dates";
import { CADENCE_DAYS, type RegularCadence, type Series, upcomingDates } from "./recurring";

/** Money moving in or out that isn't spending: pay, refunds, moves between your own accounts. */
const NOT_SPENDING: ReadonlySet<Category> = new Set(["income", "transfer"]);

const SHORTEST_FIRST: RegularCadence[] = ["daily", "weekly", "biweekly", "monthly"];
export const ONE_OFF_CENTS = 50_000; // a non-repeating payment of $500+ is a one-off, not a habit

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

/**
 * A one-off: a big payment ($500+) that isn't part of a recurring pattern, like a
 * tuition bill or a car repair. Kept out of averages so one event doesn't skew "normal".
 */
export const isOneOff = (series: Series[], t: Transaction) => Math.abs(t.amountCents) >= ONE_OFF_CENTS && !inAnySeries(series, t);

/** True if the transaction belongs to one of the detected recurring series. */
export function inAnySeries(series: Series[], t: Transaction): boolean {
  return series.some((s) => s.accountId === t.accountId && s.merchant === t.merchant && s.occurrences.some((o) => o.date === t.date));
}

/**
 * How often this person is paid, judged from the last 90 days of income.
 * If several income sources each bring at least 25% of the money, the most
 * frequent one wins: a gig worker paid daily *and* weekly plans day by day.
 */
export function detectPayCycle(
  transactions: readonly Transaction[],
  series: Series[],
  checkingId: string,
  today: string,
): PayCycle {
  const since = addDays(today, -90);
  const inWindow = (date: string) => date >= since && date < today;

  const income = series.filter((s) => s.direction === "in" && s.category === "income" && s.accountId === checkingId);
  // Ignore unusual spikes inside a regular income (e.g. family sending extra for tuition once).
  const earned = (s: Series) =>
    s.occurrences.filter((o) => inWindow(o.date) && o.cents <= 2 * s.typicalCents).reduce((sum, o) => sum + o.cents, 0);
  const totalIncome = income.reduce((sum, s) => sum + earned(s), 0);

  const main = income
    .filter((s) => totalIncome > 0 && earned(s) / totalIncome >= 0.25)
    .sort((a, b) => SHORTEST_FIRST.indexOf(a.cadence) - SHORTEST_FIRST.indexOf(b.cadence))[0];

  const cadence = main?.cadence ?? "irregular";
  let payday = "irregularly";
  let nextPayday = addDays(today, 7);
  if (main && cadence === "daily") {
    payday = "almost every day";
    nextPayday = addDays(today, 1);
  } else if (main) {
    nextPayday = upcomingDates(main, today, addDays(today, 62))[0] ?? nextPayday;
    const recent = main.occurrences.slice(-4).map((o) => o.date);
    if (cadence === "monthly") {
      payday = `the ${ordinal(dayOfMonth(recent.at(-1)!))}`;
    } else {
      const weekday = WEEKDAYS[weekdayOf(recent.at(-1)!)]!;
      const name = weekday[0]!.toUpperCase() + weekday.slice(1);
      payday = cadence === "weekly" ? `${name}s` : `every other ${name}`;
    }
  }

  // All normal spending over the same 90 days, from every account (card purchases count;
  // card *payments* and savings transfers don't, they aren't spending), minus one-offs.
  const spending = transactions
    .filter((t) => inWindow(t.date) && t.amountCents < 0 && !NOT_SPENDING.has(t.category) && !isOneOff(series, t))
    .reduce((sum, t) => sum - t.amountCents, 0);

  const cycles = 90 / CADENCE_DAYS[cadence];
  return {
    cadence,
    payday,
    nextPayday,
    avgIncomePerCycleCents: Math.round(totalIncome / cycles),
    avgSurplusPerCycleCents: Math.round((totalIncome - spending) / cycles),
  };
}
