/**
 * routes/fileRoutes.js — serving stored files.
 *   GET /files/:key    PRIVATE chat files (images, documents, voice notes). Only the two people in the
 *                      conversation may open them, and never after the message was deleted for them.
 *   GET /avatars/:key  PUBLIC profile pictures (random, unguessable names).
 *
 * IMPORTANT: /files must be mounted AFTER the session middleware (it reads req.session). When it was
 * mounted before, every request was refused and shared images looked "invisible" (see app.js).
 *
 * Files are streamed from the storage back-end (MongoDB GridFS or disk) with support for HTTP Range
 * requests, which Safari / iOS need in order to play voice notes and videos.
 */
import Message from "../models/Message.js";
import { statFile, readFile } from "../services/storage.js";

const CHAT_KEY = /^[a-f0-9]{32}[a-z0-9.]{0,10}$/;
const AVATAR_KEY = /^[a-f0-9]{24}\.(png|jpe?g|webp|gif)$/;
const AVATAR_MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

// Only these are displayed in the page; everything else is offered as a download.
export const INLINE_IMAGES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp"]);
export const INLINE_AUDIO = /^audio\/(webm|ogg|mpeg|mp4|wav|x-m4a|aac)/;

/** Parses "Range: bytes=a-b". Returns {start,end}, null (no/ignored header) or "invalid". */
function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match || (match[1] === "" && match[2] === "")) return null;
  let start; let end;
  if (match[1] === "") { // "-500" = the last 500 bytes
    const suffix = Number(match[2]);
    if (!suffix) return "invalid";
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  return start > end || start >= size ? "invalid" : { start, end };
}

/** Streams `descriptor` to the response, honouring Range requests. */
function sendStored(req, res, descriptor, { mime, headers }) {
  const size = descriptor.size;
  const range = parseRange(req.headers.range, size);

  res.setHeader("Content-Type", mime);
  res.setHeader("Accept-Ranges", "bytes");
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);

  if (range === "invalid") {
    res.status(416).setHeader("Content-Range", `bytes */${size}`);
    return res.end();
  }
  if (range) {
    res.status(206).setHeader("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
    res.setHeader("Content-Length", range.end - range.start + 1);
  } else {
    res.setHeader("Content-Length", size);
  }
  if (req.method === "HEAD" || size === 0) return res.end();

  const stream = readFile(descriptor, range || undefined);
  stream.on("error", (error) => { console.error("[files] stream error:", error.message); res.destroy(error); });
  res.on("close", () => stream.destroy()); // the browser left (e.g. scrolled away) — stop reading
  stream.pipe(res);
}

/** GET /files/:key — private chat file. */
export async function serveChatFile(req, res) {
  const key = String(req.params.key || "");
  if (!CHAT_KEY.test(key)) return res.status(404).end();
  const userId = req.session?.userId;
  if (!userId) return res.status(401).end();

  // The file must belong to a message this user is part of and has not deleted.
  const message = await Message.findOne({
    "file.stored": key,
    deletedForEveryone: { $ne: true },
    deletedFor: { $ne: userId },
    $or: [{ sender: userId }, { receiver: userId }]
  }).select("file");
  if (!message) return res.status(404).end();

  const descriptor = await statFile("chat", key);
  if (!descriptor) return res.status(404).end();

  const { mime, name } = message.file;
  const inline = (INLINE_IMAGES.has(mime) || INLINE_AUDIO.test(mime)) && req.query.download !== "1";
  const asciiName = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");

  sendStored(req, res, descriptor, {
    mime,
    headers: {
      "X-Content-Type-Options": "nosniff",
      // An uploaded file can never run scripts, even if someone opens its URL directly.
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(name)}`
    }
  });
}

/** GET /avatars/:key — public profile picture. */
export async function serveAvatar(req, res) {
  const key = String(req.params.key || "");
  const match = AVATAR_KEY.exec(key);
  if (!match) return res.status(404).end();

  const descriptor = await statFile("avatar", key);
  if (!descriptor) return res.status(404).end();

  sendStored(req, res, descriptor, {
    mime: AVATAR_MIME[match[1]],
    headers: {
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-site",
      "Cache-Control": "public, max-age=604800, immutable" // the name changes whenever the picture changes
    }
  });
}
