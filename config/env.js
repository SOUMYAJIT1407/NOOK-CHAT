/**
 * config/env.js — the ONE place where environment variables are read.
 * ------------------------------------------------------------------------------------------
 * • Loads `.env` (if the file exists) — on cloud hosts you normally set real environment
 *   variables in the dashboard instead, and a missing .env file is perfectly fine.
 * • This code only READS the .env file. It never writes to it.
 * • Everything else in the project imports `config` from here instead of touching process.env,
 *   so defaults and validation live in a single, documented place.
 */
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

/** Absolute path of the project folder (works no matter where `node` is started from). */
export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PUBLIC_DIR = path.join(ROOT_DIR, "public");
export const VIEWS_DIR = path.join(ROOT_DIR, "views");

dotenv.config({ path: path.join(ROOT_DIR, ".env") });

const env = process.env;

/** "true" / "1" / "yes" / "on" -> true, empty -> fallback. */
const bool = (value, fallback) =>
  value === undefined || value === "" ? fallback : ["1", "true", "yes", "on"].includes(String(value).toLowerCase());

/** Comma separated list -> trimmed array without empty items. */
const list = (value) => String(value || "").split(",").map((item) => item.trim()).filter(Boolean);

const isProd = env.NODE_ENV === "production";

/** Session secrets that must never be used on a public server. */
const WEAK_SECRETS = ["replace_with_a_long_random_secret", "nook_development_secret_change_me", "changeme", "secret"];

/**
 * "trust proxy" tells Express it sits behind a load balancer (Render, Railway, Heroku, Fly,
 * Nginx, Cloudflare...). It makes req.ip / req.protocol correct and lets secure cookies work.
 * TRUST_PROXY accepts: false | true | a hop count such as 1 | an IP/subnet list.
 */
function parseTrustProxy(value) {
  if (value === undefined || value === "") return isProd ? 1 : false;
  if (/^(false|0|no|off)$/i.test(value)) return false;
  if (/^(true|yes|on)$/i.test(value)) return true;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

export const config = {
  env: env.NODE_ENV || "development",
  isProd,

  // Hosting platforms inject PORT; 3000 is the local default.
  port: Number(env.PORT) || 3000,
  trustProxy: parseTrustProxy(env.TRUST_PROXY),

  mongoUri: String(env.MONGO_URI || "").trim(),
  sessionSecret: env.SESSION_SECRET || "",
  sessionDays: Number(env.SESSION_DAYS) || 7,

  /**
   * DNS servers. MongoDB Atlas "mongodb+srv://" addresses need SRV lookups that some home/office
   * networks block, so locally we default to Google DNS (this is what the project always did).
   * In production the platform's own DNS is used unless DNS_SERVERS is set explicitly.
   */
  dnsServers: env.DNS_SERVERS !== undefined ? list(env.DNS_SERVERS) : isProd ? [] : ["8.8.8.8", "8.8.4.4"],

  /**
   * Where uploaded files / avatars are kept:
   *   gridfs (default) -> inside MongoDB. Survives redeploys, restarts and container replacement,
   *                       which is what you want on cloud hosts with a temporary disk.
   *   local            -> UPLOAD_DIR on disk. Only use it with a persistent volume.
   */
  storageDriver: (env.STORAGE_DRIVER || "gridfs").toLowerCase(),
  uploadDir: path.resolve(ROOT_DIR, env.UPLOAD_DIR || "uploads"),
  maxUploadMb: Number(env.MAX_UPLOAD_MB) || 25,

  // Socket.IO is same-origin by default. Only set CORS_ORIGIN if the web page is on another domain.
  corsOrigins: list(env.CORS_ORIGIN),

  // Optional features
  google: {
    clientId: env.GOOGLE_CLIENT_ID || "",
    clientSecret: env.GOOGLE_CLIENT_SECRET || "",
    callbackUrl: env.GOOGLE_CALLBACK_URL || ""
  },
  turn: {
    urls: list(env.TURN_URL),
    username: env.TURN_USERNAME || "",
    credential: env.TURN_CREDENTIAL || ""
  },

  // Brute-force protection (requests per window per IP) for login / register.
  authRateLimit: { windowMs: 15 * 60 * 1000, max: Number(env.AUTH_RATE_LIMIT) || 30 },

  // How long "delete for everyone" stays available; 0 = no limit.
  deleteForEveryoneMinutes: Number(env.DELETE_FOR_EVERYONE_MINUTES) || 0
};

config.maxUploadBytes = config.maxUploadMb * 1024 * 1024;

/**
 * Checks the configuration at start-up. `errors` stop the server (it would not work or would be
 * unsafe), `warnings` are only printed.
 */
export function validateConfig() {
  const errors = [];
  const warnings = [];

  if (!config.mongoUri) errors.push("MONGO_URI is missing. Add your MongoDB connection string to .env (or to the host's environment variables).");
  if (!["gridfs", "local"].includes(config.storageDriver)) errors.push(`STORAGE_DRIVER must be "gridfs" or "local" (got "${config.storageDriver}").`);

  const weakSecret = !config.sessionSecret || WEAK_SECRETS.includes(config.sessionSecret) || config.sessionSecret.length < 16;
  if (weakSecret) {
    const hint = "Set SESSION_SECRET to a long random string, e.g. run: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"";
    if (isProd) errors.push(`SESSION_SECRET is missing or too weak. ${hint}`);
    else warnings.push(`SESSION_SECRET is missing or weak (fine for local development only). ${hint}`);
  }

  if (isProd && config.storageDriver === "local") warnings.push("STORAGE_DRIVER=local: uploads are lost on hosts with an ephemeral disk unless UPLOAD_DIR is a persistent volume.");
  if (isProd && !config.trustProxy) warnings.push("TRUST_PROXY is off. Behind a load balancer, set TRUST_PROXY=1 so secure cookies and client IPs work.");
  if (Boolean(config.google.clientId) !== Boolean(config.google.clientSecret)) warnings.push("Only one of GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET is set — Google sign-in stays disabled.");

  return { errors, warnings };
}

export { bool };
