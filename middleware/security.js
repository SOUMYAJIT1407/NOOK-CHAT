/**
 * middleware/security.js — safe default response headers (a small, dependency-free "helmet").
 * A strict Content-Security-Policy is intentionally NOT set: the login/home pages use inline
 * scripts and Google Fonts, and a policy that blocks them would change those pages.
 */
import { config } from "../config/env.js";

export function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");           // never guess a file's type
  res.setHeader("X-Frame-Options", "SAMEORIGIN");               // cannot be embedded by other sites
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // Camera / microphone / screen-share are needed for calls — allow them for this site only.
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=()");
  if (config.isProd && req.secure) {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains"); // HTTPS only (6 months)
  }
  next();
}
