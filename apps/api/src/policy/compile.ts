import type { AccountType, Policy, Rule, Tier } from "@mandate/shared";
import { usd } from "../lib/money";
import { parseMoney } from "../store/csv";

/**
 * THE RULE COMPILER: plain-English rules → rules as data, with NO AI.
 * On purpose: if the AI wrote the rules that limit the AI, a prompt injection could
 * rewrite them. Plain patterns can't be talked into anything, and whatever isn't
 * understood is reported back instead of guessed.
 *
 *   "Never let my checking go below $200."       → balance_floor  checking $200
 *   "Ask me before any payment over $100"         → amount_cap     $100 → ask (L2)
 *   "...or to anyone new."                        → new_payee      ask (L2), 24 h
 *   "Never move more than $500 a day."            → daily_cap      $500
 *   "Save up to $80 for my wishes every payday."  → wish_autosave  $80, automatic (L3)
 *   "Move checking above $1,000 to savings."      → sweep          keep $1,000, automatic
 *   "Ask me about everything else."               → default        ask (L2)
 */

export interface CompileResult {
  policy: Policy;
  /** Problems the user should see before signing (not understood, risky, missing). */
  warnings: string[];
}

/** An amount like "$1,200" or "80" or "$80.50" → cents. */
const AMOUNT = /\$\s?([\d,]+(?:\.\d{1,2})?)/;
const cents = (match: RegExpExecArray | null): number | null => {
  const raw = match?.[1]?.replace(/,/g, "");
  if (!raw) return null;
  try {
    return parseMoney(raw);
  } catch {
    return null;
  }
};

/** Words that mean "ask me first", "never", "do it", "just suggest". */
const ASK = /\b(?:ask|approv\w*|confirm\w*|check with me|permission)\b/i;
const NEVER = /\b(?:never|don'?t|do not|block|forbid\w*|not allowed)\b/i;
const AUTO = /\b(?:automatic\w*|without asking|on (?:its|your) own|just do)\b/i;
const SUGGEST = /\b(?:suggest\w*|recommend\w*|only tell me)\b/i;

/** The tier a sentence asks for, or `fallback` if it doesn't say. */
function tierIn(sentence: string, fallback: Tier): Tier {
  if (ASK.test(sentence)) return "L2";
  if (AUTO.test(sentence)) return "L3";
  if (SUGGEST.test(sentence)) return "L1";
  if (NEVER.test(sentence)) return "L0";
  return fallback;
}

/** Which own account a sentence talks about (checking unless it says savings). */
const accountIn = (s: string): AccountType => (/\bsavings?\b/i.test(s) ? "savings" : "checking");

/** One matcher: reads a rule from a sentence, or returns null. */
type Matcher = (sentence: string) => Rule | null;

const MATCHERS: Matcher[] = [
  // "Never let my checking go below $200" / "Keep at least $200 in checking"
  (s) => {
    if (!/\b(?:below|under|less than|at least|minimum)\b/i.test(s) || !/\b(?:checking|savings|balance|account)\b/i.test(s)) return null;
    const minCents = cents(AMOUNT.exec(s));
    return minCents === null ? null : { type: "balance_floor", account: accountIn(s), minCents };
  },
  // "Ask me before any payment over $100" / "Never pay more than $1,000 at once"
  (s) => {
    if (!/\b(?:payments?|pay|purchases?|spend\w*|bills?)\b/i.test(s) || /\b(?:a|per|each|every)\s+day\b|\bdaily\b/i.test(s)) return null;
    const m = /(?:over|above|more than|bigger than|larger than)\s+\$\s?([\d,]+(?:\.\d{1,2})?)/i.exec(s);
    const perTxCents = cents(m);
    return perTxCents === null ? null : { type: "amount_cap", perTxCents, aboveTier: tierIn(s, "L2") === "L3" ? "L2" : tierIn(s, "L2") };
  },
  // "...or to anyone new" / "Never pay someone new" / "new payees wait 48 hours"
  (s) => {
    if (!/\b(?:anyone new|someone new|new (?:payees?|people|companies|recipients?)|haven'?t paid)\b/i.test(s)) return null;
    const hours = /(\d+)\s*(?:hours?|h)\b/i.exec(s);
    const days = /(\d+)\s*days?\b/i.exec(s);
    const cooldownHours = hours ? Number(hours[1]) : days ? Number(days[1]) * 24 : 24;
    const tier = tierIn(s, "L2");
    return { type: "new_payee", tier: tier === "L3" ? "L2" : tier, cooldownHours };
  },
  // "Never move more than $500 a day" / "At most $300 per day"
  (s) => {
    const m = /(?:more than|over|at most|max(?:imum)?(?: of)?|up to|limit(?: of)?)\s+\$\s?([\d,]+(?:\.\d{1,2})?)\s+(?:a|per|each|every)\s+day\b/i.exec(s);
    const maxCents = cents(m);
    return maxCents === null ? null : { type: "daily_cap", maxCents };
  },
  // "Save up to $80 for my wishes every payday"
  (s) => {
    if (!/\b(?:save|saving|put aside|set aside)\b/i.test(s) || !/\bwish\w*|\bgoals?\b/i.test(s)) return null;
    const maxPerPaydayCents = cents(AMOUNT.exec(s));
    if (maxPerPaydayCents === null) return null;
    return { type: "wish_autosave", trigger: "income_detected", maxPerPaydayCents, tier: tierIn(s, "L3") === "L2" ? "L2" : "L3" };
  },
  // "On payday, move checking above $1,000 to savings"
  (s) => {
    const m = /(?:move|sweep|transfer)\b.*?(?:above|over|more than)\s+\$\s?([\d,]+(?:\.\d{1,2})?).*?\b(?:to|into)\s+(?:my\s+)?(savings|checking)/i.exec(s);
    const keepCents = cents(m);
    if (keepCents === null) return null;
    const to = m![2]!.toLowerCase() as AccountType;
    return { type: "sweep", trigger: "income_detected", from: to === "savings" ? "checking" : "savings", to, keepCents, tier: tierIn(s, "L3") === "L2" ? "L2" : "L3" };
  },
];

/** Does this sentence set what happens when no rule applies? e.g. "Ask me about everything else." */
export const setsDefault = (sentence: string) =>
  /\b(?:everything|anything|all)\s+else\b/i.test(sentence) || /^(?:always )?ask me (?:first|about everything)/i.test(sentence);

/** How a sentence the compiler can't read is reported, e.g. 'Not understood, so it was left out: "Pay my bills"'. */
const NOT_UNDERSTOOD = "Not understood, so it was left out: ";

/**
 * The sentences that weren't understood, picked out of compileMandate's warnings.
 * e.g. ['Not understood, so it was left out: "Pay my bills"', "There's no daily limit…"] → ["Pay my bills"]
 */
export const notUnderstood = (warnings: readonly string[]): string[] =>
  warnings.filter((w) => w.startsWith(NOT_UNDERSTOOD)).map((w) => w.slice(NOT_UNDERSTOOD.length + 1, -1));

/**
 * Two phrasings the compiler understands for each kind of rule. The AI helper may only
 * suggest rewrites in these shapes (a test checks every one of them compiles).
 */
export const EXAMPLE_PHRASINGS: { rule: Rule["type"] | "default"; meaning: string; examples: [string, string] }[] = [
  { rule: "balance_floor", meaning: "a minimum balance", examples: ["Never let my checking go below $200.", "Keep at least $500 in savings."] },
  { rule: "amount_cap", meaning: "payments over an amount need approval, or are blocked", examples: ["Ask me before any payment over $100.", "Never pay more than $1,000 at once."] },
  { rule: "new_payee", meaning: "paying someone new needs approval (and a waiting time)", examples: ["Ask me before paying anyone new.", "New payees need my approval and wait 48 hours."] },
  { rule: "daily_cap", meaning: "the most the agent may move in one day", examples: ["Never move more than $500 a day.", "At most $300 per day."] },
  { rule: "sweep", meaning: "on payday, move money above an amount to another own account", examples: ["On payday, move checking above $1,000 to savings.", "Move savings above $5,000 into checking."] },
  { rule: "wish_autosave", meaning: "on payday, save up to an amount for wishes", examples: ["Save up to $80 for my wishes every payday.", "Save $50 for my wishes but ask me first."] },
  { rule: "default", meaning: "what happens when no other rule applies", examples: ["Ask me about everything else.", "Only suggest everything else."] },
];

/** Canonical order, so the same rules always come out the same way. */
const ORDER: Rule["type"][] = ["balance_floor", "amount_cap", "new_payee", "daily_cap", "sweep", "wish_autosave"];

/** Compiles plain-English rules. Never throws: problems become warnings. */
export function compileMandate(text: string): CompileResult {
  const warnings: string[] = [];
  const byType = new Map<Rule["type"], Rule>();
  let defaultTier: Tier | null = null;

  // One sentence at a time, e.g. "Ask me before any payment over $100 or to anyone new"
  const sentences = text
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((s) => s.trim().replace(/[.!?;]+$/, ""))
    .filter((s) => s.length > 0);

  for (const sentence of sentences) {
    let understood = false;

    // "...everything else..." sets what happens when no rule applies
    if (setsDefault(sentence)) {
      defaultTier = tierIn(sentence, "L2");
      understood = true;
    }

    for (const match of MATCHERS) {
      const rule = match(sentence);
      if (!rule) continue;
      understood = true;
      // The same kind of rule twice: the later one wins, and the user is told
      if (byType.has(rule.type)) warnings.push(`Two rules of the same kind ("${sentence}"): the last one is used.`);
      byType.set(rule.type, rule);
    }

    if (!understood) warnings.push(`${NOT_UNDERSTOOD}"${sentence}"`);
  }

  const rules = ORDER.flatMap((t) => (byType.has(t) ? [byType.get(t)!] : []));
  const policy: Policy = { defaultTier: defaultTier ?? "L2", rules };
  return { policy, warnings: [...warnings, ...riskWarnings(policy)] };
}

/** Rules that are allowed but risky: the user should think twice before signing. */
export function riskWarnings(policy: Policy): string[] {
  const out: string[] = [];
  const floor = policy.rules.find((r) => r.type === "balance_floor");
  const daily = policy.rules.find((r) => r.type === "daily_cap");
  const save = policy.rules.find((r) => r.type === "wish_autosave");

  if (!floor) out.push("There's no minimum balance: the agent could empty checking. Try: \"Never let my checking go below $200.\"");
  else if (floor.type === "balance_floor" && floor.minCents < 5_000) out.push(`A minimum balance of ${usd(floor.minCents)} is very low.`);
  if (!daily) out.push("There's no daily limit on what the agent moves. Try: \"Never move more than $500 a day.\"");
  else if (daily.type === "daily_cap" && daily.maxCents > 200_000) out.push(`A daily limit of ${usd(daily.maxCents)} is high.`);
  if (save?.type === "wish_autosave" && save.maxPerPaydayCents > 200_000) out.push(`Saving up to ${usd(save.maxPerPaydayCents)} per payday automatically is a lot.`);
  if (policy.defaultTier === "L3") out.push("Anything not covered by a rule will happen automatically. That's risky; \"ask me about everything else\" is safer.");
  return out;
}
