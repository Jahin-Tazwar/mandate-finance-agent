import { z } from "zod";

/**
 * Permission tiers: how much freedom the agent has for an action.
 *   L0 observe · L1 recommend · L2 act with approval · L3 act alone within the rules
 */
export const Tier = z.enum(["L0", "L1", "L2", "L3"]);

/** The policy engine's answer for every proposed action. */
export const Decision = z.enum(["allow", "require_approval", "deny"]);

/**
 * Where an action's details came from. "untrusted" = anything taken from a
 * document, email or memo field; those actions always need the user's approval.
 */
export const ActionSource = z.enum(["user", "agent", "untrusted"]);

export type Tier = z.infer<typeof Tier>;
export type Decision = z.infer<typeof Decision>;
export type ActionSource = z.infer<typeof ActionSource>;
