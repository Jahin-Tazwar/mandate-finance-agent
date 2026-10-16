import { Router } from "express";
import { ChatBody } from "@mandate/shared";
import { assertNotBusy, runChat } from "../agent";
import { openStream } from "../http/sse";
import { getPersona } from "../store";

export const chatRoutes = Router();

/**
 * Chat with the agent. The answer is a Server-Sent Events stream:
 *   event: tool    data: {"name":"get_bills","status":"done"}
 *   event: action  data: { ...Action }
 *   event: text    data: {"delta":"Your power "}   (word by word)
 *   event: done    data: {}
 */
chatRoutes.post("/personas/:personaId/chat", async (req, res) => {
  const personaId = req.params.personaId;
  getPersona(personaId); // 404 if unknown
  const { message } = ChatBody.parse(req.body); // empty / too long → 400
  assertNotBusy(personaId); // a chat already running → 429

  // From here on it's a stream, not one JSON response
  const send = openStream(res);
  await runChat(personaId, message, send); // never throws: problems arrive as an "error" event
  res.end();
});
