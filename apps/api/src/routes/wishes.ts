import { Router } from "express";
import { z } from "zod";
import { WishInput, WishPatch } from "@mandate/shared";
import { appendAudit } from "../audit";
import { config } from "../config";
import { usd } from "../lib/money";
import { addWish, deleteWish, getPersona, getWish, updateWish } from "../store";
import { getPlannedWish, getWishDetail, getWishImpact, getWishList, nextPriority, previewWish } from "../wishes";

export const wishRoutes = Router();

// Routes with :personaId: check the persona first so unknown ids get a 404
wishRoutes.param("personaId", (_req, _res, next, personaId: string) => {
  getPersona(personaId); // Reject: unknown persona → throws → 404
  next();
});

// A wish's target date must be in the future (after the app's "today")
const futureDate = (date: string) => date > config.today;
const NewWishBody = WishInput.refine((w) => futureDate(w.targetDate), {
  message: "targetDate must be after today",
  path: ["targetDate"],
});
const PatchBody = WishPatch.refine((p) => p.targetDate === undefined || futureDate(p.targetDate), {
  message: "targetDate must be after today",
  path: ["targetDate"],
});

// All wishes with their plans, and whether together they fit what's left over
wishRoutes.get("/personas/:personaId/wishes", (req, res) => {
  res.json(getWishList(req.params.personaId));
});

// Live plan for the "new wish" form. Saves nothing.
wishRoutes.post("/personas/:personaId/wishes/preview", (req, res) => {
  const input = NewWishBody.parse(req.body); // invalid → 400
  res.json(previewWish(req.params.personaId, input));
});

// "What does spending this do to my wishes?" e.g. ?amountCents=6000
const ImpactQuery = z.object({ amountCents: z.coerce.number().int().positive() });
wishRoutes.get("/personas/:personaId/wishes/impact", (req, res) => {
  const { amountCents } = ImpactQuery.parse(req.query);
  res.json(getWishImpact(req.params.personaId, amountCents));
});

// Create a wish → 201 with its plan
wishRoutes.post("/personas/:personaId/wishes", (req, res) => {
  const personaId = req.params.personaId;
  const input = NewWishBody.parse(req.body);
  const stored = addWish(personaId, {
    title: input.title,
    category: input.category,
    targetCents: input.targetCents,
    savedCents: input.savedCents,
    targetDate: input.targetDate,
    priority: input.priority ?? nextPriority(personaId),
    autoSave: input.autoSave,
  });

  // Record it in the audit log
  appendAudit({
    personaId,
    eventType: "wish_created",
    actor: { type: "user", personaId },
    summary: `Created wish "${stored.title}" (${usd(stored.targetCents)} by ${stored.targetDate}).`,
    payload: { wishId: stored.id, ...input },
  });
  res.status(201).json(getPlannedWish(stored.id));
});

// One wish with its saving history and projection (404 if unknown)
wishRoutes.get("/wishes/:wishId", (req, res) => {
  res.json(getWishDetail(req.params.wishId));
});

// Change some fields → the wish with a recalculated plan
wishRoutes.patch("/wishes/:wishId", (req, res) => {
  const changes = PatchBody.parse(req.body); // unknown fields → 400
  const stored = updateWish(req.params.wishId, changes);

  // Record what changed, e.g. "Changed wish "iPhone 17": paused"
  appendAudit({
    personaId: stored.personaId,
    eventType: "wish_updated",
    actor: { type: "user", personaId: stored.personaId },
    summary: `Changed wish "${stored.title}": ${Object.keys(changes).join(", ")}.`,
    payload: { wishId: stored.id, changes },
  });
  res.json(getPlannedWish(stored.id));
});

// Remove a wish → 204 (money already saved stays in savings)
wishRoutes.delete("/wishes/:wishId", (req, res) => {
  const wish = getWish(req.params.wishId); // 404 if unknown (before deleting, to log its name)
  deleteWish(wish.id);
  appendAudit({
    personaId: wish.personaId,
    eventType: "wish_deleted",
    actor: { type: "user", personaId: wish.personaId },
    summary: `Deleted wish "${wish.title}".`,
    payload: { wishId: wish.id },
  });
  res.status(204).end();
});
