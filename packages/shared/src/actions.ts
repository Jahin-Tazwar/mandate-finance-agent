import { z } from "zod";
import { Cents, Persona } from "./entities";
import { ActionSource, Decision, Tier } from "./policy";

// ---- Actions: something the agent or the user wanted to do, and what happened ----

/**
 * executed = done · pending_approval = waiting for the user ·
 * denied = blocked by the rules · rejected = the user said no
 */
export const ActionStatus = z.enum(["executed", "pending_approval", "denied", "rejected"]);

export const ActionType = z.enum(["payment", "transfer", "wish_contribution", "cancel_subscription", "dispute"]);

/** Used by chat, approvals and the timeline. */
export const Action = z.object({
  id: z.string(),
  personaId: z.string(),
  type: ActionType,
  /** One line for the UI, e.g. "Pay CityPower $132.80". */
  summary: z.string(),
  /** The details, e.g. { payee: "CityPower", amountCents: 13280, fromAccount: "checking" }. */
  params: z.record(z.string(), z.unknown()),
  source: ActionSource,
  tier: Tier,
  decision: Decision,
  status: ActionStatus,
  /** Why the rules decided this, in plain sentences (the first one is the deciding one). */
  reasons: z.array(z.string()),
  /** The agent's own explanation of why it proposed this. null for the user's own actions. */
  agentRationale: z.string().nullable(),
  /** Payments only: which wish arrives later because of this money leaving. */
  wishImpact: z.array(z.object({ wishId: z.string(), title: z.string(), delayDays: z.number().int() })).optional(),
  createdAt: z.string(),
  /** When the user approved or rejected it. */
  decidedAt: z.string().nullable(),
  /** Who approved it (persona id), for approved actions. */
  approvedBy: z.string().nullable(),
  executedAt: z.string().nullable(),
});

/** POST /api/actions/:actionId/decision. Approving needs the PIN; rejecting never does. */
export const ActionDecisionBody = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve"), pin: z.string().regex(/^\d{4}$/, "PIN is 4 digits") }),
  z.object({ decision: z.literal("reject") }),
]);

/** POST /api/wishes/:wishId/contribute */
export const ContributeBody = z.object({ amountCents: Cents.positive() });

// ---- Demo sign-in ----

/** GET /api/auth/demo-accounts: fake, intentionally public credentials for the sign-in screen. */
export const DemoAccount = z.object({
  personaId: z.string(),
  name: z.string(),
  profile: z.string(),
  username: z.string(),
  password: z.string(),
  pin: z.string(),
});

/** POST /api/auth/login */
export const LoginBody = z.object({ username: z.string().trim().min(1).max(50), password: z.string().min(1).max(100) });

/** GET /api/auth/me */
export const Me = z.object({ persona: Persona });

// ---- Chat ----

/** POST /api/personas/:id/chat */
export const ChatBody = z.object({ message: z.string().trim().min(1).max(2_000) });

export type ActionStatus = z.infer<typeof ActionStatus>;
export type ActionType = z.infer<typeof ActionType>;
export type Action = z.infer<typeof Action>;
export type ActionDecisionBody = z.infer<typeof ActionDecisionBody>;
export type DemoAccount = z.infer<typeof DemoAccount>;
export type LoginBody = z.infer<typeof LoginBody>;
export type Me = z.infer<typeof Me>;
export type ChatBody = z.infer<typeof ChatBody>;
