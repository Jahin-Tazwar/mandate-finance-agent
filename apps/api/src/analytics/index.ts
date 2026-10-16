import type { Bill, Budget, Forecast, PayCycle, Subscription } from "@mandate/shared";
import { config } from "../config";
import { monthOf } from "../lib/dates";
import { allTransactions, cancelledSubscriptions, getAccount, listActions, listDocumentBills, subscriptionUsage } from "../store";
import { buildBudget } from "./budget";
import { findDuplicateCharges, listBills, listSubscriptions } from "./commitments";
import { buildForecast, projectChecking, safeToSpendToday } from "./forecast";
import { detectPayCycle } from "./payCycle";
import { detectSeries } from "./recurring";

/**
 * One persona's analytics, computed fresh on every call. There's nothing to cache:
 * a few hundred transactions take well under a millisecond, and nothing can go stale.
 */

/** Everything the calculations below need for one persona. */
function context(personaId: string) {
  const transactions = allTransactions(personaId);
  const today = config.today;
  const checking = getAccount(personaId, "checking");

  // The recurring patterns (pay, rent, bills...) that everything else builds on
  const series = detectSeries(transactions, today);
  const floor = config.defaultBalanceFloorCents;

  // Walks checking 30 days forward; `true` = include average everyday spending
  const project = (includeEverydaySpending: boolean) =>
    projectChecking({ transactions, series, checkingId: checking.id, startBalance: checking.balanceCents, today, includeEverydaySpending });

  return { personaId, transactions, today, checking, series, floor, project };
}

export function getPayCycle(personaId: string): PayCycle {
  const c = context(personaId);
  return detectPayCycle(c.transactions, c.series, c.checking.id, c.today);
}

export function getSubscriptions(personaId: string): Subscription[] {
  const c = context(personaId);
  const cancelled = cancelledSubscriptions(personaId);

  // Ones cancelled through the app show as "cancelled" (they'd still look recurring from history)
  return listSubscriptions(personaId, c.series, subscriptionUsage(personaId), c.today).map((s) =>
    cancelled.has(s.merchant) ? { ...s, status: "cancelled" as const } : s,
  );
}

export function getBills(personaId: string): Bill[] {
  const c = context(personaId);

  // Bills from uploaded documents too ("paid" once a payment for them has gone through)
  const paidIds = new Set(listActions(personaId).filter((a) => a.status === "executed").map((a) => a.params.billId));
  const fromDocuments = listDocumentBills(personaId).map((b) => (paidIds.has(b.id) ? { ...b, status: "paid" as const } : b));

  // Soonest first
  return [...listBills(personaId, c.series, c.today), ...fromDocuments].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** The dashboard forecast: what will probably happen, everyday spending included. */
export function getForecast(personaId: string): Forecast {
  const c = context(personaId);
  return buildForecast(c.project(true), c.floor);
}

/** Uses only money you can count on, so everyday spending is left out. */
export function getSafeToSpendToday(personaId: string): number {
  const c = context(personaId);
  return safeToSpendToday(c.project(false), c.floor);
}

/** Budget for `month` (default: this month), with safe-to-spend and insights. */
export function getBudget(personaId: string, month?: string): Budget {
  const c = context(personaId);
  return buildBudget({
    transactions: c.transactions,
    series: c.series,
    month: month ?? monthOf(c.today),
    today: c.today,
    safeToSpendTodayCents: safeToSpendToday(c.project(false), c.floor),
    subscriptions: listSubscriptions(personaId, c.series, subscriptionUsage(personaId), c.today),
    duplicates: findDuplicateCharges(c.transactions, c.today),
  });
}

/** Charges that look like the same purchase billed twice (last 60 days). */
export function getDuplicateCharges(personaId: string) {
  return findDuplicateCharges(allTransactions(personaId), config.today);
}
