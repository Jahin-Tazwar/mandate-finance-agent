import type { Bill, Budget, Forecast, PayCycle, Subscription } from "@mandate/shared";
import { config } from "../config";
import { monthOf } from "../lib/dates";
import { allTransactions, getAccount, subscriptionUsage } from "../store";
import { buildBudget } from "./budget";
import { findDuplicateCharges, listBills, listSubscriptions } from "./commitments";
import { buildForecast, projectChecking, safeToSpendToday } from "./forecast";
import { detectPayCycle } from "./payCycle";
import { detectSeries } from "./recurring";

/**
 * Persona-level analytics, computed fresh from the store on every call.
 * (A few hundred transactions take well under a millisecond, so there's
 * nothing to cache and nothing that can go stale after a payment.)
 */
function context(personaId: string) {
  const transactions = allTransactions(personaId);
  const today = config.today;
  const checking = getAccount(personaId, "checking");
  const series = detectSeries(transactions, today);
  const floor = config.defaultBalanceFloorCents;
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
  return listSubscriptions(personaId, c.series, subscriptionUsage(personaId), c.today);
}

export function getBills(personaId: string): Bill[] {
  const c = context(personaId);
  return listBills(personaId, c.series, c.today);
}

export function getForecast(personaId: string): Forecast {
  const c = context(personaId);
  return buildForecast(c.project(true), c.floor);
}

export function getSafeToSpendToday(personaId: string): number {
  const c = context(personaId);
  return safeToSpendToday(c.project(false), c.floor);
}

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
