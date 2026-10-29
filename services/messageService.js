/**
 * services/messageService.js — all chat business rules in one place.
 * ------------------------------------------------------------------------------------------
 * The Socket.IO handlers (sockets/chatHandlers.js) and the upload route only translate between
 * the network and these functions. Keeping the rules here makes them easy to read and to test
 * without a browser or a socket. Every function throws a ServiceError with a user-friendly
 * message when something is not allowed.
 */
import mongoose from "mongoose";
import Message from "../models/Message.js";
import User from "../models/User.js";
import { config } from "../config/env.js";
import { areFriends } from "./friends.js";
import { serializeMany, serializeOne } from "./messages.js";
import { removeFile } from "./storage.js";

/** An error whose message is safe to show to the user. */
export class ServiceError extends Error {}
const fail = (message) => { throw new ServiceError(message); };

/** Strict 24-hex-character ObjectId check (mongoose.isValidObjectId also accepts any 12-char string). */
export const isObjectId = (value) => typeof value === "string" && /^[a-f0-9]{24}$/i.test(value);

export const ALLOWED_REACTIONS = ["❤️", "👍", "😂", "😮", "😢", "🔥"];
const MAX_TEXT = 5000;
const HISTORY_LIMIT = 500;

/** Both directions of one conversation. */
const between = (a, b) => ({ $or: [{ sender: a, receiver: b }, { sender: b, receiver: a }] });

// -------------------------------------------------------------------------------------------
// Sending
// -------------------------------------------------------------------------------------------

/** Throws unless `userId` may message `receiverId` (valid id, not yourself, exists, friends). */
export async function assertCanMessage(userId, receiverId) {
  if (!isObjectId(receiverId)) fail("Invalid message data.");
  if (String(receiverId) === String(userId)) fail("You cannot message yourself.");
  if (!(await User.exists({ _id: receiverId }))) fail("Receiver not found.");
  if (!(await areFriends(userId, receiverId))) fail("Accept the friend request before messaging.");
}

/** A reply target must be a still-visible message of the SAME conversation, otherwise it is ignored. */
async function validReplyTo(userId, receiverId, replyTo) {
  if (!isObjectId(replyTo)) return null;
  const ok = await Message.exists({ _id: replyTo, deletedForEveryone: { $ne: true }, deletedFor: { $ne: userId }, ...between(userId, receiverId) });
  return ok ? replyTo : null;
}

/** Saves a text message. Returns the payload to push to both people. */
export async function sendText(userId, { receiverId, message, replyTo } = {}) {
  const text = typeof message === "string" ? message.trim().slice(0, MAX_TEXT) : "";
  if (!text) fail("Invalid message data.");
  await assertCanMessage(userId, String(receiverId || ""));

  const doc = await Message.create({
    sender: userId, receiver: receiverId, type: "text", message: text,
    replyTo: await validReplyTo(userId, receiverId, replyTo)
  });
  return serializeOne(doc);
}

/** Saves a message that carries an already-stored file (image / file / voice note). */
export async function createFileMessage(userId, receiverId, { type, caption = "", file, replyTo = null }) {
  const doc = await Message.create({
    sender: userId, receiver: receiverId, type, message: caption, file,
    replyTo: await validReplyTo(userId, receiverId, replyTo)
  });
  return serializeOne(doc);
}

// -------------------------------------------------------------------------------------------
// Reading
// -------------------------------------------------------------------------------------------

/** The latest messages of a conversation, oldest first, WITHOUT the ones this user deleted for themselves. */
export async function loadConversation(userId, otherId) {
  if (!isObjectId(otherId)) fail("Invalid user ID.");
  if (!(await areFriends(userId, otherId))) fail("You can chat only after accepting the friend request.");

  const messages = await Message.find({ ...between(userId, otherId), deletedFor: { $ne: userId } })
    .sort({ createdAt: -1, _id: -1 }) // _id breaks ties between messages created in the same millisecond
    .limit(HISTORY_LIMIT);
  messages.reverse();
  return serializeMany(messages);
}

/** Marks everything `otherId` sent to `userId` as seen. Returns how many messages changed. */
export async function markConversationRead(userId, otherId) {
  if (!isObjectId(otherId)) return { modified: 0, at: null };
  const at = new Date();
  const result = await Message.updateMany({ sender: otherId, receiver: userId, readAt: null }, { readAt: at });
  return { modified: result.modifiedCount ?? 0, at };
}

// -------------------------------------------------------------------------------------------
// Editing & reacting
// -------------------------------------------------------------------------------------------

export async function editMessage(userId, messageId, text) {
  const clean = typeof text === "string" ? text.trim().slice(0, MAX_TEXT) : "";
  if (!isObjectId(messageId) || !clean) fail("Invalid message.");

  const message = await Message.findOneAndUpdate(
    { _id: messageId, sender: userId, type: { $in: ["text", "image", "file"] }, deletedForEveryone: { $ne: true } },
    { message: clean, edited: true, updatedAt: new Date() },
    { new: true }
  );
  if (!message) fail("Message not found.");
  return { recipients: [String(message.sender), String(message.receiver)], payload: { _id: String(message._id), message: message.message, edited: true, updatedAt: message.updatedAt } };
}

/** Adds, changes or removes (same emoji again) this user's reaction. */
export async function toggleReaction(userId, messageId, emoji) {
  if (!isObjectId(messageId) || typeof emoji !== "string") fail("Invalid reaction.");
  if (!ALLOWED_REACTIONS.includes(emoji)) fail("Unsupported reaction.");

  const message = await Message.findOne({ _id: messageId, deletedForEveryone: { $ne: true }, deletedFor: { $ne: userId }, $or: [{ sender: userId }, { receiver: userId }] });
  if (!message) fail("Message not found.");

  const reactions = Object.fromEntries(message.reactions || []);
  if (reactions[userId] === emoji) delete reactions[userId]; else reactions[userId] = emoji;
  message.reactions = reactions;
  message.updatedAt = new Date();
  await message.save();

  return { recipients: [String(message.sender), String(message.receiver)], payload: { messageId: String(message._id), reactions } };
}

// -------------------------------------------------------------------------------------------
// Deleting — "Delete for me" and "Delete for everyone"
// -------------------------------------------------------------------------------------------

/**
 * scope "me"        Hides the message for this user only (either person may do this, for any message,
 *                   including call history). The other person is not affected. When both people have
 *                   deleted it for themselves it is erased from the database completely.
 * scope "everyone"  Only the SENDER may do this. The text / file is wiped from the database and the
 *                   stored file is deleted; both people then see "This message was deleted".
 *                   Call history cannot be deleted for everyone. DELETE_FOR_EVERYONE_MINUTES can limit
 *                   how long after sending this stays possible.
 *
 * Returns { scope, messageId, recipients, deletedAt } — `recipients` are the users who must be
 * told (just the requester for "me", both people for "everyone").
 */
export async function deleteMessage(userId, messageId, scope) {
  if (!isObjectId(messageId)) fail("Invalid message.");
  if (scope !== "me" && scope !== "everyone") fail("Choose “Delete for me” or “Delete for everyone”.");

  const me = String(userId);
  const message = await Message.findOne({ _id: messageId, $or: [{ sender: me }, { receiver: me }] });
  if (!message) fail("Message not found.");

  const sender = String(message.sender);
  const receiver = String(message.receiver);

  // ---- Delete for everyone ----
  if (scope === "everyone") {
    if (sender !== me) fail("Only the sender can delete a message for everyone.");
    if (message.type === "call") fail("Call history can only be deleted for yourself.");
    if (message.deletedForEveryone) return { scope, messageId, recipients: [sender, receiver], deletedAt: message.deletedAt }; // already done

    const limit = config.deleteForEveryoneMinutes;
    if (limit > 0 && Date.now() - new Date(message.createdAt).getTime() > limit * 60_000) {
      fail(`Messages can only be deleted for everyone within ${limit} minute${limit === 1 ? "" : "s"} of sending.`);
    }

    const deletedAt = new Date();
    // Atomic: only the first request wins, and we get the OLD document back to know which file to erase.
    const before = await Message.findOneAndUpdate(
      { _id: messageId, sender: me, deletedForEveryone: { $ne: true } },
      { $set: { deletedForEveryone: true, deletedAt, message: "", edited: false, reactions: {}, updatedAt: deletedAt }, $unset: { file: "" } },
      { new: false }
    );
    if (before?.file?.stored) await removeFile("chat", before.file.stored);
    return { scope, messageId, recipients: [sender, receiver], deletedAt };
  }

  // ---- Delete for me ----
  const updated = await Message.findOneAndUpdate(
    { _id: messageId, $or: [{ sender: me }, { receiver: me }] },
    { $addToSet: { deletedFor: me } },
    { new: true }
  );
  if (!updated) fail("Message not found.");

  const hiddenBy = new Set((updated.deletedFor || []).map(String));
  if (hiddenBy.has(String(updated.sender)) && hiddenBy.has(String(updated.receiver))) {
    // Nobody can see it any more -> remove the record and its file for good.
    await Message.deleteOne({ _id: messageId });
    if (updated.file?.stored) await removeFile("chat", updated.file.stored);
  }
  return { scope, messageId, recipients: [me], deletedAt: null };
}
