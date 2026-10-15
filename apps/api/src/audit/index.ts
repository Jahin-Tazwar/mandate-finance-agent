import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config";

/**
 * THE AUDIT LOG: an append-only list of everything that happened.
 * Each entry stores the previous entry's hash (fingerprint), and its own hash
 * covers that too. Change any old entry and every hash after it stops matching,
 * so tampering is easy to detect (verifyChain).
 */

/** Who did it: the user, the agent, or the system itself. */
export interface Actor {
  type: "user" | "agent" | "system";
  personaId?: string;
}

export interface AuditEntry {
  seq: number;
  ts: string;
  personaId: string | null;
  eventType: string; // e.g. "wish_created", "policy_check", "seed_loaded"
  actor: Actor;
  summary: string; // one plain sentence, e.g. "Blocked transfer of $500 to a new payee"
  payload: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

/** What callers provide; the log adds seq, time and hashes. */
export type AuditEvent = Omit<AuditEntry, "seq" | "ts" | "prevHash" | "hash">;

/** The "previous hash" of the very first entry: 64 zeros. */
const GENESIS_HASH = "0".repeat(64);

let entries: AuditEntry[] = [];

/**
 * JSON with object keys always in the same (sorted) order, so the same entry
 * always produces exactly the same text, and therefore the same hash.
 * e.g. { b: 1, a: 2 } → '{"a":2,"b":1}'
 */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`);
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 of the previous hash + this entry's content (everything except its own hash). */
export function hashEntry(entry: Omit<AuditEntry, "hash">): string {
  const { prevHash, ...content } = entry;
  return createHash("sha256").update(prevHash + stableJson(content)).digest("hex");
}

/** Adds one entry to the end of the log and returns it. */
export function appendAudit(event: AuditEvent): AuditEntry {
  const prevHash = entries.at(-1)?.hash ?? GENESIS_HASH;
  const withoutHash = { ...event, seq: entries.length + 1, ts: new Date().toISOString(), prevHash };
  const entry: AuditEntry = { ...withoutHash, hash: hashEntry(withoutHash) };
  entries.push(entry);

  // Also append it to a file (best effort: a disk problem must never stop the app)
  if (config.auditFile) {
    try {
      fs.mkdirSync(path.dirname(config.auditFile), { recursive: true });
      fs.appendFileSync(config.auditFile, JSON.stringify(entry) + "\n");
    } catch {
      // ignore: the in-memory log is the one that counts
    }
  }
  return entry;
}

/** Starts a new, empty log (used when the demo data is reset). */
export function resetAudit(): void {
  entries = [];
}

/** All entries, oldest first. Read-only. */
export function auditEntries(): readonly AuditEntry[] {
  return entries;
}

/** Entries newest first, optionally for one persona. */
export function listAudit(personaId?: string, limit = 100): AuditEntry[] {
  const matching = personaId ? entries.filter((e) => e.personaId === personaId) : entries;
  return matching.slice(-limit).reverse();
}

/**
 * Checks the whole chain: every entry must point at the previous entry's hash,
 * and its own hash must match its content.
 * Returns where it first breaks, e.g. { valid: false, entries: 42, brokenAt: 17 }.
 */
export function verifyChain(list: readonly AuditEntry[] = entries): { valid: boolean; entries: number; brokenAt: number | null } {
  let expectedPrev = GENESIS_HASH;
  for (const entry of list) {
    const { hash, ...withoutHash } = entry;

    // Broken: the link to the previous entry doesn't match, or the content was changed
    if (entry.prevHash !== expectedPrev || hashEntry(withoutHash) !== hash) {
      return { valid: false, entries: list.length, brokenAt: entry.seq };
    }
    expectedPrev = hash;
  }
  return { valid: true, entries: list.length, brokenAt: null };
}
