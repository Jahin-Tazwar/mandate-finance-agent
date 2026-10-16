import { parseMoney } from "../store/csv";

/**
 * Reads a bill's text WITHOUT any AI: plain patterns for the fields we need, plus a scan
 * for text that tries to give orders to an AI. Nothing in a document is ever treated as an
 * instruction; at most it becomes a warning, and a "what if the AI obeyed?" check (see index.ts).
 */

export interface BillFields {
  payee: string | null;
  amountCents: number | null;
  dueDate: string | null;
  accountNumber: string | null;
}

/** A payment the document asks for that ISN'T the bill itself, e.g. "transfer $500 to account 99-1234". */
export interface Redirect {
  payee: string;
  /** null = no amount given (e.g. "pay to: CityPower Payments") → the bill's amount is used. */
  amountCents: number | null;
  /** The sentence it came from, for the warning. */
  quote: string;
}

/** The first match's group 1, trimmed; null if no match. */
const first = (text: string, pattern: RegExp) => pattern.exec(text)?.[1]?.trim() ?? null;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * A date in any common bill format → "YYYY-MM-DD", or null.
 * e.g. "October 20, 2026" / "Oct 20 2026" / "2026-10-20" / "20/10/2026"
 */
export function parseDate(text: string): string | null {
  const pad = (n: number) => String(n).padStart(2, "0");

  // "2026-10-20"
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // "October 20, 2026" or "Oct 20 2026"
  const named = /([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(text);
  if (named) {
    const month = MONTHS.indexOf(named[1]!.slice(0, 3).toLowerCase());
    if (month >= 0) return `${named[3]}-${pad(month + 1)}-${pad(Number(named[2]))}`;
  }

  // "20/10/2026" (day first, as on most bills outside the US)
  const dmy = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
  if (dmy) return `${dmy[3]}-${pad(Number(dmy[2]))}-${pad(Number(dmy[1]))}`;
  return null;
}

/** The bill's own details, from labelled lines like "Amount due: $132.80". */
export function readBillFields(text: string): BillFields {
  // Payee: a "Biller:" / "From:" / "Company:" line, otherwise the first line (the letterhead)
  const payee = first(text, /^(?:biller|from|company|payee)\s*:\s*(.+)$/im) ?? first(text, /^\s*(\S.{1,60})$/m);

  // e.g. "Amount due: $132.80" / "Total due: 1,450.00"
  const amount = first(text, /(?:amount|total)(?:\s+due)?\s*:?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i);

  // e.g. "Due date: October 20, 2026" / "Due: 2026-10-20". Only at the start of a line,
  // so "Amount due: $132.80" is never mistaken for the date.
  const dueLine = first(text, /^\s*(?:payment\s+)?due(?:\s+date)?\s*:\s*(.+)$/im);

  // e.g. "Account number: CP-88213" / "Account no. 12345"
  const accountNumber = first(text, /account\s*(?:number|no\.?|#)\s*:?\s*([A-Z0-9-]{3,30})/i);

  let amountCents: number | null = null;
  try {
    amountCents = amount ? parseMoney(amount.replace(/,/g, "")) : null;
  } catch {
    amountCents = null; // not a usable number
  }

  return { payee, amountCents: amountCents && amountCents > 0 ? amountCents : null, dueDate: dueLine ? parseDate(dueLine) : null, accountNumber };
}

/** Phrases that only make sense as orders to an AI (or as a fraud trick), never on a real bill. */
const INSTRUCTION_PATTERNS: { pattern: RegExp; what: string }[] = [
  { pattern: /ignore\s+(?:all\s+|any\s+)?(?:your\s+|the\s+|previous\s+|prior\s+)*(?:rules|instructions)/i, what: "tells the assistant to ignore its rules" },
  { pattern: /note\s+to\s+(?:the\s+)?(?:ai|assistant|agent|bot)|\b(?:ai|virtual)\s+assistant\b/i, what: "is addressed to an AI assistant" },
  { pattern: /pre-?approved/i, what: 'claims a payment is "pre-approved"' },
  { pattern: /without\s+(?:asking|approval|confirm\w*|checking)/i, what: "asks to skip the customer's approval" },
  { pattern: /(?:bank|payment)\s+details\s+(?:have\s+)?(?:changed|been\s+updated)|new\s+(?:bank\s+)?account\s+(?:number|details)/i, what: "says the bank details changed (a classic fraud trick)" },
  { pattern: /you\s+are\s+now|system\s+prompt|admin\s+mode|developer\s+mode/i, what: "tries to change how the assistant behaves" },
];

/** Payments the text asks for that aren't the bill: "transfer $500 to account 99-1234", "pay to: X, account Y". */
const REDIRECT_PATTERNS: { pattern: RegExp; hasAmount: boolean }[] = [
  // e.g. "transfer $500 to account 99-1234."
  { pattern: /(?:transfer|send|pay|wire)\s+\$\s?([\d,]+(?:\.\d{1,2})?)\s+to\s+((?:account\s+)?[A-Za-z0-9][\w-]*(?:\s[A-Za-z0-9][\w-]*){0,3}?)(?=\s*[.,;\n]|$)/gim, hasAmount: true },
  // e.g. "Please pay to: CityPower Payments, account 44-8899."
  { pattern: /pay(?:ments?)?\s+(?:to|into)\s*:\s*([A-Za-z0-9][^,\n.]{1,50})/gim, hasAmount: false },
];

/** Scans for orders aimed at an AI and payments to someone other than the biller. */
export function findInjections(text: string): { warnings: string[]; redirects: Redirect[] } {
  const found = INSTRUCTION_PATTERNS.filter((p) => p.pattern.test(text)).map((p) => p.what);
  // e.g. ["a", "b", "c"] → "a, b and c"
  const list = found.length > 1 ? `${found.slice(0, -1).join(", ")} and ${found.at(-1)}` : found[0];
  const warnings = found.length ? [`This document contains text that ${list}. It was treated as data and ignored.`] : [];

  const redirects: Redirect[] = [];
  for (const { pattern, hasAmount } of REDIRECT_PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      const payee = (hasAmount ? m[2] : m[1])!.trim();
      // e.g. "account 99-1234" → "Account 99-1234"
      const name = payee.charAt(0).toUpperCase() + payee.slice(1);
      let amountCents: number | null = null;
      if (hasAmount) {
        try {
          amountCents = parseMoney(m[1]!.replace(/,/g, ""));
        } catch {
          continue; // not a usable amount
        }
      }
      redirects.push({ payee: name, amountCents, quote: m[0].trim() });
    }
  }
  return { warnings, redirects };
}
