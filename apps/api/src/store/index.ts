import type { Account, AccountType, Category, Persona, Transaction, TransactionPage } from "@mandate/shared";
import { config } from "../config";
import { notFound } from "../http/errors";
import { loadSeed, type StoreState } from "./seed";

/**
 * The in-memory store: the ONLY module that reads or changes data.
 * Routes and services call these functions; nobody touches `state` directly.
 * That keeps the door open to a real database later (only this folder would change).
 */
let state: StoreState | null = null;

/** The loaded data. */
function current(): StoreState {
  // Reject: someone forgot to load the data at startup
  if (!state) throw new Error("Store not initialised: call initStore() first");
  return state;
}

/** Loads (or reloads) everything from the seed CSVs. Throws if any row is invalid. */
export function initStore(seedDir = config.seedDir): StoreState {
  state = loadSeed(seedDir);
  return state;
}

/** Back to the original demo data. */
export const resetStore = () => initStore();

export const loadedAt = () => current().loadedAt;

// ---- Personas & accounts ----

export function listPersonas(): Persona[] {
  return [...current().personas.values()];
}

export function getPersona(personaId: string): Persona {
  const persona = current().personas.get(personaId);

  // Reject: unknown persona → 404 (the error handler in app.ts turns this into the response)
  if (!persona) throw notFound(`Persona "${personaId}"`);
  return persona;
}

export function listAccounts(personaId: string): Account[] {
  getPersona(personaId); // 404 if the persona doesn't exist
  return [...current().accounts.values()].filter((a) => a.personaId === personaId);
}

export function getAccount(personaId: string, type: AccountType): Account {
  const account = listAccounts(personaId).find((a) => a.type === type);

  // Reject: should never happen (every persona gets all 3 accounts)
  if (!account) throw notFound(`${type} account for "${personaId}"`);
  return account;
}

/** All of a persona's transactions, newest first. Read-only: callers must not modify them. */
export function allTransactions(personaId: string): readonly Transaction[] {
  getPersona(personaId);
  return current().transactions.get(personaId)!;
}

/** Simulated subscription usage: merchant → last used date (null = never). */
export function subscriptionUsage(personaId: string): ReadonlyMap<string, string | null> {
  getPersona(personaId);
  return current().usage.get(personaId)!;
}

// ---- Transactions ----

/** Filters for the transactions list. Every filter is optional; limit/offset are for paging. */
export interface TransactionQuery {
  from?: string;
  to?: string;
  category?: Category;
  account?: AccountType;
  limit: number;
  offset: number;
}

/** One page of a persona's transactions (newest first), plus how many match in total. */
export function queryTransactions(personaId: string, q: TransactionQuery): TransactionPage {
  getPersona(personaId); // 404 if the persona doesn't exist

  // Filter by account type → find that account's id, e.g. "credit" → "acc_daniel_crd"
  let accountId: string | undefined;
  if (q.account) {
    accountId = listAccounts(personaId).find((a) => a.type === q.account)?.id;
  }

  // Keep a transaction only if it passes every filter that was given (missing filter = pass)
  const matches = current()
    .transactions.get(personaId)!
    .filter(
      (t) =>
        (!q.from || t.date >= q.from) &&
        (!q.to || t.date <= q.to) &&
        (!q.category || t.category === q.category) &&
        (!accountId || t.accountId === accountId),
    );

  // One page, e.g. offset 50, limit 50 → matches 51–100
  return { total: matches.length, items: matches.slice(q.offset, q.offset + q.limit) };
}
