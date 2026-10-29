/**
 * models/Message.js — one chat entry. `type` decides which extra field is used:
 *   text -> message | image / file / audio -> file {stored, name, size, mime} | call -> call {kind, status, duration}
 * `readAt` is set when the receiver has seen it; `reactions` maps userId -> emoji.
 *
 * Deleting (two flavours, like WhatsApp):
 *   deletedFor          ids of users who chose "Delete for me" — hidden for them only.
 *   deletedForEveryone  the sender chose "Delete for everyone": the content (text / file) is erased
 *                       from the database and both people see "This message was deleted".
 * When BOTH people have deleted a message for themselves it is removed completely.
 */
import mongoose from "mongoose";

const fileSchema = new mongoose.Schema(
  {
    stored: { type: String, required: true },
    name: { type: String, required: true },
    size: { type: Number, default: 0 },
    mime: { type: String, default: "application/octet-stream" }
  },
  { _id: false }
);

const callSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["audio", "video"], default: "audio" },
    status: { type: String, enum: ["completed", "missed", "declined", "busy"], default: "completed" },
    duration: { type: Number, default: 0 }
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  receiver: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  type: { type: String, enum: ["text", "image", "file", "audio", "call"], default: "text" },
  message: { type: String, default: "", trim: true, maxlength: 5000 },
  file: { type: fileSchema, default: undefined },
  call: { type: callSchema, default: undefined },
  replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
  edited: { type: Boolean, default: false },
  readAt: { type: Date, default: null },
  reactions: { type: Map, of: String, default: {} },

  deletedFor: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
  deletedForEveryone: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Fast conversation loading, unread counters and file look-ups.
messageSchema.index({ sender: 1, receiver: 1, createdAt: -1 });
messageSchema.index({ receiver: 1, readAt: 1 });
messageSchema.index({ "file.stored": 1 });

export default mongoose.model("Message", messageSchema);
