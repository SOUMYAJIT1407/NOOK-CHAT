/**
 * NOOK CHAT — server.js  (start-up and shutdown only)
 * ------------------------------------------------------------------------------------------
 * Boot sequence:
 *   1. read + validate configuration           config/env.js
 *   2. connect to MongoDB                      config/database.js
 *   3. prepare file storage                    services/storage.js
 *   4. create sessions, the Express app, and the HTTP server with Socket.IO on top
 *   5. listen on PORT
 * Shutdown (SIGTERM from the host, or Ctrl+C): stop taking new connections, disconnect sockets,
 * close MongoDB, exit. A watchdog forces the exit if something hangs.
 *
 * Folder map:
 *   app.js        Express app (middleware order + routes)
 *   config/       env vars, database, sessions
 *   routes/       HTTP endpoints (pages, auth, Google, users, friends, uploads, files, health)
 *   sockets/      real-time: presence, chat, typing indicator, call signalling
 *   services/     business rules (messages & deletion, friends, file storage)
 *   models/       Mongoose schemas   |   middleware/  guards, rate limit, security, errors
 *   views/ public/  EJS pages + css/js/images   |   tests/  automated tests   |   docs/  guides
 */
import http from "http";
import { config, validateConfig } from "./config/env.js";
import { applyDnsSettings, connectDatabase, disconnectDatabase, resetPresence } from "./config/database.js";
import { createSessionMiddleware } from "./config/session.js";
import { initStorage } from "./services/storage.js";
import { createApp } from "./app.js";
import { createSocketServer } from "./sockets/index.js";

async function main() {
  const { errors, warnings } = validateConfig();
  warnings.forEach((warning) => console.warn(`[config] ⚠ ${warning}`));
  if (errors.length) {
    errors.forEach((error) => console.error(`[config] ✖ ${error}`));
    process.exit(1);
  }

  applyDnsSettings();
  await connectDatabase();
  await initStorage();
  await resetPresence();

  const sessionMiddleware = createSessionMiddleware();
  const app = createApp({ sessionMiddleware });
  const server = http.createServer(app);
  const sockets = createSocketServer(server, { app, sessionMiddleware });

  // Load balancers usually close idle connections after 60 s; keep ours open a little longer so they
  // never reuse a connection the server has already dropped (that causes sporadic 502 errors).
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, resolve);
  });
  console.log(`NOOK running at http://localhost:${config.port}  (${config.env})`);

  // ---- graceful shutdown ----
  let closing = false;
  async function shutdown(signal) {
    if (closing) return;
    closing = true;
    console.log(`[server] ${signal} received — shutting down…`);
    const watchdog = setTimeout(() => { console.error("[server] shutdown timed out, forcing exit."); process.exit(1); }, 10_000);
    watchdog.unref();
    try {
      await sockets.close();      // disconnects clients and closes the HTTP server
    } catch (error) {
      console.error("[server] error while closing sockets:", error.message);
    }
    await disconnectDatabase();
    process.exit(0);
  }
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// A bug or a lost database must never leave a half-working process around: log and let the host restart us.
process.on("unhandledRejection", (reason) => { console.error("[fatal] unhandled rejection:", reason); });
process.on("uncaughtException", (error) => { console.error("[fatal] uncaught exception:", error); process.exit(1); });

main().catch((error) => {
  console.error("[server] failed to start:", error.message);
  process.exit(1);
});
