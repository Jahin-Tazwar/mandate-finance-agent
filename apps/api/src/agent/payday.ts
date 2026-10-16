import type { Action, ProposedAction, Transaction } from "@mandate/shared";
import { proposeAction } from "../actions";
import { getBills, getDuplicateCharges, getPayCycle, getSubscriptions } from "../analytics";
import { appendAudit } from "../audit";
import { config } from "../config";
import { addDays, shortDate } from "../lib/dates";
import { usd } from "../lib/money";
import { allTransactions, listActions, markPaycheckLanded, paycheckLanded, postTransaction } from "../store";
import { autoSavePlan } from "../wishes";

/**
 * THE PAYDAY ROUTINE ("Run payday" in the demo). Plain code, no AI, so it does the
 * same thing every time. When pay lands, the agent:
 *   1. pays the bills due before the next payday
 *   2. saves for wishes that have auto-save on (the planned amount, e.g. $40.39 for the iPhone)
 *   3. offers to cancel subscriptions nobody has used for 30+ days
 *   4. offers to dispute charges that look like duplicates
 * Every step is only a PROPOSAL: the policy engine decides each one (automatic,
 * wait for approval, or blocked), exactly like the chat agent's proposals.
 */

/** Unused this many days → worth offering to cancel. */
const UNUSED_DAYS = 30;

/** Something already handled (done or waiting) shouldn't be proposed again. */
function alreadyHandled(personaId: string, matches: (a: Action) => boolean): boolean {
  return listActions(personaId).some((a) => (a.status === "executed" || a.status === "pending_approval") && matches(a));
}

/**
 * The demo paycheck: a copy of the persona's most recent pay, landing today.
 * e.g. Maya: "Bean & Leaf Cafe" +$412.50 into checking. Only once per reset.
 */
function landPaycheck(personaId: string): Transaction | null {
  // Skip: already paid this demo
  if (paycheckLanded(personaId)) return null;

  const lastPay = allTransactions(personaId).find((t) => t.category === "income" && t.amountCents > 0 && t.accountId.endsWith("_chk"));
  // Skip: this persona has no pay history to copy
  if (!lastPay) return null;

  markPaycheckLanded(personaId);
  return postTransaction(personaId, {
    account: "checking",
    amountCents: lastPay.amountCents,
    merchant: lastPay.merchant,
    description: lastPay.description,
    category: "income",
    memo: "Demo payday",
  });
}

/** Runs the payday routine → the paycheck (if it landed now) and every action proposed. */
export function runPayday(personaId: string): { paycheck: Transaction | null; actions: Action[] } {
  const payCycle = getPayCycle(personaId);

  // The savings plan is read BEFORE the pay lands, so it's the plan the user was shown
  // (e.g. "$40.39 every Friday"), not one recalculated mid-run
  const savings = autoSavePlan(personaId);

  const paycheck = landPaycheck(personaId);
  const actions: Action[] = [];
  const propose = (action: ProposedAction, why: string) => actions.push(proposeAction(personaId, action, why));

  // 1. Bills due before the next payday: this pay has to cover them. At least a week ahead,
  // so daily pay still sees the week's bills.
  // e.g. Daniel (paid on the 25th): CityPower Oct 15, phone Oct 18, internet Oct 20 → yes;
  // rent Nov 1 → no, that's for the next payday's run
  const weekAhead = addDays(config.today, 7);
  const horizon = payCycle.nextPayday > weekAhead ? payCycle.nextPayday : weekAhead;
  for (const bill of getBills(personaId)) {
    // Skip: not due yet, or already paid / waiting for approval
    if (bill.status === "paid" || bill.dueDate > horizon) continue;
    if (alreadyHandled(personaId, (a) => a.params.billId === bill.id)) continue;

    const fromAccount = bill.accountId.endsWith("_crd") ? "credit" : "checking";
    propose(
      { source: "agent", type: "payment", payee: bill.payee, amountCents: bill.amountCents, fromAccount, billId: bill.id },
      `Payday: the ${bill.payee} bill (${usd(bill.amountCents)}) is due ${shortDate(bill.dueDate)}.`,
    );
  }

  // 2. Auto-save for wishes (once per demo day each)
  for (const s of savings) {
    // Skip: already saved for this wish today
    if (alreadyHandled(personaId, (a) => a.type === "wish_contribution" && a.source !== "user" && a.params.wishId === s.wishId)) continue;
    propose(
      { source: "agent", type: "wish_contribution", wishId: s.wishId, amountCents: s.amountCents },
      `Payday: your plan saves ${usd(s.amountCents)} for ${s.title} each payday.`,
    );
  }

  // 3. Subscriptions nobody uses
  for (const sub of getSubscriptions(personaId)) {
    // Skip: cancelled, used recently, no usage data, or already offered
    if (sub.status !== "active" || sub.unusedDays === null || sub.unusedDays < UNUSED_DAYS) continue;
    if (alreadyHandled(personaId, (a) => a.params.subscriptionId === sub.id)) continue;
    propose(
      { source: "agent", type: "cancel_subscription", subscriptionId: sub.id, merchant: sub.merchant },
      `${sub.merchant} costs ${usd(sub.amountCents)} ${sub.cadence === "weekly" ? "a week" : "a month"} and hasn't been used for ${sub.unusedDays} days.`,
    );
  }

  // 4. Charges that look like duplicates: dispute the second one
  for (const dup of getDuplicateCharges(personaId)) {
    const second = dup.transactionIds[1]!;
    if (alreadyHandled(personaId, (a) => a.params.transactionId === second)) continue;
    propose(
      { source: "agent", type: "dispute", transactionId: second },
      `${dup.merchant} charged ${usd(dup.amountCents)} twice on ${shortDate(dup.date)}.`,
    );
  }

  // e.g. "Payday run: pay landed (+$412.50); 4 actions: 2 done, 1 waiting, 1 blocked."
  const count = (status: Action["status"]) => actions.filter((a) => a.status === status).length;
  appendAudit({
    personaId,
    eventType: "payday_run",
    actor: { type: "agent", personaId },
    summary:
      `Payday run: ${paycheck ? `pay landed (+${usd(paycheck.amountCents)})` : "no new pay"}; ` +
      `${actions.length} action(s): ${count("executed")} done, ${count("pending_approval")} waiting, ${count("denied")} blocked.`,
    payload: { paycheckId: paycheck?.id ?? null, actionIds: actions.map((a) => a.id) },
  });
  return { paycheck, actions };
}
