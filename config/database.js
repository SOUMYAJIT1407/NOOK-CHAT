/**
 * config/database.js — MongoDB connection (Mongoose).
 */
import dns from "dns";
import mongoose from "mongoose";
import { config } from "./env.js";
import User from "../models/User.js";

/** Apply the DNS settings from config (see config/env.js for why). Safe to call once at boot. */
export function applyDnsSettings() {
  dns.setDefaultResultOrder("ipv4first"); // some networks hand out broken IPv6 routes
  if (config.dnsServers.length) {
    try { dns.setServers(config.dnsServers); } catch (error) { console.warn("[db] Could not set DNS servers:", error.message); }
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Connects to MongoDB. Cloud databases are sometimes briefly unreachable while a service is
 * starting, so we try a few times before giving up (the host then restarts the app).
 */
export async function connectDatabase({ attempts = 4, delayMs = 3000 } = {}) {
  mongoose.set("strictQuery", true);
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await mongoose.connect(config.mongoUri, {
        serverSelectionTimeoutMS: 30000,
        connectTimeoutMS: 30000,
        maxPoolSize: 10
      });
      console.log("MongoDB Connected Successfully");
      return mongoose.connection;
    } catch (error) {
      lastError = error;
      console.error(`[db] Connection attempt ${attempt}/${attempts} failed: ${error.message}`);
      if (attempt < attempts) await sleep(delayMs);
    }
  }
  throw lastError;
}

/** True while the driver has a live connection (used by the /readyz health check). */
export const isDatabaseReady = () => mongoose.connection.readyState === 1;

export async function disconnectDatabase() {
  try { await mongoose.connection.close(); } catch { /* already closed */ }
}

/**
 * After a crash or redeploy nobody is really connected, but the database may still say
 * "isOnline: true" for users. Reset it at boot so presence is never stuck on "Online".
 */
export async function resetPresence() {
  const result = await User.updateMany({ isOnline: true }, { isOnline: false });
  const count = result.modifiedCount ?? result.nModified ?? 0;
  if (count) console.log(`[db] Reset presence for ${count} user(s).`);
}
