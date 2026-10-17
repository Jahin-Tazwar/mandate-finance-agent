import type { NextFunction, Request, Response } from "express";
import {
  getSession,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  type Session,
} from "../store/auth";

declare global {
  namespace Express {
    interface Request {
      session?: Session;
      personaId?: string;
    }
  }
}

export function parseCookies(header?: string): Record<string, string> {
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const item of header.split(";")) {
    const [rawKey, ...rawVal] = item.trim().split("=");
    if (rawKey) {
      cookies[rawKey] = decodeURIComponent(rawVal.join("="));
    }
  }
  return cookies;
}

export function buildSessionCookie(sessionId: string): string {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

export function buildClearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0`;
}

/**
 * Extracts and verifies the session from cookie if present.
 */
export function sessionMiddleware(req: Request, _res: Response, next: NextFunction) {
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies[SESSION_COOKIE_NAME];
  if (sessionId) {
    const session = getSession(sessionId);
    if (session) {
      req.session = session;
      req.personaId = session.personaId;
    }
  }
  next();
}

/**
 * Enforces session authentication and persona authorization.
 *
 * Rules:
 * - If not signed in and AUTH_DISABLED is true: allows request through.
 * - If not signed in and AUTH_DISABLED is false: 401 { error: "Not signed in" }.
 * - If signed in:
 *     - If route has :personaId and it does not match session's persona: 403 { error: "Forbidden: persona mismatch" }.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authDisabled = process.env.AUTH_DISABLED !== "false";

  if (!req.session) {
    if (authDisabled) {
      return next();
    }
    return res.status(401).json({ error: "Not signed in" });
  }

  const routePersonaId = req.params.personaId;
  if (routePersonaId && routePersonaId !== req.session.personaId) {
    return res.status(403).json({ error: "Forbidden: another persona's data" });
  }

  next();
}
