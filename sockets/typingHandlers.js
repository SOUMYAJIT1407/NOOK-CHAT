/**
 * sockets/typingHandlers.js — the "typing…" indicator.
 * ------------------------------------------------------------------------------------------
 * Flow:   browser A (typing)  --"typing" {receiverId, isTyping}-->  server  --"typing" {userId, isTyping}-->  browser B
 *
 * Nothing is stored in the database. The server adds three safety nets so the indicator can
 * never get "stuck" or flood the database:
 *   1. Throttle    — repeated "I am typing" events from one socket are limited to ~1 per 700 ms.
 *   2. Auto-expire — if no new event arrives for 6 s, the server itself sends "stopped typing".
 *   3. Cleanup     — when a socket disconnects, or a message is sent, typing is stopped at once.
 * The friendship check is cached (services/friends.js), so keystrokes do not cause DB queries.
 */
import { areFriends } from "../services/friends.js";
import { isObjectId } from "../services/messageService.js";

const THROTTLE_MS = 700;
const EXPIRE_MS = 6000;

export function createTyping({ presence }) {
  // socket.id -> Map(receiverId -> { timer, lastAt })
  const active = new Map();

  const tell = (userId, receiverId, isTyping) => presence.emitToUsers([receiverId], "typing", { userId, isTyping });

  /** Stop "typing" towards one person (no-op if it was not active). */
  function stop(socket, receiverId) {
    const perSocket = active.get(socket.id);
    const entry = perSocket?.get(String(receiverId));
    if (!entry) return;
    clearTimeout(entry.timer);
    perSocket.delete(String(receiverId));
    if (!perSocket.size) active.delete(socket.id);
    tell(socket.userId, receiverId, false);
  }

  /** Stop every active typing indicator of a socket (it disconnected). */
  function cleanup(socket) {
    const perSocket = active.get(socket.id);
    if (!perSocket) return;
    for (const receiverId of [...perSocket.keys()]) stop(socket, receiverId);
  }

  function register(socket) {
    socket.on("typing", async ({ receiverId, isTyping } = {}) => {
      try {
        if (!isObjectId(receiverId) || receiverId === socket.userId) return;

        if (!isTyping) return stop(socket, receiverId);
        if (!(await areFriends(socket.userId, receiverId))) return;

        let perSocket = active.get(socket.id);
        if (!perSocket) active.set(socket.id, (perSocket = new Map()));
        const key = String(receiverId);
        const now = Date.now();
        const entry = perSocket.get(key);

        if (entry && now - entry.lastAt < THROTTLE_MS) return; // too frequent — ignore
        if (entry) clearTimeout(entry.timer);

        const timer = setTimeout(() => stop(socket, receiverId), EXPIRE_MS);
        timer.unref?.();
        perSocket.set(key, { timer, lastAt: now });
        tell(socket.userId, receiverId, true);
      } catch (error) {
        console.error("[typing] error:", error.message);
      }
    });
  }

  return { register, stop, cleanup };
}
