import type { Account, AccountType, Action, Category, Mandate, Persona, Transaction, TransactionPage } from "@mandate/shared";
import { appendAudit, resetAudit } from "../audit";
import { config } from "../config";
import { notFound } from "../http/errors";
import { type ChatTurn, type StoreState, type StoredContribution, type StoredWish, accountId, loadSeed } from "./seed";

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

/** Turns the agent on (true) or off (false, the kill switch). */
export function setAgentEnabled(personaId: string, enabled: boolean): void {
  getPersona(personaId);
  current().agentEnabled.set(personaId, enabled);
}

// ---- Ids for things created while the app runs ----

/** The next id with this prefix, e.g. nextId("act") → "act_1", then "act_2"... (a reset starts again at 1) */
export function nextId(prefix: string): string {
  const n = (current().counters.get(prefix) ?? 0) + 1;
  current().counters.set(prefix, n);
  return `${prefix}_${n}`;
}

// ---- Moving money (only the executor calls these) ----

/** What a new transaction needs; the date is always the app's "today". */
export interface NewTransaction {
  account: AccountType;
  /** Negative = money out, e.g. −13280 for a $132.80 bill. */
  amountCents: number;
  merchant: string;
  description: string;
  category: Category;
  memo?: string;
}

/**
 * Records a transaction and changes the account balance to match.
 * Analytics are computed fresh from the transactions, so every screen sees it at once.
 */
export function postTransaction(personaId: string, tx: NewTransaction): Transaction {
  getPersona(personaId);
  const account = current().accounts.get(accountId(personaId, tx.account))!;
  account.balanceCents += tx.amountCents;

  const transaction: Transaction = {
    id: nextId(`tx_${personaId}_new`),
    accountId: account.id,
    date: config.today,
    description: tx.description,
    merchant: tx.merchant,
    amountCents: tx.amountCents,
    category: tx.category,
    memo: tx.memo ?? "",
  };
  current().transactions.get(personaId)!.unshift(transaction); // newest first
  return transaction;
}

/** Adds money to a wish and records it in the wish's saving history. */
export function addContribution(wishId: string, c: Omit<StoredContribution, "id" | "wishId" | "date">): StoredContribution {
  const wish = getWish(wishId); // 404 if it doesn't exist
  wish.savedCents += c.amountCents;

  const contribution: StoredContribution = { ...c, id: nextId("wc"), wishId, date: config.today };
  const list = current().contributions.get(wishId) ?? [];
  list.push(contribution);
  current().contributions.set(wishId, list);
  return contribution;
}

/** A wish's saving history, oldest first. */
export function listContributions(wishId: string): readonly StoredContribution[] {
  return current().contributions.get(wishId) ?? [];
}

/** Remembers that a subscription was cancelled through the app. */
export function markCancelled(personaId: string, merchant: string): void {
  current().cancelled.get(personaId)!.add(merchant);
}

/** Subscriptions cancelled through the app (merchant names). */
export function cancelledSubscriptions(personaId: string): ReadonlySet<string> {
  getPersona(personaId);
  return current().cancelled.get(personaId)!;
}

// ---- Actions ----

/** Stores a new action. */
export function addAction(action: Action): Action {
  current().actions.get(action.personaId)!.push(action);
  return action;
}

/** One action by id, from any persona (the caller checks it's theirs). */
export function getAction(actionId: string): Action {
  for (const list of current().actions.values()) {
    const action = list.find((a) => a.id === actionId);
    if (action) return action;
  }
  // Reject: no such action → 404
  throw notFound(`Action "${actionId}"`);
}

/** A persona's actions, newest first. */
export function listActions(personaId: string): Action[] {
  getPersona(personaId);
  return [...current().actions.get(personaId)!].reverse();
}

/** Changes some fields of an action (status, decidedAt...) and returns it. */
export function updateAction(actionId: string, changes: Partial<Action>): Action {
  const action = getAction(actionId);
  Object.assign(action, changes);
  return action;
}

// ---- Chat history (kept short: the model only needs recent context) ----

/** The persona's chat so far. The agent module adds to it. */
export function chatHistory(personaId: string): ChatTurn[] {
  getPersona(personaId);
  return current().chats.get(personaId)!;
}
