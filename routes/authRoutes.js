/**
 * routes/authRoutes.js — e-mail / password authentication
 *   GET/POST /register   create an account (password rules are enforced here too, not only in the browser)
 *   GET/POST /login      log in with e-mail OR username
 *   GET      /logout     end the session and mark the user offline
 * ("Continue with Google" lives in routes/oauthRoutes.js)
 */

import express from "express";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { config } from "../config/env.js";
import { SESSION_COOKIE } from "../config/session.js";
import { rateLimit } from "../middleware/rateLimit.js";

const router = express.Router();

// Human-readable messages for the ?notice=<code> redirects used by the Google sign-in flow.
const NOTICES = {
  google_not_configured: "Google sign-in is not set up on this server yet.",
  google_cancelled: "Google sign-in was cancelled.",
  google_failed: "Google sign-in failed. Please try again.",
  google_unverified: "Your Google e-mail address is not verified."
};
const noticeFrom = (req) => NOTICES[req.query.notice] || null;

// Brute-force protection: limit sign-in / sign-up attempts per IP address. When the limit is hit
// the normal page is shown again with a message (the layout is unchanged).
const authLimiter = rateLimit({
  ...config.authRateLimit,
  onLimit: (req, res, message) => {
    const text = "Too many attempts. Please wait a few minutes and try again.";
    return req.path === "/register"
      ? res.status(429).render("register", { error: text })
      : res.status(429).render("login", { error: text, registered: false });
  }
});

// Server-side password rule (the register page shows the same rules + a strength meter):
// at least 6 characters, 3 letters, 1 capital letter and 1 special character.
const passwordIsValid = (password) =>
  typeof password === "string" &&
  password.length >= 6 &&
  /[A-Z]/.test(password) &&
  /[^A-Za-z0-9]/.test(password) &&
  (password.match(/[A-Za-z]/g) || []).length >= 3;

router.get("/register", (req, res) => {
  if (req.session.userId) return res.redirect("/chat");
  res.render("register", { error: noticeFrom(req) });
});

// Create the account. The password is hashed with bcrypt (cost 12) — it is never stored in plain text.
router.post("/register", authLimiter, async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const confirmPassword = String(req.body.confirmPassword || "");

    if (!username || !email || !password || !confirmPassword) {
      return res.render("register", { error: "All fields are required." });
    }

    if (password !== confirmPassword) {
      return res.render("register", { error: "Passwords do not match." });
    }

    if (!passwordIsValid(password)) {
      return res.render("register", {
        error: "Password needs 3 letters, 1 capital letter, and 1 special character."
      });
    }

    const existingUser = await User.findOne({
      $or: [{ email }, { username }]
    });

    if (existingUser) {
      return res.render("register", {
        error: "Username or email already exists."
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    await User.create({
      username,
      email,
      password: hashedPassword
    });

    res.redirect("/login?registered=1");
  } catch (error) {
    console.error("Registration error:", error);
    res.render("register", { error: "Registration failed. Please try again." });
  }
});

router.get("/login", (req, res) => {
  if (req.session.userId) return res.redirect("/chat");
  res.render("login", {
    error: noticeFrom(req),
    registered: req.query.registered === "1"
  });
});

// Check credentials; on success remember the user in the session and open the Messenger.
router.post("/login", authLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.render("login", { error: "Email and password are required.", registered: false });
    }

    const user = await User.findOne({
      $or: [
        { email },
        { username: String(req.body.email || "").trim() }
      ]
    });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.render("login", { error: "Invalid email or password.", registered: false });
    }

    // Start a fresh session id for the logged-in user (prevents "session fixation"). The online
    // status is set by the chat socket when the Messenger opens, not here.
    return req.session.regenerate((err) => {
      if (err) {
        console.error("Session error:", err);
        return res.render("login", { error: "Login failed. Please try again.", registered: false });
      }
      req.session.userId = user._id.toString();
      req.session.save(() => res.redirect("/chat"));
    });
  } catch (error) {
    console.error("Login error:", error);
    res.render("login", { error: "Login failed. Please try again.", registered: false });
  }
});

// End the session. (Online / last-seen status is handled by the chat socket disconnecting.)
router.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie(SESSION_COOKIE);
    res.redirect("/login");
  });
});

export default router;
