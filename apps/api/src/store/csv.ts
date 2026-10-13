import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { z } from "zod";

/**
 * Turns a money string from a spreadsheet into integer cents, without ever
 * going through a floating-point number: "-42.18" → -4218, "2400" → 240000.
 */
export function parseMoney(text: string): number {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) {
    throw new Error(`"${text}" isn't a plain amount like -42.18 (no $ signs or thousands commas)`);
  }
  const [, sign, whole, fraction = ""] = match;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return sign === "-" ? -cents : cents;
}

/** Cents back to the spreadsheet format: -4218 → "-42.18". */
export function formatMoney(cents: number): string {
  const abs = Math.abs(cents);
  const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return cents < 0 ? `-${text}` : text;
}

// Reusable column checks for seed files
export const moneyColumn = z.string().transform((text, ctx) => {
  try {
    return parseMoney(text);
  } catch (err) {
    ctx.addIssue({ code: "custom", message: (err as Error).message });
    return z.NEVER;
  }
});

export const dateColumn = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must look like 2026-05-03")
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), "not a real calendar date");

export const yesNoColumn = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.enum(["yes", "no"], { message: 'write "yes" or "no"' }))
  .transform((v) => v === "yes");

export const optionalText = z.string().transform((v) => (v.trim() === "" ? null : v.trim()));

/** Collects every bad row across all files, so the team sees all problems at once. */
export class SeedErrors {
  readonly messages: string[] = [];

  add(file: string, row: number, message: string) {
    this.messages.push(`${file} row ${row}: ${message}`);
  }

  throwIfAny() {
    if (this.messages.length === 0) return;
    const shown = this.messages.slice(0, 25).join("\n  ");
    const more = this.messages.length > 25 ? `\n  …and ${this.messages.length - 25} more` : "";
    throw new Error(`Seed data has ${this.messages.length} problem(s):\n  ${shown}${more}`);
  }
}

/**
 * Reads one CSV file and validates every row with `schema`.
 * Row numbers match what you see in Excel (the header is row 1).
 */
export function readCsv<S extends z.ZodType>(
  seedDir: string,
  file: string,
  schema: S,
  errors: SeedErrors,
  { optional = false } = {},
): z.output<S>[] {
  const fullPath = path.join(seedDir, file);
  if (!fs.existsSync(fullPath)) {
    if (!optional) errors.add(file, 0, "file is missing");
    return [];
  }

  const records: Record<string, string>[] = parse(fs.readFileSync(fullPath, "utf8"), {
    columns: true,
    bom: true, // Excel adds an invisible marker at the start of "CSV UTF-8" files
    skip_empty_lines: true,
    trim: true,
  });

  // Check the header once: a missing column would otherwise fail every single row.
  if (schema instanceof z.ZodObject && records.length > 0) {
    const missing = Object.keys(schema.shape).filter((column) => !(column in records[0]!));
    if (missing.length > 0) {
      errors.add(file, 1, `missing column(s): ${missing.join(", ")} (header must include: ${Object.keys(schema.shape).join(", ")})`);
      return [];
    }
  }

  const rows: z.output<S>[] = [];
  records.forEach((record, i) => {
    const result = schema.safeParse(record);
    if (result.success) {
      rows.push(result.data);
    } else {
      for (const issue of result.error.issues) {
        const column = issue.path.length ? `${issue.path.join(".")}: ` : "";
        errors.add(file, i + 2, `${column}${issue.message}`);
      }
    }
  });
  return rows;
}
