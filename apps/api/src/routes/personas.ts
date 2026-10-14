import { Router } from "express";
import { z } from "zod";
import { AccountType, Category, IsoDate } from "@mandate/shared";
import { listAccounts, listPersonas, queryTransactions } from "../store";

export const personaRoutes = Router();

// The 3 demo personas (for the persona switcher / sign-in screen)
personaRoutes.get("/personas", (_req, res) => {
  res.json(listPersonas());
});

// A persona's checking, savings and credit accounts with balances (404 if unknown persona)
personaRoutes.get("/personas/:personaId/accounts", (req, res) => {
  res.json(listAccounts(req.params.personaId));
});

// Allowed filters for the transactions list. Query-string values always arrive as text,
// so numbers are converted ("coerced"), e.g. ?limit=5 → "5" → 5.
const TransactionQuery = z.object({
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  category: Category.optional(),
  account: AccountType.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// One page of transactions, newest first, e.g. ?category=dining&limit=10
personaRoutes.get("/personas/:personaId/transactions", (req, res) => {
  const query = TransactionQuery.parse(req.query); // invalid → ZodError → 400
  res.json(queryTransactions(req.params.personaId, query));
});
