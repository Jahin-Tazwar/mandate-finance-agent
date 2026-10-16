import type { Response } from "express";

/**
 * Turns a response into a Server-Sent Events stream and returns a `send` function.
 * Each event is two lines and a blank line, e.g.
 *   event: action
 *   data: {"id":"act_1",...}
 */
export function openStream(res: Response): (event: string, data: unknown) => void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // tell proxies (like Render's) not to hold events back
  res.flushHeaders();

  return (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
}
