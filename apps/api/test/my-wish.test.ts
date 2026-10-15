import { expect, it } from "vitest";
import { planWish } from "../src/wishes/planner";

// A pretend person: paid every Friday, $100 left over each week
const ctx = {
  payCycle: { cadence: "weekly" as const, payday: "Fridays", nextPayday: "2026-10-16", avgIncomePerCycleCents: 50_000, avgSurplusPerCycleCents: 10_000 },
  today: "2026-10-12",
  availableCents: 10_000,
  topExtraCategory: "dining",
};

const ps5 = {
  personaId: "maya", title: "PS5", category: "gadget" as const,
  targetCents: 30_000, savedCents: 0, targetDate: "2026-11-06",
  priority: 1, autoSave: true, paused: false,
};

it("PS5 plan", () => {
  const { preview } = planWish(ps5, ctx);
  console.log(preview.advice); // the plain-English sentences the user sees
  expect(preview.plan.paydaysLeft).toBe(4);     // a)
  expect(preview.plan.perPaydayCents).toBe(75_00);  // b) in cents!
  expect(preview.status).toBe("tight");             // c)
});

it("headphones get what the PS5 leaves over", () => {
  const first = planWish(ps5, ctx);
  const headphones = { ...ps5, title: "Headphones", targetCents: 12_000, priority: 2 };

  // Same person, but only what's LEFT after the PS5
  const { preview, paceCents } = planWish(headphones, { ...ctx, availableCents: ctx.availableCents - first.paceCents });
  console.log(preview.advice);

  expect(preview.plan.perPaydayCents).toBe(3_000);  // b) needed per Friday
  expect(preview.status).toBe("not_realistic");             // b)
  expect(paceCents).toBe(2_500);                    // c) what it can actually get
  expect(preview.eta?.date).toBe("2026-11-13");          // c) when it's reached at that pace
});