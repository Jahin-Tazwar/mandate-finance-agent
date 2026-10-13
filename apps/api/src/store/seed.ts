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

/** Simulated usage signal (a real app would get this from the provider). Blank = never used. */
const UsageRow = z.object({
  persona: z.string(),
  merchant: z.string().min(1),
  last_used: z.string().transform((v) => v.trim()).pipe(z.union([z.literal(""), dateColumn])),
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

const ACCOUNT_SUFFIX = { checking: "chk", savings: "sav", credit: "crd" } as const;
const ACCOUNT_NAME = { checking: "Everyday checking", savings: "Savings", credit: "Credit card" } as const;

export const accountId = (personaId: string, type: AccountType) => `acc_${personaId}_${ACCOUNT_SUFFIX[type]}`;

/**
 * Reads every seed CSV, validates it, and builds the in-memory bank:
 * accounts get their starting balance plus every transaction on them.
 * Throws one error listing every problem found, with file and row numbers.
 */
export function loadSeed(seedDir: string): StoreState {
  const errors = new SeedErrors();
  const state: StoreState = {
    loadedAt: new Date().toISOString(),
    personas: new Map(),
    accounts: new Map(),
    transactions: new Map(),
    wishes: new Map(),
    usage: new Map(),
  };

  for (const row of readCsv(seedDir, "personas.csv", PersonaRow, errors)) {
    if (state.personas.has(row.id)) {
      errors.add("personas.csv", 0, `persona "${row.id}" appears twice`);
      continue;
    }
    state.personas.set(row.id, { id: row.id, name: row.name, profile: row.profile, currency: row.currency });

    const starts: Record<AccountType, number> = {
      checking: row.checking_start,
      savings: row.savings_start,
      credit: 0, // a card starts with nothing owed; purchases make it negative
    };
    for (const type of AccountType.options) {
      const id = accountId(row.id, type);
      state.accounts.set(id, { id, personaId: row.id, type, name: ACCOUNT_NAME[type], balanceCents: starts[type] });
    }

    const file = `transactions/${row.id}.csv`;
    const rows = readCsv(seedDir, file, TransactionRow, errors);
    const transactions: Transaction[] = rows.map((tx, i) => {
      const account = state.accounts.get(accountId(row.id, tx.account))!;
      account.balanceCents += tx.amount;
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
    // Newest first; for the same day, later rows in the file come first.
    transactions.reverse().sort((a, b) => b.date.localeCompare(a.date));
    state.transactions.set(row.id, transactions);
    state.wishes.set(row.id, []);
    state.usage.set(row.id, new Map());
  }

  readCsv(seedDir, "wishes.csv", WishRow, errors).forEach((w, i) => {
    const list = state.wishes.get(w.persona);
    if (!list) {
      errors.add("wishes.csv", i + 2, `unknown persona "${w.persona}"`);
      return;
    }
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

  readCsv(seedDir, "subscription_usage.csv", UsageRow, errors, { optional: true }).forEach((u, i) => {
    const usage = state.usage.get(u.persona);
    if (!usage) {
      errors.add("subscription_usage.csv", i + 2, `unknown persona "${u.persona}"`);
      return;
    }
    usage.set(u.merchant, u.last_used === "" ? null : u.last_used);
  });

  errors.throwIfAny();
  return state;
}
