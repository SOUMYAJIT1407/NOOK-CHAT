/**
 * sockets/chatHandlers.js — Socket.IO events for messaging.
 * ------------------------------------------------------------------------------------------
 * Each handler: validate -> call a function in services/messageService.js -> push the result to
 * everybody involved. `callback` (the "ack") tells the sender whether it worked.
 *
 *   load-friends    friends list with last message + unread count
 *   load-messages   open a conversation  -> server emits "chat-history"
 *   send-message    text message         -> "new-message" to both people
 *   mark-read       seen receipts        -> "messages-read" to the sender
 *   edit-message    edit own message     -> "message-edited"
 *   delete-message  { messageId, scope: "me" | "everyone" } -> "message-deleted"
 *   react-message   emoji reaction       -> "message-reaction"
 */
import { friendsWithMeta } from "../services/friends.js";
import {
  ServiceError, loadConversation, sendText, markConversationRead,
  editMessage, deleteMessage, toggleReaction
} from "../services/messageService.js";

const ack = (callback, data) => { if (typeof callback === "function") callback(data); };

/** Runs a handler; turns ServiceErrors into a friendly { error } and logs anything unexpected. */
function guarded(callback, fn) {
  return Promise.resolve()
    .then(fn)
    .catch((error) => {
      if (error instanceof ServiceError) return ack(callback, { error: error.message });
      console.error("[socket] handler error:", error);
      ack(callback, { error: "Something went wrong. Please try again." });
    });
}

export function registerChatHandlers({ socket, presence, typing }) {
  const userId = socket.userId;

  socket.on("load-friends", (callback) => guarded(callback, async () => {
    ack(callback, { success: true, friends: await friendsWithMeta(userId) });
  }));

  socket.on("load-messages", (otherUserId, callback) => guarded(callback, async () => {
    const messages = await loadConversation(userId, String(otherUserId || ""));
    socket.emit("chat-history", { userId: String(otherUserId), messages });
    ack(callback, { success: true });
  }));

  socket.on("send-message", (data = {}, callback) => guarded(callback, async () => {
    const payload = await sendText(userId, data);
    typing.stop(socket, payload.receiver); // sending ends "typing…" immediately
    presence.emitToUsers([userId, payload.receiver], "new-message", payload);
    ack(callback, { success: true, message: payload });
  }));

  socket.on("mark-read", ({ userId: otherId } = {}, callback) => guarded(callback, async () => {
    const { modified, at } = await markConversationRead(userId, String(otherId || ""));
    if (modified) presence.emitToUsers([otherId], "messages-read", { by: userId, at });
    presence.emitToUsers([userId], "unread-cleared", { userId: String(otherId) });
    ack(callback, { success: true });
  }));

  socket.on("edit-message", ({ messageId, text } = {}, callback) => guarded(callback, async () => {
    const { recipients, payload } = await editMessage(userId, String(messageId || ""), text);
    presence.emitToUsers(recipients, "message-edited", payload);
    ack(callback, { success: true });
  }));

  // "Delete for me" tells only the requester's own tabs; "Delete for everyone" tells both people.
  socket.on("delete-message", ({ messageId, scope } = {}, callback) => guarded(callback, async () => {
    const result = await deleteMessage(userId, String(messageId || ""), scope);
    presence.emitToUsers(result.recipients, "message-deleted", { messageId: result.messageId, scope: result.scope, deletedAt: result.deletedAt });
    ack(callback, { success: true, scope: result.scope });
  }));

  socket.on("react-message", ({ messageId, emoji } = {}, callback) => guarded(callback, async () => {
    const { recipients, payload } = await toggleReaction(userId, String(messageId || ""), emoji);
    presence.emitToUsers(recipients, "message-reaction", payload);
    ack(callback, { success: true });
  }));
}
