import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { z } from "zod";

/**
 * Money text from a spreadsheet → whole cents, never via a decimal number.
 * e.g. "-42.18" → -4218, "2400" → 240000, "0.5" → 50
 */
export function parseMoney(text: string): number {
  // Pieces: optional minus, whole number, optional "." + 1–2 digits
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());

  // Reject: anything else, e.g. "$42.18", "1,200", "12.345"
  if (!match) {
    throw new Error(`"${text}" isn't a plain amount like -42.18 (no $ signs or thousands commas)`);
  }

  // e.g. "-42.18" → sign "-", whole "42", fraction "18" → 42 × 100 + 18 = 4218
  const [, sign, whole, fraction = ""] = match;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0")); // "5" → "50" cents
  return sign === "-" ? -cents : cents;
}

/** Cents back to spreadsheet text, e.g. -4218 → "-42.18". */
export function formatMoney(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, "0"); // 5 → "05"
  const text = `${dollars}.${rest}`;
  return cents < 0 ? `-${text}` : text;
}

// ---- Reusable column checks for the seed files ----

/** A money column: checked and converted to cents, with a friendly error if it's not plain. */
export const moneyColumn = z.string().transform((text, ctx) => {
  try {
    return parseMoney(text);
  } catch (err) {
    // Reject: report parseMoney's message as this column's problem
    ctx.addIssue({ code: "custom", message: (err as Error).message });
    return z.NEVER;
  }
});

/** A date column: must look like 2026-05-03 and be a real date (not 2026-02-31). */
export const dateColumn = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must look like 2026-05-03")
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), "not a real calendar date");

/** "yes" / "no" (any capitalisation) → true / false. */
export const yesNoColumn = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.enum(["yes", "no"], { message: 'write "yes" or "no"' }))
  .transform((v) => v === "yes");

/** Optional text: an empty cell becomes null. */
export const optionalText = z.string().transform((v) => (v.trim() === "" ? null : v.trim()));

/** Collects every bad row across all files, so the team sees all problems at once. */
export class SeedErrors {
  readonly messages: string[] = [];

  /** e.g. add("transactions/maya.csv", 3, "amount: ...") → "transactions/maya.csv row 3: amount: ..." */
  add(file: string, row: number, message: string) {
    this.messages.push(`${file} row ${row}: ${message}`);
  }

  /** Throws one error listing up to 25 problems (and how many more), or does nothing. */
  throwIfAny() {
    if (this.messages.length === 0) return;
    const shown = this.messages.slice(0, 25).join("\n  ");
    const more = this.messages.length > 25 ? `\n  …and ${this.messages.length - 25} more` : "";
    throw new Error(`Seed data has ${this.messages.length} problem(s):\n  ${shown}${more}`);
  }
}

/**
 * Reads one CSV file and checks every row with `schema`. Bad rows go to `errors`.
 * Row numbers match Excel: the header is row 1, the first data row is row 2.
 */
export function readCsv<S extends z.ZodType>(
  seedDir: string,
  file: string,
  schema: S,
  errors: SeedErrors,
  { optional = false } = {},
): z.output<S>[] {
  // Reject: the file doesn't exist (fine for optional files, a problem otherwise)
  const fullPath = path.join(seedDir, file);
  if (!fs.existsSync(fullPath)) {
    if (!optional) errors.add(file, 0, "file is missing");
    return [];
  }

  // Each row becomes an object keyed by the header, e.g. { date: "2026-05-01", amount: "-750.00", ... }
  const records: Record<string, string>[] = parse(fs.readFileSync(fullPath, "utf8"), {
    columns: true,
    bom: true, // Excel adds an invisible marker at the start of "CSV UTF-8" files
    skip_empty_lines: true,
    trim: true,
  });

  // Check the header once: a missing column would otherwise fail every single row
  if (schema instanceof z.ZodObject && records.length > 0) {
    const required = Object.keys(schema.shape);
    const missing = required.filter((column) => !(column in records[0]!));

    // Reject: whole file, with one clear message
    if (missing.length > 0) {
      errors.add(file, 1, `missing column(s): ${missing.join(", ")} (header must include: ${required.join(", ")})`);
      return [];
    }
  }

  // Check each row; keep the good ones, report every problem in the bad ones
  const rows: z.output<S>[] = [];
  records.forEach((record, i) => {
    const result = schema.safeParse(record);
    if (result.success) {
      rows.push(result.data);
      return;
    }

    // Reject: this row, once per problem, e.g. "row 3: amount: ..." (i + 2: header is row 1)
    for (const issue of result.error.issues) {
      const column = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      errors.add(file, i + 2, `${column}${issue.message}`);
    }
  });
  return rows;
}
