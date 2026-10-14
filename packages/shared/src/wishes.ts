import { z } from "zod";
import { Cents, IsoDate } from "./entities";

/** How often someone is paid. Detected from income history; wish plans save once per payday. */
export const PayCadence = z.enum(["daily", "weekly", "biweekly", "monthly", "irregular"]);

export const WishCategory = z.enum(["gadget", "vehicle", "property", "travel", "education", "luxury", "other"]);

/**
 * on_track = comfortable · tight = doable but uses most of what's left over ·
 * not_realistic = needs more than what's left over · achieved · paused
 */
export const WishStatus = z.enum(["on_track", "tight", "not_realistic", "achieved", "paused"]);

/** What the user fills in to create a wish (also the body of the preview call). */
export const WishInput = z.object({
  title: z.string().trim().min(1).max(60),
  category: WishCategory,
  targetCents: Cents.positive().max(1_000_000_000), // up to $10 million (land, a flat...)
  targetDate: IsoDate,
  savedCents: Cents.min(0).default(0),
  priority: z.number().int().min(1).optional(), // 1 = most important; default: after the others
  autoSave: z.boolean().default(true),
});

/** Fields that can be changed on an existing wish (all optional). Unknown fields are rejected. */
export const WishPatch = z
  .object({
    title: z.string().trim().min(1).max(60),
    targetCents: Cents.positive().max(1_000_000_000),
    targetDate: IsoDate,
    priority: z.number().int().min(1),
    autoSave: z.boolean(),
    paused: z.boolean(),
  })
  .partial()
  .strict();

/** How the wish gets funded: a fixed amount every payday until the target date. */
export const WishPlan = z.object({
  cadence: PayCadence,
  perPaydayCents: Cents,
  paydaysLeft: z.number().int(),
  /** null when nothing is planned (achieved, paused, or the date is too soon). */
  nextContributionDate: IsoDate.nullable(),
});

export const Wish = z.object({
  id: z.string(),
  personaId: z.string(),
  title: z.string(),
  category: WishCategory,
  targetCents: Cents,
  savedCents: Cents,
  targetDate: IsoDate,
  priority: z.number().int(),
  autoSave: z.boolean(),
  paused: z.boolean(),
  status: WishStatus,
  progressPct: z.number(),
  plan: WishPlan,
  /** When it's reached at the pace you can afford. null = can't be reached at the current pace. */
  eta: z.object({ date: IsoDate, daysVsTarget: z.number().int() }).nullable(),
  /** Ready-to-show sentences, e.g. "Saving $40.39 each Friday uses 86% of what you usually have left over." */
  advice: z.array(z.string()),
  createdAt: z.string(),
});

/** A wish being previewed in the form: no id or createdAt yet. */
export const WishPreview = Wish.omit({ id: true, createdAt: true });

/** GET /api/personas/:id/wishes */
export const WishList = z.object({
  wishes: z.array(Wish),
  totalPerPaydayCents: Cents,
  surplusPerPaydayCents: Cents,
  overCommitted: z.boolean(),
});

/** GET /api/wishes/:id */
export const WishDetail = z.object({
  wish: Wish,
  contributions: z.array(
    z.object({
      id: z.string(),
      date: IsoDate,
      amountCents: Cents,
      source: z.enum(["agent", "user"]),
      actionId: z.string().nullable(),
    }),
  ),
  /** Expected savings over time, one point per payday (thinned out for long plans). */
  projection: z.array(z.object({ date: IsoDate, savedCents: Cents })),
});

/** GET /api/personas/:id/wishes/impact?amountCents=6000 */
export const WishImpact = z.object({
  amountCents: Cents,
  impacts: z.array(z.object({ wishId: z.string(), title: z.string(), delayDays: z.number().int() })),
  message: z.string(),
});

export type PayCadence = z.infer<typeof PayCadence>;
export type WishCategory = z.infer<typeof WishCategory>;
export type WishStatus = z.infer<typeof WishStatus>;
export type WishInput = z.infer<typeof WishInput>;
export type WishPatch = z.infer<typeof WishPatch>;
export type WishPlan = z.infer<typeof WishPlan>;
export type Wish = z.infer<typeof Wish>;
export type WishPreview = z.infer<typeof WishPreview>;
export type WishList = z.infer<typeof WishList>;
export type WishDetail = z.infer<typeof WishDetail>;
export type WishImpact = z.infer<typeof WishImpact>;
