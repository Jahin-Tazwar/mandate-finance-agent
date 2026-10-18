import { beforeEach, describe, expect, it } from "vitest";
import { Action } from "@mandate/shared";
import { proposeAction } from "../src/actions";
import { getBills } from "../src/analytics";
import { createApp } from "../src/app";
import { clearLockouts } from "../src/auth";
import { getAccount, initStore, setAgentEnabled } from "../src/store";
import { signedIn } from "./helpers";

const app = createApp();

beforeEach(() => {
  initStore();
  clearLockouts();
});

const checking = (personaId: string) => getAccount(personaId, "checking").balanceCents;
const savings = (personaId: string) => getAccount(personaId, "savings").balanceCents;

/** The agent asks to pay someone from checking. */
const agentPays = (personaId: string, payee: string, amountCents: number) =>
  proposeAction(personaId, { source: "agent", type: "payment", fromAccount: "checking", payee, amountCents }, "Bill is due soon.");

describe("user actions", () => {
  it("topping up a wish moves checking → savings and shows in the wish's history", async () => {
    const before = { checking: checking("maya"), savings: savings("maya") };
    const res = await signedIn(app, "maya").post("/api/wishes/wish_maya_1/contribute").send({ amountCents: 2_000 }).expect(201);
    const action = Action.parse(res.body);
    expect(action).toMatchObject({ status: "executed", source: "user", summary: "Save $20 for iPhone 17" });

    expect(checking("maya")).toBe(before.checking - 2_000);
    expect(savings("maya")).toBe(before.savings + 2_000);

    const detail = await signedIn(app, "maya").get("/api/wishes/wish_maya_1").expect(200);
    expect(detail.body.wish.savedCents).toBe(15_000 + 2_000);
    expect(detail.body.contributions).toEqual([{ id: "wc_1", date: "2026-10-12", amountCents: 2_000, source: "user", actionId: action.id }]);
  });

  it("someone else's wish → 403, nothing moves", async () => {
    const before = checking("daniel");
    await signedIn(app, "maya").post("/api/wishes/wish_daniel_1/contribute").send({ amountCents: 2_000 }).expect(403);
    expect(checking("daniel")).toBe(before);
  });
});

describe("agent actions: allow, ask, block", () => {
  it("small payment to a known payee runs automatically", () => {
    const before = checking("daniel");
    const action = agentPays("daniel", "Mobi Telecom", 5_500);
    expect(action).toMatchObject({ status: "executed", decision: "allow", tier: "L3" });
    expect(checking("daniel")).toBe(before - 5_500);
  });

  it("over the limit → waits; wrong PIN refused; right PIN executes once", async () => {
    const before = checking("daniel");
    const action = agentPays("daniel", "CityPower", 13_280);
    expect(action.status).toBe("pending_approval");
    expect(action.wishImpact).toBeDefined();
    expect(checking("daniel")).toBe(before); // nothing moved yet

    const daniel = signedIn(app, "daniel");
    const approvals = await daniel.get("/api/personas/daniel/approvals").expect(200);
    expect(approvals.body.map((a: Action) => a.id)).toEqual([action.id]);

    const wrong = await daniel.post(`/api/actions/${action.id}/decision`).send({ decision: "approve", pin: "0000" }).expect(403);
    expect(wrong.body).toEqual({ error: "Wrong PIN", attemptsLeft: 4 });
    expect(checking("daniel")).toBe(before);

    const ok = await daniel.post(`/api/actions/${action.id}/decision`).send({ decision: "approve", pin: "2222" }).expect(200);
    expect(ok.body).toMatchObject({ status: "executed", approvedBy: "daniel" });
    expect(checking("daniel")).toBe(before - 13_280);

    // Approving twice must never pay twice
    await daniel.post(`/api/actions/${action.id}/decision`).send({ decision: "approve", pin: "2222" }).expect(409);
    expect(checking("daniel")).toBe(before - 13_280);
  });

  it("the paid bill shows up as a transaction, filed like earlier CityPower payments", async () => {
    const action = agentPays("daniel", "CityPower", 13_280);
    await signedIn(app, "daniel").post(`/api/actions/${action.id}/decision`).send({ decision: "approve", pin: "2222" }).expect(200);
    const res = await signedIn(app, "daniel").get("/api/personas/daniel/transactions?limit=1").expect(200);
    expect(res.body.items[0]).toMatchObject({ merchant: "CityPower", amountCents: -13_280, category: "utilities", date: "2026-10-12" });
  });

  it("rejecting needs no PIN and moves nothing", async () => {
    const before = checking("daniel");
    const action = agentPays("daniel", "CityPower", 13_280);
    const res = await signedIn(app, "daniel").post(`/api/actions/${action.id}/decision`).send({ decision: "reject" }).expect(200);
    expect(res.body.status).toBe("rejected");
    expect(checking("daniel")).toBe(before);
  });

  it("someone else can't approve your action", async () => {
    const action = agentPays("daniel", "CityPower", 13_280);
    await signedIn(app, "maya").post(`/api/actions/${action.id}/decision`).send({ decision: "approve", pin: "1111" }).expect(403);
  });

  it("5 wrong PINs lock approvals", async () => {
    const action = agentPays("daniel", "CityPower", 13_280);
    const daniel = signedIn(app, "daniel");
    for (let i = 0; i < 4; i++) await daniel.post(`/api/actions/${action.id}/decision`).send({ decision: "approve", pin: "0000" }).expect(403);
    await daniel.post(`/api/actions/${action.id}/decision`).send({ decision: "approve", pin: "0000" }).expect(429);
    await daniel.post(`/api/actions/${action.id}/decision`).send({ decision: "approve", pin: "2222" }).expect(429);
  });

  it("the rules are checked again at approval time (the balance may have changed)", async () => {
    // Daniel first saves everything above $500, so checking = $500
    const daniel = signedIn(app, "daniel");
    await daniel.post("/api/wishes/wish_daniel_1/contribute").send({ amountCents: checking("daniel") - 50_000 }).expect(201);

    // A $299 payment just fits above the $200 floor ($500 − $299 = $201), so it waits for approval...
    const action = agentPays("daniel", "CityPower", 29_900);
    expect(action.status).toBe("pending_approval");
    // ...then the user moves $50 to savings, so it no longer fits
    await signedIn(app, "daniel").post("/api/wishes/wish_daniel_1/contribute").send({ amountCents: 5_000 }).expect(201);

    const res = await signedIn(app, "daniel").post(`/api/actions/${action.id}/decision`).send({ decision: "approve", pin: "2222" }).expect(200);
    expect(res.body.status).toBe("denied");
    expect(res.body.reasons[0]).toMatch(/^Can't do this any more: .*below your \$200 floor/);
  });

  it("paying a bill: the amount must match the bill (a made-up amount or bill is refused)", () => {
    const bill = getBills("daniel")[0]!;
    const pay = (amountCents: number, billId = bill.id) =>
      proposeAction("daniel", { source: "agent", type: "payment", fromAccount: "checking", payee: bill.payee, amountCents, billId });
    expect(() => pay(bill.amountCents * 10)).toThrow(/That bill is/);
    expect(() => pay(bill.amountCents, "bill_nope")).toThrow(/not found/);
    expect(pay(bill.amountCents).status).not.toBe("denied");
  });

  it("a document can't add a new payee: blocked, never offered for approval", async () => {
    const action = proposeAction("daniel", { source: "untrusted", type: "payment", fromAccount: "checking", payee: "Account 99-1234", amountCents: 50_000 });
    expect(action.status).toBe("denied");
    const approvals = await signedIn(app, "daniel").get("/api/personas/daniel/approvals").expect(200);
    expect(approvals.body).toEqual([]);
    const all = await signedIn(app, "daniel").get("/api/personas/daniel/actions").expect(200);
    expect(all.body[0].id).toBe(action.id);
  });

  it("the daily cap counts what the agent really moved: the 6th $99 payment is blocked", () => {
    // $99.00, $99.01, $99.02...: different amounts, so the duplicate rule doesn't stop them first
    const statuses = Array.from({ length: 6 }, (_, i) => agentPays("daniel", "Mobi Telecom", 9_900 + i).status);
    expect(statuses).toEqual(["executed", "executed", "executed", "executed", "executed", "denied"]);
  });

  it("kill switch: the agent's proposals are blocked", () => {
    setAgentEnabled("daniel", false);
    expect(agentPays("daniel", "Mobi Telecom", 1_000).status).toBe("denied");
  });

  it("every step is in the audit log, and the chain still verifies", async () => {
    const action = agentPays("daniel", "CityPower", 13_280);
    await signedIn(app, "daniel").post(`/api/actions/${action.id}/decision`).send({ decision: "approve", pin: "2222" }).expect(200);
    const log = await signedIn(app, "daniel").get("/api/audit?limit=2").expect(200);
    expect(log.body.map((e: { eventType: string }) => e.eventType)).toEqual(["action_approved", "action_pending_approval"]);
    const verify = await signedIn(app, "daniel").get("/api/audit/verify").expect(200);
    expect(verify.body.valid).toBe(true);
  });
});

describe("red team: paying the same bill twice", () => {
  const approve = (id: string) => signedIn(app, "daniel").post(`/api/actions/${id}/decision`).send({ decision: "approve", pin: "2222" }).expect(200);

  it("'pay my phone bill' three times: paid once, the repeats are blocked", () => {
    const before = checking("maya");
    const statuses = Array.from({ length: 3 }, () => agentPays("maya", "Mobi Telecom", 3_500));
    expect(statuses.map((a) => a.status)).toEqual(["executed", "denied", "denied"]);
    expect(statuses[1]!.reasons[0]).toBe("You already paid Mobi Telecom $35 today. MoneyWise won't pay the same bill twice.");
    expect(checking("maya")).toBe(before - 3_500);
  });

  it("the same name in different letter case is still the same payee", () => {
    agentPays("maya", "Mobi Telecom", 3_500);
    expect(agentPays("maya", "  mobi TELECOM ", 3_500).status).toBe("denied");
  });

  it("paying a bill by its id, then again without the id: paid once", () => {
    const bill = getBills("aisha").find((b) => b.payee === "CityPower")!;
    const before = checking("aisha");
    const pay = (billId?: string) =>
      proposeAction("aisha", { source: "agent", type: "payment", fromAccount: "checking", payee: bill.payee, amountCents: bill.amountCents, ...(billId ? { billId } : {}) });

    expect(pay(bill.id).status).toBe("executed");
    expect(pay().status).toBe("denied");
    expect(() => pay(bill.id)).toThrow(); // the paid bill is gone from the list (404) or blocked: never paid twice
    expect(checking("aisha")).toBe(before - bill.amountCents);
  });

  it("over the $100 limit three times: one approval card, the repeats are blocked", async () => {
    const bill = getBills("daniel").find((b) => b.payee === "CityPower")!;
    const before = checking("daniel");
    const cards = Array.from({ length: 3 }, () =>
      proposeAction("daniel", { source: "agent", type: "payment", fromAccount: "checking", payee: "CityPower", amountCents: 13_280, billId: bill.id }),
    );
    expect(cards.map((a) => a.status)).toEqual(["pending_approval", "denied", "denied"]);
    expect(cards[1]!.reasons[0]).toMatch(/^A payment of CityPower \$132\.80 is already waiting for your approval/);

    const approvals = await signedIn(app, "daniel").get("/api/personas/daniel/approvals").expect(200);
    expect(approvals.body).toHaveLength(1);

    await approve(cards[0]!.id);
    expect(checking("daniel")).toBe(before - 13_280);
  });

  it("approval re-check: the user paid it themselves meanwhile, so approving the card moves nothing", async () => {
    const before = checking("daniel");
    const card = agentPays("daniel", "CityPower", 13_280);
    expect(card.status).toBe("pending_approval");

    // The user pays the same bill by hand: allowed (people sometimes mean it), with a heads-up
    const own = proposeAction("daniel", { source: "user", type: "payment", fromAccount: "checking", payee: "CityPower", amountCents: 13_280 });
    expect(own.status).toBe("executed");
    expect(own.reasons[1]).toMatch(/^Heads up: A payment of CityPower \$132\.80 is already waiting/);

    const res = await approve(card.id);
    expect(res.body.status).toBe("denied");
    expect(res.body.reasons[0]).toBe("Can't do this any more: You already paid CityPower $132.80 today. MoneyWise won't pay the same bill twice.");
    expect(checking("daniel")).toBe(before - 13_280); // once, by the user
  });

  it("the user's own repeat payment goes through, with a heads-up", () => {
    const pay = () => proposeAction("maya", { source: "user", type: "payment", fromAccount: "checking", payee: "Mobi Telecom", amountCents: 3_500 });
    pay();
    const again = pay();
    expect(again.status).toBe("executed");
    expect(again.reasons).toEqual(["You asked for this yourself, and it fits your rules.", "Heads up: You already paid Mobi Telecom $35 today."]);
  });

  it("a document repeating a bill that's already waiting: blocked", () => {
    const fromDoc = () => proposeAction("daniel", { source: "untrusted", type: "payment", fromAccount: "checking", payee: "CityPower", amountCents: 13_280 });
    expect(fromDoc().status).toBe("pending_approval");
    expect(fromDoc().status).toBe("denied");
  });

  it("a rejected or blocked payment doesn't count: asking again later is fine", async () => {
    const card = agentPays("daniel", "CityPower", 13_280);
    await signedIn(app, "daniel").post(`/api/actions/${card.id}/decision`).send({ decision: "reject" }).expect(200);
    expect(agentPays("daniel", "CityPower", 13_280).status).toBe("pending_approval");
  });
});
