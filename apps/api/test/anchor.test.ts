import request from "supertest";
import { fromHex, type Hex, toHex } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setChainForTests } from "../src/anchor";
import { createApp } from "../src/app";
import { auditEntries } from "../src/audit";
import { initStore } from "../src/store";
import { signedIn } from "./helpers";

const app = createApp();
const TX = (n: number) => `0x${String(n).padStart(64, "0")}`;

/** A fake test chain: remembers what was "sent", and can read it back by tx hash. */
function fakeChain() {
  const sent = new Map<string, Hex>();
  setChainForTests({
    send: async (data) => {
      const txHash = TX(sent.size + 1);
      sent.set(txHash, data);
      return txHash;
    },
    read: async (txHash) => sent.get(txHash) ?? null,
  });
  return sent;
}

beforeEach(() => {
  initStore();
});
afterEach(() => {
  setChainForTests(null);
  vi.useRealTimers();
});

const anchor = () => signedIn(app, "maya").post("/api/audit/anchor");

describe("on-chain anchoring", () => {
  it("not set up → 503 to anchor, and an empty public list", async () => {
    await anchor().expect(503);
    await request(app).get("/api/anchors").expect(200, []);
    const status = await request(app).get("/api/anchors/status").expect(200);
    expect(status.body).toEqual({ enabled: false, chain: "base-sepolia" });
  });

  it("publishes the log's latest fingerprint as readable text, and the log records it", async () => {
    const sent = fakeChain();
    const head = auditEntries().at(-1)!;
    const res = await anchor().expect(200);

    expect(res.body.anchor).toMatchObject({ seq: head.seq, hash: head.hash, chain: "base-sepolia", txHash: TX(1), explorerUrl: `https://sepolia.basescan.org/tx/${TX(1)}` });
    // What's on the chain: plain text anyone can read on the explorer
    expect(fromHex(sent.get(TX(1))!, "string")).toBe(`mandate-audit:v1:${head.seq}:${head.hash}`);
    expect(auditEntries().at(-1)).toMatchObject({ eventType: "audit_anchored", payload: { seq: head.seq, txHash: TX(1) } });

    const list = await request(app).get("/api/anchors").expect(200);
    expect(list.body).toMatchObject([{ seq: head.seq, matchesLog: true }]);
  });

  it("at most once a minute; after that, the next anchor covers the newer entries", async () => {
    fakeChain();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T20:00:00Z"));
    const first = await anchor().expect(200);

    const tooSoon = await anchor().expect(429);
    expect(tooSoon.body.retryAfterSeconds).toBeGreaterThan(0);

    vi.setSystemTime(new Date("2026-10-16T20:01:05Z"));
    const second = await anchor().expect(200);
    expect(second.body.anchor.seq).toBeGreaterThan(first.body.anchor.seq); // includes the "anchored" entry itself
  });

  it("check reads the CHAIN and compares with the log: match, mismatch, missing", async () => {
    const sent = fakeChain();
    const { body } = await anchor().expect(200);

    const ok = await request(app).get(`/api/anchors/${body.anchor.txHash}/check`).expect(200);
    expect(ok.body).toEqual({ txHash: TX(1), onChain: true, seq: body.anchor.seq, hash: body.anchor.hash, matchesLog: true });

    // A transaction claiming a different fingerprint for the same entry → doesn't match the log
    sent.set(TX(9), toHex(`mandate-audit:v1:${body.anchor.seq}:${"f".repeat(64)}`));
    const bad = await request(app).get(`/api/anchors/${TX(9)}/check`).expect(200);
    expect(bad.body.matchesLog).toBe(false);

    const missing = await request(app).get(`/api/anchors/${TX(7)}/check`).expect(200);
    expect(missing.body).toMatchObject({ onChain: false, matchesLog: false });

    await request(app).get("/api/anchors/0x123/check").expect(400);
  });

  it("anchoring needs a session; a demo reset clears the anchors (the log they point at is gone)", async () => {
    fakeChain();
    await request(app).post("/api/audit/anchor").expect(401);
    await anchor().expect(200);
    initStore();
    await request(app).get("/api/anchors").expect(200, []);
  });
});

describe("when the network refuses", () => {
  it("→ 502 with a clear message, and a retry is allowed at once", async () => {
    let fail = true;
    setChainForTests({
      send: async () => {
        if (fail) throw new Error("insufficient funds for gas");
        return TX(1);
      },
      read: async () => null,
    });
    const res = await anchor().expect(502);
    expect(res.body.error).toMatch(/test ETH/);
    fail = false;
    await anchor().expect(200);
  });
});
