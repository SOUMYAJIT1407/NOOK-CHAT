/**
 * routes/uploadRoutes.js — file / image / voice-note sharing and profile pictures (mounted at /api)
 * ------------------------------------------------------------------------------------------
 *   POST   /api/messages/upload?to=<id>   raw file body -> storage -> a chat message pushed live
 *   POST   /api/users/avatar              profile picture
 *   DELETE /api/users/avatar              remove the profile picture
 *
 * Files are sent as the raw request body (no multipart parser needed): the browser puts the name and
 * type in the X-File-Name / X-File-Type headers. Stored names are random hex strings so nobody can
 * guess a URL; downloading is handled (and access-checked) in routes/fileRoutes.js.
 */
import express from "express";
import crypto from "crypto";
import path from "path";
import { config } from "../config/env.js";
import isAuthenticated from "../middleware/authMiddleware.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { assertCanMessage, createFileMessage, ServiceError } from "../services/messageService.js";
import { saveFile, removeFile } from "../services/storage.js";
import { INLINE_IMAGES, INLINE_AUDIO } from "./fileRoutes.js";

const router = express.Router();

const MAX_AVATAR = 3 * 1024 * 1024;
const AVATAR_EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" };
const uploadLimiter = rateLimit({ windowMs: 60_000, max: 60, message: "You are sending files too quickly. Please wait a moment." });

const raw = (limit) => express.raw({ type: () => true, limit });

/** Make a user-supplied file name safe: decode it, drop path/control characters, limit its length. */
function cleanName(value) {
  let name = "file";
  try { name = decodeURIComponent(String(value || "file")); } catch { name = String(value || "file"); }
  name = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 120);
  return name || "file";
}

const extOf = (name) => path.extname(name).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 10);

function normalizeMime(value) {
  const mime = String(value || "").split(";")[0].trim().toLowerCase();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime) ? mime : "application/octet-stream";
}

// Send a file / image / voice note in a conversation (creates the message and pushes it live).
router.post("/messages/upload", isAuthenticated, uploadLimiter, raw(config.maxUploadBytes), async (req, res) => {
  const userId = String(req.user._id);
  const to = String(req.query.to || "");
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ success: false, message: "Empty file." });

  let stored = null;
  try {
    await assertCanMessage(userId, to); // valid receiver, a friend, not yourself

    const name = cleanName(req.headers["x-file-name"]);
    const mime = normalizeMime(req.headers["x-file-type"] || req.headers["content-type"]);
    const voice = req.query.voice === "1" && INLINE_AUDIO.test(mime);
    const type = voice ? "audio" : INLINE_IMAGES.has(mime) ? "image" : "file";
    stored = `${crypto.randomBytes(16).toString("hex")}${extOf(name)}`;

    await saveFile("chat", stored, req.body, { mime, name });

    const caption = typeof req.query.caption === "string" ? req.query.caption.trim().slice(0, 1000) : "";
    const payload = await createFileMessage(userId, to, {
      type, caption, file: { stored, name, size: req.body.length, mime }, replyTo: req.query.replyTo
    });
    req.app.get("emitToUsers")([userId, to], "new-message", payload);
    res.json({ success: true, message: payload });
  } catch (error) {
    if (stored) await removeFile("chat", stored); // do not leave an orphan file behind
    if (error instanceof ServiceError) return res.status(400).json({ success: false, message: error.message });
    throw error; // -> middleware/errorHandler.js
  }
});

// Profile picture (public, random file name).
router.post("/users/avatar", isAuthenticated, raw(MAX_AVATAR), async (req, res) => {
  const mime = normalizeMime(req.headers["x-file-type"] || req.headers["content-type"]);
  if (!AVATAR_EXT[mime]) return res.status(400).json({ success: false, message: "Use a PNG, JPG, WEBP or GIF image." });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ success: false, message: "Empty image." });

  const key = `${crypto.randomBytes(12).toString("hex")}${AVATAR_EXT[mime]}`;
  await saveFile("avatar", key, req.body, { mime });

  const old = req.user.photo;
  req.user.photo = `/avatars/${key}`;
  await req.user.save();
  if (old?.startsWith("/avatars/")) await removeFile("avatar", path.basename(old));

  req.app.get("broadcastProfile")(req.user);
  res.json({ success: true, photo: req.user.photo });
});

router.delete("/users/avatar", isAuthenticated, async (req, res) => {
  const old = req.user.photo;
  req.user.photo = "";
  await req.user.save();
  if (old?.startsWith("/avatars/")) await removeFile("avatar", path.basename(old));
  req.app.get("broadcastProfile")(req.user);
  res.json({ success: true });
});

export default router;
