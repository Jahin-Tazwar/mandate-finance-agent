import type { Action, ActionDecisionBody, ProposedAction } from "@mandate/shared";
import { getBills, getSubscriptions } from "../analytics";
import { appendAudit } from "../audit";
import { verifyPin } from "../auth";
import { HttpError } from "../http/errors";
import { usd } from "../lib/money";
import { evaluate } from "../policy/engine";
import { policyContext } from "../policy";
import { addAction, allTransactions, getAction, getWish, listActions, nextId, updateAction } from "../store";
import { getWishImpact } from "../wishes";
import { execute } from "./executor";

/**
 * ACTIONS: everything that changes money goes through here, from the agent or the user.
 *
 *   propose → policy engine → allow            → execute now           → "executed"
 *                           → require_approval → wait for the user     → "pending_approval"
 *                           → deny             → nothing happens       → "denied"
 *
 *   approve (with PIN) → re-check the hard rules → execute → "executed"
 *   reject             → nothing happens                    → "rejected"
 *
 * Every step is written to the audit log.
 */

/**
 * Checks that whatever the action points at exists and belongs to this persona.
 * Throws 404 (doesn't exist) or 403 (someone else's).
 */
export function assertTargetsExist(personaId: string, action: ProposedAction): void {
  // Reject: saving for a wish that doesn't exist, or belongs to someone else
  if (action.type === "wish_contribution") {
    const wish = getWish(action.wishId); // 404 if unknown
    if (wish.personaId !== personaId) throw new HttpError(403, "That wish belongs to someone else");
  }

  // Reject: paying a bill that doesn't exist, or a different amount than the bill says
  // (stops a model that "remembers" the wrong amount, e.g. $1,328.00 for a $132.80 bill)
  if (action.type === "payment" && action.billId) {
    const bill = getBills(personaId).find((b) => b.id === action.billId);
    if (!bill) throw new HttpError(404, `Bill "${action.billId}" not found`);
    if (bill.amountCents !== action.amountCents) {
      throw new HttpError(422, `That bill is ${usd(bill.amountCents)}, not ${usd(action.amountCents)}`);
    }
  }

  // Reject: cancelling a subscription this persona doesn't have
  if (action.type === "cancel_subscription" && !getSubscriptions(personaId).some((s) => s.id === action.subscriptionId)) {
    throw new HttpError(404, `Subscription "${action.subscriptionId}" not found`);
  }

  // Reject: disputing a transaction that isn't theirs
  if (action.type === "dispute" && !allTransactions(personaId).some((t) => t.id === action.transactionId)) {
    throw new HttpError(404, `Transaction "${action.transactionId}" not found`);
  }
}

/** One line for the UI, e.g. "Pay CityPower $132.80" or "Save $40.39 for iPhone 17". */
function summarize(personaId: string, action: ProposedAction): string {
  switch (action.type) {
    case "payment":
      return `Pay ${action.payee} ${usd(action.amountCents)}${action.fromAccount === "credit" ? " (credit card)" : ""}`;
    case "transfer":
      return `Move ${usd(action.amountCents)} from ${action.fromAccount} to ${action.toAccount}`;
    case "wish_contribution":
      return `Save ${usd(action.amountCents)} for ${getWish(action.wishId).title}`;
    case "cancel_subscription":
      return `Cancel ${action.merchant}`;
    case "dispute": {
      const tx = allTransactions(personaId).find((t) => t.id === action.transactionId);
      return tx ? `Dispute ${tx.merchant} charge of ${usd(-tx.amountCents)} on ${tx.date}` : `Dispute transaction ${action.transactionId}`;
    }
  }
}

/** The action's details without `source` and `type` (those have their own fields). */
function paramsOf(action: ProposedAction): Record<string, unknown> {
  const { source: _source, type: _type, ...params } = action;
  return params;
}

/** Rebuilds the proposed action from a stored one (to re-check it at approval time). */
function proposedFrom(action: Action): ProposedAction {
  return { source: action.source, type: action.type, ...action.params } as ProposedAction;
}

/** Who did it, for the audit log. */
const actorOf = (personaId: string, source: ProposedAction["source"]) =>
  source === "user" ? { type: "user" as const, personaId } : { type: "agent" as const, personaId };

/**
 * Proposes an action: the policy engine decides, and allowed actions run immediately.
 * `rationale` = the agent's own reason (null for the user's own actions).
 */
export function proposeAction(personaId: string, proposed: ProposedAction, rationale: string | null = null): Action {
  assertTargetsExist(personaId, proposed); // 404 / 403
  const verdict = evaluate(proposed, policyContext(personaId));
  const now = new Date().toISOString();

  const action: Action = {
    id: nextId("act"),
    personaId,
    type: proposed.type,
    summary: summarize(personaId, proposed),
    params: paramsOf(proposed),
    source: proposed.source,
    tier: verdict.tier,
    decision: verdict.decision,
    status: verdict.decision === "allow" ? "executed" : verdict.decision === "deny" ? "denied" : "pending_approval",
    reasons: verdict.reasons,
    agentRationale: rationale,
    createdAt: now,
    decidedAt: null,
    approvedBy: null,
    executedAt: null,
  };

  // Payments: which wish gets later because of this money leaving
  if (proposed.type === "payment") action.wishImpact = getWishImpact(personaId, proposed.amountCents).impacts;

  // Allowed: do it now
  if (action.status === "executed") {
    execute(personaId, proposed, action.id);
    action.executedAt = now;
  }
  addAction(action);

  // e.g. "Executed: Pay Mobi Telecom $35 (source: agent)."
  const word = { executed: "Executed", pending_approval: "Waiting for approval", denied: "Blocked", rejected: "Rejected" }[action.status];
  appendAudit({
    personaId,
    eventType: `action_${action.status}`,
    actor: actorOf(personaId, proposed.source),
    summary: `${word}: ${action.summary} (source: ${proposed.source}).`,
    payload: { actionId: action.id, action: proposed, decision: verdict.decision, tier: verdict.tier, reasons: verdict.reasons, rationale },
  });
  return action;
}

/**
 * The user approves (with PIN) or rejects a waiting action.
 * `personaId` = the signed-in persona; it must own the action.
 */
export function decideAction(personaId: string, actionId: string, body: ActionDecisionBody): Action {
  const action = getAction(actionId); // 404 if unknown

  // Reject: someone else's action
  if (action.personaId !== personaId) throw new HttpError(403, "That isn't your account");

  // Reject: already decided (approving twice must never pay twice)
  if (action.status !== "pending_approval") throw new HttpError(409, `This action is already ${action.status.replace("_", " ")}`);

  const now = new Date().toISOString();

  if (body.decision === "reject") {
    updateAction(actionId, { status: "rejected", decidedAt: now });
    appendAudit({
      personaId,
      eventType: "action_rejected",
      actor: { type: "user", personaId },
      summary: `Rejected: ${action.summary}.`,
      payload: { actionId },
    });
    return action;
  }

  // Approving moves money: confirm it's really the user (wrong PIN → 403, too many → 429)
  verifyPin(personaId, body.pin);

  // Re-check the hard rules NOW: the balance may have changed since it was proposed.
  // The user's approval stands in for the tier check, but never for the floor or the funds.
  const proposed = proposedFrom(action);
  const recheck = evaluate({ ...proposed, source: "user" } as ProposedAction, policyContext(personaId));
  if (recheck.decision === "deny") {
    updateAction(actionId, { status: "denied", decidedAt: now, reasons: [`Can't do this any more: ${recheck.reasons[0]}`, ...action.reasons] });
    appendAudit({
      personaId,
      eventType: "action_denied",
      actor: { type: "user", personaId },
      summary: `Approved but blocked at execution: ${action.summary}.`,
      payload: { actionId, reasons: recheck.reasons },
    });
    return action;
  }

  execute(personaId, proposed, actionId);
  updateAction(actionId, { status: "executed", decidedAt: now, approvedBy: personaId, executedAt: now });
  appendAudit({
    personaId,
    eventType: "action_approved",
    actor: { type: "user", personaId },
    summary: `Approved with PIN and executed: ${action.summary}.`,
    payload: { actionId },
  });
  return action;
}

/** Actions waiting for the user, newest first. */
export const listApprovals = (personaId: string) => listActions(personaId).filter((a) => a.status === "pending_approval");

export { listActions };
