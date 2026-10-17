import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { initStore } from "../src/store";
import { clearAllAuth } from "../src/store/auth";

const app = createApp();

function getCookies(res: request.Response): string[] {
  const cookie = res.headers["set-cookie"];
  if (Array.isArray(cookie)) return cookie;
  if (typeof cookie === "string") return [cookie];
  return [];
}

beforeEach(() => {
  clearAllAuth();
  initStore();
});

describe("Auth API", () => {
  it("GET /api/auth/demo-accounts returns demo accounts for judges", async () => {
    const res = await request(app).get("/api/auth/demo-accounts").expect(200);
    expect(res.body).toHaveLength(3);
    const usernames = res.body.map((acc: { username: string }) => acc.username).sort();
    expect(usernames).toEqual(["aisha", "daniel", "maya"]);
    const maya = res.body.find((acc: { username: string }) => acc.username === "maya");
    expect(maya).toMatchObject({
      personaId: "maya",
      name: "Maya Chen",
      username: "maya",
      password: "maya-demo",
      pin: "1111",
    });
  });

  it("GET /api/auth/me returns 401 when no session cookie is present", async () => {
    const res = await request(app).get("/api/auth/me").expect(401);
    expect(res.body.error).toBe("Not signed in");
  });

  it("POST /api/auth/login logs in valid user and returns session cookie", async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "maya", password: "maya-demo" })
      .expect(200);

    expect(loginRes.body.id).toBe("maya");
    expect(loginRes.body.name).toBe("Maya Chen");

    const cookies = getCookies(loginRes);
    expect(cookies.length).toBeGreaterThan(0);
    expect(cookies[0]).toMatch(/mandate_session=/);
    expect(cookies[0]).toMatch(/HttpOnly/);

    // Call /api/auth/me with session cookie
    const meRes = await request(app)
      .get("/api/auth/me")
      .set("Cookie", cookies)
      .expect(200);

    expect(meRes.body.persona.id).toBe("maya");
  });

  it("POST /api/auth/login returns 401 on wrong credentials with attemptsLeft", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: "maya", password: "wrong-password" })
      .expect(401);

    expect(res.body.error).toBe("Wrong username or password");
    expect(res.body.attemptsLeft).toBe(4);
  });

  it("POST /api/auth/login locks account after 5 failed attempts (429)", async () => {
    for (let i = 0; i < 4; i++) {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ username: "daniel", password: "bad" })
        .expect(401);
      expect(res.body.attemptsLeft).toBe(4 - i);
    }

    // 5th attempt locks account
    const lockedRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "daniel", password: "bad" })
      .expect(429);

    expect(lockedRes.body.error).toBe("Too many attempts");
    expect(lockedRes.body.retryAfterSeconds).toBeGreaterThan(0);

    // Further attempt remains 429 even with correct password
    const furtherRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "daniel", password: "daniel-demo" })
      .expect(429);
    expect(furtherRes.body.error).toBe("Too many attempts");

    // Admin reset clears the lockout
    await request(app).post("/api/admin/reset").expect(200);

    // Now login succeeds
    await request(app)
      .post("/api/auth/login")
      .send({ username: "daniel", password: "daniel-demo" })
      .expect(200);
  });

  it("POST /api/auth/logout clears session cookie and signs user out", async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "aisha", password: "aisha-demo" })
      .expect(200);

    const cookies = getCookies(loginRes);

    // Logout
    const logoutRes = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", cookies)
      .expect(204);

    const clearCookies = getCookies(logoutRes);
    expect(clearCookies[0]).toMatch(/Max-Age=0/);

    // /api/auth/me is now 401
    await request(app)
      .get("/api/auth/me")
      .set("Cookie", cookies)
      .expect(401);
  });

  it("enforces persona authorization: signed-in user cannot access another persona's data", async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "maya", password: "maya-demo" })
      .expect(200);

    const cookies = getCookies(loginRes);

    // Maya accessing Maya's accounts -> 200
    await request(app)
      .get("/api/personas/maya/accounts")
      .set("Cookie", cookies)
      .expect(200);

    // Maya accessing Daniel's accounts -> 403
    const forbiddenRes = await request(app)
      .get("/api/personas/daniel/accounts")
      .set("Cookie", cookies)
      .expect(403);

    expect(forbiddenRes.body.error).toMatch(/Forbidden/);
  });
});
