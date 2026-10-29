/**
 * routes/pageRoutes.js — the HTML pages that are not login/register.
 *   GET /      public landing page
 *   GET /chat  the Messenger (login required)
 *   GET /api/calls/ice-config   STUN/TURN servers for WebRTC calls
 */
import express from "express";
import { config } from "../config/env.js";
import isAuthenticated from "../middleware/authMiddleware.js";

const router = express.Router();

// `userLoggedIn` lets the landing-page buttons go straight to the chat when already logged in.
router.get("/", (req, res) => {
  res.render("home", { userLoggedIn: Boolean(req.session.userId) });
});

router.get("/chat", isAuthenticated, (req, res) => {
  res.render("chat", { user: req.user });
});

// STUN (free, Google) works on most networks. For strict firewalls / mobile carriers add a TURN server
// with TURN_URL / TURN_USERNAME / TURN_CREDENTIAL — otherwise some calls will not connect.
router.get("/api/calls/ice-config", isAuthenticated, (req, res) => {
  const iceServers = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
  if (config.turn.urls.length) {
    iceServers.push({ urls: config.turn.urls, username: config.turn.username, credential: config.turn.credential });
  }
  res.json({ success: true, iceServers });
});

export default router;
