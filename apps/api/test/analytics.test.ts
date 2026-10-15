import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { Bill, Budget, Forecast, PayCycle, Subscription, type Transaction } from "@mandate/shared";
import { getBills, getBudget, getForecast, getPayCycle, getSubscriptions } from "../src/analytics";
import { classifyCadence, detectSeries, upcomingDates } from "../src/analytics/recurring";
import { createApp } from "../src/app";
import { signedIn } from "./helpers";
import { config } from "../src/config";
import { addDays, addMonths } from "../src/lib/dates";
import { initStore } from "../src/store";

beforeEach(() => {
  initStore();
});

const datesEvery = (start: string, gapDays: number, count: number) =>
  Array.from({ length: count }, (_, i) => addDays(start, i * gapDays));

describe("dates", () => {
  it("adds months keeping the day, clamped to the month's length", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-10-01", 1)).toBe("2026-11-01");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
  });
});

describe("classifyCadence", () => {
  it("recognises regular schedules", () => {
    expect(classifyCadence(datesEvery("2026-05-01", 1, 30))).toBe("daily");
    expect(classifyCadence(datesEvery("2026-05-01", 7, 10))).toBe("weekly");
    expect(classifyCadence(datesEvery("2026-05-01", 14, 6))).toBe("biweekly");
    expect(classifyCadence(["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01"])).toBe("monthly");
  });

  it("calls a messy pattern irregular, and needs at least 3 dates", () => {
    expect(classifyCadence(["2026-05-01", "2026-05-04", "2026-05-20", "2026-06-02", "2026-06-30"])).toBe("irregular");
    expect(classifyCadence(["2026-05-01", "2026-06-01"])).toBe("irregular");
  });
});

describe("detectSeries", () => {
  const tx = (date: string, merchant: string, cents: number, category: Transaction["category"]): Transaction => ({
    id: `${merchant}-${date}`, accountId: "acc_x_chk", date, description: merchant, merchant, amountCents: cents, category, memo: null,
  });

  it("finds a monthly bill and predicts it on the same day of the month", () => {
    const rent = ["2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"].map((d) => tx(d, "Landlord", -75000, "housing"));
    const [series] = detectSeries(rent, "2026-10-12");
    expect(series?.cadence).toBe("monthly");
    expect(upcomingDates(series!, "2026-10-12", "2026-12-31")).toEqual(["2026-11-01", "2026-12-01"]);
  });

  it("never treats discretionary spending as a commitment, even if it looks regular", () => {
    const dinners = datesEvery("2026-08-01", 7, 10).map((d) => tx(d, "Pizza Place", -2000, "dining"));
    expect(detectSeries(dinners, "2026-10-12")).toEqual([]);
  });

  it("drops a series that stopped (e.g. a cancelled subscription)", () => {
    const old = ["2026-03-05", "2026-04-05", "2026-05-05"].map((d) => tx(d, "OldMag", -999, "subscriptions"));
    expect(detectSeries(old, "2026-10-12")).toEqual([]);
  });
});

describe("pay cycle (seed data)", () => {
  it("Maya is paid weekly on Fridays", () => {
    const pc = getPayCycle("maya");
    expect(pc).toMatchObject({ cadence: "weekly", payday: "Fridays", nextPayday: "2026-10-16" });
  });

  it("Daniel is paid monthly on the 25th", () => {
    expect(getPayCycle("daniel")).toMatchObject({ cadence: "monthly", payday: "the 25th", nextPayday: "2026-10-25" });
  });

  it("Aisha plans day by day (daily payouts are her main income)", () => {
    expect(getPayCycle("aisha")).toMatchObject({ cadence: "daily", nextPayday: addDays(config.today, 1) });
  });

  it("ignores one-off income spikes (Maya's tuition help) when averaging", () => {
    const { avgIncomePerCycleCents } = getPayCycle("maya");
    expect(avgIncomePerCycleCents).toBeLessThan(50_000); // ~$416/week, not ~$600 with the $2,500 one-off
  });
});

describe("subscriptions, bills and duplicates (seed data)", () => {
  it("flags Maya's never-used gym", () => {
    const gym = getSubscriptions("maya").find((s) => s.merchant === "FitZone")!;
    expect(gym.lastUsed).toBeNull();
    expect(gym.unusedDays).toBeGreaterThan(150);
  });

  it("lists Maya's rent as due on Nov 1", () => {
    expect(getBills("maya")).toContainEqual(expect.objectContaining({ payee: "Greenview Student Housing", dueDate: "2026-11-01", amountCents: 75_000 }));
  });

  it("budget insights mention the unused gym and Daniel's duplicate charge", () => {
    expect(getBudget("maya").insights.join(" ")).toMatch(/FitZone/);
    expect(getBudget("daniel").insights.join(" ")).toMatch(/duplicate charge: TechStore \$129\.99 twice on Sep 14/);
  });

  it("a one-off (Maya's tuition) doesn't create an education budget", () => {
    expect(getBudget("maya").categories.find((c) => c.category === "education")).toBeUndefined();
  });
});

describe("forecast and safe-to-spend", () => {
  it("forecasts 30 days starting today", () => {
    const f = getForecast("maya");
    expect(f.days).toHaveLength(30);
    expect(f.days[0]!.date).toBe(config.today);
    expect(f.days.some((d) => d.date === f.lowestPoint.date)).toBe(true);
  });

  it("safe-to-spend is never negative", () => {
    for (const p of ["maya", "daniel", "aisha"]) expect(getBudget(p).safeToSpendTodayCents).toBeGreaterThanOrEqual(0);
  });
});

describe("analytics API", () => {
  const app = createApp();

  it.each([
    ["pay-cycle", PayCycle],
    ["subscriptions", Subscription.array()],
    ["bills", Bill.array()],
    ["forecast", Forecast],
    ["budget", Budget],
  ] as const)("GET /api/personas/daniel/%s matches the contract", async (path, schema) => {
    const res = await signedIn(app, "daniel").get(`/api/personas/daniel/${path}`).expect(200);
    expect(() => schema.parse(res.body)).not.toThrow();
  });

  it("budget for an earlier month", async () => {
    const res = await signedIn(app, "maya").get("/api/personas/maya/budget?month=2026-09").expect(200);
    expect(res.body.month).toBe("2026-09");
  });

  it("400 for a bad month, 403 for a persona that isn't yours", async () => {
    await signedIn(app, "maya").get("/api/personas/maya/budget?month=2026-13").expect(400);
    await signedIn(app, "maya").get("/api/personas/zed/forecast").expect(403); // not maya's
  });
});
