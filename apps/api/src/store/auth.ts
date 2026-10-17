import crypto from "node:crypto";
import type { DemoAccount, Persona } from "@mandate/shared";
import { getPersona, listPersonas } from "./index";

export interface Session {
  id: string;
  personaId: string;
  createdAt: number;
  expiresAt: number;
}

export interface LockoutRecord {
  failedAttempts: number;
  lockedUntil: number | null;
}

const DEMO_CREDENTIALS: Record<string, { username: string; password: string; pin: string }> = {
  maya: { username: "maya", password: "maya-demo", pin: "1111" },
  daniel: { username: "daniel", password: "daniel-demo", pin: "2222" },
  aisha: { username: "aisha", password: "aisha-demo", pin: "3333" },
};

const sessions = new Map<string, Session>();
const lockouts = new Map<string, LockoutRecord>();

export const SESSION_COOKIE_NAME = "mandate_session";
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60; // 8 hours = 28,800 seconds
export const MAX_ATTEMPTS = 5;
export const LOCKOUT_SECONDS = 300; // 5 minutes

export function getDemoAccounts(): DemoAccount[] {
  const personas = listPersonas();
  return personas.map((p) => {
    const creds = DEMO_CREDENTIALS[p.id] ?? {
      username: p.id,
      password: `${p.id}-demo`,
      pin: "0000",
    };
    return {
      personaId: p.id,
      name: p.name,
      profile: p.profile,
      username: creds.username,
      password: creds.password,
      pin: creds.pin,
    };
  });
}

export function findDemoAccountByUsername(username: string): DemoAccount | undefined {
  const accounts = getDemoAccounts();
  return accounts.find((a) => a.username.toLowerCase() === username.toLowerCase());
}

export function getSession(sessionId: string): Session | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    return null;
  }
  return session;
}

export function createSession(personaId: string): Session {
  const id = crypto.randomUUID();
  const now = Date.now();
  const session: Session = {
    id,
    personaId,
    createdAt: now,
    expiresAt: now + SESSION_MAX_AGE_SECONDS * 1000,
  };
  sessions.set(id, session);
  return session;
}

export function deleteSession(sessionId: string): boolean {
  return sessions.delete(sessionId);
}

export function clearAllAuth(): void {
  sessions.clear();
  lockouts.clear();
}

export function clearAuthLockouts(): void {
  lockouts.clear();
}

export type LoginResult =
  | { success: true; session: Session; persona: Persona }
  | { success: false; status: 401; error: string; attemptsLeft: number }
  | { success: false; status: 429; error: string; retryAfterSeconds: number };

export function authenticate(username: string, password: string): LoginResult {
  const normalizedUser = username.trim().toLowerCase();
  const now = Date.now();
  const record = lockouts.get(normalizedUser) ?? { failedAttempts: 0, lockedUntil: null };

  // Check existing lockout
  if (record.lockedUntil) {
    if (record.lockedUntil > now) {
      const retryAfterSeconds = Math.max(1, Math.ceil((record.lockedUntil - now) / 1000));
      return {
        success: false,
        status: 429,
        error: "Too many attempts",
        retryAfterSeconds,
      };
    }
    // Lockout expired, reset
    record.failedAttempts = 0;
    record.lockedUntil = null;
  }

  const account = findDemoAccountByUsername(normalizedUser);

  if (!account || account.password !== password) {
    record.failedAttempts += 1;
    if (record.failedAttempts >= MAX_ATTEMPTS) {
      record.lockedUntil = now + LOCKOUT_SECONDS * 1000;
      lockouts.set(normalizedUser, record);
      return {
        success: false,
        status: 429,
        error: "Too many attempts",
        retryAfterSeconds: LOCKOUT_SECONDS,
      };
    }
    lockouts.set(normalizedUser, record);
    return {
      success: false,
      status: 401,
      error: "Wrong username or password",
      attemptsLeft: MAX_ATTEMPTS - record.failedAttempts,
    };
  }

  // Success: clear lockout
  lockouts.delete(normalizedUser);
  const persona = getPersona(account.personaId);
  const session = createSession(persona.id);

  return {
    success: true,
    session,
    persona,
  };
}
