/**
 * routes/friendRoutes.js — friend requests (mounted at /api/friends)
 *   GET   /requests                   incoming pending requests
 *   POST  /requests/:userId           send a request
 *   PATCH /requests/:requestId/accept accept (both users get a live "friend-request-updated")
 *   PATCH /requests/:requestId/reject decline
 * Chatting, calling and file sharing are only allowed between accepted friends.
 */

import express from "express";
import mongoose from "mongoose";
import FriendRequest from "../models/FriendRequest.js";
import User from "../models/User.js";
import isAuthenticated from "../middleware/authMiddleware.js";

const router = express.Router();

function validId(id) {
  return mongoose.isValidObjectId(id);
}

/** Finds an existing request between two users, whichever of them sent it. */
async function getRelation(userA, userB) {
  return FriendRequest.findOne({
    $or: [
      { sender: userA, receiver: userB },
      { sender: userB, receiver: userA }
    ]
  });
}

router.get("/requests", isAuthenticated, async (req, res) => {
  try {
    const requests = await FriendRequest.find({
      receiver: req.user._id,
      status: "pending"
    })
      .populate("sender", "username email isOnline lastSeen photo bio")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      requests: requests.map((request) => ({
        id: String(request._id),
        user: {
          id: String(request.sender._id),
          username: request.sender.username,
          email: request.sender.email,
          isOnline: request.sender.isOnline,
          lastSeen: request.sender.lastSeen,
          photo: request.sender.photo || "",
          bio: request.sender.bio || ""
        },
        createdAt: request.createdAt
      })),
      count: requests.length
    });
  } catch (error) {
    console.error("Friend requests error:", error);
    res.status(500).json({ success: false, message: "Unable to load requests." });
  }
});

router.post("/requests/:userId", isAuthenticated, async (req, res) => {
  try {
    const targetId = String(req.params.userId);
    const currentUserId = String(req.user._id);

    if (!validId(targetId) || targetId === currentUserId) {
      return res.status(400).json({ success: false, message: "Invalid user." });
    }

    const target = await User.findById(targetId).select("username email isOnline lastSeen photo bio");
    if (!target) return res.status(404).json({ success: false, message: "User not found." });

    const existing = await getRelation(currentUserId, targetId);

    if (existing) {
      if (existing.status === "accepted") {
        return res.json({ success: true, status: "friends", message: "You are already friends." });
      }
      if (existing.status === "pending") {
        return res.json({
          success: true,
          status: String(existing.sender) === currentUserId ? "pending_sent" : "pending_received",
          message: "A request already exists."
        });
      }

      existing.sender = currentUserId;
      existing.receiver = targetId;
      existing.status = "pending";
      await existing.save();
      req.app.get("emitToUsers")([targetId], "friend-request", { from: currentUserId });

      return res.json({ success: true, status: "pending_sent", requestId: String(existing._id) });
    }

    const request = await FriendRequest.create({
      sender: currentUserId,
      receiver: targetId,
      status: "pending"
    });

    req.app.get("emitToUsers")([targetId], "friend-request", { from: currentUserId });
    res.json({ success: true, status: "pending_sent", requestId: String(request._id) });
  } catch (error) {
    console.error("Send friend request error:", error);
    res.status(500).json({ success: false, message: "Could not send request." });
  }
});

router.patch("/requests/:requestId/accept", isAuthenticated, async (req, res) => {
  try {
    const requestId = String(req.params.requestId);
    if (!validId(requestId)) return res.status(400).json({ success: false, message: "Invalid request ID." });

    const request = await FriendRequest.findOne({
      _id: requestId,
      receiver: req.user._id,
      status: "pending"
    }).populate("sender", "username email isOnline lastSeen photo bio");

    if (!request) return res.status(404).json({ success: false, message: "Request not found." });

    request.status = "accepted";
    await request.save();
    req.app.get("emitToUsers")([String(request.sender._id), String(req.user._id)], "friend-request-updated", { status: "accepted" });

    res.json({
      success: true,
      status: "accepted",
      friend: {
        id: String(request.sender._id),
        username: request.sender.username,
        email: request.sender.email,
        isOnline: request.sender.isOnline,
        lastSeen: request.sender.lastSeen,
        photo: request.sender.photo || "",
        bio: request.sender.bio || ""
      }
    });
  } catch (error) {
    console.error("Accept request error:", error);
    res.status(500).json({ success: false, message: "Could not accept request." });
  }
});

router.patch("/requests/:requestId/reject", isAuthenticated, async (req, res) => {
  try {
    const requestId = String(req.params.requestId);
    if (!validId(requestId)) return res.status(400).json({ success: false, message: "Invalid request ID." });

    const request = await FriendRequest.findOne({
      _id: requestId,
      receiver: req.user._id,
      status: "pending"
    });

    if (!request) return res.status(404).json({ success: false, message: "Request not found." });

    request.status = "rejected";
    await request.save();

    res.json({ success: true, status: "rejected" });
  } catch (error) {
    console.error("Reject request error:", error);
    res.status(500).json({ success: false, message: "Could not reject request." });
  }
});

export default router;
