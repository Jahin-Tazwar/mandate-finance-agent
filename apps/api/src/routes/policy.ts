import { Router } from "express";
import { z } from "zod";
import { ProposedAction } from "@mandate/shared";
import { listAudit, verifyChain } from "../audit";
import { checkAction } from "../policy";
import { getMandate, getPersona } from "../store";

export const policyRoutes = Router();

// Routes with :personaId: check the persona first so unknown ids get a 404
policyRoutes.param("personaId", (_req, _res, next, personaId: string) => {
  getPersona(personaId); // Reject: unknown persona → throws → 404
  next();
});

// The persona's signed rules: in words, as data, and one sentence per rule
policyRoutes.get("/personas/:personaId/mandate", (req, res) => {
  res.json(getMandate(req.params.personaId));
});

// Dry run: "would the agent be allowed to do this?" Decides, records it in the audit log,
// but moves no money. Handy for the frontend, the red-team tests and manual attack testing.
policyRoutes.post("/personas/:personaId/policy/check", (req, res) => {
  const action = ProposedAction.parse(req.body); // wrong shape → 400
  res.json({ action, ...checkAction(req.params.personaId, action) });
});

// The audit log, newest first, e.g. ?personaId=daniel&limit=50
const AuditQuery = z.object({
  personaId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1_000).default(100),
});
policyRoutes.get("/audit", (req, res) => {
  const { personaId, limit } = AuditQuery.parse(req.query);
  res.json(listAudit(personaId, limit));
});

// Is the chain intact? e.g. { valid: true, entries: 12, brokenAt: null }
policyRoutes.get("/audit/verify", (_req, res) => {
  res.json(verifyChain());
});
