/**
 * app.js — builds the Express application (no network listening happens here).
 * ------------------------------------------------------------------------------------------
 * Order matters in Express. Top to bottom:
 *   1. proxy + security headers          every response gets them
 *   2. health checks                     before sessions, so monitoring never touches the session store
 *   3. static files + public avatars     no login needed
 *   4. body parsers
 *   5. SESSIONS                          everything below can use req.session
 *   6. private files, pages, API         login-protected
 *   7. 404 + error handlers              always last
 */
import express from "express";
import { config, PUBLIC_DIR, VIEWS_DIR } from "./config/env.js";
import { securityHeaders } from "./middleware/security.js";
import { notFound, errorHandler } from "./middleware/errorHandler.js";
import healthRoutes from "./routes/healthRoutes.js";
import pageRoutes from "./routes/pageRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import oauthRoutes from "./routes/oauthRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import friendRoutes from "./routes/friendRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import { serveChatFile, serveAvatar } from "./routes/fileRoutes.js";

export function createApp({ sessionMiddleware }) {
  const app = express();

  app.disable("x-powered-by");
  // Behind a load balancer (Render, Railway, Heroku, Nginx...) trust its X-Forwarded-* headers.
  if (config.trustProxy) app.set("trust proxy", config.trustProxy);

  app.set("view engine", "ejs");
  app.set("views", VIEWS_DIR);

  app.use(securityHeaders);
  app.use(healthRoutes);

  // Static assets (css / js / images). In production browsers may cache them for an hour.
  app.use(express.static(PUBLIC_DIR, { maxAge: config.isProd ? "1h" : 0 }));
  app.get("/avatars/:key", serveAvatar); // public profile pictures

  app.use(express.urlencoded({ extended: true, limit: "100kb" }));
  app.use(express.json({ limit: "100kb" }));

  app.use(sessionMiddleware);

  // Private chat files: MUST come after the session middleware (it checks who is asking).
  app.get("/files/:key", serveChatFile);

  app.use("/", pageRoutes);
  app.use("/", authRoutes);                 // /login /register /logout
  app.use("/auth", oauthRoutes);            // /auth/google  /auth/google/callback
  app.use("/api/users", userRoutes);
  app.use("/api/friends", friendRoutes);
  app.use("/api", uploadRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
