/**
 * middleware/errorHandler.js — last line of defence.
 *   notFound      unknown URL -> 404 (JSON for /api, a small page otherwise)
 *   errorHandler  any error thrown in a route (Express 5 forwards async errors here too)
 * Stack traces are only sent to the browser outside production.
 */
import { config } from "../config/env.js";

const wantsJson = (req) => req.path.startsWith("/api/") || req.xhr || (req.headers.accept || "").includes("application/json");

const page = (title, text) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — NOOK</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070918;color:#f4f6ff;font-family:Inter,system-ui,sans-serif;text-align:center;padding:24px}
h1{font-size:64px;margin:0 0 8px;background:linear-gradient(135deg,#8b7cff,#5c7cff);-webkit-background-clip:text;color:transparent}p{color:#9ba3c7;margin:0 0 22px}
a{display:inline-block;padding:12px 22px;border-radius:12px;background:linear-gradient(135deg,#8b7cff,#5c7cff);color:#fff;text-decoration:none;font-weight:600}</style></head>
<body><main><h1>${title}</h1><p>${text}</p><a href="/">Back to NOOK</a></main></body></html>`;

export function notFound(req, res) {
  if (wantsJson(req)) return res.status(404).json({ success: false, message: "Not found." });
  res.status(404).type("html").send(page("404", "We couldn’t find that page."));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  // Body-parser errors carry their own status (too large, malformed JSON...).
  const status = err.status || err.statusCode || (err.type === "entity.too.large" ? 413 : 500);
  const message = status === 413 ? `The file is too large (max ${config.maxUploadMb} MB).`
    : status < 500 ? (err.expose ? err.message : "Bad request.")
    : "Something went wrong on our side. Please try again.";

  if (status >= 500) console.error(`[error] ${req.method} ${req.originalUrl}:`, err);

  if (wantsJson(req)) return res.status(status).json({ success: false, message });
  res.status(status).type("html").send(page(String(status), message));
}
