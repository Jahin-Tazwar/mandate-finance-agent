import { Router } from "express";
import { z } from "zod";
import { getBills, getBudget, getForecast, getPayCycle, getSubscriptions } from "../analytics";
import { getPersona } from "../store";

export const analyticsRoutes = Router();

// Every route here is /personas/:personaId/...; check the persona first so unknown ids get a 404.
analyticsRoutes.param("personaId", (_req, _res, next, personaId: string) => {
  getPersona(personaId);
  next();
});

analyticsRoutes.get("/personas/:personaId/pay-cycle", (req, res) => {
  res.json(getPayCycle(req.params.personaId));
});

analyticsRoutes.get("/personas/:personaId/subscriptions", (req, res) => {
  res.json(getSubscriptions(req.params.personaId));
});

analyticsRoutes.get("/personas/:personaId/bills", (req, res) => {
  res.json(getBills(req.params.personaId));
});

analyticsRoutes.get("/personas/:personaId/forecast", (req, res) => {
  res.json(getForecast(req.params.personaId));
});

const BudgetQuery = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must look like 2026-09").optional(),
});

analyticsRoutes.get("/personas/:personaId/budget", (req, res) => {
  const { month } = BudgetQuery.parse(req.query);
  res.json(getBudget(req.params.personaId, month));
});
