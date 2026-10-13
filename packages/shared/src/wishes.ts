import { z } from "zod";

/** How often someone is paid. Detected from income history; wish plans save once per payday. */
export const PayCadence = z.enum(["daily", "weekly", "biweekly", "monthly", "irregular"]);

export const WishCategory = z.enum(["gadget", "vehicle", "property", "travel", "education", "luxury", "other"]);

export const WishStatus = z.enum(["on_track", "tight", "not_realistic", "achieved", "paused"]);

export type PayCadence = z.infer<typeof PayCadence>;
export type WishCategory = z.infer<typeof WishCategory>;
export type WishStatus = z.infer<typeof WishStatus>;
