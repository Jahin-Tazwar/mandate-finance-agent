/**
 * THE REDACTOR: removes personal data from text before it's sent to the AI model.
 * The model doesn't need an email address or a full card number to answer a money
 * question, so it never gets them. Each replacement keeps just enough to stay useful,
 * e.g. a card number becomes "[number ending 4821]".
 */

/** Each rule: what to find → what to put instead. Order matters (longest patterns first). */
const RULES: { name: string; pattern: RegExp; replace: (match: string) => string }[] = [
  // e.g. maya.chen@uni.edu → [email]
  { name: "email", pattern: /[\w.+-]+@[\w-]+(\.[\w-]+)+/g, replace: () => "[email]" },
  // e.g. 123-45-6789 → [id number] (US social security number shape)
  { name: "id_number", pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replace: () => "[id number]" },
  // e.g. 4111 1111 1111 4821 or 000123456789 → [number ending 4821] (card / account numbers)
  {
    name: "long_number",
    pattern: /\b\d(?:[ -]?\d){9,18}\b/g,
    replace: (m) => `[number ending ${m.replace(/\D/g, "").slice(-4)}]`,
  },
  // e.g. +1 (415) 555-0134 → [phone]. Needs the leading "+" so dates and amounts are never caught.
  { name: "phone", pattern: /\+\d[\d ()-]{7,}\d/g, replace: () => "[phone]" },
];

/** Redacted text, and how many things were removed (counted for the audit log). */
export function redact(text: string): { text: string; count: number } {
  let count = 0;
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.pattern, (match) => {
      count += 1;
      return rule.replace(match);
    });
  }
  return { text: out, count };
}
