/**
 * config/session.js — login sessions.
 * ------------------------------------------------------------------------------------------
 * Sessions are stored in MongoDB (collection "sessions") rather than in the server's memory:
 *   • they survive restarts and redeploys (users stay logged in),
 *   • the default in-memory store leaks memory and is not meant for production.
 * The very same middleware is attached to Socket.IO, so a socket knows which user it belongs to.
 */
import session from "express-session";
import MongoStore from "connect-mongo";
import mongoose from "mongoose";
import { config } from "./env.js";

export const SESSION_COOKIE = "nook.sid";

export function createSessionMiddleware() {
  const maxAgeMs = config.sessionDays * 24 * 60 * 60 * 1000;

  const store = MongoStore.create({
    client: mongoose.connection.getClient(), // reuse the connection Mongoose already opened
    dbName: mongoose.connection.name,
    collectionName: "sessions",
    ttl: Math.round(maxAgeMs / 1000),
    touchAfter: 24 * 3600 // do not rewrite an unchanged session more than once a day
  });
  store.on("error", (error) => console.error("[session] store error:", error.message));

  return session({
    name: SESSION_COOKIE,
    secret: config.sessionSecret || "nook_development_secret_change_me",
    store,
    resave: false,
    saveUninitialized: false,
    // Behind a TLS-terminating proxy the request itself is plain http; `proxy` makes express-session
    // honour X-Forwarded-Proto so the Secure flag can be set.
    proxy: Boolean(config.trustProxy),
    cookie: {
      maxAge: maxAgeMs,
      httpOnly: true,                       // JavaScript cannot read the cookie
      sameSite: "lax",                      // sent on normal navigation, blocked on cross-site posts
      secure: config.isProd ? "auto" : false // HTTPS-only in production
    }
  });
}
