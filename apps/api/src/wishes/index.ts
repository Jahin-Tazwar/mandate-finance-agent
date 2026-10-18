import type { Category, Wish, WishDetail, WishImpact, WishInput, WishList, WishPreview } from "@mandate/shared";
import { getPayCycle } from "../analytics";
import { config } from "../config";
import { addDays } from "../lib/dates";
import { usd } from "../lib/money";
import { allTransactions, getWish, listContributions, listWishes } from "../store";
import type { StoredWish } from "../store/seed";
import { type WishFields, perDay, planWish, projectSavings } from "./planner";

/** Optional spending the advice may suggest cutting (groceries aren't optional). */
const EXTRAS: Category[] = ["dining", "shopping", "entertainment"];

/** The optional category this persona spent most on in the last 90 days, e.g. "dining". */
function topExtraCategory(personaId: string, today: string): string | null {
  const since = addDays(today, -90);
  let top: string | null = null;
  let topCents = 0;

  for (const category of EXTRAS) {
    const spent = allTransactions(personaId)
      .filter((t) => t.category === category && t.amountCents < 0 && t.date >= since && t.date < today)
      .reduce((sum, t) => sum - t.amountCents, 0);
    if (spent > topCents) {
      top = category;
      topCents = spent;
    }
  }
  return top;
}

/** One planned wish, plus how much it actually takes per payday. */
interface Planned {
  wish: Wish;
  paceCents: number;
}

/**
 * Plans every wish of a persona, most important first. Each wish only gets what's
 * left after the wishes above it, e.g. Maya: $47.06 left over → iPhone takes $40.39 →
 * $6.67 left for the Kyoto trip.
 * `draft` (optional) is a not-yet-saved wish from the form, slotted in by its priority.
 */
function planAll(personaId: string, draft?: WishFields): { planned: Planned[]; draftPreview?: WishPreview; surplus: number } {
  const today = config.today;
  const payCycle = getPayCycle(personaId);
  const extra = topExtraCategory(personaId, today);
  const surplus = payCycle.avgSurplusPerCycleCents;

  // Higher priority first. A draft goes after existing wishes with the same priority.
  const stored = listWishes(personaId);
  const queue: (StoredWish | { draft: WishFields })[] = [...stored];
  if (draft) {
    const position = stored.filter((w) => w.priority <= draft.priority).length;
    queue.splice(position, 0, { draft });
  }

  // Walk down the list, handing each wish what's still left over
  let left = surplus;
  const planned: Planned[] = [];
  let draftPreview: WishPreview | undefined;
  for (const item of queue) {
    const fields = "draft" in item ? item.draft : item;
    const { preview, paceCents } = planWish(fields, { payCycle, today, availableCents: left, usualSurplusCents: surplus, topExtraCategory: extra });
    left -= paceCents;

    if ("draft" in item) draftPreview = preview;
    else planned.push({ wish: { ...preview, id: item.id, createdAt: item.createdAt }, paceCents });
  }
  return { planned, draftPreview, surplus };
}

/** GET /personas/:id/wishes: every wish with its plan, and whether they fit together. */
export function getWishList(personaId: string): WishList {
  const { planned, surplus } = planAll(personaId);

  // Total the plans that are still saving (not achieved, not paused)
  const active = planned.filter((p) => p.wish.status !== "achieved" && p.wish.status !== "paused");
  const total = active.reduce((sum, p) => sum + p.wish.plan.perPaydayCents, 0);

  return {
    wishes: planned.map((p) => p.wish),
    totalPerPaydayCents: total,
    surplusPerPaydayCents: surplus,
    overCommitted: total > surplus, // e.g. Maya: $40.39 + $26.00 = $66.39 > $47.06 → true
  };
}

/** The default priority for a new wish: after all existing ones. */
export function nextPriority(personaId: string): number {
  return Math.max(0, ...listWishes(personaId).map((w) => w.priority)) + 1;
}

/** POST /personas/:id/wishes/preview: the plan for a wish being typed, without saving it. */
export function previewWish(personaId: string, input: WishInput): WishPreview {
  const draft: WishFields = {
    personaId,
    title: input.title,
    category: input.category,
    targetCents: input.targetCents,
    savedCents: input.savedCents,
    targetDate: input.targetDate,
    priority: input.priority ?? nextPriority(personaId),
    autoSave: input.autoSave,
    paused: false,
  };
  return planAll(personaId, draft).draftPreview!;
}

/** One wish with its plan (as part of the persona's whole list, so priorities count). */
function plannedWish(wishId: string): Planned {
  const stored = getWish(wishId); // 404 if it doesn't exist
  return planAll(stored.personaId).planned.find((p) => p.wish.id === wishId)!;
}

/** The planned version of a wish (used after create / update). */
export const getPlannedWish = (wishId: string): Wish => plannedWish(wishId).wish;

/** GET /wishes/:id: the wish, its saving history, and a projection for a chart. */
export function getWishDetail(wishId: string): WishDetail {
  const { wish, paceCents } = plannedWish(wishId);
  const payCycle = getPayCycle(wish.personaId);
  return {
    wish,
    // Saving history, e.g. [{ date: "2026-10-12", amountCents: 4039, source: "agent", actionId: "act_3" }]
    contributions: listContributions(wishId).map(({ wishId: _w, ...c }) => c),
    projection: projectSavings({ ...wish }, paceCents, payCycle),
  };
}

/**
 * GET /personas/:id/wishes/impact?amountCents=6000
 * Money spent now is money not saved, so the top active wish arrives later.
 * e.g. iPhone saves $40.39 a week ≈ $5.77 a day → a $60 ticket ≈ 11 days later.
 */
export function getWishImpact(personaId: string, amountCents: number): WishImpact {
  const { planned } = planAll(personaId);
  const payCycle = getPayCycle(personaId);

  // The most important wish that's actually receiving money
  const target = planned.find((p) => p.paceCents > 0);

  // Nothing affected: no wish is currently being saved for
  if (!target) {
    return { amountCents, impacts: [], message: "This doesn't affect any of your wishes." };
  }

  const delayDays = Math.ceil(amountCents / perDay(target.paceCents, payCycle.cadence));
  return {
    amountCents,
    impacts: [{ wishId: target.wish.id, title: target.wish.title, delayDays }],
    message: `Spending ${usd(amountCents)} delays your ${target.wish.title} by ${delayDays} day${delayDays === 1 ? "" : "s"}.`,
  };
}

/**
 * What auto-save would put aside this payday, wish by wish (most important first).
 * Only wishes with auto-save on that are actually receiving money.
 * e.g. Maya → [{ wishId: "wish_maya_1", title: "iPhone 17", amountCents: 4039 }]
 */
export function autoSavePlan(personaId: string): { wishId: string; title: string; amountCents: number }[] {
  return planAll(personaId)
    .planned.filter((p) => p.wish.autoSave && p.paceCents > 0)
    .map((p) => ({ wishId: p.wish.id, title: p.wish.title, amountCents: p.paceCents }));
}
