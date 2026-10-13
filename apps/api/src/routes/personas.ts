import { Router } from "express";
import { z } from "zod";
import { AccountType, Category, IsoDate } from "@mandate/shared";
import { listAccounts, listPersonas, queryTransactions } from "../store";

export const personaRoutes = Router();

personaRoutes.get("/personas", (_req, res) => {
  res.json(listPersonas());
});

personaRoutes.get("/personas/:personaId/accounts", (req, res) => {
  res.json(listAccounts(req.params.personaId));
});

// Query-string values always arrive as text, so numbers are converted ("coerced") here.
const TransactionQuery = z.object({
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  category: Category.optional(),
  account: AccountType.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

personaRoutes.get("/personas/:personaId/transactions", (req, res) => {
  const query = TransactionQuery.parse(req.query); // invalid → ZodError → 400
  res.json(queryTransactions(req.params.personaId, query));
});
