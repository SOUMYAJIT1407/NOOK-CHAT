/**
 * routes/userRoutes.js — people & profile API (mounted at /api/users)
 *   GET   /search?q=     find people by any characters of their name
 *   GET   /friends       friends list with last message + unread count
 *   PATCH /profile       update bio
 *   GET   /:id/shared    photos and files shared with a friend (info panel)
 */

import express from "express";
import User from "../models/User.js";
import FriendRequest from "../models/FriendRequest.js";
import isAuthenticated from "../middleware/authMiddleware.js";
import Message from "../models/Message.js";
import { friendsWithMeta, publicUser, areFriends } from "../services/friends.js";
import { isObjectId } from "../services/messageService.js";
import { rateLimit } from "../middleware/rateLimit.js";

const router = express.Router();
const searchLimiter = rateLimit({ windowMs: 60_000, max: 120, message: "Too many searches. Please slow down." });

// Escape characters that have a special meaning inside a regular expression (user input!).
const escapeRe = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True when the letters of `needle` appear in `text` in the same order (not necessarily together). Linear time. */
function hasLettersInOrder(text, needleChars) {
  let i = 0;
  for (const ch of text) if (ch === needleChars[i] && ++i === needleChars.length) return true;
  return needleChars.length === 0;
}

const MAX_RESULTS = 15;

// SEARCH BY NAME
// "ali" finds Alice, Khalid and Natalie (all contain the letters "a", "l", "i" in order).
//   1. The database looks for names that CONTAIN what was typed (a plain, fast substring match).
//   2. If that gives fewer than MAX_RESULTS people, it also fetches names that contain every
//      distinct typed letter, and Node.js keeps the ones where the letters appear in order.
//      (Doing step 2's "letters in order" check in JavaScript instead of one big regular expression
//      such as a.*l.*i keeps the database safe: a long query can never trigger catastrophic
//      regex backtracking.)
//   3. Results are ranked: exact name, starts-with, contains, scattered letters. Each person also
//      carries their relationship to you (friend / request sent / request received / none) so the
//      page can show the right button.
router.get("/search", isAuthenticated, searchLimiter, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim().slice(0, 30);
    const currentUserId = String(req.user._id);
    if (!q) return res.json({ success: true, users: [] });

    const needle = q.toLowerCase();
    const letters = [...needle].filter((c) => c.trim());
    const notMe = { _id: { $ne: currentUserId } };
    const FIELDS = "username email isOnline lastSeen photo bio";

    // 1) names that contain the text
    const found = new Map();
    const containing = await User.find({ ...notMe, username: { $regex: escapeRe(q), $options: "i" } })
      .select(FIELDS).limit(60);
    containing.forEach((u) => found.set(String(u._id), u));

    // 2) names that contain all the typed letters in order (only when there is room for more)
    if (found.size < MAX_RESULTS && letters.length > 1) {
      const distinct = [...new Set(letters)];
      const loose = await User.find({
        ...notMe,
        $and: distinct.map((c) => ({ username: { $regex: escapeRe(c), $options: "i" } }))
      }).select(FIELDS).limit(200);
      for (const u of loose) {
        if (!found.has(String(u._id)) && hasLettersInOrder(u.username.toLowerCase(), letters)) found.set(String(u._id), u);
      }
    }

    const rank = (name) => {
      const n = name.toLowerCase();
      if (n === needle) return 0;
      if (n.startsWith(needle)) return 1;
      if (n.includes(needle)) return 2;
      return 3;
    };
    const users = [...found.values()]
      .map((u) => ({ u, r: rank(u.username) }))
      .sort((a, b) => a.r - b.r || a.u.username.localeCompare(b.u.username))
      .slice(0, MAX_RESULTS)
      .map((x) => x.u);

    const relations = await FriendRequest.find({
      $or: [{ sender: currentUserId }, { receiver: currentUserId }]
    }).select("sender receiver status");

    const statusMap = new Map();
    for (const relation of relations) {
      const sender = String(relation.sender);
      const receiver = String(relation.receiver);
      const otherId = sender === currentUserId ? receiver : sender;
      if (relation.status === "accepted") statusMap.set(otherId, "friends");
      else if (relation.status === "pending") statusMap.set(otherId, sender === currentUserId ? "pending_sent" : "pending_received");
    }

    res.json({
      success: true,
      users: users.map((user) => ({
        ...publicUser(user),
        relationship: statusMap.get(String(user._id)) || "none"
      }))
    });
  } catch (error) {
    console.error("User search error:", error);
    res.status(500).json({ success: false, message: "Search failed." });
  }
});

router.get("/friends", isAuthenticated, async (req, res) => {
  try {
    res.json({ success: true, friends: await friendsWithMeta(req.user._id) });
  } catch (error) {
    console.error("Friends error:", error);
    res.status(500).json({ success: false, message: "Could not load friends." });
  }
});

router.patch("/profile", isAuthenticated, async (req, res) => {
  try {
    const bio = String(req.body.bio ?? "").trim().slice(0, 160);
    req.user.bio = bio;
    await req.user.save();
    req.app.get("broadcastProfile")(req.user);
    res.json({ success: true, bio });
  } catch (error) {
    console.error("Profile error:", error);
    res.status(500).json({ success: false, message: "Could not update profile." });
  }
});

// Shared media / files between me and a friend (for the info panel).
// Only friends may see what was shared between them.
router.get("/:id/shared", isAuthenticated, async (req, res) => {
  try {
    const me = String(req.user._id);
    const other = String(req.params.id);
    if (!isObjectId(other) || !(await areFriends(me, other))) {
      return res.status(403).json({ success: false, message: "Not allowed." });
    }
    // Skip anything this user deleted for themselves, or the sender deleted for everyone.
    const items = await Message.find({
      type: { $in: ["image", "file"] },
      deletedFor: { $ne: me },
      deletedForEveryone: { $ne: true },
      $or: [{ sender: me, receiver: other }, { sender: other, receiver: me }]
    }).sort({ createdAt: -1, _id: -1 }).limit(60);
    res.json({
      success: true,
      items: items.map((m) => ({
        id: String(m._id), type: m.type, url: `/files/${m.file.stored}`,
        name: m.file.name, size: m.file.size, mime: m.file.mime, createdAt: m.createdAt
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Could not load shared items." });
  }
});

export default router;
