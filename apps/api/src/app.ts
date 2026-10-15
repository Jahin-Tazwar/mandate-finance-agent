import { existsSync } from "node:fs";
import path from "node:path";
import express, { type ErrorRequestHandler, type Express } from "express";
import { ZodError } from "zod";
import { config } from "./config";
import { HttpError } from "./http/errors";
import { analyticsRoutes } from "./routes/analytics";
import { personaRoutes } from "./routes/personas";
import { policyRoutes } from "./routes/policy";
import { systemRoutes } from "./routes/system";
import { wishRoutes } from "./routes/wishes";

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
  app.use("/api", wishRoutes);
  app.use("/api", policyRoutes);

  // Unknown /api routes get a clear JSON 404 instead of an HTML page.
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // The website itself (only if it has been built; in dev, Vite serves it instead)
  serveWebsite(app);

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

/**
 * Serves the built React app from the same address as the API, so the browser's
 * calls to /api/... need no CORS setup and Render needs only one service.
 */
function serveWebsite(app: Express) {
  const dir = config.webDistDir;

  // Skip: not built (or tests running), so this server is API-only
  if (!dir || !existsSync(path.join(dir, "index.html"))) return;

  // Real files first: /assets/index-DvONLvwp.js, favicon...
  app.use(express.static(dir));

  // Any other page address (e.g. /wishes/new, opened directly or refreshed) gets
  // index.html, and React's router picks the screen. /api never reaches here:
  // unknown /api routes already got their JSON 404 above.
  app.use((req, res, next) => {
    // Skip: only page loads get the website, not POST / PATCH / DELETE
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    res.sendFile(path.join(dir, "index.html"));
  });
}
