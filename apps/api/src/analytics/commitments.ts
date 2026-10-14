import type { Bill, Subscription, Transaction } from "@mandate/shared";
import { addDays, daysBetween } from "../lib/dates";
import { type Series, upcomingDates } from "./recurring";

/** Name → id-friendly text, e.g. "FitZone Premium" → "fitzone-premium" */
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // anything that isn't a letter or digit becomes "-"
    .replace(/^-|-$/g, ""); // no "-" at the start or end

/** Recurring subscription charges, with how long since each was last used. */
export function listSubscriptions(
  personaId: string,
  series: Series[],
  usage: ReadonlyMap<string, string | null>,
  today: string,
): Subscription[] {
  // Only money-out series in the "subscriptions" category, charged weekly or monthly
  const subscriptionSeries = series.filter(
    (s) => s.direction === "out" && s.category === "subscriptions" && (s.cadence === "weekly" || s.cadence === "monthly"),
  );

  const subscriptions = subscriptionSeries.map((s) => {
    // Usage file: a date = last used; empty = never used; merchant missing = we don't know
    const hasUsageData = usage.has(s.merchant);
    const lastUsed = usage.get(s.merchant) ?? null;

    // Never used → count from the first charge, e.g. FitZone since May 2 → 163 days
    const unusedSince = lastUsed ?? s.occurrences[0]!.date;

    return {
      id: `sub_${personaId}_${slug(s.merchant)}`,
      merchant: s.merchant,
      amountCents: -s.typicalCents, // shown as a positive cost
      cadence: s.cadence as "weekly" | "monthly",
      accountId: s.accountId,
      lastCharged: s.lastDate,
      nextCharge: upcomingDates(s, today, addDays(today, 62))[0]!,
      lastUsed,
      unusedDays: hasUsageData ? daysBetween(unusedSince, today) : null,
      status: "active" as const,
    };
  });

  // Least-used first (unknown usage goes last)
  return subscriptions.sort((a, b) => (b.unusedDays ?? -1) - (a.unusedDays ?? -1));
}

/**
 * Bills due in the next 30 days: rent, utilities, insurance, transit passes...
 * (recurring payments that aren't subscriptions or moves between your own accounts).
 */
export function listBills(personaId: string, series: Series[], today: string): Bill[] {
  const until = addDays(today, 30);

  // Money-out series that are bills: not daily, not subscriptions, not transfers
  const billSeries = series.filter(
    (s) => s.direction === "out" && s.cadence !== "daily" && s.category !== "subscriptions" && s.category !== "transfer",
  );

  // One bill per predicted due date, e.g. rent on Nov 1 → "bill_maya_greenview-student-housing_20261101"
  const bills = billSeries.flatMap((s) =>
    upcomingDates(s, today, until).map((dueDate) => ({
      id: `bill_${personaId}_${slug(s.merchant)}_${dueDate.replaceAll("-", "")}`,
      payee: s.merchant,
      amountCents: -s.typicalCents, // shown as a positive amount owed
      dueDate,
      status: "due" as const,
      source: "bank" as const,
      accountId: s.accountId,
    })),
  );

  // Soonest first; on the same day, biggest first
  return bills.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || b.amountCents - a.amountCents);
}

export interface DuplicateCharge {
  merchant: string;
  amountCents: number;
  date: string;
  transactionIds: string[];
}

/** Same account + merchant + amount + day, more than once: probably charged twice. */
export function findDuplicateCharges(transactions: readonly Transaction[], today: string, days = 60): DuplicateCharge[] {
  const since = addDays(today, -days);

  // Group identical charges, e.g. "acc_daniel_crd|TechStore|-12999|2026-09-14" → [tx1, tx2]
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    // Skip: money coming in, older than 60 days, or a transfer between own accounts
    if (t.amountCents >= 0 || t.date < since || t.category === "transfer") continue;

    const key = `${t.accountId}|${t.merchant}|${t.amountCents}|${t.date}`;
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push(t);
  }

  // Keep only groups with 2+ charges
  const duplicates: DuplicateCharge[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const first = group[0]!;
    duplicates.push({
      merchant: first.merchant,
      amountCents: -first.amountCents,
      date: first.date,
      transactionIds: group.map((t) => t.id),
    });
  }
  return duplicates;
}
