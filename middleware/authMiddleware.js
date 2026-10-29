/**
 * middleware/authMiddleware.js — route guard.
 * Loads the logged-in user from the session into req.user, or redirects to /login.
 */

import User from "../models/User.js";

export default async function isAuthenticated(req, res, next) {
  try {
    if (!req.session.userId) {
      return res.redirect("/login");
    }

    const user = await User.findById(req.session.userId);

    if (!user) {
      return req.session.destroy(() => res.redirect("/login"));
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("Authentication error:", error);
    res.status(500).send("Server Error");
  }
}
