import { beforeEach, describe, expect, it } from "vitest";
import { Mandate } from "@mandate/shared";
import { proposeAction } from "../src/actions";
import { createApp } from "../src/app";
import { clearLockouts } from "../src/auth";
import { compileMandate } from "../src/policy/compile";
import { defaultMandate } from "../src/policy/mandate";
import { initStore } from "../src/store";
import { signedIn } from "./helpers";

const app = createApp();

beforeEach(() => {
  initStore();
  clearLockouts();
});

describe("rule compiler (plain English → rules, no AI)", () => {
  it("reads every persona's starting rules back exactly", () => {
    for (const id of ["maya", "daniel", "aisha"]) {
      const m = defaultMandate(id, "x");
      expect(compileMandate(m.naturalLanguage)).toEqual({ policy: m.policy, warnings: [] });
    }
  });

  it("understands other ways of saying it", () => {
    const { policy } = compileMandate(
      "Keep at least $500 in checking. Never pay more than $1,000 at once. New payees need my approval and wait 48 hours. " +
        "At most $300 per day. On payday, move checking above $2,000 into savings. Ask me about everything else.",
    );
    expect(policy).toEqual({
      defaultTier: "L2",
      rules: [
        { type: "balance_floor", account: "checking", minCents: 50_000 },
        { type: "amount_cap", perTxCents: 100_000, aboveTier: "L0" }, // "never" over $1,000 = blocked
        { type: "new_payee", tier: "L2", cooldownHours: 48 },
        { type: "daily_cap", maxCents: 30_000 },
        { type: "sweep", trigger: "income_detected", from: "checking", to: "savings", keepCents: 200_000, tier: "L3" },
      ],
    });
  });

  it("reports what it didn't understand instead of guessing", () => {
    const { policy, warnings } = compileMandate("Pay my bills. Buy me a car!");
    expect(policy.rules).toEqual([]);
    expect(warnings).toContain('Not understood, so it was left out: "Pay my bills"');
    expect(warnings).toContain('Not understood, so it was left out: "Buy me a car"');
  });

  it("warns about risky rules: no floor, no daily limit, everything automatic", () => {
    const { warnings } = compileMandate("Do everything else automatically.");
    expect(warnings.join(" ")).toMatch(/no minimum balance.*no daily limit.*happen automatically/s);
  });

  it("new payees can never be made automatic, even if the text says so", () => {
    const { policy } = compileMandate("Pay anyone new automatically.");
    expect(policy.rules).toEqual([{ type: "new_payee", tier: "L2", cooldownHours: 24 }]);
  });
});

describe("compile → review → sign", () => {
  const maya = () => signedIn(app, "maya");
  const text = "Never let my checking go below $300. Ask me before any payment over $20 or to anyone new. Never move more than $200 a day. Save up to $50 for my wishes every payday.";

  it("compile shows the rules and saves nothing", async () => {
    const res = await maya().post("/api/personas/maya/mandate/compile").send({ text }).expect(200);
    expect(res.body.summary).toContain("Checking never goes below $300.");
    expect(res.body.warnings).toEqual([]);
    const current = await maya().get("/api/personas/maya/mandate").expect(200);
    expect(current.body.version).toBe(1);
  });

  it("signing needs the PIN, makes version 2, and the new rules apply at once", async () => {
    // Under the starting rules, a $35 phone bill is automatic
    expect(proposeAction("maya", { source: "agent", type: "payment", fromAccount: "checking", payee: "Mobi Telecom", amountCents: 3_500 }).status).toBe("executed");

    await maya().post("/api/personas/maya/mandate/sign").send({ naturalLanguage: text, pin: "0000" }).expect(403);
    const res = await maya().post("/api/personas/maya/mandate/sign").send({ naturalLanguage: text, pin: "1111" }).expect(200);
    expect(Mandate.parse(res.body)).toMatchObject({ version: 2, signedBy: "maya" });

    // Now the limit is $20, so a $30 payment waits for approval
    // (not $35 again: that would be blocked as paying the same bill twice)
    const after = proposeAction("maya", { source: "agent", type: "payment", fromAccount: "checking", payee: "Mobi Telecom", amountCents: 3_000 });
    expect(after.status).toBe("pending_approval");
    expect(after.reasons[0]).toBe("$30 is over your $20 limit per payment.");
  });

  it("a policy sent by the browser is ignored: the server compiles the text itself", async () => {
    const sneaky = { naturalLanguage: text, pin: "1111", policy: { defaultTier: "L3", rules: [] } };
    const res = await maya().post("/api/personas/maya/mandate/sign").send(sneaky).expect(200);
    expect(res.body.policy.defaultTier).toBe("L2");
    expect(res.body.policy.rules).toHaveLength(5);
  });

  it("signing is in the audit log; nobody else can sign your rules", async () => {
    await maya().post("/api/personas/maya/mandate/sign").send({ naturalLanguage: text, pin: "1111" }).expect(200);
    const log = await maya().get("/api/audit?limit=1").expect(200);
    expect(log.body[0]).toMatchObject({ eventType: "mandate_signed" });
    expect(log.body[0].summary).toMatch(/^Signed new rules \(version 2\) with PIN: Checking never goes below \$300\./);

    await signedIn(app, "daniel").post("/api/personas/maya/mandate/sign").send({ naturalLanguage: text, pin: "1111" }).expect(403);
  });
});
