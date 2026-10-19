import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";

const app = createApp();

describe("security headers", () => {
  it("every response carries them, and doesn't say it's Express", async () => {
    const res = await request(app).get("/api/health").expect(200);
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("errors carry them too (e.g. a request without a session)", async () => {
    const res = await request(app).get("/api/personas/maya/accounts").expect(401);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("HTTPS-only (HSTS) is sent over HTTPS, not over plain http", async () => {
    const plain = await request(app).get("/api/health");
    expect(plain.headers["strict-transport-security"]).toBeUndefined();
    // Render forwards HTTPS requests with this header
    const https = await request(app).get("/api/health").set("X-Forwarded-Proto", "https");
    expect(https.headers["strict-transport-security"]).toBe("max-age=15552000; includeSubDomains");
  });
});
