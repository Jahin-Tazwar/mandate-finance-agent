import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { appendAudit, auditEntries, verifyChain } from "../src/audit";
import { createApp } from "../src/app";
import { signedIn } from "./helpers";
import { initStore } from "../src/store";

beforeEach(() => {
  initStore(); // also starts a fresh audit log
});

const event = (summary: string) => ({
  personaId: "maya",
  eventType: "test",
  actor: { type: "system" as const },
  summary,
  payload: { n: summary.length },
});

describe("audit hash chain", () => {
  it("starts with a seed_loaded entry linked to 64 zeros", () => {
    const [first] = auditEntries();
    expect(first).toMatchObject({ seq: 1, eventType: "seed_loaded", prevHash: "0".repeat(64) });
    expect(first!.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("each entry points at the one before it", () => {
    appendAudit(event("one"));
    appendAudit(event("two"));
    const all = auditEntries();
    expect(all[1]!.prevHash).toBe(all[0]!.hash);
    expect(all[2]!.prevHash).toBe(all[1]!.hash);
    expect(verifyChain()).toEqual({ valid: true, entries: 3, brokenAt: null });
  });

  it("editing an old entry is detected, at that entry", () => {
    appendAudit(event("pay $35"));
    appendAudit(event("pay $40"));
    // Someone quietly changes entry #2 in a copy of the log
    const tampered = auditEntries().map((e) => ({ ...e }));
    tampered[1] = { ...tampered[1]!, summary: "pay $3,500" };
    expect(verifyChain(tampered)).toEqual({ valid: false, entries: 3, brokenAt: 2 });
  });

  it("deleting an entry is detected (the next one no longer links)", () => {
    appendAudit(event("a"));
    appendAudit(event("b"));
    const withGap = auditEntries().filter((e) => e.seq !== 2);
    expect(verifyChain(withGap).valid).toBe(false);
  });

  it("a reset starts a fresh, valid chain", () => {
    appendAudit(event("x"));
    initStore();
    expect(auditEntries()).toHaveLength(1);
    expect(verifyChain().valid).toBe(true);
  });
});

describe("audit API", () => {
  const app = createApp();

  it("logs wish changes and verifies", async () => {
    await signedIn(app, "maya").patch("/api/wishes/wish_maya_1").send({ paused: true }).expect(200);

    const res = await signedIn(app, "maya").get("/api/audit?personaId=maya").expect(200);
    expect(res.body[0]).toMatchObject({ eventType: "wish_updated", summary: 'Changed wish "iPhone 17": paused.' });

    const verify = await request(app).get("/api/audit/verify").expect(200);
    expect(verify.body).toEqual({ valid: true, entries: 2, brokenAt: null });
  });
});
