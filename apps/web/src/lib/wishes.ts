import { PayCadence, WishCategory, WishStatus } from "@mandate/shared";
import { z } from "zod";
import { ApiError, apiRequest, type Parser } from "./api";

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const WishSchema = z.object({
  id: z.string(),
  personaId: z.string(),
  title: z.string(),
  category: WishCategory,
  targetCents: z.number().int(),
  savedCents: z.number().int(),
  targetDate: IsoDate,
  priority: z.number().int(),
  autoSave: z.boolean(),
  status: WishStatus,
  progressPct: z.number(),
  plan: z.object({
    cadence: PayCadence,
    perPaydayCents: z.number().int(),
    paydaysLeft: z.number().int(),
    nextContributionDate: IsoDate.nullable(),
  }),
  eta: z.object({ date: IsoDate, daysVsTarget: z.number().int() }).nullable(),
  advice: z.array(z.string()),
  paused: z.boolean().default(false),
  createdAt: z.string(),
});

export const WishListSchema = z.object({
  wishes: z.array(WishSchema),
  totalPerPaydayCents: z.number().int(),
  surplusPerPaydayCents: z.number().int(),
  overCommitted: z.boolean(),
});

export type Wish = z.infer<typeof WishSchema>;
export type WishList = z.infer<typeof WishListSchema>;
export type WishDraft = {
  title: string;
  category: z.infer<typeof WishCategory>;
  targetCents: number;
  savedCents: number;
  targetDate: string;
};
export type WishPreview = Omit<Wish, "id" | "createdAt" | "personaId" | "priority" | "autoSave">;

const parseWishList: Parser<WishList> = (value) => WishListSchema.parse(value);
const parseWish: Parser<Wish> = (value) => WishSchema.parse(value);
const parsePreview: Parser<WishPreview> = (value) => {
  const parsed = WishSchema.omit({
    id: true,
    createdAt: true,
    personaId: true,
    priority: true,
    autoSave: true,
  }).parse(value);
  return parsed;
};

const seedWishes: Array<WishDraft & { personaId: string; priority: number; autoSave: boolean }> = [
  { personaId: "maya", title: "iPhone 17", category: "gadget", targetCents: 120000, savedCents: 15000, targetDate: "2027-04-12", priority: 1, autoSave: true },
  { personaId: "maya", title: "Trip to Kyoto", category: "travel", targetCents: 50000, savedCents: 24000, targetDate: "2026-12-20", priority: 2, autoSave: true },
  { personaId: "daniel", title: "Car down payment", category: "vehicle", targetCents: 800000, savedCents: 150000, targetDate: "2028-10-01", priority: 1, autoSave: true },
  { personaId: "daniel", title: "Holiday in Bali", category: "travel", targetCents: 250000, savedCents: 30000, targetDate: "2027-07-01", priority: 2, autoSave: false },
  { personaId: "aisha", title: "Flat down payment", category: "property", targetCents: 2500000, savedCents: 200000, targetDate: "2030-10-01", priority: 1, autoSave: true },
  { personaId: "aisha", title: "Emergency fund", category: "other", targetCents: 300000, savedCents: 40000, targetDate: "2027-06-30", priority: 2, autoSave: true },
];

const STORAGE_PREFIX = "moneywise:wishes:";

function storageKey(personaId: string) {
  return `${STORAGE_PREFIX}${personaId}`;
}

function addPayPeriod(date: Date, cadence: z.infer<typeof PayCadence>) {
  const next = new Date(date);
  if (cadence === "daily") next.setDate(next.getDate() + 1);
  else if (cadence === "weekly" || cadence === "irregular") next.setDate(next.getDate() + 7);
  else if (cadence === "biweekly") next.setDate(next.getDate() + 14);
  else {
    const dayOfMonth = next.getDate();
    next.setDate(1);
    next.setMonth(next.getMonth() + 1);
    const lastDayOfMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(dayOfMonth, lastDayOfMonth));
  }
  return next;
}

function dateString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function paydayCount(nextPayday: string, targetDate: string, cadence: z.infer<typeof PayCadence>) {
  const target = new Date(`${targetDate}T12:00:00`);
  let date = new Date(`${nextPayday}T12:00:00`);
  let count = 0;
  while (date <= target && count < 600) {
    count += 1;
    date = addPayPeriod(date, cadence);
  }
  return Math.max(count, 1);
}

function createPreview(
  draft: WishDraft,
  cadence: z.infer<typeof PayCadence>,
  nextPayday: string,
  surplusCents: number,
): WishPreview {
  const remaining = Math.max(draft.targetCents - draft.savedCents, 0);
  const paydaysLeft = paydayCount(nextPayday, draft.targetDate, cadence);
  const perPaydayCents = remaining > 0 ? Math.ceil(remaining / paydaysLeft) : 0;
  const progressPct = draft.targetCents > 0 ? Math.min(100, (draft.savedCents / draft.targetCents) * 100) : 0;
  const share = surplusCents > 0 ? perPaydayCents / surplusCents : perPaydayCents > 0 ? Infinity : 0;
  const status = progressPct >= 100 ? "achieved" : share > 1 ? "not_realistic" : share >= 0.6 ? "tight" : "on_track";
  const nextContribution = new Date(`${nextPayday}T12:00:00`);
  const target = new Date(`${draft.targetDate}T12:00:00`);
  const eta = new Date(nextContribution);
  let contributions = 1;
  while (draft.savedCents + perPaydayCents * contributions < draft.targetCents && contributions < paydaysLeft) {
    eta.setTime(addPayPeriod(eta, cadence).getTime());
    contributions += 1;
  }
  const daysVsTarget = Math.round((eta.getTime() - target.getTime()) / 86_400_000);
  const suffix = cadence === "daily" ? "a day" : cadence === "weekly" ? "each payday" : cadence === "biweekly" ? "every two weeks" : cadence === "monthly" ? "every month" : "each pay cycle";
  const advice = [
    `Saving ${formatMoney(perPaydayCents)} ${suffix} uses ${Number.isFinite(share) ? Math.round(share * 100) : 100}% of your usual pay-cycle surplus.`,
  ];
  if (status === "tight") advice.push("A later target date would make this plan more comfortable.");
  if (status === "not_realistic") advice.push("Try a smaller target or give yourself more time.");
  return {
    title: draft.title,
    category: draft.category,
    targetCents: draft.targetCents,
    savedCents: draft.savedCents,
    targetDate: draft.targetDate,
    status,
    progressPct,
    paused: false,
    plan: {
      cadence,
      perPaydayCents,
      paydaysLeft,
      nextContributionDate: dateString(nextContribution),
    },
    eta: { date: dateString(eta), daysVsTarget },
    advice,
  };
}

function formatMoney(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function localWish(draft: WishDraft, personaId: string, payCycle: { cadence: z.infer<typeof PayCadence>; nextPayday: string; avgSurplusPerCycleCents: number }, priority: number, autoSave: boolean): Wish {
  const preview = createPreview(draft, payCycle.cadence, payCycle.nextPayday, payCycle.avgSurplusPerCycleCents);
  return WishSchema.parse({
    ...preview,
    id: `local_${personaId}_${crypto.randomUUID()}`,
    personaId,
    priority,
    autoSave,
    paused: false,
    createdAt: new Date().toISOString(),
  });
}

function getLocalWishList(personaId: string, payCycle: { cadence: z.infer<typeof PayCadence>; nextPayday: string; avgSurplusPerCycleCents: number }): WishList {
  const stored = localStorage.getItem(storageKey(personaId));
  if (stored) {
    const parsed = WishListSchema.shape.wishes.parse(JSON.parse(stored));
    const refreshed = parsed.map((wish) => {
      const plan = createPreview(
        {
          title: wish.title,
          category: wish.category,
          targetCents: wish.targetCents,
          savedCents: wish.savedCents,
          targetDate: wish.targetDate,
        },
        payCycle.cadence,
        payCycle.nextPayday,
        payCycle.avgSurplusPerCycleCents,
      );
      return WishSchema.parse({ ...wish, ...plan });
    });
    localStorage.setItem(storageKey(personaId), JSON.stringify(refreshed));
    return buildWishList(refreshed, payCycle.avgSurplusPerCycleCents);
  }
  const seeded = seedWishes
    .filter((wish) => wish.personaId === personaId)
    .map((wish) => localWish(wish, personaId, payCycle, wish.priority, wish.autoSave));
  localStorage.setItem(storageKey(personaId), JSON.stringify(seeded));
  return buildWishList(seeded, payCycle.avgSurplusPerCycleCents);
}

function buildWishList(wishes: Wish[], surplusPerPaydayCents: number): WishList {
  const ordered = [...wishes].sort((a, b) => a.priority - b.priority);
  const totalPerPaydayCents = ordered
    .filter((wish) => wish.status !== "paused" && wish.status !== "achieved")
    .reduce((total, wish) => total + wish.plan.perPaydayCents, 0);
  return {
    wishes: ordered,
    totalPerPaydayCents,
    surplusPerPaydayCents,
    overCommitted: totalPerPaydayCents > surplusPerPaydayCents,
  };
}

function saveLocalWish(wish: Wish) {
  const wishes = WishListSchema.shape.wishes.parse(JSON.parse(localStorage.getItem(storageKey(wish.personaId)) ?? "[]"));
  const existing = wishes.filter((item) => item.id !== wish.id);
  localStorage.setItem(storageKey(wish.personaId), JSON.stringify([...existing, wish]));
}

export async function updateWish(
  existingWish: Wish,
  draft: WishDraft,
  payCycle: { cadence: z.infer<typeof PayCadence>; nextPayday: string; avgSurplusPerCycleCents: number },
  autoSave: boolean,
): Promise<{ data: Wish; localOnly: boolean }> {
  try {
    return {
      data: await apiRequest(`/api/wishes/${encodeURIComponent(existingWish.id)}`, parseWish, {
        method: "PATCH",
        body: {
          title: draft.title,
          targetCents: draft.targetCents,
          targetDate: draft.targetDate,
          priority: existingWish.priority,
          autoSave,
        },
      }),
      localOnly: false,
    };
  } catch (error) {
    if (!isRouteNotFound(error)) throw error;
    const wish = WishSchema.parse({
      ...existingWish,
      ...createPreview(draft, payCycle.cadence, payCycle.nextPayday, payCycle.avgSurplusPerCycleCents),
      autoSave,
    });
    saveLocalWish(wish);
    return { data: wish, localOnly: true };
  }
}

function isRouteNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

export async function getWishes(
  personaId: string,
  payCycle: { cadence: z.infer<typeof PayCadence>; nextPayday: string; avgSurplusPerCycleCents: number },
  signal?: AbortSignal,
): Promise<{ data: WishList; localOnly: boolean }> {
  try {
    return {
      data: await apiRequest(`/api/personas/${encodeURIComponent(personaId)}/wishes`, parseWishList, { signal }),
      localOnly: false,
    };
  } catch (error) {
    if (!isRouteNotFound(error)) throw error;
    return { data: getLocalWishList(personaId, payCycle), localOnly: true };
  }
}

export async function previewWish(
  personaId: string,
  draft: WishDraft,
  payCycle: { cadence: z.infer<typeof PayCadence>; nextPayday: string; avgSurplusPerCycleCents: number },
  signal?: AbortSignal,
): Promise<{ data: WishPreview; localOnly: boolean }> {
  try {
    return {
      data: await apiRequest(
        `/api/personas/${encodeURIComponent(personaId)}/wishes/preview`,
        parsePreview,
        { method: "POST", body: draft, signal },
      ),
      localOnly: false,
    };
  } catch (error) {
    if (!isRouteNotFound(error)) throw error;
    return { data: createPreview(draft, payCycle.cadence, payCycle.nextPayday, payCycle.avgSurplusPerCycleCents), localOnly: true };
  }
}

export async function createWish(
  personaId: string,
  draft: WishDraft,
  payCycle: { cadence: z.infer<typeof PayCadence>; nextPayday: string; avgSurplusPerCycleCents: number },
  priority: number,
  autoSave: boolean,
): Promise<{ data: Wish; localOnly: boolean }> {
  try {
    return {
      data: await apiRequest(
        `/api/personas/${encodeURIComponent(personaId)}/wishes`,
        parseWish,
        { method: "POST", body: { ...draft, priority, autoSave } },
      ),
      localOnly: false,
    };
  } catch (error) {
    if (!isRouteNotFound(error)) throw error;
    const wish = localWish(draft, personaId, payCycle, priority, autoSave);
    saveLocalWish(wish);
    return { data: wish, localOnly: true };
  }
}

export function describeCadence(cadence: z.infer<typeof PayCadence>, payday: string, amount: number) {
  const formatted = formatMoney(amount);
  if (cadence === "daily") return `${formatted} a day`;
  if (cadence === "weekly") return `${formatted} every ${payday.replace(/s$/i, "")}`;
  if (cadence === "biweekly") return `${formatted} every two weeks`;
  if (cadence === "monthly") return `${formatted} every month`;
  return `${formatted} each pay cycle`;
}

export function categoryLabel(category: z.infer<typeof WishCategory>) {
  return category === "other" ? "Other" : category.charAt(0).toUpperCase() + category.slice(1);
}

export function statusLabel(status: z.infer<typeof WishStatus>) {
  return status.replaceAll("_", " ");
}
