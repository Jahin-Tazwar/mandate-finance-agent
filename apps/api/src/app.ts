import { existsSync } from "node:fs";
import path from "node:path";
import express, { type ErrorRequestHandler, type Express } from "express";
import { ZodError } from "zod";
import { requireOwnPersona, requireSession } from "./auth";
import { config } from "./config";
import { HttpError } from "./http/errors";
import { securityHeaders } from "./http/headers";
import { actionRoutes } from "./routes/actions";
import { agentRoutes } from "./routes/agent";
import { anchorRoutes } from "./routes/anchors";
import { analyticsRoutes } from "./routes/analytics";
import { authRoutes } from "./routes/auth";
import { documentRoutes } from "./routes/documents";
import { chatRoutes } from "./routes/chat";
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

  // Render sits in front of us and handles HTTPS; trust its "this was HTTPS" header,
  // so req.secure is true there and the session cookie gets the Secure flag
  app.set("trust proxy", 1);

  // Security headers on every response (pages, API, errors), and don't advertise "Express"
  app.disable("x-powered-by");
  app.use(securityHeaders);

  app.use(express.json({ limit: "100kb" })); // read JSON request bodies into req.body (big bodies → 413)

  // ---- Sign-in gates (before the routes they protect) ----
  // Everything about one persona needs a session, and it must be THAT persona's session.
  // (GET /api/personas, the list itself, stays public: the sign-in screen needs it.)
  app.use("/api/personas/:personaId", requireSession, requireOwnPersona);
  // Wishes and actions are looked up by their own id; their routes check the owner (403)
  app.use(["/api/wishes", "/api/actions"], requireSession);

  // All routes live under /api
  app.use("/api", systemRoutes);
  app.use("/api", authRoutes);
  app.use("/api", personaRoutes);
  app.use("/api", analyticsRoutes);
  app.use("/api", wishRoutes);
  app.use("/api", actionRoutes);
  app.use("/api", policyRoutes);
  app.use("/api", chatRoutes);
  app.use("/api", agentRoutes);
  app.use("/api", documentRoutes);
  app.use("/api", anchorRoutes);

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
    // An error that knows its status, e.g. notFound() → 404, wrong PIN → 403 + attemptsLeft
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, ...err.extra });
      return;
    }
    // Express's own request errors: broken JSON → 400, body too big → 413
    if (typeof err?.status === "number" && err.expose) {
      res.status(err.status).json({ error: err.type === "entity.parse.failed" ? "Invalid JSON" : err.message });
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
