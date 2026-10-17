import { type Hex, createPublicClient, createWalletClient, fromHex, http, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, sepolia } from "viem/chains";
import { appendAudit, auditEntries } from "../audit";
import { config } from "../config";
import { HttpError } from "../http/errors";

/**
 * ON-CHAIN ANCHORING. The audit log proves nothing was edited, as long as you trust our
 * server. Anchoring removes that "as long as": every so often, the log's latest fingerprint
 * (hash) is published on a public TEST blockchain, where nobody (including us) can change
 * or delete it, with a timestamp. Each entry's hash covers every entry before it, so one
 * hash stands for the whole history up to that point.
 *
 * Anyone can check it: open the transaction on the explorer, read the text
 *   moneywise-audit:v1:42:5be1…   (entry #42, its hash)
 * and compare it with entry #42 of the log.
 */

/** One published fingerprint. */
export interface Anchor {
  /** The audit entry anchored, e.g. 42 (= the whole log up to #42). */
  seq: number;
  hash: string;
  chain: "base-sepolia" | "sepolia";
  txHash: string;
  explorerUrl: string;
  anchoredAt: string;
}

/** Test chains only: there's no way to point this at real money. */
const CHAINS = {
  "base-sepolia": { chain: baseSepolia, explorer: "https://sepolia.basescan.org/tx/" },
  sepolia: { chain: sepolia, explorer: "https://sepolia.etherscan.io/tx/" },
} as const;

/** At most one anchor a minute (each one is a transaction). */
const MIN_GAP_MS = 60_000;

/** The text written on-chain, e.g. "moneywise-audit:v1:42:5be1…". */
const payloadFor = (seq: number, hash: string) => `moneywise-audit:v1:${seq}:${hash}`;

/** How we talk to the chain: send a payload, read one back. Tests replace it with a fake. */
export interface ChainClient {
  send(data: Hex): Promise<string>;
  read(txHash: string): Promise<Hex | null>;
}

/** The real chain client: a 0-value transaction to our own address, with the text as its data. */
function realClient(): ChainClient {
  const { chain } = CHAINS[config.anchor.chain];
  const account = privateKeyToAccount(config.anchor.privateKey as Hex);
  const transport = http(config.anchor.rpcUrl ?? undefined); // empty = the chain's public endpoint
  const wallet = createWalletClient({ account, chain, transport });
  const reader = createPublicClient({ chain, transport });
  return {
    send: (data) => wallet.sendTransaction({ to: account.address, value: 0n, data }),
    read: async (txHash) => {
      const tx = await reader.getTransaction({ hash: txHash as Hex }).catch(() => null);
      return tx?.input ?? null;
    },
  };
}

let fakeClient: ChainClient | null = null;

/** Tests: use a fake chain. Pass null to go back to the real one. */
export function setChainForTests(fake: ChainClient | null) {
  fakeClient = fake;
}

/** True if anchoring can work: a key is set (or a fake chain in tests). */
export const anchoringReady = () => fakeClient !== null || Boolean(config.anchor.privateKey);

const client = () => fakeClient ?? realClient();

let anchors: Anchor[] = [];
let lastSentAt = 0;

/** Clears the anchors (the log they point at was reset). */
export function resetAnchors(): void {
  anchors = [];
  lastSentAt = 0;
}

/** Every anchor, newest first, with whether it still matches the log. */
export function listAnchors(): (Anchor & { matchesLog: boolean })[] {
  const log = auditEntries();
  return [...anchors].reverse().map((a) => ({ ...a, matchesLog: log.find((e) => e.seq === a.seq)?.hash === a.hash }));
}

/**
 * Publishes the log's latest fingerprint. Returns the new anchor, or null if nothing
 * new happened since the last one. Throws 503 (not set up) or 429 (too soon).
 */
export async function anchorNow(trigger: "manual" | "scheduled"): Promise<Anchor | null> {
  // Reject: no wallet configured
  if (!anchoringReady()) throw new HttpError(503, "On-chain anchoring isn't set up (no ANCHOR_PRIVATE_KEY on the server)");

  // Reject: one a minute at most
  const waitMs = lastSentAt + MIN_GAP_MS - Date.now();
  if (waitMs > 0) throw new HttpError(429, "Anchored less than a minute ago", { retryAfterSeconds: Math.ceil(waitMs / 1000) });

  // Skip: nothing new since the last anchor
  const head = auditEntries().at(-1);
  const last = anchors.at(-1);
  if (!head || (last && last.seq === head.seq)) return null;

  lastSentAt = Date.now();
  let txHash: string;
  try {
    txHash = await client().send(toHex(payloadFor(head.seq, head.hash)));
  } catch (err) {
    // Reject: the network refused it (most often: the wallet has no test ETH yet). Retry allowed at once.
    lastSentAt = 0;
    console.error(`Anchoring: ${(err as Error).message.split("\n")[0]}`);
    throw new HttpError(502, "The test network refused the anchoring transaction (does the wallet have test ETH?)");
  }
  const { explorer } = CHAINS[config.anchor.chain];
  const anchor: Anchor = { seq: head.seq, hash: head.hash, chain: config.anchor.chain, txHash, explorerUrl: `${explorer}${txHash}`, anchoredAt: new Date().toISOString() };
  anchors.push(anchor);

  // The log records its own anchoring (this becomes the next entry, anchored next time)
  appendAudit({
    personaId: null,
    eventType: "audit_anchored",
    actor: { type: "system" },
    summary: `Published the log's fingerprint up to entry #${head.seq} on ${config.anchor.chain} (${trigger}).`,
    payload: { seq: head.seq, hash: head.hash, txHash, chain: config.anchor.chain },
  });
  return anchor;
}

/**
 * Checks an anchor against the CHAIN itself (not our own copy): reads the transaction,
 * decodes its text, and compares it with the log.
 */
export async function checkAnchor(txHash: string): Promise<{ txHash: string; onChain: boolean; seq: number | null; hash: string | null; matchesLog: boolean }> {
  if (!anchoringReady()) throw new HttpError(503, "On-chain anchoring isn't set up");

  const data = await client().read(txHash);
  // e.g. "moneywise-audit:v1:42:5be1…" → seq 42, hash "5be1…"
  const text = data ? fromHex(data, "string") : "";
  const match = /^moneywise-audit:v1:(\d+):([0-9a-f]{64})$/.exec(text);
  if (!match) return { txHash, onChain: data !== null, seq: null, hash: null, matchesLog: false };

  const seq = Number(match[1]);
  const hash = match[2]!;
  return { txHash, onChain: true, seq, hash, matchesLog: auditEntries().find((e) => e.seq === seq)?.hash === hash };
}
