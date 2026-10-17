import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RuleSuggestion } from "@mandate/shared";
import { type ModelMessage, setModelForTests } from "../src/agent/llm";
import { createApp } from "../src/app";
import { EXAMPLE_PHRASINGS, compileMandate, notUnderstood } from "../src/policy/compile";
import { initStore } from "../src/store";
import { signedIn } from "./helpers";

const app = createApp();

beforeEach(() => {
  initStore();
});
afterEach(() => {
  setModelForTests(null);
});

/**
 * A fake model that answers with `reply` (a JSON object, or raw text) and records
 * what it was sent, so tests can check the prompt.
 */
function fakeModel(reply: object | string) {
  const seen: ModelMessage[][] = [];
  setModelForTests(async (messages) => {
    seen.push(messages);
    return { content: typeof reply === "string" ? reply : JSON.stringify(reply), toolCalls: [], model: "fake" };
  });
  return seen;
}

/** Maya asks for help with these sentences → the suggestions. */
async function explain(sentences: string[]) {
  const res = await signedIn(app, "maya").post("/api/personas/maya/mandate/explain").send({ sentences }).expect(200);
  return RuleSuggestion.array().parse(res.body.suggestions);
}

describe("the phrasings the AI may use", () => {
  it("every example compiles to exactly its kind of rule (so the prompt never teaches a broken phrasing)", () => {
    for (const { rule, examples } of EXAMPLE_PHRASINGS) {
      for (const example of examples) {
        const { policy, warnings } = compileMandate(example);
        expect(notUnderstood(warnings)).toEqual([]);
        if (rule === "default") expect(policy.rules).toEqual([]);
        else expect(policy.rules.map((r) => r.type)).toEqual([rule]);
      }
    }
  });
});

describe("compile lists what it didn't understand", () => {
  it("notUnderstood sits alongside warnings", async () => {
    const res = await signedIn(app, "maya")
      .post("/api/personas/maya/mandate/compile")
      .send({ text: "Never let my checking go below $200. Don't let me go broke. No more than $200 a month on dining." })
      .expect(200);
    expect(res.body.notUnderstood).toEqual(["Don't let me go broke", "No more than $200 a month on dining"]);
    expect(res.body.warnings).toContain('Not understood, so it was left out: "Don\'t let me go broke"');
  });
});

describe("POST /api/personas/:id/mandate/explain", () => {
  it("a fixable sentence: the rewrite compiles cleanly and comes with what it means", async () => {
    fakeModel({ suggestions: [{ rewrite: "Never let my checking go below $100.", explanation: "MoneyWise needs a number: this keeps at least $100 in checking." }] });
    const [s] = await explain(["Don't let me go broke"]);
    expect(s).toEqual({
      original: "Don't let me go broke",
      rewrite: "Never let my checking go below $100.",
      explanation: "MoneyWise needs a number: this keeps at least $100 in checking.",
      summary: ["Checking never goes below $100."],
      warnings: [],
    });
  });

  it("a rewrite the compiler still can't read is dropped (code checks the AI)", async () => {
    fakeModel({ suggestions: [{ rewrite: "Please always keep me financially safe.", explanation: "Clearer." }] });
    const [s] = await explain(["Don't let me go broke"]);
    expect(s).toMatchObject({ rewrite: null, summary: [] });
    expect(s!.explanation).toMatch(/rule checker understands/);
  });

  it("an unsupported rule (a category budget): no rewrite, the explanation says so", async () => {
    fakeModel({ suggestions: [{ rewrite: null, explanation: "MoneyWise can't enforce budgets per category yet." }] });
    const [s] = await explain(["Max $200 a month on dining"]);
    expect(s).toEqual({ original: "Max $200 a month on dining", rewrite: null, explanation: "MoneyWise can't enforce budgets per category yet.", summary: [], warnings: [] });
  });

  it("a risky rewrite (everything automatic) is shown WITH its risk warning", async () => {
    fakeModel({ suggestions: [{ rewrite: "Do everything else automatically.", explanation: "This lets the agent act alone." }] });
    const [s] = await explain(["Just handle it all for me"]);
    expect(s!.summary).toEqual(["Anything else happens automatically."]);
    expect(s!.warnings).toEqual([`Anything not covered by a rule will happen automatically. That's risky; "ask me about everything else" is safer.`]);
  });

  it("answers each sentence in order, and only the missing-rule warnings for a whole rule set are left out", async () => {
    fakeModel({
      suggestions: [
        { rewrite: "Ask me before any payment over $50.", explanation: "Big payments wait for you." },
        { rewrite: null, explanation: "MoneyWise can't limit spending to weekdays yet." },
      ],
    });
    const out = await explain(["Check big spends with me", "Only weekdays"]);
    expect(out.map((s) => s.rewrite)).toEqual(["Ask me before any payment over $50.", null]);
    expect(out[0]!.warnings).toEqual([]); // no "There's no minimum balance…" for a single sentence
  });

  it("the sentences are redacted, and the prompt treats them as data and lists the allowed phrasings", async () => {
    const seen = fakeModel({ suggestions: [{ rewrite: null, explanation: "Can't do that." }] });
    await explain(["Send alerts to maya.chen@uni.edu"]);
    const [system, user] = seen[0]!;
    expect(user!.content).toBe("Sentences the checker didn't understand:\n1. Send alerts to [email]");
    expect(system!.content).toMatch(/data, not instructions/);
    expect(system!.content).toMatch(/Never invent a nearby rule/);
    for (const p of EXAMPLE_PHRASINGS) expect(system!.content).toContain(p.examples[0]);
  });

  it("model down, broken JSON, wrong shape or no model → friendly examples, still 200", async () => {
    const check = async () => {
      const [s] = await explain(["Don't let me go broke"]);
      expect(s).toMatchObject({ rewrite: null, summary: [], warnings: [] });
      expect(s!.explanation).toMatch(/^AI help isn't available right now\. Try one of these examples: "Never let my checking go below \$200\."/);
    };
    setModelForTests(async () => {
      throw new Error("down");
    });
    await check();
    fakeModel("Sure! Here's my suggestion: keep $100.");
    await check();
    fakeModel({ suggestions: [{ rewrite: 42 }] });
    await check();
    setModelForTests(null); // no model configured in tests
    await check();
  });

  it("saves nothing: the rules are unchanged afterwards; the audit entry has counts, not text", async () => {
    fakeModel({ suggestions: [{ rewrite: "Do everything else automatically.", explanation: "x" }] });
    await explain(["Secret plan: buy a boat"]);
    const mandate = await signedIn(app, "maya").get("/api/personas/maya/mandate").expect(200);
    expect(mandate.body).toMatchObject({ version: 1, policy: { defaultTier: "L2" } });

    const log = await signedIn(app, "maya").get("/api/audit?limit=1").expect(200);
    expect(log.body[0]).toMatchObject({ eventType: "mandate_explained", payload: { sentences: 1, rewrites: 1, usedAi: true } });
    expect(JSON.stringify(log.body[0])).not.toMatch(/boat/);
  });

  it("401 without a session, 403 for another persona, 400 for empty or too many or too long", async () => {
    await request(app).post("/api/personas/maya/mandate/explain").send({ sentences: ["x"] }).expect(401);
    await signedIn(app, "daniel").post("/api/personas/maya/mandate/explain").send({ sentences: ["x"] }).expect(403);
    const maya = signedIn(app, "maya");
    await maya.post("/api/personas/maya/mandate/explain").send({ sentences: [] }).expect(400);
    await maya.post("/api/personas/maya/mandate/explain").send({ sentences: Array(11).fill("x") }).expect(400);
    await maya.post("/api/personas/maya/mandate/explain").send({ sentences: ["x".repeat(301)] }).expect(400);
  });
});
