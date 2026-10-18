import type { AccountType, PolicyDecision, ProposedAction } from "@mandate/shared";
import { appendAudit } from "../audit";
import { config } from "../config";
import { HttpError } from "../http/errors";
import { usd } from "../lib/money";
import { allTransactions, getMandate, getWish, isAgentEnabled, listAccounts, listActions } from "../store";
import { type EarlierPayment, type PolicyContext, evaluate, requestKey } from "./engine";

/**
 * Gathers the facts the engine needs for one persona.
 * `exceptActionId` = leave this action out (when re-checking it at approval, so it isn't its own repeat).
 */
export function policyContext(personaId: string, exceptActionId?: string): PolicyContext {
  // Current balance of each account, e.g. { checking: 50892, savings: 60000, credit: 0 }
  const balances = { checking: 0, savings: 0, credit: 0 } as Record<AccountType, number>;
  for (const account of listAccounts(personaId)) balances[account.type] = account.balanceCents;

  // Everyone paid before (by name, lowercased) and when they were first paid.
  // Transactions are newest first, so the last date seen per name is the earliest.
  const knownPayees = new Map<string, string>();
  for (const t of allTransactions(personaId)) {
    // Skip: money coming in, or moving between your own accounts
    if (t.amountCents >= 0 || t.category === "transfer") continue;
    knownPayees.set(t.merchant.trim().toLowerCase(), t.date);
  }

  return {
    policy: getMandate(personaId).policy,
    agentEnabled: isAgentEnabled(personaId),
    balances,
    knownPayees,
    today: config.today,
    agentMovedTodayCents: agentMovedToday(personaId),
    earlierPayments: earlierPayments(personaId, exceptActionId),
    earlierRequests: earlierRequests(personaId, exceptActionId),
    agentSavedForWishesCents: agentSavedForWishes(personaId),
  };
}

/**
 * MoneyWise payments that happened or are waiting for approval, from anyone (user, agent,
 * document), e.g. [{ payee: "mobi telecom", amountCents: 3500, status: "executed", ... }].
 * Like the daily cap, every action in memory happened on the demo's today.
 */
function earlierPayments(personaId: string, exceptActionId?: string): EarlierPayment[] {
  const list: EarlierPayment[] = [];
  for (const a of listActions(personaId)) {
    // Skip: not a payment, it never happened (blocked / rejected), or it's the one being checked
    if (a.type !== "payment" || (a.status !== "executed" && a.status !== "pending_approval") || a.id === exceptActionId) continue;
    list.push({
      actionId: a.id,
      payee: String(a.params.payee).trim().toLowerCase(),
      amountCents: Number(a.params.amountCents),
      billId: typeof a.params.billId === "string" ? a.params.billId : null,
      status: a.status,
    });
  }
  return list;
}

/** Cancels and disputes done or waiting, e.g. "cancel:sub_maya_fitzone" → "pending_approval". */
function earlierRequests(personaId: string, exceptActionId?: string): Map<string, "executed" | "pending_approval"> {
  const map = new Map<string, "executed" | "pending_approval">();
  for (const a of listActions(personaId)) {
    // Skip: it never happened (blocked / rejected), or it's the one being checked
    if ((a.status !== "executed" && a.status !== "pending_approval") || a.id === exceptActionId) continue;
    const key = requestKey({ type: a.type, ...a.params } as ProposedAction);
    if (key) map.set(key, a.status);
  }
  return map;
}

/**
 * What the agent already saved for wishes "this payday", e.g. $40.39 + $6.67 = $47.06.
 * Like the daily cap: every action in memory happened on the demo's today, which is a payday
 * (a reset clears them). The user's own top-ups don't count.
 */
function agentSavedForWishes(personaId: string): number {
  let total = 0;
  for (const a of listActions(personaId)) {
    if (a.type !== "wish_contribution" || a.source === "user" || a.status !== "executed") continue;
    total += Number(a.params.amountCents);
  }
  return total;
}

/**
 * Money the agent already moved "today", for the daily cap.
 * Every action in memory happened on the demo's today (a reset clears them), so this is
 * the total of the agent's executed money actions, e.g. $35 + $40.39 = $75.39.
 */
export function agentMovedToday(personaId: string): number {
  let total = 0;
  for (const a of listActions(personaId)) {
    // Skip: the user's own actions, and anything that didn't actually happen
    if (a.source === "user" || a.status !== "executed") continue;
    const amount = a.params.amountCents;
    if (typeof amount === "number") total += amount;
  }
  return total;
}

/** A short description of an action for the audit log, e.g. "payment of $180 to CityPower". */
function describe(action: ProposedAction): string {
  switch (action.type) {
    case "payment":
      return `payment of ${usd(action.amountCents)} to ${action.payee}`;
    case "transfer":
      return `transfer of ${usd(action.amountCents)} from ${action.fromAccount} to ${action.toAccount}`;
    case "wish_contribution":
      return `saving ${usd(action.amountCents)} for wish ${action.wishId}`;
    case "cancel_subscription":
      return `cancelling ${action.merchant}`;
    case "dispute":
      return `disputing transaction ${action.transactionId}`;
  }
}

/**
 * Asks the policy engine about an action WITHOUT doing it (a dry run),
 * and records the answer in the audit log.
 */
export function checkAction(personaId: string, action: ProposedAction): PolicyDecision {
  // Reject: saving for a wish that doesn't exist, or belongs to someone else
  if (action.type === "wish_contribution") {
    const wish = getWish(action.wishId); // 404 if unknown
    if (wish.personaId !== personaId) throw new HttpError(403, "That wish belongs to someone else");
  }

  const result = evaluate(action, policyContext(personaId));

  // Record it: blocked attempts are exactly what the security report needs as evidence
  const verdict = { allow: "Allowed", require_approval: "Needs approval for", deny: "Blocked" }[result.decision];
  appendAudit({
    personaId,
    eventType: "policy_check",
    actor: action.source === "user" ? { type: "user", personaId } : { type: "agent", personaId },
    summary: `${verdict} ${describe(action)} (source: ${action.source}).`,
    payload: { action, ...result },
  });
  return result;
}
