import type { Express } from "express";
import request from "supertest";
import { createSessionToken } from "../src/auth";

/**
 * A test client signed in as `personaId`: every request carries a valid session cookie.
 * e.g. signedIn(app, "maya").get("/api/personas/maya/accounts")
 * (Tests that check sign-in itself use POST /api/auth/login instead; see auth.test.ts.)
 */
export function signedIn(app: Express, personaId: string) {
  const cookie = `mandate_session=${createSessionToken(personaId)}`;
  return {
    get: (url: string) => request(app).get(url).set("Cookie", cookie),
    post: (url: string) => request(app).post(url).set("Cookie", cookie),
    patch: (url: string) => request(app).patch(url).set("Cookie", cookie),
    delete: (url: string) => request(app).delete(url).set("Cookie", cookie),
  };
}
