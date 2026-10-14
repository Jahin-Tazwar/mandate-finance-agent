import type { Budget, Category, Subscription, Transaction } from "@mandate/shared";
import { dayOfMonth, daysInMonth, monthOf, previousMonth, shortDate } from "../lib/dates";
import { usd } from "../lib/money";
import type { DuplicateCharge } from "./commitments";
import { isOneOff } from "./payCycle";
import type { Series } from "./recurring";

/** Money moving that isn't spending: pay, and moves between your own accounts. */
const NOT_SPENDING: ReadonlySet<Category> = new Set(["income", "transfer"]);

/** Only spending you choose can run "ahead of pace"; rent on the 1st always looks early. */
const DISCRETIONARY: ReadonlySet<Category> = new Set(["groceries", "dining", "shopping", "entertainment"]);

/** e.g. 39123 ($391.23) → 39500 ($395) */
const roundUpTo5Dollars = (cents: number) => Math.ceil(cents / 500) * 500;

/** "dining" → "Dining" */
const label = (c: Category) => c[0]!.toUpperCase() + c.slice(1);

/**
 * A monthly budget built from the person's own history, plus plain-English insights.
 * Each category's budget = average of the last 3 full months (one-offs left out), rounded up to $5.
 */
export function buildBudget(opts: {
  transactions: readonly Transaction[];
  series: Series[];
  month: string;
  today: string;
  safeToSpendTodayCents: number;
  subscriptions: Subscription[];
  duplicates: DuplicateCharge[];
}): Budget {
  const { transactions, month, today } = opts;

  // The 3 full months before this one, e.g. for October: Sep, Aug, Jul
  const m1 = previousMonth(month);
  const m2 = previousMonth(m1);
  const history = [m1, m2, previousMonth(m2)];

  // Total spent per category in one month, e.g. { dining: 17500, groceries: 39100 }
  const spentIn = (m: string, skipOneOffs: boolean) => {
    const totals = new Map<Category, number>();
    for (const t of transactions) {
      // Skip: money coming in, pay, transfers, another month, or after today
      if (t.amountCents >= 0 || NOT_SPENDING.has(t.category) || monthOf(t.date) !== m || t.date >= today) continue;

      // Skip: one-offs (e.g. a $2,800 tuition bill) shouldn't set a monthly budget
      if (skipOneOffs && isOneOff(opts.series, t)) continue;

      totals.set(t.category, (totals.get(t.category) ?? 0) - t.amountCents);
    }
    return totals;
  };

  // Past months set the budget (without one-offs); this month shows everything actually spent
  const past = history.map((m) => spentIn(m, true));
  const current = spentIn(month, false);

  // One row per category that appears in any of these months
  const allCategories = new Set([...past.flatMap((p) => [...p.keys()]), ...current.keys()]);
  const categories = [...allCategories]
    .map((category) => ({
      category,
      budgetCents: roundUpTo5Dollars(past.reduce((sum, p) => sum + (p.get(category) ?? 0), 0) / past.length),
      spentCents: current.get(category) ?? 0,
    }))
    // Skip: categories with no budget and nothing spent
    .filter((c) => c.budgetCents > 0 || c.spentCents > 0)
    // Biggest budgets first
    .sort((a, b) => b.budgetCents - a.budgetCents);

  // ---- Insights: plain sentences, all computed, no AI ----
  const insights: string[] = [];

  // How far through the month we are, e.g. Oct 12 → 11 of 31 days done ≈ 0.35
  const isCurrentMonth = month === monthOf(today);
  const elapsed = isCurrentMonth ? (dayOfMonth(today) - 1) / daysInMonth(month) : 1;

  // Over budget, or spending faster than the month is passing
  for (const c of categories) {
    // Skip: no budget to compare with, or too little spent to mention (under $20)
    if (c.budgetCents === 0 || c.spentCents < 2_000) continue;

    if (c.spentCents > c.budgetCents) {
      const pct = Math.round(((c.spentCents - c.budgetCents) / c.budgetCents) * 100);
      insights.push(`${label(c.category)} is ${pct}% over budget this month.`);
    } else if (isCurrentMonth && DISCRETIONARY.has(c.category) && elapsed > 0 && c.spentCents > c.budgetCents * elapsed * 1.25) {
      // "Ahead of pace" = spent 25% more than expected by now
      // e.g. 35% of the month gone, budget $175 → expected ~$61; warn above ~$77
      insights.push(`${label(c.category)} is ahead of pace: ${usd(c.spentCents)} of ${usd(c.budgetCents)} spent already.`);
    }
  }

  // Subscriptions not used for 45+ days
  for (const s of opts.subscriptions.filter((s) => (s.unusedDays ?? 0) >= 45)) {
    const when = s.lastUsed ? `in ${s.unusedDays} days` : `since you started paying (${s.unusedDays} days)`;
    insights.push(`You haven't used ${s.merchant} ${when}. It costs ${usd(s.amountCents)} a month.`);
  }

  // Probably charged twice
  for (const d of opts.duplicates) {
    insights.push(`Possible duplicate charge: ${d.merchant} ${usd(d.amountCents)} twice on ${shortDate(d.date)}.`);
  }

  return { month, safeToSpendTodayCents: opts.safeToSpendTodayCents, categories, insights };
}
