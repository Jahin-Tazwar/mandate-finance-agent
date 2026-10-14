import express, { type ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { HttpError } from "./http/errors";
import { analyticsRoutes } from "./routes/analytics";
import { personaRoutes } from "./routes/personas";
import { systemRoutes } from "./routes/system";

/**
 * Builds the Express app without starting it. Tests import this and send
 * requests straight to it; src/index.ts is what actually listens on a port.
 */
export function createApp() {
  const app = express();
  app.use(express.json()); // read JSON request bodies into req.body

  // All routes live under /api
  app.use("/api", systemRoutes);
  app.use("/api", personaRoutes);
  app.use("/api", analyticsRoutes);

  // Unknown /api routes get a clear JSON 404 instead of an HTML page.
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // One place that turns thrown errors into JSON responses.
  // Express 5 also sends errors thrown inside async handlers here automatically.
  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    // Bad input (failed a Zod check) → 400 with the list of problems
    if (err instanceof ZodError) {
      res.status(400).json({ error: "Invalid request", issues: err.issues });
      return;
    }
    // An error that knows its status, e.g. notFound() → 404
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    // Anything else is a bug: log it, and don't leak details to the browser
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  };
  app.use(errorHandler);

  return app;
}
