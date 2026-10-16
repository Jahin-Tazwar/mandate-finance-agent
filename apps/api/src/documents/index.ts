import { PDFParse } from "pdf-parse";
import type { Action } from "@mandate/shared";
import { proposeAction } from "../actions";
import { appendAudit } from "../audit";
import { config } from "../config";
import { HttpError } from "../http/errors";
import { addDays, shortDate } from "../lib/dates";
import { usd } from "../lib/money";
import { addDocumentBill } from "../store";
import { accountId } from "../store/seed";
import { type BillFields, findInjections, readBillFields } from "./extract";

/**
 * BILL UPLOAD (the prompt-injection demo).
 *   1. read the PDF's text (hidden white or tiny text included: that's how real attacks hide)
 *   2. pull out the bill's details with plain patterns, no AI
 *   3. scan for orders aimed at an AI → warnings for the user
 *   4. propose paying the bill, marked "untrusted" → always needs the user's approval
 *   5. stress test: any payment the document asks for (e.g. "transfer $500 to account 99-1234")
 *      is run through the rules AS IF the assistant had been fooled into obeying. It's blocked,
 *      which proves the protection doesn't depend on the AI noticing the trick.
 */

export interface DocumentResult {
  billId: string;
  extracted: BillFields;
  untrusted: true;
  warnings: string[];
  actions: Action[];
}

/** The PDF's text, all pages. Throws 400 if it can't be read. */
async function readPdfText(data: Buffer): Promise<string> {
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    // Drop the page markers pdf-parse adds, e.g. "-- 1 of 1 --"
    return result.text.replace(/^-- \d+ of \d+ --$/gm, "").slice(0, 50_000);
  } catch {
    // Reject: broken or encrypted PDF
    throw new HttpError(400, "Couldn't read this PDF");
  } finally {
    await parser.destroy();
  }
}

/** Reads an uploaded bill and proposes what to do with it. */
export async function ingestDocument(personaId: string, pdf: Buffer, filename: string): Promise<DocumentResult> {
  const text = await readPdfText(pdf);
  const fields = readBillFields(text);
  const scan = findInjections(text);
  const warnings = [...scan.warnings];

  // Reject: not a bill we can read (no payee or no amount). Still show any attack warnings.
  if (!fields.payee || !fields.amountCents) {
    throw new HttpError(422, "Couldn't find the payee and amount on this bill", { warnings });
  }

  // No due date printed: assume two weeks, and say so
  if (!fields.dueDate) {
    fields.dueDate = addDays(config.today, 14);
    warnings.push(`No due date found on the bill; assumed ${shortDate(fields.dueDate)}.`);
  }

  const bill = addDocumentBill(personaId, {
    payee: fields.payee,
    amountCents: fields.amountCents,
    dueDate: fields.dueDate,
    status: "due",
    source: "document",
    accountId: accountId(personaId, "checking"),
  });

  // The bill itself: untrusted, so it waits for the user (or is blocked if the payee is new)
  const actions: Action[] = [
    proposeAction(
      personaId,
      { source: "untrusted", type: "payment", fromAccount: "checking", payee: bill.payee, amountCents: bill.amountCents, billId: bill.id },
      `From your uploaded bill: ${bill.payee} ${usd(bill.amountCents)}, due ${shortDate(bill.dueDate)}.`,
    ),
  ];

  // Stress test each extra payment the document asks for (once per payee)
  const seen = new Set<string>();
  for (const r of scan.redirects) {
    // Skip: the same payee twice, or the bill's own payee and amount (that's just the bill)
    const key = r.payee.toLowerCase();
    if (seen.has(key) || (key === bill.payee.toLowerCase() && (r.amountCents ?? bill.amountCents) === bill.amountCents)) continue;
    seen.add(key);

    const amountCents = r.amountCents ?? bill.amountCents;
    const action = proposeAction(
      personaId,
      { source: "untrusted", type: "payment", fromAccount: "checking", payee: r.payee, amountCents },
      `Safety check: the document says "${r.quote.slice(0, 120)}". Checked as if the assistant had obeyed.`,
    );
    actions.push(action);

    // e.g. "It asked to send $500 to Account 99-1234, someone you've never paid. That was blocked."
    if (action.status === "denied") {
      warnings.push(`It asked to send ${usd(amountCents)} to ${r.payee}, someone you've never paid. That was blocked.`);
    }
  }

  appendAudit({
    personaId,
    eventType: "document_uploaded",
    actor: { type: "user", personaId },
    summary: `Uploaded a bill: ${bill.payee} ${usd(bill.amountCents)} due ${shortDate(bill.dueDate)}${warnings.length ? `; ${warnings.length} warning(s)` : ""}.`,
    payload: {
      filename: filename.replace(/[^\w.() -]/g, "_").slice(0, 100), // file names are user input: keep them tame
      billId: bill.id,
      extracted: fields,
      warnings,
      redirects: scan.redirects,
      actionIds: actions.map((a) => a.id),
    },
  });

  return { billId: bill.id, extracted: fields, untrusted: true, warnings, actions };
}
