import { Router } from "express";
import { z } from "zod";
import { ActionDecisionBody, ContributeBody } from "@mandate/shared";
import { decideAction, listActions, listApprovals, proposeAction } from "../actions";
import { assertOwner } from "../auth";
import { getAction, getPersona, getWish } from "../store";

export const actionRoutes = Router();

// Routes with :personaId: check the persona first so unknown ids get a 404
actionRoutes.param("personaId", (_req, _res, next, personaId: string) => {
  getPersona(personaId); // Reject: unknown persona → throws → 404
  next();
});

// Actions waiting for the user's approval, newest first
actionRoutes.get("/personas/:personaId/approvals", (req, res) => {
  res.json(listApprovals(req.params.personaId));
});

// Every action (executed, waiting, blocked, rejected), newest first, e.g. ?limit=50
const ActionsQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).default(50) });
actionRoutes.get("/personas/:personaId/actions", (req, res) => {
  const { limit } = ActionsQuery.parse(req.query);
  res.json(listActions(req.params.personaId).slice(0, limit));
});

// Approve (needs the PIN) or reject a waiting action → the updated Action
actionRoutes.post("/actions/:actionId/decision", (req, res) => {
  const body = ActionDecisionBody.parse(req.body); // bad shape → 400
  const action = getAction(req.params.actionId); // 404 if unknown
  assertOwner(res, action.personaId); // Reject: someone else's action → 403
  res.json(decideAction(action.personaId, action.id, body));
});

// Manual top-up for a wish: goes through the policy engine like everything else
actionRoutes.post("/wishes/:wishId/contribute", (req, res) => {
  const { amountCents } = ContributeBody.parse(req.body);
  const wish = getWish(req.params.wishId); // 404 if unknown
  assertOwner(res, wish.personaId); // Reject: someone else's wish → 403
  const action = proposeAction(wish.personaId, { source: "user", type: "wish_contribution", wishId: wish.id, amountCents });
  res.status(201).json(action);
});
