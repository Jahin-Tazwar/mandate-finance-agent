import { z } from "zod";
import { AccountType, Cents } from "./entities";

/**
 * Permission tiers: how much freedom the agent has for an action.
 *   L0 observe · L1 recommend · L2 act with approval · L3 act alone within the rules
 */
export const Tier = z.enum(["L0", "L1", "L2", "L3"]);

/** The policy engine's answer for every proposed action. */
export const Decision = z.enum(["allow", "require_approval", "deny"]);

/**
 * Where an action's details came from. "untrusted" = anything taken from a
 * document, email or memo field; those actions always need the user's approval.
 */
export const ActionSource = z.enum(["user", "agent", "untrusted"]);

// ---- The user's rules (the "mandate") ----

/** One rule. The `type` field says which kind it is. */
export const Rule = z.discriminatedUnion("type", [
  /** Never let this account go below `minCents`. Breaking it = blocked. */
  z.object({ type: z.literal("balance_floor"), account: AccountType, minCents: Cents.min(0) }),
  /** Payments above `perTxCents` need the tier `aboveTier` (e.g. L2 = ask me). */
  z.object({ type: z.literal("amount_cap"), perTxCents: Cents.positive(), aboveTier: Tier }),
  /** The agent may move at most `maxCents` per day in total. Over it = blocked. */
  z.object({ type: z.literal("daily_cap"), maxCents: Cents.positive() }),
  /** Paying someone new needs `tier`, and stays "new" for `cooldownHours` after the first payment. */
  z.object({ type: z.literal("new_payee"), tier: Tier, cooldownHours: z.number().int().min(0) }),
  /** On payday, move money above `keepCents` from one own account to another at `tier`. */
  z.object({
    type: z.literal("sweep"),
    trigger: z.literal("income_detected"),
    from: AccountType,
    to: AccountType,
    keepCents: Cents.min(0),
    tier: Tier,
  }),
  /** On payday, save for wishes, up to `maxPerPaydayCents`, at `tier`. */
  z.object({
    type: z.literal("wish_autosave"),
    trigger: z.literal("income_detected"),
    maxPerPaydayCents: Cents.positive(),
    tier: Tier,
  }),
]);

/** All of a user's rules. `defaultTier` applies when no rule says otherwise. */
export const Policy = z.object({
  defaultTier: Tier,
  rules: z.array(Rule),
});

/** GET /api/personas/:id/mandate: the rules in words, as data, and when they were signed. */
export const Mandate = z.object({
  version: z.number().int(),
  naturalLanguage: z.string(),
  signedAt: z.string().nullable(),
  policy: Policy,
  /** One plain sentence per rule, e.g. "Checking never goes below $200.00." */
  summary: z.array(z.string()),
});

// ---- Actions the agent (or the user) proposes ----

const base = { source: ActionSource };

/** Something the agent or the user wants to do. Checked by the policy engine before anything happens. */
export const ProposedAction = z.discriminatedUnion("type", [
  /** Pay a person or company, e.g. a bill. */
  z.object({
    ...base,
    type: z.literal("payment"),
    fromAccount: z.enum(["checking", "credit"]),
    payee: z.string().trim().min(1).max(80),
    amountCents: Cents.positive(),
    billId: z.string().optional(),
  }),
  /** Move money between your own accounts. */
  z.object({ ...base, type: z.literal("transfer"), fromAccount: AccountType, toAccount: AccountType, amountCents: Cents.positive() }),
  /** Put money aside for a wish (checking → savings). */
  z.object({ ...base, type: z.literal("wish_contribution"), wishId: z.string(), amountCents: Cents.positive() }),
  /** Cancel a subscription. */
  z.object({ ...base, type: z.literal("cancel_subscription"), subscriptionId: z.string(), merchant: z.string() }),
  /** Flag a charge as wrong (e.g. a duplicate). */
  z.object({ ...base, type: z.literal("dispute"), transactionId: z.string() }),
]);

/** The policy engine's verdict, with the reasons in plain sentences. */
export const PolicyDecision = z.object({
  decision: Decision,
  tier: Tier,
  reasons: z.array(z.string()),
});

export type Tier = z.infer<typeof Tier>;
export type Decision = z.infer<typeof Decision>;
export type ActionSource = z.infer<typeof ActionSource>;
export type Rule = z.infer<typeof Rule>;
export type Policy = z.infer<typeof Policy>;
export type Mandate = z.infer<typeof Mandate>;
export type ProposedAction = z.infer<typeof ProposedAction>;
export type PolicyDecision = z.infer<typeof PolicyDecision>;
