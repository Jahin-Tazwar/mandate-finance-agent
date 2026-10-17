import { Router } from "express";
import { Tier } from "@mandate/shared";
import { clearLockouts } from "../auth";
import { config } from "../config";
import { HttpError } from "../http/errors";
import { resetStore } from "../store";

export const systemRoutes = Router();

// "Is the server alive?" Also answers HEAD (Express does that for every GET route),
// which is what the keep-alive pinger uses.
systemRoutes.get("/health", (_req, res) => {
  res.json({ ok: true, service: "moneywise-api", time: new Date().toISOString() });
});

// Explicit HEAD handler. Optional: the GET route above is registered first and already
// answers HEAD requests, so in practice this one never runs.
systemRoutes.head("/health", (_req, res) => {
  res.json({ ok: true, service: "moneywise-api", time: new Date().toISOString() });
});

// Proves the shared package works: this list comes from packages/shared.
systemRoutes.get("/meta", (_req, res) => {
  res.json({ tiers: Tier.options });
});

// Reloads the seed CSVs (and clears sign-in lockouts): a clean demo without restarting.
// When ADMIN_KEY is set (always on the hosted version), the request must carry it.
systemRoutes.post("/admin/reset", (req, res) => {
  // Reject: wrong or missing admin key
  if (config.adminKey && req.get("x-admin-key") !== config.adminKey) {
    throw new HttpError(403, "Admin key required");
  }
  const { loadedAt } = resetStore();
  clearLockouts();
  res.json({ ok: true, resetAt: loadedAt });
});
