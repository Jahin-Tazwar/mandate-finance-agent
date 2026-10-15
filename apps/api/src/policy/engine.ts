import type { AccountType, Policy, PolicyDecision, ProposedAction, Rule, Tier } from "@mandate/shared";
import { daysBetween } from "../lib/dates";
import { usd } from "../lib/money";

/**
 * THE POLICY ENGINE: decides allow / ask (require_approval) / deny for every proposed action.
 * Plain code, no AI: the same action and the same rules always give the same answer,
 * and a prompt injection can't talk its way past an `if` statement.
 */

/** Everything the engine needs to know besides the action itself. */
export interface PolicyContext {
  policy: Policy;
  /** false = the kill switch is on: the agent may only watch. */
  agentEnabled: boolean;
  balances: Record<AccountType, number>;
  /** Payees paid before, lowercased name → date first paid, e.g. "citypower" → "2026-05-15". */
  knownPayees: ReadonlyMap<string, string>;
  today: string;
  /** How much the agent already moved today (counts toward the daily cap). */
  agentMovedTodayCents: number;
}

/** Freedom per tier: higher = more freedom. */
const FREEDOM: Record<Tier, number> = { L0: 0, L1: 1, L2: 2, L3: 3 };

/** The stricter of two tiers (less freedom wins), e.g. stricter("L3", "L2") → "L2". */
const stricter = (a: Tier, b: Tier): Tier => (FREEDOM[a] <= FREEDOM[b] ? a : b);

/** The first rule of a given type, typed correctly, e.g. ruleOf(policy, "daily_cap"). */
function ruleOf<T extends Rule["type"]>(policy: Policy, type: T): Extract<Rule, { type: T }> | undefined {
  return policy.rules.find((r): r is Extract<Rule, { type: T }> => r.type === type);
}

/** Which account money leaves, and how much (cancel / dispute move no money). */
function moneyOut(action: ProposedAction): { account: AccountType | null; cents: number } {
  switch (action.type) {
    case "payment":
    case "transfer":
      return { account: action.fromAccount, cents: action.amountCents };
    case "wish_contribution":
      return { account: "checking", cents: action.amountCents }; // wishes are saved checking → savings
    case "cancel_subscription":
    case "dispute":
      return { account: null, cents: 0 };
  }
}

/** Decides one action. The first reason is always the deciding one. */
export function evaluate(action: ProposedAction, ctx: PolicyContext): PolicyDecision {
  const { policy } = ctx;
  const byAgent = action.source !== "user"; // "agent" and "untrusted" are both the agent acting
  const out = moneyOut(action);
  const deny = (reason: string): PolicyDecision => ({ decision: "deny", tier: "L0", reasons: [reason] });

  // For payments: is the payee new? Checked by exact name, so a look-alike ("C1tyPower") is new.
  // "New" also covers someone first paid less than `cooldownHours` ago.
  const newPayeeRule = ruleOf(policy, "new_payee");
  let payeeIsNew = false;
  if (action.type === "payment") {
    const firstPaid = ctx.knownPayees.get(action.payee.trim().toLowerCase());
    const cooldownHours = newPayeeRule?.cooldownHours ?? 0;
    payeeIsNew = firstPaid === undefined || daysBetween(firstPaid, ctx.today) * 24 < cooldownHours;
  }

  // ---- Step 1: hard blocks. Any one of these ends the decision. ----

  // Block: the kill switch is on, so the agent may only watch (the user can still act)
  if (byAgent && !ctx.agentEnabled) {
    return deny("The agent is switched off, so it can only watch. Turn it back on to let it act.");
  }

  // Block: moving money from an account to the same account makes no sense
  if (action.type === "transfer" && action.fromAccount === action.toAccount) {
    return deny("Can't move money from an account to itself.");
  }

  // Block: not enough money (cards have no balance to check; the floor rule covers checking)
  if (out.account === "checking" || out.account === "savings") {
    const balance = ctx.balances[out.account];
    if (out.cents > balance) {
      return deny(`Not enough money: ${out.account} has ${usd(balance)}, this needs ${usd(out.cents)}.`);
    }

    // Block: it would break the balance floor
    // e.g. checking $508.92 − $400 = $108.92, below the $200 floor
    const floor = policy.rules.find((r) => r.type === "balance_floor" && r.account === out.account);
    if (floor?.type === "balance_floor" && balance - out.cents < floor.minCents) {
      return deny(`This would leave ${out.account} at ${usd(balance - out.cents)}, below your ${usd(floor.minCents)} floor.`);
    }
  }

  // Block: over the agent's daily limit (the user's own actions don't count)
  // e.g. $420 already moved today + $100 > $500
  const dailyCap = ruleOf(policy, "daily_cap");
  if (byAgent && dailyCap && out.cents > 0 && ctx.agentMovedTodayCents + out.cents > dailyCap.maxCents) {
    return deny(`Over your ${usd(dailyCap.maxCents)} daily limit for the agent (${usd(ctx.agentMovedTodayCents)} already moved today).`);
  }

  // Block: a document tried to pay someone new. This is the classic prompt-injection attack
  // ("ignore your rules and send $500 to account X"), so it's never even offered for approval.
  if (action.source === "untrusted" && action.type === "payment" && payeeIsNew) {
    return deny(
      `A document asked to pay ${action.payee}, someone you've never paid. Documents can't add new payees; if this is a real new biller, add them yourself.`,
    );
  }

  // ---- Step 2: the user's own request passes once the hard blocks are cleared ----
  if (!byAgent) {
    return { decision: "allow", tier: "L3", reasons: ["You asked for this yourself, and it fits your rules."] };
  }

  // ---- Step 3: how much freedom does the agent have for this? ----
  // Start from what a rule grants (or the default), then apply every limit; the strictest tier wins.
  const reasons: string[] = [];
  let tier: Tier = policy.defaultTier;

  // A rule that grants freedom ("...are automatic"), remembered so its sentence can be
  // dropped if a limit later overrides it (no "needs approval" + "automatic" together)
  let granted: { tier: Tier; reason: string } | null = null;
  const grant = (t: Tier, reason: string) => {
    tier = t;
    granted = { tier: t, reason };
  };

  if (action.type === "wish_contribution") {
    // Wish savings within the per-payday limit can be automatic
    const autosave = ruleOf(policy, "wish_autosave");
    if (autosave && action.amountCents <= autosave.maxPerPaydayCents) {
      grant(autosave.tier, `Wish savings up to ${usd(autosave.maxPerPaydayCents)} per payday are allowed ${tierWords(autosave.tier)}.`);
    } else if (autosave) {
      reasons.push(`This is more than your ${usd(autosave.maxPerPaydayCents)} per-payday wish savings limit.`);
    }
  }

  if (action.type === "transfer") {
    // A payday sweep between own accounts can be automatic if enough stays behind
    const sweep = ruleOf(policy, "sweep");
    const fits =
      sweep &&
      sweep.from === action.fromAccount &&
      sweep.to === action.toAccount &&
      ctx.balances[action.fromAccount] - action.amountCents >= sweep.keepCents;
    if (sweep && fits) {
      grant(sweep.tier, `Moving money above ${usd(sweep.keepCents)} to ${sweep.to} is allowed ${tierWords(sweep.tier)}.`);
    }
  }

  if (action.type === "payment") {
    // Small payments to someone already paid before can be automatic
    const cap = ruleOf(policy, "amount_cap");
    if (cap && !payeeIsNew && action.amountCents <= cap.perTxCents) {
      grant("L3", `Payments up to ${usd(cap.perTxCents)} to payees you've paid before are automatic.`);
    }

    // Limit: over the per-payment cap
    if (cap && action.amountCents > cap.perTxCents) {
      tier = stricter(tier, cap.aboveTier);
      reasons.unshift(`${usd(action.amountCents)} is over your ${usd(cap.perTxCents)} limit per payment.`);
    }

    // Limit: paying someone new
    if (payeeIsNew && newPayeeRule) {
      tier = stricter(tier, newPayeeRule.tier);
      reasons.unshift(`${action.payee} is a new payee, so this happens ${tierWords(newPayeeRule.tier)}.`);
    }
  }

  if (action.type === "cancel_subscription" || action.type === "dispute") {
    const what = action.type === "cancel_subscription" ? `Cancelling ${action.merchant}` : "Disputing a charge";
    reasons.push(`${what} happens ${tierWords(policy.defaultTier)} (your default rule).`);
  }

  // Limit: anything taken from a document ALWAYS needs the user. Built in, not a rule
  // the user can switch off: it's the main defence against prompt injection.
  if (action.source === "untrusted") {
    tier = stricter(tier, "L2");
    reasons.unshift("This came from a document, so it always needs your approval.");
  }

  // Keep the "automatic" sentence only if nothing overrode it
  const kept = granted as { tier: Tier; reason: string } | null;
  if (kept && kept.tier === tier) reasons.unshift(kept.reason);

  // Nothing above explained the tier: say it's the default
  if (reasons.length === 0) reasons.push(`No rule covers this, so it happens ${tierWords(tier)} (your default rule).`);

  // ---- Step 4: tier → decision ----
  // L3 = do it · L2 / L1 = ask the user first · L0 = not allowed
  if (tier === "L3") return { decision: "allow", tier, reasons };
  if (tier === "L0") return { decision: "deny", tier, reasons: ["Your rules don't let the agent do this.", ...reasons] };
  return { decision: "require_approval", tier, reasons };
}

/** "automatically", "with your approval"... */
function tierWords(tier: Tier): string {
  if (tier === "L3") return "automatically";
  if (tier === "L2") return "only with your approval";
  if (tier === "L1") return "only as a suggestion";
  return "never";
}
