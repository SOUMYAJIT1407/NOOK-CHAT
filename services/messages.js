/**
 * services/messages.js — turns Message documents into the JSON the browser expects.
 * Includes a text preview for the conversation list and the "quoted reply" info.
 */
import Message from "../models/Message.js";

export const DELETED_PREVIEW = "🚫 This message was deleted";

/** One-line preview of a message for the sidebar ("📷 Photo", "🎤 Voice message"...). */
export function previewText(m) {
  if (m.deletedForEveryone) return DELETED_PREVIEW;
  switch (m.type) {
    case "image": return "📷 Photo";
    case "file": return `📎 ${m.file?.name || "File"}`;
    case "audio": return "🎤 Voice message";
    case "call": return m.call?.kind === "video" ? "📹 Video call" : "📞 Voice call";
    default: return m.message || "";
  }
}

/**
 * Shape a message for the client: files become /files/<name> URLs, reactions a plain object.
 * A message deleted for everyone is sent as an empty "tombstone" ({ deleted: true }) — its
 * text, file and reactions are never exposed again.
 */
export function serializeMessage(m, replyInfo = null) {
  const base = {
    _id: String(m._id),
    sender: String(m.sender),
    receiver: String(m.receiver),
    replyTo: m.replyTo ? String(m.replyTo) : null,
    replyInfo,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt
  };

  if (m.deletedForEveryone) {
    return { ...base, type: m.type || "text", deleted: true, deletedAt: m.deletedAt || null, message: "", file: null, call: null, edited: false, readAt: m.readAt || null, reactions: {} };
  }

  return {
    ...base,
    type: m.type || "text",
    deleted: false,
    message: m.message || "",
    file: m.file ? { url: `/files/${m.file.stored}`, name: m.file.name, size: m.file.size, mime: m.file.mime } : null,
    call: m.call ? { kind: m.call.kind, status: m.call.status, duration: m.call.duration } : null,
    edited: Boolean(m.edited),
    readAt: m.readAt || null,
    reactions: m.reactions instanceof Map ? Object.fromEntries(m.reactions) : (m.reactions || {})
  };
}

/** Looks up the original messages that other messages reply to (one query for the whole batch). */
export async function replyInfoMap(messages) {
  const ids = [...new Set(messages.filter((m) => m.replyTo).map((m) => String(m.replyTo)))];
  const map = new Map();
  if (!ids.length) return map;
  const originals = await Message.find({ _id: { $in: ids } }).select("sender type message file call deletedForEveryone");
  for (const o of originals) {
    map.set(String(o._id), { _id: String(o._id), sender: String(o.sender), text: previewText(o).slice(0, 140), deleted: Boolean(o.deletedForEveryone) });
  }
  return map;
}

export async function serializeMany(messages) {
  const map = await replyInfoMap(messages);
  return messages.map((m) => serializeMessage(m, m.replyTo ? map.get(String(m.replyTo)) || null : null));
}

export async function serializeOne(m) {
  return (await serializeMany([m]))[0];
}
