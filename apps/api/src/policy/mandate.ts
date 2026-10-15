import type { Mandate, Policy, Rule, Tier } from "@mandate/shared";
import { usd } from "../lib/money";

/**
 * Each persona starts with a signed mandate (their rules). From Oct 16 they can rewrite
 * it in plain English; until then these defaults apply.
 */

/** How much each persona lets the agent save for wishes on a payday, automatically. */
const WISH_AUTOSAVE_CAP: Record<string, number> = {
  maya: 8_000, // $80 a week covers her $40.39 iPhone plan
  daniel: 60_000, // $600 a month covers his car + holiday plans
  aisha: 3_000, // $30 a day
};

/** The rules every persona starts with. */
function defaultPolicy(personaId: string): Policy {
  return {
    defaultTier: "L2", // anything not covered below: ask me first
    rules: [
      { type: "balance_floor", account: "checking", minCents: 20_000 },
      { type: "amount_cap", perTxCents: 10_000, aboveTier: "L2" },
      { type: "new_payee", tier: "L2", cooldownHours: 24 },
      { type: "daily_cap", maxCents: 50_000 },
      {
        type: "wish_autosave",
        trigger: "income_detected",
        maxPerPaydayCents: WISH_AUTOSAVE_CAP[personaId] ?? 5_000,
        tier: "L3",
      },
    ],
  };
}

/** "automatically", "with your approval"... for a tier */
function howItHappens(tier: Tier): string {
  switch (tier) {
    case "L3":
      return "automatically";
    case "L2":
      return "only with your approval";
    case "L1":
      return "only as a suggestion";
    case "L0":
      return "never (the agent only watches)";
  }
}

/** One plain sentence for one rule. */
function describeRule(rule: Rule): string {
  switch (rule.type) {
    case "balance_floor":
      return `${rule.account[0]!.toUpperCase()}${rule.account.slice(1)} never goes below ${usd(rule.minCents)}.`;
    case "amount_cap":
      return `Payments over ${usd(rule.perTxCents)} happen ${howItHappens(rule.aboveTier)}.`;
    case "daily_cap":
      return `The agent can move at most ${usd(rule.maxCents)} a day.`;
    case "new_payee": {
      const wait = rule.cooldownHours > 0 ? `, and they count as new for ${rule.cooldownHours} hours` : "";
      return `Paying someone new happens ${howItHappens(rule.tier)}${wait}.`;
    }
    case "sweep":
      return `On payday, ${rule.from} money above ${usd(rule.keepCents)} moves to ${rule.to} ${howItHappens(rule.tier)}.`;
    case "wish_autosave":
      return `On payday, up to ${usd(rule.maxPerPaydayCents)} goes to your wishes ${howItHappens(rule.tier)}.`;
  }
}

/**
 * The rules as plain sentences, e.g. ["Checking never goes below $200.", ...].
 * Used in the API, the UI and (later) to show the user what the AI understood.
 */
export function summarize(policy: Policy): string[] {
  const sentences = policy.rules.map(describeRule);
  sentences.push(`Anything else happens ${howItHappens(policy.defaultTier)}.`);
  return sentences;
}

/** The mandate a persona starts with (version 1, signed when the demo data loaded). */
export function defaultMandate(personaId: string, signedAt: string): Mandate {
  const policy = defaultPolicy(personaId);
  const cap = usd(WISH_AUTOSAVE_CAP[personaId] ?? 5_000);
  return {
    version: 1,
    naturalLanguage:
      `Never let my checking go below $200. Ask me before any payment over $100 or to anyone new. ` +
      `Save up to ${cap} for my wishes every payday. Never move more than $500 a day.`,
    signedAt,
    policy,
    summary: summarize(policy),
  };
}
