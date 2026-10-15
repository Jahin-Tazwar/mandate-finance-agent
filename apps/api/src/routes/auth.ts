import { Router } from "express";
import { LoginBody } from "@mandate/shared";
import { appendAudit } from "../audit";
import { clearSessionCookie, listDemoAccounts, sessionPersona, setSessionCookie, verifyLogin } from "../auth";
import { HttpError } from "../http/errors";
import { getPersona } from "../store";

export const authRoutes = Router();

// Public: the demo accounts for the sign-in screen (fake credentials, shown on purpose)
authRoutes.get("/auth/demo-accounts", (_req, res) => {
  res.json(listDemoAccounts());
});

// Sign in → the Persona, plus the session cookie
authRoutes.post("/auth/login", (req, res) => {
  const { username, password } = LoginBody.parse(req.body); // missing fields → 400

  let personaId: string;
  try {
    personaId = verifyLogin(username, password); // wrong → 401, locked → 429
  } catch (err) {
    // Record failed sign-ins too: repeated failures are worth seeing in the audit log
    appendAudit({
      personaId: null,
      eventType: "sign_in_failed",
      actor: { type: "system" },
      summary: `Failed sign-in for username "${username.slice(0, 50)}".`,
      payload: { username: username.slice(0, 50) },
    });
    throw err;
  }

  setSessionCookie(req, res, personaId);
  appendAudit({ personaId, eventType: "signed_in", actor: { type: "user", personaId }, summary: "Signed in.", payload: {} });
  res.json(getPersona(personaId));
});

// Who's signed in? 401 if nobody (the frontend shows the sign-in screen)
authRoutes.get("/auth/me", (req, res) => {
  const personaId = sessionPersona(req);
  if (!personaId) throw new HttpError(401, "Please sign in");
  res.json({ persona: getPersona(personaId) });
});

// Sign out → 204, cookie removed
authRoutes.post("/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});
