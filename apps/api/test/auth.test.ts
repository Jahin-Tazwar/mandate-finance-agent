import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { clearLockouts, createSessionToken, verifyPin } from "../src/auth";
import { HttpError } from "../src/http/errors";
import { initStore } from "../src/store";
import { signedIn } from "./helpers";

const app = createApp();

beforeEach(() => {
  initStore();
  clearLockouts();
});

const login = (username: string, password: string) => request(app).post("/api/auth/login").send({ username, password });

describe("sign-in", () => {
  it("lists the demo accounts publicly (fake credentials, on purpose)", async () => {
    const res = await request(app).get("/api/auth/demo-accounts").expect(200);
    expect(res.body.find((a: { personaId: string }) => a.personaId === "maya")).toMatchObject({ username: "maya", password: "maya-demo", pin: "1111" });
  });

  it("login → persona + an HttpOnly cookie; /me works with it; logout clears it", async () => {
    const res = await login("maya", "maya-demo").expect(200);
    expect(res.body.id).toBe("maya");
    const cookie = res.headers["set-cookie"]![0]!;
    expect(cookie).toMatch(/^mandate_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);

    const me = await request(app).get("/api/auth/me").set("Cookie", cookie.split(";")[0]!).expect(200);
    expect(me.body.persona.id).toBe("maya");

    const out = await request(app).post("/api/auth/logout").expect(204);
    expect(out.headers["set-cookie"]![0]).toMatch(/mandate_session=;/);
  });

  it("wrong password → 401 with attempts left; unknown username gets the same message", async () => {
    const wrong = await login("maya", "nope").expect(401);
    expect(wrong.body).toEqual({ error: "Wrong username or password", attemptsLeft: 4 });
    const unknown = await login("mallory", "nope").expect(401);
    expect(unknown.body.error).toBe("Wrong username or password");
  });

  it("5 wrong tries lock the username (even the right password is refused), a reset unlocks", async () => {
    for (let i = 0; i < 4; i++) await login("maya", "nope").expect(401);
    const locked = await login("maya", "nope").expect(429);
    expect(locked.body.retryAfterSeconds).toBeGreaterThan(0);
    await login("maya", "maya-demo").expect(429);

    await request(app).post("/api/admin/reset").expect(200);
    await login("maya", "maya-demo").expect(200);
  });
});

describe("every persona route needs the right session", () => {
  it("not signed in → 401", async () => {
    await request(app).get("/api/personas/maya/accounts").expect(401);
    await request(app).patch("/api/wishes/wish_maya_1").send({ paused: true }).expect(401);
    await request(app).post("/api/actions/act_1/decision").send({ decision: "reject" }).expect(401);
    await request(app).get("/api/audit").expect(401);
  });

  it("someone else's data → 403 (BOLA: changing the id in the URL doesn't work)", async () => {
    const maya = signedIn(app, "maya");
    await maya.get("/api/personas/daniel/accounts").expect(403);
    await maya.get("/api/personas/daniel/transactions").expect(403);
    await maya.patch("/api/wishes/wish_daniel_1").send({ paused: true }).expect(403);
    await maya.get("/api/audit?personaId=daniel").expect(403);
  });

  it("a forged or expired cookie → 401", async () => {
    // Take Maya's real cookie and change the persona to Daniel: the signature no longer matches
    const [, expires, signature] = createSessionToken("maya").split(".");
    const forged = `mandate_session=daniel.${expires}.${signature}`;
    await request(app).get("/api/personas/daniel/accounts").set("Cookie", forged).expect(401);

    const expired = `mandate_session=${createSessionToken("maya", Date.now() - 9 * 3600 * 1000)}`;
    await request(app).get("/api/personas/maya/accounts").set("Cookie", expired).expect(401);
  });

  it("public routes stay public", async () => {
    await request(app).get("/api/health").expect(200);
    await request(app).get("/api/personas").expect(200);
    await request(app).get("/api/audit/verify").expect(200);
  });

  it("the audit log only shows your own entries", async () => {
    await signedIn(app, "daniel").patch("/api/wishes/wish_daniel_1").send({ paused: true }).expect(200);
    const res = await signedIn(app, "maya").get("/api/audit").expect(200);
    expect(res.body.every((e: { personaId: string }) => e.personaId === "maya")).toBe(true);
  });
});

describe("admin reset", () => {
  afterEach(() => {
    delete process.env.ADMIN_KEY;
  });

  it("needs the admin key when ADMIN_KEY is set", async () => {
    process.env.ADMIN_KEY = "test-key";
    await request(app).post("/api/admin/reset").expect(403);
    await request(app).post("/api/admin/reset").set("x-admin-key", "wrong").expect(403);
    await request(app).post("/api/admin/reset").set("x-admin-key", "test-key").expect(200);
  });
});

describe("red team: guessing the PIN with a stolen session", () => {
  afterEach(() => vi.useRealTimers());

  /** Five wrong PINs; returns how long the lock is (seconds) */
  const fiveWrong = (): number => {
    for (let i = 0; i < 4; i++) expect(() => verifyPin("maya", "0000")).toThrow("Wrong PIN");
    try {
      verifyPin("maya", "0000");
    } catch (err) {
      return (err as HttpError).extra.retryAfterSeconds as number;
    }
    throw new Error("the 5th wrong PIN didn't lock");
  };

  it("each lock in a row is longer: 5 min, 15, 30, then 1 hour", () => {
    vi.useFakeTimers();
    const locks: number[] = [];
    for (let i = 0; i < 5; i++) {
      const seconds = fiveWrong();
      locks.push(seconds / 60);
      expect(() => verifyPin("maya", "1111")).toThrow("Too many attempts"); // even the right PIN waits
      vi.advanceTimersByTime(seconds * 1000); // wait the lock out
    }
    expect(locks).toEqual([5, 15, 30, 60, 60]);
  });

  it("8 hours of guessing: about 55 tries, not 480", () => {
    vi.useFakeTimers();
    let guesses = 0;
    const end = Date.now() + 8 * 3600 * 1000;
    while (Date.now() < end) {
      guesses += 5;
      vi.advanceTimersByTime(fiveWrong() * 1000);
    }
    expect(guesses).toBe(55);
  });

  it("the right PIN clears it: the next mistake starts again at 5 minutes", () => {
    vi.useFakeTimers();
    vi.advanceTimersByTime(fiveWrong() * 1000);
    verifyPin("maya", "1111"); // correct
    expect(fiveWrong()).toBe(5 * 60);
  });
});
