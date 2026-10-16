import { Router } from "express";
import { z } from "zod";
import { CompileBody, ExplainBody, ProposedAction, SignBody } from "@mandate/shared";
import { appendAudit, listAudit, verifyChain } from "../audit";
import { assertOwner, requireSession, verifyPin } from "../auth";
import { checkAction } from "../policy";
import { compileMandate, notUnderstood } from "../policy/compile";
import { explainSentences } from "../policy/explain";
import { summarize } from "../policy/mandate";
import { getMandate, getPersona, setMandate } from "../store";

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

// Plain-English rules → rules as data, to show the user BEFORE signing. Saves nothing.
policyRoutes.post("/personas/:personaId/mandate/compile", (req, res) => {
  const { text } = CompileBody.parse(req.body);
  const { policy, warnings } = compileMandate(text);
  // notUnderstood: the sentences to offer AI help for (they're also in warnings)
  res.json({ policy, summary: summarize(policy), warnings, notUnderstood: notUnderstood(warnings) });
});

// AI help for sentences the compiler didn't understand: explanations + rewrites that the
// server has checked with the compiler. Saves and applies nothing.
policyRoutes.post("/personas/:personaId/mandate/explain", async (req, res) => {
  const { sentences } = ExplainBody.parse(req.body); // empty, over 10, or over 300 chars → 400
  res.json(await explainSentences(req.params.personaId, sentences));
});

// Sign new rules with the PIN. The rules are compiled again HERE from the text, so what's
// signed is exactly what the text says (a changed `policy` sent by a browser can't sneak in).
policyRoutes.post("/personas/:personaId/mandate/sign", (req, res) => {
  const personaId = req.params.personaId;
  const { naturalLanguage, pin } = SignBody.parse(req.body);
  verifyPin(personaId, pin); // wrong → 403, too many → 429

  const { policy, warnings } = compileMandate(naturalLanguage);
  const previous = getMandate(personaId);
  const mandate = {
    version: previous.version + 1,
    naturalLanguage,
    signedAt: new Date().toISOString(),
    policy,
    summary: summarize(policy),
    signedBy: personaId,
  };
  setMandate(personaId, mandate);

  appendAudit({
    personaId,
    eventType: "mandate_signed",
    actor: { type: "user", personaId },
    summary: `Signed new rules (version ${mandate.version}) with PIN: ${mandate.summary.join(" ")}`,
    payload: { version: mandate.version, previousVersion: previous.version, policy, warnings },
  });
  res.json({ ...mandate, warnings });
});

// Dry run: "would the agent be allowed to do this?" Decides, records it in the audit log,
// but moves no money. Handy for the frontend, the red-team tests and manual attack testing.
policyRoutes.post("/personas/:personaId/policy/check", (req, res) => {
  const action = ProposedAction.parse(req.body); // wrong shape → 400
  res.json({ action, ...checkAction(req.params.personaId, action) });
});

// The signed-in persona's audit log, newest first, e.g. ?limit=50.
// (Entries name other people's payees and amounts, so you only ever see your own.)
const AuditQuery = z.object({
  personaId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1_000).default(100),
});
policyRoutes.get("/audit", requireSession, (req, res) => {
  const query = AuditQuery.parse(req.query);
  const personaId: string | undefined = res.locals.personaId ?? query.personaId;

  // Reject: asking for someone else's log
  if (query.personaId) assertOwner(res, query.personaId);
  res.json(listAudit(personaId, query.limit));
});

// Is the chain intact? e.g. { valid: true, entries: 12, brokenAt: null }
policyRoutes.get("/audit/verify", (_req, res) => {
  res.json(verifyChain());
});
