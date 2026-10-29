/**
 * tests/helpers/testApp.js — starts the REAL Express app (app.js) on a random port for HTTP tests.
 * Only two things differ from production: the database is the in-memory stand-in, and sessions use
 * the simple built-in memory store instead of MongoDB.
 */
import "./env.js";
import http from "http";
import bcrypt from "bcryptjs";
import session from "express-session";
import { createApp } from "../../app.js";
import { SESSION_COOKIE } from "../../config/session.js";
import { installFakeDb, makeUser } from "./fakeDb.js";
import { initStorage } from "../../services/storage.js";

export const PASSWORD = "Passw0rd!";

/** Boots the app. Returns { url, emitted, close }. `emitted` records every live event the routes push. */
export async function startTestApp() {
  installFakeDb();
  await initStorage(); // creates the upload folders, exactly like server.js does at start-up
  const sessionMiddleware = session({ name: SESSION_COOKIE, secret: "test", resave: false, saveUninitialized: false });
  const app = createApp({ sessionMiddleware });

  const emitted = [];
  app.set("emitToUsers", (users, event, payload) => emitted.push({ users, event, payload }));
  app.set("broadcastProfile", () => {});

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, emitted, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** Creates a user whose password is PASSWORD. */
export async function makeLoginUser(username) {
  return makeUser(username, { password: await bcrypt.hash(PASSWORD, 4) });
}

/** A tiny HTTP client that remembers the session cookie of ONE logged-in person. */
export class Client {
  constructor(baseUrl) { this.baseUrl = baseUrl; this.cookie = ""; }

  async request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (this.cookie) headers.cookie = this.cookie;
    const res = await fetch(this.baseUrl + path, { redirect: "manual", ...options, headers });
    const setCookie = res.headers.getSetCookie?.() || [];
    const sid = setCookie.map((c) => c.split(";")[0]).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    if (sid) this.cookie = sid;
    return res;
  }

  async login(user) {
    const body = new URLSearchParams({ email: user.email, password: PASSWORD });
    const res = await this.request("/login", { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } });
    if (res.status !== 302 || res.headers.get("location") !== "/chat") throw new Error(`login failed (${res.status})`);
    return this;
  }

  json(path, options) { return this.request(path, options).then((r) => r.json()); }

  /** Upload a file to a friend (raw body, like the browser does). */
  upload(toId, bytes, { name = "pic.png", type = "image/png", query = "" } = {}) {
    return this.request(`/api/messages/upload?to=${toId}${query}`, {
      method: "POST", body: bytes,
      headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(name), "x-file-type": type }
    });
  }
}
