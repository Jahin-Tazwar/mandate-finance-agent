import { EventEmitter } from "node:events";
import type { Action } from "@mandate/shared";

/**
 * A notice board for actions: every time an action is created or changes status, it's
 * posted here, and every open timeline stream for that persona gets it straight away
 * (that's how the Approvals badge and the Activity feed update without refreshing).
 */
const board = new EventEmitter();
board.setMaxListeners(100); // many browser tabs may listen at once

/** Posts an action (a copy, so listeners can't change the stored one). */
export function announce(action: Action): void {
  board.emit(action.personaId, structuredClone(action));
}

/** Calls `listener` for each of this persona's action updates. Returns a function that stops listening. */
export function listen(personaId: string, listener: (action: Action) => void): () => void {
  board.on(personaId, listener);
  return () => board.off(personaId, listener);
}
