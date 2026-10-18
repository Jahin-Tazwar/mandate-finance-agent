import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { DemoAccount } from "@mandate/shared";
import { config } from "../config";
import { HttpError } from "../http/errors";
import { getPersona, listPersonas } from "../store";

/**
 * DEMO SIGN-IN. Each persona has a username, a password and a 4-digit PIN.
 * The credentials are fake and shown on the sign-in screen on purpose (judges need
 * one-click access), but everything around them works like a real app:
 *   - passwords and PINs are stored only as salted scrypt hashes, compared in constant time
 *   - the session is an HttpOnly cookie signed with HMAC, so it can't be read or forged
 *   - every request is checked against the signed-in persona (no peeking at other accounts)
 *   - 5 wrong tries lock that username / PIN: 5 minutes, then longer each time in a row
 */

const SESSION_COOKIE = "mandate_session";
const SESSION_HOURS = 8;
const MAX_TRIES = 5;
/**
 * How long each lock in a row lasts: 5 min, 15 min, 30 min, then 1 hour every time.
 * A fixed 5-minute lock let a thief with a stolen session try 480 PINs in 8 hours (a 4.8%
 * chance of finding a 4-digit PIN); with these it's about 55 (0.55%). A typo still costs 5 minutes.
 */
const LOCK_STEPS_SECONDS = [5 * 60, 15 * 60, 30 * 60, 60 * 60];

/** Demo PINs (everyone else gets 0000). */
const DEMO_PINS: Record<string, string> = { maya: "1111", daniel: "2222", aisha: "3333" };

// ---- Credentials ----

/** e.g. "maya" → { username: "maya", password: "maya-demo", pin: "1111" } */
function demoCredentials(personaId: string) {
  return { username: personaId, password: `${personaId}-demo`, pin: DEMO_PINS[personaId] ?? "0000" };
}

/** GET /api/auth/demo-accounts: the public list for the sign-in screen. */
export function listDemoAccounts(): DemoAccount[] {
  return listPersonas().map((p) => ({ personaId: p.id, name: p.name, profile: p.profile, ...demoCredentials(p.id) }));
}

/** A salted hash: the same password gives a different hash every run, and it can't be reversed. */
interface Hashed {
  salt: Buffer;
  hash: Buffer;
}
const hashSecret = (secret: string, salt = randomBytes(16)): Hashed => ({ salt, hash: scryptSync(secret, salt, 32) });

/** True if `secret` matches. timingSafeEqual takes the same time either way, so timing reveals nothing. */
const matches = (secret: string, stored: Hashed) => timingSafeEqual(scryptSync(secret, stored.salt, 32), stored.hash);

/** Hashes per persona, made the first time they're needed (scrypt is slow on purpose). */
const hashed = new Map<string, { password: Hashed; pin: Hashed }>();
function hashesFor(personaId: string) {
  let entry = hashed.get(personaId);
  if (!entry) {
    const creds = demoCredentials(personaId);
    entry = { password: hashSecret(creds.password), pin: hashSecret(creds.pin) };
    hashed.set(personaId, entry);
  }
  return entry;
}

// ---- Lockout: 5 wrong tries → locked, longer each time ----

/**
 * e.g. "login:maya" or "pin:maya" → wrong tries since the last lock, how many locks in a row,
 * and when the current lock ends (ms). Only a correct try clears it.
 */
const tries = new Map<string, { failures: number; locks: number; lockedUntil: number }>();

/** Clears every lockout (part of the demo reset). */
export const clearLockouts = () => tries.clear();

/** Throws 429 if `key` is locked right now. */
function assertNotLocked(key: string) {
  const entry = tries.get(key);

  // Reject: still locked, e.g. "try again in 240 seconds"
  if (entry && entry.lockedUntil > Date.now()) {
    const retryAfterSeconds = Math.ceil((entry.lockedUntil - Date.now()) / 1000);
    throw new HttpError(429, "Too many attempts", { retryAfterSeconds });
  }
}

/**
 * Counts one wrong try. Returns how many are left, or, if this try locked it, for how long,
 * e.g. { attemptsLeft: 3 } or { attemptsLeft: 0, lockSeconds: 900 } (the 2nd lock in a row).
 */
function recordFailure(key: string): { attemptsLeft: number; lockSeconds?: number } {
  const entry = tries.get(key) ?? { failures: 0, locks: 0, lockedUntil: 0 };
  // A lock that has run out gives 5 new tries, but the locks in a row are remembered
  if (entry.lockedUntil && entry.lockedUntil <= Date.now()) {
    entry.failures = 0;
    entry.lockedUntil = 0;
  }
  entry.failures += 1;
  tries.set(key, entry);
  if (entry.failures < MAX_TRIES) return { attemptsLeft: MAX_TRIES - entry.failures };

  // The 5th wrong try: lock, longer than last time (stays at 1 hour after the 4th lock)
  const lockSeconds = LOCK_STEPS_SECONDS[Math.min(entry.locks, LOCK_STEPS_SECONDS.length - 1)]!;
  entry.locks += 1;
  entry.lockedUntil = Date.now() + lockSeconds * 1000;
  return { attemptsLeft: 0, lockSeconds };
}

/** Checks a username + password. Returns the persona id, or throws 401 / 429. */
export function verifyLogin(username: string, password: string): string {
  const key = `login:${username.toLowerCase()}`;
  assertNotLocked(key);

  // Usernames are the persona ids. An unknown username still costs a try and gives
  // the same message, so nobody can find out which usernames exist.
  const personaId = listPersonas().find((p) => demoCredentials(p.id).username === username.toLowerCase())?.id;
  if (personaId && matches(password, hashesFor(personaId).password)) {
    tries.delete(key); // success clears the count
    return personaId;
  }

  // Reject: wrong username or password (the last try locks it)
  const { attemptsLeft, lockSeconds } = recordFailure(key);
  if (lockSeconds) throw new HttpError(429, "Too many attempts", { retryAfterSeconds: lockSeconds });
  throw new HttpError(401, "Wrong username or password", { attemptsLeft });
}

/**
 * The PIN step-up for risky actions (approving, signing rules, turning the agent on).
 * Wrong PIN → 403 with attemptsLeft; 5 wrong → 429.
 */
export function verifyPin(personaId: string, pin: string | undefined): void {
  const key = `pin:${personaId}`;
  assertNotLocked(key);

  // Reject: no PIN sent
  if (!pin) throw new HttpError(403, "PIN required", { attemptsLeft: MAX_TRIES - (tries.get(key)?.failures ?? 0) });

  if (matches(pin, hashesFor(personaId).pin)) {
    tries.delete(key);
    return;
  }

  // Reject: wrong PIN
  const { attemptsLeft, lockSeconds } = recordFailure(key);
  if (lockSeconds) throw new HttpError(429, "Too many attempts", { retryAfterSeconds: lockSeconds });
  throw new HttpError(403, "Wrong PIN", { attemptsLeft });
}

// ---- Session cookie: "maya.1760000000000.<signature>" ----

/** HMAC signature: only someone with the server's secret can make one that matches. */
const sign = (payload: string) => createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");

/** A signed session value for this persona, valid for 8 hours. */
export function createSessionToken(personaId: string, now = Date.now()): string {
  const payload = `${personaId}.${now + SESSION_HOURS * 3600 * 1000}`;
  return `${payload}.${sign(payload)}`;
}

/** The persona id inside a session value, or null if it's forged, changed or expired. */
export function readSessionToken(token: string | undefined): string | null {
  // Skip: no cookie, or not three parts
  const parts = token?.split(".");
  if (!parts || parts.length !== 3) return null;
  const [personaId, expires, signature] = parts as [string, string, string];

  // Reject: the signature doesn't match (someone edited the persona or the expiry)
  const expected = Buffer.from(sign(`${personaId}.${expires}`));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  // Reject: expired
  if (Number(expires) < Date.now()) return null;
  return personaId;
}

/** One cookie from the Cookie header, e.g. "a=1; mandate_session=xyz" → "xyz". */
function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/** Signs the browser in: HttpOnly (page scripts can't read it), SameSite=Lax (other sites can't send it with a POST). */
export function setSessionCookie(req: Request, res: Response, personaId: string) {
  res.cookie(SESSION_COOKIE, createSessionToken(personaId), {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure, // HTTPS only when served over HTTPS (Render); plain http on localhost
    path: "/",
    maxAge: SESSION_HOURS * 3600 * 1000,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

/** The signed-in persona for this request, or null. */
export function sessionPersona(req: Request): string | null {
  const personaId = readSessionToken(readCookie(req, SESSION_COOKIE));
  // Skip: a valid cookie for a persona that no longer exists
  if (!personaId || !listPersonas().some((p) => p.id === personaId)) return null;
  return personaId;
}

// ---- Middleware ----

/** Routes behind this need a session. Sets res.locals.personaId. */
export function requireSession(req: Request, res: Response, next: NextFunction) {
  const personaId = sessionPersona(req);

  // Reject: not signed in (unless the temporary AUTH_DISABLED switch is on)
  if (!personaId && !config.authDisabled) throw new HttpError(401, "Please sign in");
  res.locals.personaId = personaId;
  next();
}

/**
 * Throws 403 unless `personaId` is the signed-in persona. This is the check that stops
 * "change maya to daniel in the URL" (called BOLA / IDOR: the most common API hole).
 */
export function assertOwner(res: Response, personaId: string) {
  const me: string | null = res.locals.personaId ?? null;

  // Skip: temporary no-auth mode and nobody signed in
  if (!me && config.authDisabled) return;

  // Reject: someone else's data
  if (me !== personaId) throw new HttpError(403, "That isn't your account");
}

/** For /api/personas/:personaId/...: the persona in the URL must be the signed-in one. */
export function requireOwnPersona(req: Request, res: Response, next: NextFunction) {
  assertOwner(res, String(req.params.personaId));
  next();
}

/** The signed-in persona's id; 401 if nobody is (for routes where the persona isn't in the URL). */
export function currentPersona(res: Response): string {
  const me: string | null = res.locals.personaId ?? null;
  if (!me) throw new HttpError(401, "Please sign in");
  getPersona(me);
  return me;
}
