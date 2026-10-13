import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { config } from "../src/config";
import { accountId, loadSeed } from "../src/store/seed";

describe("loadSeed with the real seed folder", () => {
  const state = loadSeed(config.seedDir);

  it("loads every persona with three accounts", () => {
    expect([...state.personas.keys()].sort()).toEqual(["aisha", "daniel", "maya"]);
    expect(state.accounts.size).toBe(9);
  });

  it("balance = starting balance + every transaction on that account", () => {
    const checking = state.accounts.get(accountId("maya", "checking"))!;
    const txSum = state.transactions
      .get("maya")!
      .filter((t) => t.accountId === checking.id)
      .reduce((sum, t) => sum + t.amountCents, 0);
    const start = 45000; // checking_start for maya in personas.csv
    expect(checking.balanceCents).toBe(start + txSum);
  });

  it("sorts transactions newest first", () => {
    const dates = state.transactions.get("daniel")!.map((t) => t.date);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("loads wishes per persona", () => {
    expect(state.wishes.get("maya")!.map((w) => w.title)).toContain("iPhone 17");
  });
});

describe("loadSeed with broken files", () => {
  let dir: string;

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function writeSeed(files: Record<string, string>) {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mandate-seed-"));
    for (const [name, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), content);
    }
  }

  const personas = "id,name,profile,currency,checking_start,savings_start,credit_limit\nmaya,Maya,Student,USD,100.00,0,0\n";
  const wishes = "persona,title,category,target_amount,target_date,saved_so_far,priority,auto_save\n";
  const txHeader = "date,account,description,merchant,amount,category,memo\n";

  it("reports every bad row with its file and Excel row number", () => {
    writeSeed({
      "personas.csv": personas,
      "wishes.csv": wishes + "nobody,Car,vehicle,100.00,2027-01-01,0,1,yes\n",
      "transactions/maya.csv":
        txHeader +
        "2026-05-01,checking,Rent,Landlord,-50.00,housing,\n" + // row 2: fine
        "05/03/2026,checking,Food,Shop,$12.00,food,\n", // row 3: three problems
    });

    let message = "";
    try {
      loadSeed(dir);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("transactions/maya.csv row 3: date");
    expect(message).toContain("transactions/maya.csv row 3: amount");
    expect(message).toContain("transactions/maya.csv row 3: category");
    expect(message).toContain('wishes.csv row 2: unknown persona "nobody"');
    expect(message).not.toContain("row 2: date");
  });

  it("reports missing columns once per file, not once per row", () => {
    writeSeed({
      "personas.csv": personas,
      "wishes.csv": wishes,
      // The shape a teammate actually sent: no merchant or memo column
      "transactions/maya.csv": "date,amount,category,account,description\n2026-05-01,-750.0,housing,checking,Rent\n2026-05-02,-9.99,subscriptions,checking,Netflix\n",
    });
    expect(() => loadSeed(dir)).toThrow(/Seed data has 1 problem\(s\):\n {2}transactions\/maya\.csv row 1: missing column\(s\): merchant, memo/);
  });

  it("reports a missing transactions file", () => {
    writeSeed({ "personas.csv": personas, "wishes.csv": wishes });
    expect(() => loadSeed(dir)).toThrow("transactions/maya.csv row 0: file is missing");
  });
});
