import { Router } from "express";
import { z } from "zod";
import { runPayday } from "../agent/payday";
import { appendAudit } from "../audit";
import { verifyPin } from "../auth";
import { getPersona, isAgentEnabled, setAgentEnabled } from "../store";

export const agentRoutes = Router();

// Routes with :personaId: check the persona first so unknown ids get a 404
agentRoutes.param("personaId", (_req, _res, next, personaId: string) => {
  getPersona(personaId); // Reject: unknown persona → throws → 404
  next();
});

// "Run payday" demo button: pay lands, then the agent proposes bills, savings, cancellations
const RunBody = z.object({ trigger: z.literal("payday") });
agentRoutes.post("/personas/:personaId/agent/run", (req, res) => {
  RunBody.parse(req.body); // only "payday" for now → anything else 400
  res.json(runPayday(req.params.personaId));
});

// The kill switch. { enabled: true } = the switch is ON = the agent may only watch.
agentRoutes.get("/personas/:personaId/killswitch", (req, res) => {
  res.json({ enabled: !isAgentEnabled(req.params.personaId) });
});

// Stopping the agent is always allowed (making things safer should be easy).
// Starting it again needs the PIN (it gives the agent its powers back).
const KillSwitchBody = z.object({ enabled: z.boolean(), pin: z.string().optional() });
agentRoutes.post("/personas/:personaId/killswitch", (req, res) => {
  const personaId = req.params.personaId;
  const { enabled, pin } = KillSwitchBody.parse(req.body);

  // Turning the agent back on: PIN first (wrong → 403, too many → 429)
  if (!enabled) verifyPin(personaId, pin);

  setAgentEnabled(personaId, !enabled);
  appendAudit({
    personaId,
    eventType: enabled ? "agent_stopped" : "agent_started",
    actor: { type: "user", personaId },
    summary: enabled ? "Kill switch ON: the agent can only watch." : "Kill switch OFF (PIN confirmed): the agent may act within the rules.",
    payload: {},
  });
  res.json({ enabled });
});
