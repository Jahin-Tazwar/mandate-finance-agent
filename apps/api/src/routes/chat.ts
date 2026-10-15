import { Router } from "express";
import { ChatBody } from "@mandate/shared";
import { assertNotBusy, runChat } from "../agent";
import { getPersona } from "../store";

export const chatRoutes = Router();

/**
 * Chat with the agent. The answer is a Server-Sent Events stream:
 *   event: tool    data: {"name":"get_bills","status":"done"}
 *   event: action  data: { ...Action }
 *   event: text    data: {"delta":"Your power bill is..."}
 *   event: done    data: {}
 */
chatRoutes.post("/personas/:personaId/chat", async (req, res) => {
  const personaId = req.params.personaId;
  getPersona(personaId); // 404 if unknown
  const { message } = ChatBody.parse(req.body); // empty / too long → 400
  assertNotBusy(personaId); // a chat already running → 429

  // From here on it's a stream, not one JSON response
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // tell proxies not to hold events back
  res.flushHeaders();

  // e.g. "event: text\ndata: {"delta":"Hi"}\n\n" (a blank line ends each event)
  const emit = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  await runChat(personaId, message, emit); // never throws: problems arrive as an "error" event
  res.end();
});
