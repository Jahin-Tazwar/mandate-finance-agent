import { z } from "zod";
import {
  AccountType,
  Category,
  WishCategory,
  type Account,
  type Persona,
  type Transaction,
  type WishCategory as WishCategoryT,
} from "@mandate/shared";
import { SeedErrors, dateColumn, moneyColumn, optionalText, readCsv, yesNoColumn } from "./csv";

// ---- Row formats of the seed files (what the team writes in Excel) ----
// Each schema checks one spreadsheet row and converts it (e.g. "42.18" → 4218 cents).

const PersonaRow = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/, "id must be lowercase letters/numbers, e.g. maya"),
  name: z.string().min(1),
  profile: z.string(),
  currency: z.string().length(3),
  checking_start: moneyColumn,
  savings_start: moneyColumn,
  credit_limit: moneyColumn,
});

const TransactionRow = z.object({
  date: dateColumn,
  account: AccountType,
  description: z.string().min(1),
  merchant: z.string().min(1),
  amount: moneyColumn,
  category: Category,
  memo: optionalText,
});

const WishRow = z.object({
  persona: z.string(),
  title: z.string().min(1),
  category: WishCategory,
  target_amount: moneyColumn.refine((c) => c > 0, "must be more than 0"),
  target_date: dateColumn,
  saved_so_far: moneyColumn.refine((c) => c >= 0, "can't be negative"),
  priority: z.coerce.number().int().min(1),
  auto_save: yesNoColumn,
});

/** Simulated usage (a real app would get this from the provider). Blank last_used = never used. */
const UsageRow = z.object({
  persona: z.string(),
  merchant: z.string().min(1),
  // Either empty, or a valid date like 2026-10-11
  last_used: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.union([z.literal(""), dateColumn])),
});

// ---- What the loader produces ----

export interface SeedWish {
  id: string;
  personaId: string;
  title: string;
  category: WishCategoryT;
  targetCents: number;
  targetDate: string;
  savedCents: number;
  priority: number;
  autoSave: boolean;
}

export interface StoreState {
  loadedAt: string;
  personas: Map<string, Persona>;
  /** All accounts, keyed by account id. */
  accounts: Map<string, Account>;
  /** Each persona's transactions, newest first. */
  transactions: Map<string, Transaction[]>;
  wishes: Map<string, SeedWish[]>;
  /** persona → merchant → last used date (null = never). Missing merchant = no usage data. */
  usage: Map<string, Map<string, string | null>>;
}

// Every persona gets these 3 accounts
const ACCOUNT_SUFFIX = { checking: "chk", savings: "sav", credit: "crd" } as const;
const ACCOUNT_NAME = { checking: "Everyday checking", savings: "Savings", credit: "Credit card" } as const;

/** e.g. ("maya", "checking") → "acc_maya_chk". Same id after every reset. */
export const accountId = (personaId: string, type: AccountType) => `acc_${personaId}_${ACCOUNT_SUFFIX[type]}`;

/**
 * Reads every seed CSV, checks it, and builds the in-memory bank.
 * Balance = starting balance + every transaction on that account.
 * If anything is wrong, throws ONE error listing every problem (file + row number).
 */
export function loadSeed(seedDir: string): StoreState {
  // Problems are collected here, not thrown one by one, so the team can fix them all at once
  const errors = new SeedErrors();
  const state: StoreState = {
    loadedAt: new Date().toISOString(),
    personas: new Map(),
    accounts: new Map(),
    transactions: new Map(),
    wishes: new Map(),
    usage: new Map(),
  };

  // ---- Personas, their accounts and their transactions ----
  for (const row of readCsv(seedDir, "personas.csv", PersonaRow, errors)) {
    // Reject: the same persona id twice
    if (state.personas.has(row.id)) {
      errors.add("personas.csv", 0, `persona "${row.id}" appears twice`);
      continue;
    }
    state.personas.set(row.id, { id: row.id, name: row.name, profile: row.profile, currency: row.currency });

    // Create the 3 accounts with their starting balances
    const starts: Record<AccountType, number> = {
      checking: row.checking_start,
      savings: row.savings_start,
      credit: 0, // a card starts with nothing owed; purchases make it negative
    };
    for (const type of AccountType.options) {
      const id = accountId(row.id, type);
      state.accounts.set(id, { id, personaId: row.id, type, name: ACCOUNT_NAME[type], balanceCents: starts[type] });
    }

    // Read this persona's transactions, adding each amount to its account's balance
    const file = `transactions/${row.id}.csv`;
    const rows = readCsv(seedDir, file, TransactionRow, errors);
    const transactions: Transaction[] = rows.map((tx, i) => {
      const account = state.accounts.get(accountId(row.id, tx.account))!;
      account.balanceCents += tx.amount;

      // Id from the row number, e.g. row 42 → "tx_maya_0042" (stable across resets)
      return {
        id: `tx_${row.id}_${String(i + 1).padStart(4, "0")}`,
        accountId: account.id,
        date: tx.date,
        description: tx.description,
        merchant: tx.merchant,
        amountCents: tx.amount,
        category: tx.category,
        memo: tx.memo,
      };
    });
    // Newest first. Reverse first so that, within one day, later rows in the file come first
    // (sort keeps the existing order for equal dates).
    transactions.reverse();
    transactions.sort((a, b) => b.date.localeCompare(a.date));
    state.transactions.set(row.id, transactions);
    // Empty lists, filled from the next files
    state.wishes.set(row.id, []);
    state.usage.set(row.id, new Map());
  }

  // ---- Wishes ----
  readCsv(seedDir, "wishes.csv", WishRow, errors).forEach((w, i) => {
    const list = state.wishes.get(w.persona);

    // Reject: a wish for a persona that doesn't exist (row number = i + 2: header is row 1)
    if (!list) {
      errors.add("wishes.csv", i + 2, `unknown persona "${w.persona}"`);
      return;
    }
    // e.g. Maya's first wish → "wish_maya_1"
    list.push({
      id: `wish_${w.persona}_${list.length + 1}`,
      personaId: w.persona,
      title: w.title,
      category: w.category,
      targetCents: w.target_amount,
      targetDate: w.target_date,
      savedCents: w.saved_so_far,
      priority: w.priority,
      autoSave: w.auto_save,
    });
  });

  // ---- Subscription usage (optional file) ----
  readCsv(seedDir, "subscription_usage.csv", UsageRow, errors, { optional: true }).forEach((u, i) => {
    const usage = state.usage.get(u.persona);

    // Reject: usage for a persona that doesn't exist
    if (!usage) {
      errors.add("subscription_usage.csv", i + 2, `unknown persona "${u.persona}"`);
      return;
    }
    usage.set(u.merchant, u.last_used === "" ? null : u.last_used); // "" → null = never used
  });

  // Reject: stop here if any file had problems
  errors.throwIfAny();
  return state;
}
