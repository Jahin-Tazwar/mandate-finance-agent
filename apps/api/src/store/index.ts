import type { Account, AccountType, Category, Mandate, Persona, Transaction, TransactionPage } from "@mandate/shared";
import { appendAudit, resetAudit } from "../audit";
import { config } from "../config";
import { notFound } from "../http/errors";
import { loadSeed, type StoreState, type StoredWish } from "./seed";

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

  // A fresh demo gets a fresh audit log; its first entry records the load
  resetAudit();
  appendAudit({
    personaId: null,
    eventType: "seed_loaded",
    actor: { type: "system" },
    summary: `Demo data loaded: ${state.personas.size} personas.`,
    payload: { personas: [...state.personas.keys()] },
  });
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

// ---- Wishes (these change while the app runs; a reset brings back the seed wishes) ----

/** A persona's wishes, most important first (priority 1 before 2). */
export function listWishes(personaId: string): readonly StoredWish[] {
  getPersona(personaId); // 404 if the persona doesn't exist
  const wishes = [...current().wishes.get(personaId)!];

  // Same priority: keep the order they were added in (sort doesn't reorder equal items)
  return wishes.sort((a, b) => a.priority - b.priority);
}

/** One wish by id, from any persona. */
export function getWish(wishId: string): StoredWish {
  for (const wishes of current().wishes.values()) {
    const wish = wishes.find((w) => w.id === wishId);
    if (wish) return wish;
  }
  // Reject: no persona has this wish → 404
  throw notFound(`Wish "${wishId}"`);
}

/** The fields a caller provides when adding a wish (the store fills in the rest). */
export type NewWish = Omit<StoredWish, "id" | "personaId" | "paused" | "createdAt">;

/** Adds a wish and returns it with its new id, e.g. Maya's 3rd wish → "wish_maya_3". */
export function addWish(personaId: string, fields: NewWish): StoredWish {
  getPersona(personaId); // 404 if the persona doesn't exist
  const wishes = current().wishes.get(personaId)!;

  // Next number = highest one used so far + 1 (so ids never clash)
  // e.g. ["wish_maya_1", "wish_maya_2"] → 3
  const used = wishes.map((w) => Number(w.id.split("_").at(-1)) || 0);
  const next = Math.max(0, ...used) + 1;

  const wish: StoredWish = {
    ...fields,
    id: `wish_${personaId}_${next}`,
    personaId,
    paused: false,
    createdAt: new Date().toISOString(),
  };
  wishes.push(wish);
  return wish;
}

/** Changes some fields of a wish and returns it. */
export function updateWish(wishId: string, changes: Partial<NewWish & { paused: boolean }>): StoredWish {
  const wish = getWish(wishId); // 404 if it doesn't exist
  Object.assign(wish, changes);
  return wish;
}

/** Removes a wish. (Money already saved for it simply stays in savings.) */
export function deleteWish(wishId: string): void {
  const wish = getWish(wishId); // 404 if it doesn't exist
  const wishes = current().wishes.get(wish.personaId)!;
  wishes.splice(wishes.indexOf(wish), 1);
}

// ---- Rules (mandate) and the kill switch ----

/** The persona's signed rules. */
export function getMandate(personaId: string): Mandate {
  getPersona(personaId); // 404 if the persona doesn't exist
  return current().mandates.get(personaId)!;
}

/** false = the kill switch is on: the agent may only watch. */
export function isAgentEnabled(personaId: string): boolean {
  getPersona(personaId);
  return current().agentEnabled.get(personaId)!;
}
