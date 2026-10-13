import { z } from "zod";
import { Category, Cents, IsoDate } from "./entities";
import { PayCadence } from "./wishes";

/** GET /api/personas/:id/pay-cycle */
export const PayCycle = z.object({
  cadence: PayCadence,
  /** Human label: "Fridays", "the 25th", "almost every day". */
  payday: z.string(),
  nextPayday: IsoDate,
  avgIncomePerCycleCents: Cents,
  /**
   * What's typically left each pay cycle after ALL normal spending (essentials and everyday
   * spending; one-offs and savings transfers excluded). Wish plans are checked against it.
   */
  avgSurplusPerCycleCents: Cents,
});

/** GET /api/personas/:id/budget */
export const Budget = z.object({
  month: z.string(),
  safeToSpendTodayCents: Cents,
  categories: z.array(z.object({ category: Category, budgetCents: Cents, spentCents: Cents })),
  insights: z.array(z.string()),
});

export const ForecastDay = z.object({ date: IsoDate, balanceCents: Cents });

/** GET /api/personas/:id/forecast */
export const Forecast = z.object({
  days: z.array(ForecastDay),
  lowestPoint: ForecastDay,
  warnings: z.array(z.string()),
});

/** GET /api/personas/:id/subscriptions */
export const Subscription = z.object({
  id: z.string(),
  merchant: z.string(),
  amountCents: Cents,
  cadence: z.enum(["weekly", "monthly"]),
  accountId: z.string(),
  lastCharged: IsoDate,
  nextCharge: IsoDate,
  /** null = never used (or no usage data). */
  lastUsed: IsoDate.nullable(),
  /** Days since last use (or since it started, if never used). null = no usage data. */
  unusedDays: z.number().int().nullable(),
  status: z.enum(["active", "cancelled"]),
});

/** GET /api/personas/:id/bills */
export const Bill = z.object({
  id: z.string(),
  payee: z.string(),
  amountCents: Cents,
  dueDate: IsoDate,
  status: z.enum(["due", "paid", "overdue"]),
  source: z.enum(["bank", "document"]),
  accountId: z.string(),
});

export type PayCycle = z.infer<typeof PayCycle>;
export type Budget = z.infer<typeof Budget>;
export type ForecastDay = z.infer<typeof ForecastDay>;
export type Forecast = z.infer<typeof Forecast>;
export type Subscription = z.infer<typeof Subscription>;
export type Bill = z.infer<typeof Bill>;
