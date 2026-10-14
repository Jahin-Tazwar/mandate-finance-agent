import type { PayCadence, PayCycle, WishPreview, WishStatus } from "@mandate/shared";
import { CADENCE_DAYS } from "../analytics/recurring";
import { addDays, addMonths, dayOfMonth, daysBetween, longDate } from "../lib/dates";
import { usd } from "../lib/money";
import type { StoredWish } from "../store/seed";

/**
 * The wish planner: turns "iPhone, $1,200, by April 12" into "save $40.39 every Friday".
 * Plain math, no AI. The AI may explain these numbers later; it never computes them.
 */

/** A plan using up to 60% of what's left over each payday is comfortable ("on track"). */
const COMFORTABLE_SHARE = 0.6;

/** Never look further ahead than this many paydays (daily pay: about 11 years). */
const MAX_PAYDAYS = 4_000;

/** For advice: "less on dining a week", "a month"... */
const PER_CYCLE: Record<PayCadence, string> = {
  daily: "a day",
  weekly: "a week",
  biweekly: "every two weeks",
  monthly: "a month",
  irregular: "per payday",
};

/**
 * The i-th payday from now (i = 0 is the next one).
 * e.g. weekly, next payday Oct 16: i=0 → Oct 16, i=1 → Oct 23, i=2 → Oct 30
 */
export function paydayAt(payCycle: PayCycle, i: number): string {
  const first = payCycle.nextPayday;
  switch (payCycle.cadence) {
    case "daily":
      return addDays(first, i);
    case "weekly":
      return addDays(first, i * 7);
    case "biweekly":
      return addDays(first, i * 14);
    case "monthly":
      return addMonths(first, i, dayOfMonth(first)); // keeps the day: the 25th stays the 25th
    case "irregular":
      return addDays(first, i * 30); // no real schedule: plan roughly monthly
  }
}

/** Every payday from the next one up to and including `lastDate`. */
function paydaysUntil(payCycle: PayCycle, lastDate: string): string[] {
  const dates: string[] = [];
  for (let i = 0; i < MAX_PAYDAYS; i++) {
    const date = paydayAt(payCycle, i);

    // Stop: past the target date
    if (date > lastDate) break;
    dates.push(date);
  }
  return dates;
}

/** "each Friday", "each day", "each month (on the 25th)", "every other Friday" */
function eachPayday(payCycle: PayCycle): string {
  switch (payCycle.cadence) {
    case "daily":
      return "each day";
    case "weekly":
      return `each ${payCycle.payday.replace(/s$/, "")}`; // "Fridays" → "each Friday"
    case "biweekly":
      return payCycle.payday; // already "every other Friday"
    case "monthly":
      return `each month (on ${payCycle.payday})`;
    case "irregular":
      return "each payday";
  }
}

/** Everything the planner needs to know besides the wish itself. */
export interface PlanContext {
  payCycle: PayCycle;
  today: string;
  /**
   * What's left over per payday for THIS wish: the usual surplus minus what
   * higher-priority wishes already take. e.g. Maya: $47.06 − iPhone $40.39 = $6.67 for her 2nd wish.
   */
  availableCents: number;
  /** Biggest optional spending (dining, shopping or fun), for advice. null if none. */
  topExtraCategory: string | null;
}

/** A wish without the store's id/createdAt (also what the "new wish" form previews). */
export type WishFields = Omit<StoredWish, "id" | "createdAt">;

/**
 * Plans one wish. Returns the full preview, plus `paceCents`: how much it will
 * actually take per payday (so the next wish knows what's left).
 */
export function planWish(w: WishFields, ctx: PlanContext): { preview: WishPreview; paceCents: number } {
  const { payCycle, today, availableCents } = ctx;
  const remaining = Math.max(0, w.targetCents - w.savedCents);
  const progressPct = Math.min(100, Math.round((w.savedCents / w.targetCents) * 1000) / 10); // one decimal

  // Fill in the parts that are the same for every outcome
  const result = (status: WishStatus, perPaydayCents: number, paydays: string[], eta: WishPreview["eta"], advice: string[]) => ({
    personaId: w.personaId,
    title: w.title,
    category: w.category,
    targetCents: w.targetCents,
    savedCents: w.savedCents,
    targetDate: w.targetDate,
    priority: w.priority,
    autoSave: w.autoSave,
    paused: w.paused,
    status,
    progressPct,
    plan: {
      cadence: payCycle.cadence,
      perPaydayCents,
      paydaysLeft: paydays.length,
      nextContributionDate: status === "paused" || status === "achieved" ? null : (paydays[0] ?? null),
    },
    eta,
    advice,
  });

  // Done: nothing left to save
  if (remaining === 0) {
    const eta = { date: today, daysVsTarget: daysBetween(w.targetDate, today) };
    return { preview: result("achieved", 0, [], eta, ["You've reached this wish."]), paceCents: 0 };
  }

  // Split what's left evenly over the paydays before the target date
  // e.g. $1,050 left, 26 Fridays until Apr 12 → $40.39 each Friday (rounded up to the cent)
  const paydays = paydaysUntil(payCycle, w.targetDate);
  const perPayday = paydays.length > 0 ? Math.ceil(remaining / paydays.length) : remaining;

  // Paused: keep the numbers for display, but plan nothing
  if (w.paused) {
    const advice = ["Paused. Nothing is set aside for this wish until you resume it."];
    return { preview: result("paused", perPayday, paydays, null, advice), paceCents: 0 };
  }

  // Compare with what's left over: up to 60% = on track, up to 100% = tight, more = not realistic
  // e.g. $40.39 of $47.06 = 86% → tight
  let status: WishStatus;
  if (paydays.length === 0) status = "not_realistic"; // the date is before the next payday
  else if (perPayday <= availableCents * COMFORTABLE_SHARE) status = "on_track";
  else if (perPayday <= availableCents) status = "tight";
  else status = "not_realistic";

  // What it will really get per payday: the plan, or only what's affordable if that's less
  const pace = Math.min(perPayday, Math.max(0, availableCents));

  // ETA: the payday when the money is there at that pace
  // e.g. $1,050 ÷ $40.39 → 26 paydays → the 26th Friday = Apr 9 (3 days early)
  let eta: WishPreview["eta"] = null;
  if (pace > 0) {
    const paydaysNeeded = Math.ceil(remaining / pace);
    if (paydaysNeeded <= MAX_PAYDAYS) {
      const date = paydayAt(payCycle, paydaysNeeded - 1);
      eta = { date, daysVsTarget: daysBetween(w.targetDate, date) };
    }
  }

  return { preview: result(status, perPayday, paydays, eta, adviceFor(status, perPayday, pace, paydays.length, eta, w, ctx)), paceCents: pace };
}

/** Plain sentences explaining the plan and, if needed, how to fix it. */
function adviceFor(
  status: WishStatus,
  perPayday: number,
  pace: number,
  paydaysLeft: number,
  eta: WishPreview["eta"],
  w: WishFields,
  ctx: PlanContext,
): string[] {
  const { payCycle, availableCents } = ctx;
  const each = eachPayday(payCycle);
  const advice: string[] = [];

  // The date is too close: not a single payday before it
  if (paydaysLeft === 0) {
    advice.push("The target date is before your next payday. Pick a later date.");
    return advice;
  }

  // How much of what's left over this plan uses
  if (availableCents > 0 && perPayday <= availableCents) {
    const pct = Math.round((perPayday / availableCents) * 100);
    advice.push(`Saving ${usd(perPayday)} ${each} uses ${pct}% of what you usually have left over.`);
  } else if (availableCents > 0) {
    advice.push(`Saving ${usd(perPayday)} ${each} is more than the ${usd(availableCents)} you usually have left over.`);
  }

  // Tight: how much less to spend on extras to make it comfortable (60%)
  // e.g. needs $40.39 → comfortable if $67.32 were left; Maya has $47.06 → spend ~$21 less a week
  if (status === "tight" && ctx.topExtraCategory) {
    const cut = Math.ceil((perPayday / COMFORTABLE_SHARE - availableCents) / 100) * 100; // whole dollars
    advice.push(`Spending ${usd(cut)} less on ${ctx.topExtraCategory} ${PER_CYCLE[payCycle.cadence]} would make this comfortable.`);
  }

  // Not realistic: say when it IS reachable, or what's in the way
  if (status === "not_realistic") {
    if (pace > 0 && eta) {
      advice.push(`At what you can afford (${usd(pace)} ${each}), you'd reach it around ${longDate(eta.date)}. Move the date, or lower the target.`);
    } else if (w.priority > 1) {
      advice.push("Your higher-priority wishes already use everything you usually have left over. Pause one, or move this date.");
    } else {
      advice.push("You usually have nothing left over after spending. Cutting extras would free up money for this.");
    }
  }
  return advice;
}

/**
 * Expected savings after each payday at `pace`, until the target is reached.
 * Long plans are thinned out to about 60 points (enough for a chart).
 */
export function projectSavings(w: WishFields, paceCents: number, payCycle: PayCycle): { date: string; savedCents: number }[] {
  // Nothing to project: no money going in, or already there
  if (paceCents <= 0 || w.savedCents >= w.targetCents) return [];

  // One point per payday: saved + pace, saved + 2 × pace... (capped at the target)
  // e.g. Maya: Oct 16 → $190.39, Oct 23 → $230.78, ... Apr 9 → $1,200
  const points: { date: string; savedCents: number }[] = [];
  for (let i = 0; i < MAX_PAYDAYS; i++) {
    const savedCents = Math.min(w.targetCents, w.savedCents + paceCents * (i + 1));
    points.push({ date: paydayAt(payCycle, i), savedCents });
    if (savedCents >= w.targetCents) break;
  }

  // Thin out: keep every n-th point, and always the last one
  // e.g. Aisha's daily plan with 1,911 points → every 32nd → ~60 points
  const step = Math.ceil(points.length / 60);
  return points.filter((_, i) => i % step === 0 || i === points.length - 1);
}

/** Converts a pace per payday into a pace per day, e.g. $40.39 a week → about $5.77 a day. */
export const perDay = (paceCents: number, cadence: PayCadence) => paceCents / CADENCE_DAYS[cadence];
