/**
 * services/friends.js — friendship helpers shared by the routes and socket handlers.
 * A friendship is a FriendRequest document with status "accepted" (direction does not matter).
 */
import mongoose from "mongoose";
import FriendRequest from "../models/FriendRequest.js";
import Message from "../models/Message.js";
import { previewText } from "./messages.js";

const FIELDS = "username email isOnline lastSeen photo bio";

/** The safe subset of a user that may be sent to other users (never the password hash). */
export function publicUser(u) {
  return {
    id: String(u._id),
    username: u.username,
    email: u.email,
    isOnline: Boolean(u.isOnline),
    lastSeen: u.lastSeen,
    photo: u.photo || "",
    bio: u.bio || ""
  };
}

// Typing events and presence checks call areFriends() very often. Friendships are never removed in
// this app, so a positive answer can be remembered for a minute (saves a DB query per keystroke).
const friendCache = new Map(); // "a:b" -> expiry timestamp
const CACHE_MS = 60_000;
const pairKey = (a, b) => (String(a) < String(b) ? `${a}:${b}` : `${b}:${a}`);

/** True when the two users have an accepted friend request in either direction. */
export async function areFriends(a, b) {
  const key = pairKey(a, b);
  const cached = friendCache.get(key);
  if (cached && cached > Date.now()) return true;

  const rel = await FriendRequest.findOne({
    $or: [
      { sender: a, receiver: b, status: "accepted" },
      { sender: b, receiver: a, status: "accepted" }
    ]
  }).select("_id");

  if (rel) {
    if (friendCache.size > 5000) friendCache.clear(); // keep memory bounded
    friendCache.set(key, Date.now() + CACHE_MS);
  }
  return Boolean(rel);
}

/** Ids (strings) of everybody the user is friends with. */
export async function friendIdsOf(userId) {
  const me = String(userId);
  const relations = await FriendRequest.find({
    $or: [{ sender: me }, { receiver: me }],
    status: "accepted"
  }).select("sender receiver");
  return relations.map((r) => (String(r.sender) === me ? String(r.receiver) : String(r.sender)));
}

/**
 * Friends list for the sidebar: each friend plus the last message and unread count, sorted so the
 * most recent conversation is first. Messages the user deleted "for me" are ignored, and a message
 * deleted for everyone shows as "This message was deleted". Plain indexed queries (no aggregation)
 * keep this portable and fast for normal friend-list sizes.
 */
export async function friendsWithMeta(userId) {
  const me = new mongoose.Types.ObjectId(String(userId));
  const relations = await FriendRequest.find({
    $or: [{ sender: me }, { receiver: me }],
    status: "accepted"
  }).populate("sender receiver", FIELDS);

  const friends = await Promise.all(relations.map(async (r) => {
    const other = String(r.sender._id) === String(me) ? r.receiver : r.sender;
    const otherId = new mongoose.Types.ObjectId(String(other._id));

    const [last, unread] = await Promise.all([
      Message.findOne({
        $or: [{ sender: me, receiver: otherId }, { sender: otherId, receiver: me }],
        deletedFor: { $ne: me }
      }).sort({ createdAt: -1, _id: -1 }),
      Message.countDocuments({
        sender: otherId, receiver: me, readAt: null,
        type: { $ne: "call" }, deletedFor: { $ne: me }, deletedForEveryone: { $ne: true }
      })
    ]);

    return {
      ...publicUser(other),
      lastMessage: last ? { text: previewText(last).slice(0, 80), at: last.createdAt, mine: String(last.sender) === String(me) } : null,
      unread
    };
  }));

  friends.sort((a, b) => {
    const ta = a.lastMessage ? new Date(a.lastMessage.at).getTime() : 0;
    const tb = b.lastMessage ? new Date(b.lastMessage.at).getTime() : 0;
    return tb - ta || a.username.localeCompare(b.username);
  });
  return friends;
}
