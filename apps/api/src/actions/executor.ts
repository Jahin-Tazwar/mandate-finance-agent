import type { Category, ProposedAction } from "@mandate/shared";
import { addContribution, allTransactions, getWish, markCancelled, postTransaction } from "../store";

/**
 * THE EXECUTOR: the only code that actually moves money.
 * It runs only AFTER the policy engine said yes (or the user approved with their PIN),
 * so it does no checking of its own. In a real bank this is where the payment API call goes.
 */
export function execute(personaId: string, action: ProposedAction, actionId: string): void {
  switch (action.type) {
    case "payment":
      // e.g. CityPower $132.80 from checking → a −13280 transaction, filed like earlier CityPower payments
      postTransaction(personaId, {
        account: action.fromAccount,
        amountCents: -action.amountCents,
        merchant: action.payee,
        description: action.billId ? `Bill payment (${action.billId})` : "Payment",
        category: categoryFor(personaId, action.payee),
        memo: `MoneyWise ${actionId}`,
      });
      return;

    case "transfer":
      moveBetween(personaId, action.fromAccount, action.toAccount, action.amountCents, `Transfer to ${action.toAccount}`, actionId);
      return;

    case "wish_contribution": {
      // Money goes checking → savings, and the wish remembers it
      const wish = getWish(action.wishId);
      moveBetween(personaId, "checking", "savings", action.amountCents, `Saved for ${wish.title}`, actionId);
      addContribution(action.wishId, {
        amountCents: action.amountCents,
        source: action.source === "user" ? "user" : "agent",
        actionId,
      });
      return;
    }

    case "cancel_subscription":
      markCancelled(personaId, action.merchant); // no money moves; future charges stop
      return;

    case "dispute":
      return; // no money moves until the bank decides; the action itself is the record
  }
}

/** Two transactions: money out of one account, into the other (both filed as "transfer"). */
function moveBetween(personaId: string, from: "checking" | "savings" | "credit", to: "checking" | "savings" | "credit", cents: number, description: string, actionId: string) {
  const memo = `MoneyWise ${actionId}`;
  postTransaction(personaId, { account: from, amountCents: -cents, merchant: "Own accounts", description, category: "transfer", memo });
  postTransaction(personaId, { account: to, amountCents: cents, merchant: "Own accounts", description, category: "transfer", memo });
}

/** Same category as the last payment to this payee, e.g. "CityPower" → utilities; new payees → other. */
function categoryFor(personaId: string, payee: string): Category {
  const name = payee.trim().toLowerCase();
  const earlier = allTransactions(personaId).find((t) => t.merchant.trim().toLowerCase() === name && t.amountCents < 0);
  return earlier?.category ?? "other";
}
