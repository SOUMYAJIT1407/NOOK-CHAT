/**
 * routes/oauthRoutes.js — "Continue with Google"
 * ------------------------------------------------------------------------------------------
 * Implements the standard OAuth 2.0 / OpenID Connect "authorization code" flow by hand, using
 * Node's built-in fetch (so no extra npm packages are required):
 *
 *   1. GET /auth/google            -> we redirect the browser to Google's consent screen.
 *   2. Google asks the user to pick an account, then redirects back to
 *      GET /auth/google/callback?code=...&state=...
 *   3. We verify `state` (CSRF protection), swap the `code` for an access token (server to
 *      server), ask Google who the user is, then find / link / create the NOOK account and
 *      log them in by setting req.session.userId — exactly like the normal password login.
 *
 * Configuration (add these lines to your .env — this project never edits your .env for you):
 *     GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
 *     GOOGLE_CLIENT_SECRET=xxxxxxxx
 *     # Optional. Defaults to  http://<host>/auth/google/callback
 *     GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
 * The callback URL must also be listed under "Authorized redirect URIs" for your OAuth client
 * in the Google Cloud Console (APIs & Services -> Credentials).
 */
import express from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { config } from "../config/env.js";

const router = express.Router();

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

/** True when both Google credentials exist in the environment. */
const googleConfigured = () => Boolean(config.google.clientId && config.google.clientSecret);

/** The exact redirect URI we send to Google (must match the Google Console entry). */
function callbackUrl(req) {
  return config.google.callbackUrl || `${req.protocol}://${req.get("host")}/auth/google/callback`;
}

/** Send the user back to the login page with a short notice code (shown as a toast). */
const backToLogin = (res, code) => res.redirect(`/login?notice=${code}`);

/**
 * Build a valid, unique NOOK username from a Google display name / e-mail.
 * Usernames are 3–30 chars and unique, so we sanitise and append a number if needed.
 */
async function makeUniqueUsername(name, email) {
  let base = String(name || email.split("@")[0] || "user")
    .replace(/[^\p{L}\p{N}_ .-]/gu, "")
    .trim()
    .slice(0, 24);
  if (base.length < 3) base = `user${base}`.slice(0, 24);
  let candidate = base;
  for (let i = 0; i < 50; i++) {
    if (!(await User.exists({ username: candidate }))) return candidate;
    candidate = `${base}${Math.floor(100 + Math.random() * 9000)}`.slice(0, 30);
  }
  return `user${crypto.randomBytes(4).toString("hex")}`;
}

// ---- Step 1: send the browser to Google ------------------------------------------------------
router.get("/google", (req, res) => {
  if (!googleConfigured()) {
    console.warn("[Google login] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are missing in .env — see README.");
    return backToLogin(res, "google_not_configured");
  }

  // `state` is a random value we remember in the session and Google echoes back. If it does not
  // match on return, the request did not start here (CSRF) and we reject it.
  const state = crypto.randomBytes(24).toString("hex");
  req.session.oauthState = state;

  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: callbackUrl(req),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account"
  });
  // Make sure the session cookie is stored before leaving our site.
  req.session.save(() => res.redirect(`${GOOGLE_AUTH_URL}?${params}`));
});

// ---- Step 2: Google sends the user back here -------------------------------------------------
router.get("/google/callback", async (req, res) => {
  try {
    if (!googleConfigured()) return backToLogin(res, "google_not_configured");
    if (req.query.error) return backToLogin(res, "google_cancelled"); // user pressed "Cancel"

    const { code, state } = req.query;
    const expected = req.session.oauthState;
    delete req.session.oauthState; // a state value may only be used once
    if (!code || !state || !expected || state !== expected) return backToLogin(res, "google_failed");

    // Swap the one-time code for an access token (server-to-server, uses the client secret).
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: String(code),
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        redirect_uri: callbackUrl(req),
        grant_type: "authorization_code"
      })
    });
    const token = await tokenRes.json();
    if (!tokenRes.ok || !token.access_token) {
      console.error("[Google login] token exchange failed:", token);
      return backToLogin(res, "google_failed");
    }

    // Ask Google who the user is.
    const infoRes = await fetch(GOOGLE_USERINFO_URL, { headers: { Authorization: `Bearer ${token.access_token}` } });
    const profile = await infoRes.json();
    if (!infoRes.ok || !profile.sub || !profile.email) return backToLogin(res, "google_failed");
    if (profile.email_verified === false) return backToLogin(res, "google_unverified");

    const email = String(profile.email).toLowerCase();

    // Find the account: first by Google id, then by e-mail (links an existing NOOK account).
    let user = await User.findOne({ googleId: profile.sub });
    if (!user) user = await User.findOne({ email });

    if (user) {
      if (!user.googleId) user.googleId = profile.sub;           // link the two logins together
      if (!user.photo && profile.picture) user.photo = profile.picture;
    } else {
      // First visit: create a new account. The password field is required by the schema, so we
      // store the hash of a long random string nobody knows (Google users sign in with Google).
      user = new User({
        username: await makeUniqueUsername(profile.name, email),
        email,
        password: await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 12),
        googleId: profile.sub,
        photo: profile.picture || ""
      });
    }
    await user.save();

    // Log in: rotate the session id (prevents session fixation) and store the user id.
    req.session.regenerate((err) => {
      if (err) return backToLogin(res, "google_failed");
      req.session.userId = user._id.toString();
      req.session.save(() => res.redirect("/chat"));
    });
  } catch (error) {
    console.error("[Google login] error:", error);
    backToLogin(res, "google_failed");
  }
});

export default router;
