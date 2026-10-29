/**
 * sockets/index.js — creates the Socket.IO server and wires everything together.
 * ------------------------------------------------------------------------------------------
 *   presence.js        who is online (userId -> sockets)
 *   chatHandlers.js    messages, read receipts, edit, delete, reactions
 *   typingHandlers.js  the "typing…" indicator
 *   callHandlers.js    WebRTC call signalling
 */
import { Server } from "socket.io";
import User from "../models/User.js";
import { config } from "../config/env.js";
import { friendIdsOf, publicUser } from "../services/friends.js";
import { createPresence } from "./presence.js";
import { createTyping } from "./typingHandlers.js";
import { createCallManager } from "./callHandlers.js";
import { registerChatHandlers } from "./chatHandlers.js";

/** Wait this long before announcing "offline", so a page refresh does not flicker the status. */
const OFFLINE_GRACE_MS = 2000;

export function createSocketServer(httpServer, { app, sessionMiddleware }) {
  const io = new Server(httpServer, {
    // Same-origin by default; only open it up when CORS_ORIGIN is configured.
    cors: config.corsOrigins.length ? { origin: config.corsOrigins, credentials: true } : undefined
  });

  // The login session (cookie) is the socket's identity.
  io.engine.use(sessionMiddleware);
  io.use((socket, next) => {
    const userId = socket.request.session?.userId;
    if (!userId) return next(new Error("Authentication required"));
    socket.userId = String(userId);
    next();
  });

  const presence = createPresence(io);
  const typing = createTyping({ presence });
  const calls = createCallManager({ presence });

  /** Presence and profile changes only matter to the user's friends (and their own other tabs). */
  async function notifyFriends(userId, event, payload) {
    try {
      presence.emitToUsers([userId, ...(await friendIdsOf(userId))], event, payload);
    } catch (error) {
      console.error(`[socket] could not send ${event}:`, error.message);
    }
  }

  // Helpers used by plain HTTP routes (file upload, profile photo).
  app.set("emitToUsers", presence.emitToUsers);
  app.set("broadcastProfile", (user) => notifyFriends(String(user._id), "profile-updated", publicUser(user)));

  io.on("connection", (socket) => {
    const userId = socket.userId;

    // Register every handler FIRST (synchronously) so no event can arrive before it is listened to.
    registerChatHandlers({ socket, presence, typing });
    typing.register(socket);
    calls.register(socket);

    if (presence.add(userId, socket.id)) {
      User.findByIdAndUpdate(userId, { isOnline: true })
        .then(() => notifyFriends(userId, "user-status", { userId, isOnline: true }))
        .catch((error) => console.error("[socket] online status error:", error.message));
    }

    socket.on("disconnect", () => {
      typing.cleanup(socket);
      if (!presence.remove(userId, socket.id)) return; // still has another tab open

      setTimeout(async () => {
        if (presence.isOnline(userId)) return; // came back (page refresh)
        calls.onUserGone(userId);
        try {
          await User.findByIdAndUpdate(userId, { isOnline: false, lastSeen: new Date() });
          await notifyFriends(userId, "user-status", { userId, isOnline: false });
        } catch (error) {
          console.error("[socket] offline status error:", error.message);
        }
      }, OFFLINE_GRACE_MS).unref();
    });
  });

  return {
    io,
    presence,
    /** Disconnect everybody and stop timers (graceful shutdown). */
    async close() {
      calls.shutdown();
      await new Promise((resolve) => io.close(resolve));
    }
  };
}
