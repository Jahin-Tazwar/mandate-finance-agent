import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { Wish, WishDetail, WishImpact, WishList, WishPreview, type PayCycle } from "@mandate/shared";
import { createApp } from "../src/app";
import { signedIn } from "./helpers";
import { initStore } from "../src/store";
import { type WishFields, paydayAt, planWish, projectSavings } from "../src/wishes/planner";

// Every test starts from the seed data
beforeEach(() => {
  initStore();
});

// A fixed pay cycle like Maya's: paid every Friday, $47.06 left over each payday
const weekly: PayCycle = {
  cadence: "weekly",
  payday: "Fridays",
  nextPayday: "2026-10-16",
  avgIncomePerCycleCents: 41_611,
  avgSurplusPerCycleCents: 4_706,
};
const ctx = { payCycle: weekly, today: "2026-10-12", availableCents: 4_706, topExtraCategory: "dining" };

const iphone: WishFields = {
  personaId: "maya",
  title: "iPhone 17",
  category: "gadget",
  targetCents: 120_000,
  savedCents: 15_000,
  targetDate: "2027-04-12",
  priority: 1,
  autoSave: true,
  paused: false,
};

describe("planWish", () => {
  it("splits what's left over the paydays before the target date", () => {
    // $1,050 left, 26 Fridays from Oct 16 to Apr 9 → $40.39 each (rounded up)
    const { preview, paceCents } = planWish(iphone, ctx);
    expect(preview.plan).toEqual({ cadence: "weekly", perPaydayCents: 4_039, affordablePerPaydayCents: 4_039, paydaysLeft: 26, nextContributionDate: "2026-10-16" });
    expect(paceCents).toBe(4_039);
    expect(preview.progressPct).toBe(12.5);
  });

  it("rates it against what's left over: ≤60% on track, ≤100% tight, more not realistic", () => {
    expect(planWish(iphone, ctx).preview.status).toBe("tight"); // 86%
    expect(planWish(iphone, { ...ctx, availableCents: 10_000 }).preview.status).toBe("on_track"); // 40%
    expect(planWish(iphone, { ...ctx, availableCents: 3_000 }).preview.status).toBe("not_realistic"); // 135%
  });

  it("gives the ETA at the planned pace (the 26th Friday, 3 days early)", () => {
    expect(planWish(iphone, ctx).preview.eta).toEqual({ date: "2027-04-09", daysVsTarget: -3 });
  });

  it("when not realistic, gives the ETA at the affordable pace and says so", () => {
    const { preview, paceCents } = planWish(iphone, { ...ctx, availableCents: 3_000 });
    expect(paceCents).toBe(3_000); // only what's affordable
    expect(preview.eta!.daysVsTarget).toBeGreaterThan(0); // late
    expect(preview.advice.join(" ")).toMatch(/At what you can afford \(\$30 each Friday\)/);
  });

  it("suggests a spending cut when tight", () => {
    expect(planWish(iphone, ctx).preview.advice).toContain("Spending $21 less on dining a week would make this comfortable.");
  });

  it("handles achieved, paused and too-soon wishes", () => {
    expect(planWish({ ...iphone, savedCents: 120_000 }, ctx).preview.status).toBe("achieved");

    const paused = planWish({ ...iphone, paused: true }, ctx);
    expect(paused.preview.status).toBe("paused");
    expect(paused.paceCents).toBe(0);

    const tooSoon = planWish({ ...iphone, targetDate: "2026-10-14" }, ctx); // before Friday's payday
    expect(tooSoon.preview.status).toBe("not_realistic");
    expect(tooSoon.preview.advice[0]).toMatch(/before your next payday/);
  });
});

describe("paydays and projection", () => {
  it("monthly paydays keep their day of the month", () => {
    const monthly: PayCycle = { ...weekly, cadence: "monthly", payday: "the 25th", nextPayday: "2026-10-25" };
    expect([0, 1, 2].map((i) => paydayAt(monthly, i))).toEqual(["2026-10-25", "2026-11-25", "2026-12-25"]);
  });

  it("projection grows each payday and stops at the target", () => {
    const points = projectSavings(iphone, 4_039, weekly);
    expect(points[0]).toEqual({ date: "2026-10-16", savedCents: 19_039 });
    expect(points.at(-1)).toEqual({ date: "2027-04-09", savedCents: 120_000 });
  });

  it("long plans are thinned out for the chart", () => {
    const daily: PayCycle = { ...weekly, cadence: "daily", nextPayday: "2026-10-13" };
    expect(projectSavings({ ...iphone, savedCents: 0 }, 100, daily).length).toBeLessThanOrEqual(61);
  });
});

describe("wishes for the seed personas", () => {
  const app = createApp();

  it("Maya: iPhone first and tight; Kyoto only gets what's left, so not realistic", async () => {
    const res = await signedIn(app, "maya").get("/api/personas/maya/wishes").expect(200);
    const list = WishList.parse(res.body);
    expect(list.wishes.map((w) => [w.title, w.status])).toEqual([
      ["iPhone 17", "tight"],
      ["Trip to Kyoto", "not_realistic"],
    ]);
    expect(list.overCommitted).toBe(true);
  });

  it("Daniel: both wishes are comfortable", async () => {
    const res = await signedIn(app, "daniel").get("/api/personas/daniel/wishes").expect(200);
    expect(WishList.parse(res.body).wishes.every((w) => w.status === "on_track")).toBe(true);
  });

  it("wish impact: a $60 purchase delays Maya's iPhone", async () => {
    const res = await signedIn(app, "maya").get("/api/personas/maya/wishes/impact?amountCents=6000").expect(200);
    const impact = WishImpact.parse(res.body);
    expect(impact.impacts[0]).toMatchObject({ wishId: "wish_maya_1", title: "iPhone 17" });
    expect(impact.message).toMatch(/delays your iPhone 17 by \d+ days/);
  });
});

describe("wish API: create, preview, change, delete", () => {
  const app = createApp();
  const laptop = { title: "Laptop", category: "gadget", targetCents: 90_000, targetDate: "2027-06-01" };

  it("preview returns a plan but saves nothing", async () => {
    const res = await signedIn(app, "daniel").post("/api/personas/daniel/wishes/preview").send(laptop).expect(200);
    expect(() => WishPreview.parse(res.body)).not.toThrow();
    const list = await signedIn(app, "daniel").get("/api/personas/daniel/wishes");
    expect(list.body.wishes).toHaveLength(2); // still just the seed wishes
  });

  it("create → 201, then it shows up in the list, after the existing wishes", async () => {
    const res = await signedIn(app, "daniel").post("/api/personas/daniel/wishes").send(laptop).expect(201);
    const wish = Wish.parse(res.body);
    expect(wish).toMatchObject({ id: "wish_daniel_3", priority: 3, savedCents: 0, autoSave: true });

    const list = await signedIn(app, "daniel").get("/api/personas/daniel/wishes");
    expect(list.body.wishes.map((w: { id: string }) => w.id)).toContain("wish_daniel_3");
  });

  it("patch recalculates the plan; pausing frees its money for the next wish", async () => {
    const res = await signedIn(app, "maya").patch("/api/wishes/wish_maya_1").send({ paused: true }).expect(200);
    expect(res.body.status).toBe("paused");

    // With the iPhone paused, the Kyoto trip gets all of Maya's $47.06
    const trip = await signedIn(app, "maya").get("/api/wishes/wish_maya_2").expect(200);
    expect(WishDetail.parse(trip.body).wish.status).not.toBe("not_realistic");
  });

  it("delete → 204, then 404", async () => {
    await signedIn(app, "maya").delete("/api/wishes/wish_maya_2").expect(204);
    await signedIn(app, "maya").get("/api/wishes/wish_maya_2").expect(404);
  });

  it("rejects bad input with 400", async () => {
    await signedIn(app, "maya").post("/api/personas/maya/wishes").send({ ...laptop, targetDate: "2026-01-01" }).expect(400); // past
    await signedIn(app, "maya").post("/api/personas/maya/wishes").send({ ...laptop, targetCents: -5 }).expect(400);
    await signedIn(app, "maya").post("/api/personas/maya/wishes").send({ ...laptop, category: "yacht" }).expect(400);
    await signedIn(app, "maya").patch("/api/wishes/wish_maya_1").send({ owner: "someone else" }).expect(400); // unknown field
  });

  it("403 for a persona that isn't yours, 404 for an unknown wish", async () => {
    await signedIn(app, "maya").get("/api/personas/zed/wishes").expect(403);
    await signedIn(app, "maya").patch("/api/wishes/wish_nope_1").send({ paused: true }).expect(404);
  });
});

describe("a 2nd wish shows what it needs AND what it really gets", () => {
  it("Kyoto: needs $26.00 each Friday, gets the $6.67 left after the iPhone", async () => {
    const res = await signedIn(createApp(), "maya").get("/api/personas/maya/wishes").expect(200);
    const kyoto = WishList.parse(res.body).wishes.find((w) => w.title === "Trip to Kyoto")!;
    expect(kyoto.plan).toMatchObject({ perPaydayCents: 2_600, affordablePerPaydayCents: 667 });
    // $6.67 is what's left AFTER the iPhone, not what Maya usually has left ($47.06)
    expect(kyoto.advice[0]).toBe("Saving $26 each Friday is more than the $6.67 left over after your higher-priority wishes.");
  });
});
