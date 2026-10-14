import { Router } from "express";
import { Tier } from "@mandate/shared";
import { resetStore } from "../store";

export const systemRoutes = Router();

// "Is the server alive?" Also answers HEAD (Express does that for every GET route),
// which is what the keep-alive pinger uses.
systemRoutes.get("/health", (_req, res) => {
  res.json({ ok: true, service: "mandate-api", time: new Date().toISOString() });
});

// Explicit HEAD handler. Optional: the GET route above is registered first and already
// answers HEAD requests, so in practice this one never runs.
systemRoutes.head("/health", (_req, res) => {
  res.json({ ok: true, service: "mandate-api", time: new Date().toISOString() });
});

// Proves the shared package works: this list comes from packages/shared.
systemRoutes.get("/meta", (_req, res) => {
  res.json({ tiers: Tier.options });
});

// Reloads the seed CSVs: a clean demo without restarting the server.
systemRoutes.post("/admin/reset", (_req, res) => {
  const { loadedAt } = resetStore();
  res.json({ ok: true, resetAt: loadedAt });
});
