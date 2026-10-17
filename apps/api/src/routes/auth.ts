import { Router } from "express";
import { LoginRequest } from "@mandate/shared";
import {
  authenticate,
  deleteSession,
  getDemoAccounts,
} from "../store/auth";
import { getPersona } from "../store";
import {
  buildClearSessionCookie,
  buildSessionCookie,
} from "../http/auth";

export const authRoutes = Router();

/**
 * Public list of demo accounts for the sign-in screen.
 */
authRoutes.get("/auth/demo-accounts", (_req, res) => {
  res.json(getDemoAccounts());
});

/**
 * Log in with username and password.
 * Sets HttpOnly session cookie on success.
 */
authRoutes.post("/auth/login", (req, res) => {
  const { username, password } = LoginRequest.parse(req.body);
  const result = authenticate(username, password);

  if (result.success) {
    res.setHeader("Set-Cookie", buildSessionCookie(result.session.id));
    res.json(result.persona);
    return;
  }

  if (result.status === 429) {
    res.status(429).json({
      error: result.error,
      retryAfterSeconds: result.retryAfterSeconds,
    });
    return;
  }

  res.status(401).json({
    error: result.error,
    attemptsLeft: result.attemptsLeft,
  });
});

/**
 * Check currently signed-in persona.
 * Called on app start to decide between sign-in screen and the app.
 */
authRoutes.get("/auth/me", (req, res) => {
  if (!req.session) {
    res.status(401).json({ error: "Not signed in" });
    return;
  }

  try {
    const persona = getPersona(req.session.personaId);
    res.json({ persona });
  } catch {
    res.status(401).json({ error: "Not signed in" });
  }
});

/**
 * Sign out, clearing the session cookie.
 */
authRoutes.post("/auth/logout", (req, res) => {
  if (req.session) {
    deleteSession(req.session.id);
  }
  res.setHeader("Set-Cookie", buildClearSessionCookie());
  res.status(204).end();
});
