import type { Budget, Category, Subscription, Transaction } from "@mandate/shared";
import { dayOfMonth, daysInMonth, monthOf, previousMonth, shortDate } from "../lib/dates";
import { usd } from "../lib/money";
import type { DuplicateCharge } from "./commitments";
import { isOneOff } from "./payCycle";
import type { Series } from "./recurring";

const NOT_SPENDING: ReadonlySet<Category> = new Set(["income", "transfer"]);
/** Only spending you choose day to day can run "ahead of pace"; rent on the 1st always looks early. */
const DISCRETIONARY: ReadonlySet<Category> = new Set(["groceries", "dining", "shopping", "entertainment"]);
const roundUpTo5Dollars = (cents: number) => Math.ceil(cents / 500) * 500;
const label = (c: Category) => c[0]!.toUpperCase() + c.slice(1);

/**
 * Monthly budget built from the person's own history: each category's budget is
 * the average of the last 3 full months, rounded up to the next $5.
 * One-off big payments (tuition, a car repair) don't set the budget.
 * `spent` is everything that went out in `month` (up to today, for the current month).
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
  const m1 = previousMonth(month);
  const m2 = previousMonth(m1);
  const history = [m1, m2, previousMonth(m2)];

  const spentIn = (m: string, skipOneOffs: boolean) => {
    const totals = new Map<Category, number>();
    for (const t of transactions) {
      if (t.amountCents >= 0 || NOT_SPENDING.has(t.category) || monthOf(t.date) !== m || t.date >= today) continue;
      if (skipOneOffs && isOneOff(opts.series, t)) continue;
      totals.set(t.category, (totals.get(t.category) ?? 0) - t.amountCents);
    }
    return totals;
  };

  const past = history.map((m) => spentIn(m, true));
  const current = spentIn(month, false);
  const categories = [...new Set([...past.flatMap((p) => [...p.keys()]), ...current.keys()])]
    .map((category) => ({
      category,
      budgetCents: roundUpTo5Dollars(past.reduce((sum, p) => sum + (p.get(category) ?? 0), 0) / past.length),
      spentCents: current.get(category) ?? 0,
    }))
    .filter((c) => c.budgetCents > 0 || c.spentCents > 0)
    .sort((a, b) => b.budgetCents - a.budgetCents);

  // ---- Insights: plain sentences, all computed, no AI ----
  const insights: string[] = [];
  const isCurrentMonth = month === monthOf(today);
  const elapsed = isCurrentMonth ? (dayOfMonth(today) - 1) / daysInMonth(month) : 1;

  for (const c of categories) {
    if (c.budgetCents === 0 || c.spentCents < 2_000) continue;
    if (c.spentCents > c.budgetCents) {
      const pct = Math.round(((c.spentCents - c.budgetCents) / c.budgetCents) * 100);
      insights.push(`${label(c.category)} is ${pct}% over budget this month.`);
    } else if (isCurrentMonth && DISCRETIONARY.has(c.category) && elapsed > 0 && c.spentCents > c.budgetCents * elapsed * 1.25) {
      insights.push(`${label(c.category)} is ahead of pace: ${usd(c.spentCents)} of ${usd(c.budgetCents)} spent already.`);
    }
  }
  for (const s of opts.subscriptions.filter((s) => (s.unusedDays ?? 0) >= 45)) {
    const when = s.lastUsed ? `in ${s.unusedDays} days` : `since you started paying (${s.unusedDays} days)`;
    insights.push(`You haven't used ${s.merchant} ${when}. It costs ${usd(s.amountCents)} a month.`);
  }
  for (const d of opts.duplicates) {
    insights.push(`Possible duplicate charge: ${d.merchant} ${usd(d.amountCents)} twice on ${shortDate(d.date)}.`);
  }

  return { month, safeToSpendTodayCents: opts.safeToSpendTodayCents, categories, insights };
}
