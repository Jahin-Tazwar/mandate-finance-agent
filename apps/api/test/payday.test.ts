import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { Action } from "@mandate/shared";
import { createApp } from "../src/app";
import { clearLockouts } from "../src/auth";
import { getAccount, initStore } from "../src/store";
import { signedIn } from "./helpers";

const app = createApp();

beforeEach(() => {
  initStore();
  clearLockouts();
});

const runPayday = (personaId: string) => signedIn(app, personaId).post(`/api/personas/${personaId}/agent/run`).send({ trigger: "payday" });
const lines = (actions: Action[]) => actions.map((a) => `${a.status}: ${a.summary}`);

describe("Run payday", () => {
  it("Maya: pay lands, phone bill paid, $40.39 saved for the iPhone, unused gym waits for her", async () => {
    const before = getAccount("maya", "checking").balanceCents;
    const res = await runPayday("maya").expect(200);

    expect(res.body.paycheck).toMatchObject({ amountCents: 28_475, category: "income", date: "2026-10-12" });
    expect(lines(res.body.actions)).toEqual([
      "executed: Pay Mobi Telecom $35",
      "executed: Save $40.39 for iPhone 17",
      "executed: Save $6.67 for Trip to Kyoto",
      "pending_approval: Cancel FitZone",
    ]);
    // +$284.75 pay − $35 bill − $40.39 − $6.67 saved
    expect(getAccount("maya", "checking").balanceCents).toBe(before + 28_475 - 3_500 - 4_039 - 667);
  });

  it("Daniel: only bills due before his next payday (rent on Nov 1 waits), and the duplicate charge is flagged", async () => {
    const res = await runPayday("daniel").expect(200);
    const summaries = res.body.actions.map((a: Action) => a.summary);
    expect(summaries).not.toContain("Pay Harbor View Apartments $1,450");
    expect(lines(res.body.actions)).toContain("pending_approval: Pay CityPower $132.80");
    expect(lines(res.body.actions)).toContain("pending_approval: Dispute TechStore charge of $129.99 on Sep 14");
  });

  it("running it twice pays nothing twice: no second paycheck, no repeated actions", async () => {
    await runPayday("maya").expect(200);
    const again = await runPayday("maya").expect(200);
    expect(again.body).toEqual({ paycheck: null, actions: [] });
  });

  it("the wish detail shows the agent's saving", async () => {
    await runPayday("maya").expect(200);
    const res = await signedIn(app, "maya").get("/api/wishes/wish_maya_1").expect(200);
    expect(res.body.contributions).toMatchObject([{ amountCents: 4_039, source: "agent" }]);
  });

  it("is recorded in the audit log", async () => {
    await runPayday("maya").expect(200);
    const log = await signedIn(app, "maya").get("/api/audit?limit=1").expect(200);
    expect(log.body[0].summary).toBe("Payday run: pay landed (+$284.75); 4 action(s): 3 done, 1 waiting, 0 blocked.");
  });

  it("needs your own session, and only knows the payday trigger", async () => {
    await request(app).post("/api/personas/maya/agent/run").send({ trigger: "payday" }).expect(401);
    await signedIn(app, "daniel").post("/api/personas/maya/agent/run").send({ trigger: "payday" }).expect(403);
    await runPayday("maya").send({ trigger: "midnight" }).expect(400);
  });
});

describe("kill switch", () => {
  const kill = (personaId: string, body: object) => signedIn(app, personaId).post(`/api/personas/${personaId}/killswitch`).send(body);

  it("stopping needs no PIN; then payday can't act (everything blocked), but pay still lands", async () => {
    await kill("maya", { enabled: true }).expect(200, { enabled: true });
    const state = await signedIn(app, "maya").get("/api/personas/maya/killswitch").expect(200);
    expect(state.body).toEqual({ enabled: true });

    const res = await runPayday("maya").expect(200);
    expect(res.body.paycheck).not.toBeNull();
    expect(res.body.actions.every((a: Action) => a.status === "denied")).toBe(true);
    expect(res.body.actions[0].reasons[0]).toMatch(/switched off/);
  });

  it("starting again needs the PIN; after that payday works", async () => {
    await kill("maya", { enabled: true }).expect(200);
    await kill("maya", { enabled: false }).expect(403); // no PIN
    await kill("maya", { enabled: false, pin: "0000" }).expect(403); // wrong PIN
    await kill("maya", { enabled: false, pin: "1111" }).expect(200, { enabled: false });

    const res = await runPayday("maya").expect(200);
    expect(res.body.actions.some((a: Action) => a.status === "executed")).toBe(true);
  });

  it("blocked actions can be retried once the agent is back on (they don't count as done)", async () => {
    await kill("maya", { enabled: true }).expect(200);
    await runPayday("maya").expect(200);
    await kill("maya", { enabled: false, pin: "1111" }).expect(200);
    const res = await runPayday("maya").expect(200);
    expect(res.body.paycheck).toBeNull(); // pay already landed the first time
    expect(lines(res.body.actions)).toContain("executed: Save $40.39 for iPhone 17");
  });
});
