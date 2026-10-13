import type { Bill, Subscription, Transaction } from "@mandate/shared";
import { addDays, daysBetween } from "../lib/dates";
import { type Series, upcomingDates } from "./recurring";

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Recurring charges in the "subscriptions" category, with how long since each was last used. */
export function listSubscriptions(
  personaId: string,
  series: Series[],
  usage: ReadonlyMap<string, string | null>,
  today: string,
): Subscription[] {
  return series
    .filter((s) => s.direction === "out" && s.category === "subscriptions" && (s.cadence === "weekly" || s.cadence === "monthly"))
    .map((s) => {
      const hasUsageData = usage.has(s.merchant);
      const lastUsed = usage.get(s.merchant) ?? null;
      const since = lastUsed ?? s.occurrences[0]!.date; // never used → count from the first charge
      return {
        id: `sub_${personaId}_${slug(s.merchant)}`,
        merchant: s.merchant,
        amountCents: -s.typicalCents,
        cadence: s.cadence as "weekly" | "monthly",
        accountId: s.accountId,
        lastCharged: s.lastDate,
        nextCharge: upcomingDates(s, today, addDays(today, 62))[0]!,
        lastUsed,
        unusedDays: hasUsageData ? daysBetween(since, today) : null,
        status: "active" as const,
      };
    })
    .sort((a, b) => (b.unusedDays ?? -1) - (a.unusedDays ?? -1));
}

/**
 * Upcoming bills in the next 30 days: rent, utilities, insurance, transit passes...
 * (recurring payments that aren't subscriptions or moves between your own accounts).
 */
export function listBills(personaId: string, series: Series[], today: string): Bill[] {
  const until = addDays(today, 30);
  return series
    .filter((s) => s.direction === "out" && s.cadence !== "daily" && s.category !== "subscriptions" && s.category !== "transfer")
    .flatMap((s) =>
      upcomingDates(s, today, until).map((dueDate) => ({
        id: `bill_${personaId}_${slug(s.merchant)}_${dueDate.replaceAll("-", "")}`,
        payee: s.merchant,
        amountCents: -s.typicalCents,
        dueDate,
        status: "due" as const,
        source: "bank" as const,
        accountId: s.accountId,
      })),
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || b.amountCents - a.amountCents);
}

export interface DuplicateCharge {
  merchant: string;
  amountCents: number;
  date: string;
  transactionIds: string[];
}

/** Same account, same merchant, same amount, same day, more than once: probably charged twice. */
export function findDuplicateCharges(transactions: readonly Transaction[], today: string, days = 60): DuplicateCharge[] {
  const since = addDays(today, -days);
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.amountCents >= 0 || t.date < since || t.category === "transfer") continue;
    const key = `${t.accountId}|${t.merchant}|${t.amountCents}|${t.date}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => ({ merchant: g[0]!.merchant, amountCents: -g[0]!.amountCents, date: g[0]!.date, transactionIds: g.map((t) => t.id) }));
}
