import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { TransactionPage } from "@mandate/shared";
import { createApp } from "../src/app";
import { signedIn } from "./helpers";
import { initStore } from "../src/store";

const app = createApp();

// Every test starts from fresh seed data, so tests can't affect each other.
beforeEach(() => {
  initStore();
});

describe("system", () => {
  it("GET and HEAD /api/health both answer 200 (HEAD is what the keep-alive pinger sends)", async () => {
    await request(app).get("/api/health").expect(200);
    await request(app).head("/api/health").expect(200);
  });

  it("unknown routes return a JSON 404", async () => {
    const res = await request(app).get("/api/nope").expect(404);
    expect(res.body).toEqual({ error: "Not found" });
  });

  it("POST /api/admin/reset reloads the seed", async () => {
    const res = await request(app).post("/api/admin/reset").expect(200);
    expect(res.body.ok).toBe(true);
  });
});

describe("personas & accounts", () => {
  it("lists the three personas", async () => {
    const res = await request(app).get("/api/personas").expect(200);
    expect(res.body.map((p: { id: string }) => p.id).sort()).toEqual(["aisha", "daniel", "maya"]);
  });

  it("returns a persona's three accounts", async () => {
    const res = await signedIn(app, "maya").get("/api/personas/maya/accounts").expect(200);
    expect(res.body.map((a: { type: string }) => a.type).sort()).toEqual(["checking", "credit", "savings"]);
  });

  it("403 for any persona that isn't the signed-in one (even one that doesn't exist)", async () => {
    const res = await signedIn(app, "maya").get("/api/personas/zed/accounts").expect(403);
    expect(res.body.error).toBe("That isn't your account");
  });
});

describe("transactions", () => {
  it("returns the contract's shape, 50 per page by default", async () => {
    const res = await signedIn(app, "maya").get("/api/personas/maya/transactions").expect(200);
    const page = TransactionPage.parse(res.body); // throws if the shape is wrong
    expect(page.items).toHaveLength(50);
    expect(page.total).toBeGreaterThan(50);
  });

  it("filters by category, account and date range", async () => {
    const res = await signedIn(app, "daniel")
      .get("/api/personas/daniel/transactions")
      .query({ category: "subscriptions", account: "credit", from: "2026-09-01", to: "2026-09-30", limit: 500 })
      .expect(200);
    const page = TransactionPage.parse(res.body);
    expect(page.items.length).toBeGreaterThan(0);
    for (const t of page.items) {
      expect(t.category).toBe("subscriptions");
      expect(t.accountId).toBe("acc_daniel_crd");
      expect(t.date >= "2026-09-01" && t.date <= "2026-09-30").toBe(true);
    }
  });

  it("pages with limit and offset", async () => {
    const first = await signedIn(app, "aisha").get("/api/personas/aisha/transactions?limit=5").expect(200);
    const second = await signedIn(app, "aisha").get("/api/personas/aisha/transactions?limit=5&offset=5").expect(200);
    expect(first.body.items[4].id).not.toBe(second.body.items[0].id);
  });

  it("rejects bad query values with 400 and the reason", async () => {
    const res = await signedIn(app, "maya").get("/api/personas/maya/transactions?limit=9999&category=food").expect(400);
    expect(res.body.error).toBe("Invalid request");
    expect(res.body.issues.map((i: { path: string[] }) => i.path[0]).sort()).toEqual(["category", "limit"]);
  });
});
