import type { NextFunction, Request, Response } from "express";

/**
 * SECURITY HEADERS on every response: instructions to the browser that close common holes.
 * The web app loads nothing from other sites (no CDNs, no web fonts), so the rules can be strict.
 */

/**
 * Where the page may load things from: only our own site.
 *   - scripts, data requests (incl. the live timeline) and images: our own site (images also data: URLs)
 *   - styles: our own site, plus inline styles (React sets style attributes for the charts)
 *   - no plugins, no other site may show us in a frame, forms only post back to us
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  res.set({
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    // Don't guess file types (a "text" upload can't be run as a script)
    "X-Content-Type-Options": "nosniff",
    // Older browsers' version of frame-ancestors: no clickjacking inside another site's frame
    "X-Frame-Options": "DENY",
    // Never send our URLs (which contain customer names) to other sites
    "Referrer-Policy": "no-referrer",
    // We need no camera, microphone or location
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
  });

  // HTTPS only (Render): browsers must keep using HTTPS for 6 months.
  // Skip: plain http on localhost, where it would be ignored anyway.
  if (req.secure) res.set("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  next();
}
