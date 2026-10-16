import { Router } from "express";
import { z } from "zod";
import { anchorNow, anchoringReady, checkAnchor, listAnchors } from "../anchor";
import { requireSession } from "../auth";
import { config } from "../config";

export const anchorRoutes = Router();

// Public: the published fingerprints (just hashes, no personal data), so anyone can check them
anchorRoutes.get("/anchors", (_req, res) => {
  res.json(listAnchors());
});

// Is anchoring switched on, and on which test chain? (for the audit screen)
anchorRoutes.get("/anchors/status", (_req, res) => {
  res.json({ enabled: anchoringReady(), chain: config.anchor.chain });
});

// Publish the latest fingerprint now ("Anchor now" button). 200 with the anchor, or
// { anchor: null } if nothing happened since the last one.
anchorRoutes.post("/audit/anchor", requireSession, async (_req, res) => {
  res.json({ anchor: await anchorNow("manual") });
});

// Check one anchor against the blockchain itself, e.g. /anchors/0xa41f…/check
const TxHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Not a transaction hash");
anchorRoutes.get("/anchors/:txHash/check", async (req, res) => {
  res.json(await checkAnchor(TxHash.parse(req.params.txHash)));
});
