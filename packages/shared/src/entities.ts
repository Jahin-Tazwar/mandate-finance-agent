import { z } from "zod";

/**
 * Money is always stored as whole cents (integers): $12.34 -> 1234.
 * Computers can't store most decimals exactly (0.1 + 0.2 = 0.30000000000000004),
 * and a ledger must never drift by a fraction of a cent.
 */
export const Cents = z.number().int();

/** Calendar date as text, e.g. "2026-10-12". Text avoids time-zone surprises. */
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const AccountType = z.enum(["checking", "savings", "credit"]);

/** Fixed category list, so spending charts and budgets can't be split by typos. */
export const Category = z.enum([
  "income",
  "housing",
  "utilities",
  "groceries",
  "dining",
  "transport",
  "subscriptions",
  "shopping",
  "education",
  "health",
  "entertainment",
  "transfer",
  "fees",
  "other",
]);

export const Persona = z.object({
  id: z.string(),
  name: z.string(),
  profile: z.string(),
  currency: z.string().length(3),
});

export const Account = z.object({
  id: z.string(),
  personaId: z.string(),
  type: AccountType,
  name: z.string(),
  balanceCents: Cents,
});

export const Transaction = z.object({
  id: z.string(),
  accountId: z.string(),
  date: IsoDate,
  description: z.string(),
  merchant: z.string(),
  /** Negative = money leaving the account, positive = money arriving. */
  amountCents: Cents,
  category: Category,
  memo: z.string().nullable(),
});

/** Response of GET /api/personas/:id/transactions (newest first). */
export const TransactionPage = z.object({
  total: z.number().int(),
  items: z.array(Transaction),
});

export type AccountType = z.infer<typeof AccountType>;
export type Category = z.infer<typeof Category>;
export type Persona = z.infer<typeof Persona>;
export type Account = z.infer<typeof Account>;
export type Transaction = z.infer<typeof Transaction>;
export type TransactionPage = z.infer<typeof TransactionPage>;
