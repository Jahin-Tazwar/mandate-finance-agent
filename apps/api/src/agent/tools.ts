import { z } from "zod";
import type { Action, ProposedAction } from "@mandate/shared";
import { proposeAction } from "../actions";
import { getBills, getBudget, getForecast, getPayCycle, getSafeToSpendToday, getSubscriptions } from "../analytics";
import { config } from "../config";
import { usd } from "../lib/money";
import { getMandate, listAccounts, queryTransactions } from "../store";
import { getWishImpact, getWishList } from "../wishes";
import type { ToolDefinition } from "./llm";

/**
 * THE AGENT'S TOOLS. Read tools look things up; propose_* tools ask for an action.
 * There is deliberately NO tool that moves money directly: every propose_* goes through
 * proposeAction → the policy engine, exactly like a button the user presses.
 */

/** Dollars from the model → cents, e.g. 132.8 → 13280. The model handles dollars better than cents. */
const Dollars = z
  .number()
  .positive()
  .max(1_000_000)
  .transform((d) => Math.round(d * 100));

/** Every proposal carries the agent's reason (shown to the user on the approval card). */
const Reason = z.string().trim().min(1).max(300);

// Arguments of each tool, checked with Zod (the model can send anything)
const Args = {
  get_overview: z.object({}),
  get_bills: z.object({}),
  get_subscriptions: z.object({}),
  get_budget: z.object({}),
  get_forecast: z.object({}),
  get_rules: z.object({}),
  get_wishes: z.object({}),
  get_recent_transactions: z.object({ limit: z.number().int().min(1).max(30).default(10), category: z.string().optional() }),
  get_wish_impact: z.object({ amount: Dollars }),
  propose_payment: z.object({
    payee: z.string().trim().min(1).max(80),
    amount: Dollars,
    from_account: z.enum(["checking", "credit"]).default("checking"),
    bill_id: z.string().optional(),
    reason: Reason,
  }),
  propose_transfer: z.object({ from_account: z.enum(["checking", "savings"]), to_account: z.enum(["checking", "savings"]), amount: Dollars, reason: Reason }),
  propose_wish_contribution: z.object({ wish_id: z.string(), amount: Dollars, reason: Reason }),
  propose_cancel_subscription: z.object({ subscription_id: z.string(), reason: Reason }),
  propose_dispute: z.object({ transaction_id: z.string(), reason: Reason }),
};

export type ToolName = keyof typeof Args;

/** Shorthand for a tool definition: name, description, properties, required. */
function tool(name: ToolName, description: string, properties: Record<string, unknown> = {}, required: string[] = []): ToolDefinition {
  return { type: "function", function: { name, description, parameters: { type: "object", properties, required } } };
}

const money = { type: "number", description: "Amount in dollars, e.g. 132.80" };
const reason = { type: "string", description: "One short sentence: why you propose this (shown to the user)" };

/** What the model is told about each tool. */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  tool("get_overview", "Balances, safe-to-spend today, and pay schedule. Start here for most questions."),
  tool("get_bills", "Bills due in the next 30 days."),
  tool("get_subscriptions", "Recurring subscriptions, with when each was last used."),
  tool("get_budget", "This month's spending by category against the budget, plus insights."),
  tool("get_forecast", "Checking balance forecast for the next 30 days: lowest point and warnings."),
  tool("get_rules", "The user's signed rules: what you may do automatically and what needs approval."),
  tool("get_wishes", "The user's wishes (savings goals) and their saving plans."),
  tool("get_recent_transactions", "Recent transactions, newest first.", {
    limit: { type: "integer", description: "How many (max 30)" },
    category: { type: "string", description: "Optional category, e.g. dining" },
  }),
  tool("get_wish_impact", "How much a purchase of this amount delays the user's wishes.", { amount: money }, ["amount"]),
  tool(
    "propose_payment",
    "Propose paying a person or company. The rules decide: it may run automatically, wait for approval, or be blocked.",
    {
      payee: { type: "string" },
      amount: money,
      from_account: { type: "string", enum: ["checking", "credit"] },
      bill_id: { type: "string", description: "The bill's id from get_bills, if paying a bill" },
      reason,
    },
    ["payee", "amount", "reason"],
  ),
  tool(
    "propose_transfer",
    "Propose moving money between the user's own checking and savings.",
    { from_account: { type: "string", enum: ["checking", "savings"] }, to_account: { type: "string", enum: ["checking", "savings"] }, amount: money, reason },
    ["from_account", "to_account", "amount", "reason"],
  ),
  tool("propose_wish_contribution", "Propose saving money for one of the user's wishes (checking → savings).", { wish_id: { type: "string" }, amount: money, reason }, [
    "wish_id",
    "amount",
    "reason",
  ]),
  tool("propose_cancel_subscription", "Propose cancelling a subscription (id from get_subscriptions).", { subscription_id: { type: "string" }, reason }, [
    "subscription_id",
    "reason",
  ]),
  tool("propose_dispute", "Propose disputing a wrong charge, e.g. a duplicate (transaction id from get_recent_transactions).", { transaction_id: { type: "string" }, reason }, [
    "transaction_id",
    "reason",
  ]),
];

/**
 * Makes data easier for the model: every "...Cents" number becomes dollar text.
 * e.g. { balanceCents: 50892 } → { balance: "$508.92" }
 */
export function forModel(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(forModel);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (key.endsWith("Cents") && typeof v === "number") out[key.slice(0, -5)] = usd(v);
      else out[key] = forModel(v);
    }
    return out;
  }
  return value;
}

/** What a propose_* tool tells the model: the outcome, in the rules' own words. */
const outcome = (a: Action) => ({ actionId: a.id, summary: a.summary, status: a.status, reasons: a.reasons, wishImpact: a.wishImpact });

/**
 * Runs one tool. `onAction` is called with every action created (for the chat stream).
 * Bad arguments or a 404 come back as { error } so the model can correct itself.
 */
export function runTool(personaId: string, name: string, rawArgs: unknown, onAction: (a: Action) => void): unknown {
  // Reject: a tool that doesn't exist
  if (!(name in Args)) return { error: `Unknown tool "${name}"` };
  const parsed = Args[name as ToolName].safeParse(rawArgs ?? {});

  // Reject: arguments of the wrong shape, e.g. a negative amount
  if (!parsed.success) return { error: "Invalid arguments", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  const args = parsed.data as Record<string, unknown>;

  // Proposals: the policy engine decides; the agent never acts on its own
  const propose = (action: ProposedAction) => {
    const created = proposeAction(personaId, action, String(args.reason));
    onAction(created);
    return outcome(created);
  };

  switch (name as ToolName) {
    case "get_overview": {
      const payCycle = getPayCycle(personaId);
      return forModel({
        today: config.today,
        accounts: listAccounts(personaId).map((a) => ({ type: a.type, balanceCents: a.balanceCents })),
        safeToSpendTodayCents: getSafeToSpendToday(personaId),
        payCycle: { cadence: payCycle.cadence, payday: payCycle.payday, nextPayday: payCycle.nextPayday, usualLeftOverPerPaydayCents: payCycle.avgSurplusPerCycleCents },
      });
    }
    case "get_bills":
      return forModel(getBills(personaId));
    case "get_subscriptions":
      return forModel(getSubscriptions(personaId).map(({ accountId: _a, ...s }) => s));
    case "get_budget":
      return forModel(getBudget(personaId));
    case "get_forecast": {
      // Just the summary: 30 daily balances would waste the model's attention
      const f = getForecast(personaId);
      return forModel({ lowestPoint: f.lowestPoint, endOfPeriod: f.days.at(-1), warnings: f.warnings });
    }
    case "get_rules":
      return { rules: getMandate(personaId).summary };
    case "get_wishes": {
      const list = getWishList(personaId);
      return forModel({
        wishes: list.wishes.map((w) => ({ id: w.id, title: w.title, status: w.status, targetCents: w.targetCents, savedCents: w.savedCents, targetDate: w.targetDate, perPaydayCents: w.plan.perPaydayCents, eta: w.eta?.date ?? null })),
        usualLeftOverPerPaydayCents: list.surplusPerPaydayCents,
        overCommitted: list.overCommitted,
      });
    }
    case "get_recent_transactions": {
      const { limit, category } = args as { limit: number; category?: string };
      const page = queryTransactions(personaId, { limit: 100, offset: 0 });
      const items = page.items.filter((t) => !category || t.category === category).slice(0, limit);
      return forModel(items.map(({ accountId: _a, ...t }) => t));
    }
    case "get_wish_impact":
      return getWishImpact(personaId, args.amount as number).message;
    case "propose_payment":
      return propose({
        source: "agent",
        type: "payment",
        payee: args.payee as string,
        amountCents: args.amount as number,
        fromAccount: args.from_account as "checking" | "credit",
        ...(args.bill_id ? { billId: args.bill_id as string } : {}),
      });
    case "propose_transfer":
      return propose({ source: "agent", type: "transfer", fromAccount: args.from_account as "checking", toAccount: args.to_account as "savings", amountCents: args.amount as number });
    case "propose_wish_contribution":
      return propose({ source: "agent", type: "wish_contribution", wishId: args.wish_id as string, amountCents: args.amount as number });
    case "propose_cancel_subscription": {
      const sub = getSubscriptions(personaId).find((s) => s.id === args.subscription_id);
      if (!sub) return { error: `No subscription with id "${String(args.subscription_id)}"` };
      return propose({ source: "agent", type: "cancel_subscription", subscriptionId: sub.id, merchant: sub.merchant });
    }
    case "propose_dispute":
      return propose({ source: "agent", type: "dispute", transactionId: args.transaction_id as string });
  }
}

/** The proposal tools (counted, so one chat message can't create a flood of actions). */
export const isProposal = (name: string) => name.startsWith("propose_");
