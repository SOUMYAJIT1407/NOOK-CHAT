/**
 * sockets/presence.js — who is online, and how to reach them.
 * ------------------------------------------------------------------------------------------
 * userId -> Set of socket ids. One person can have several tabs / devices open, so we keep a Set
 * and only call someone "offline" when their LAST socket disconnects.
 * This map lives in this server's memory, so the app is designed to run as ONE instance
 * (see docs/DEPLOYMENT.md for what to change before running several).
 */
export function createPresence(io) {
  const online = new Map();

  return {
    /** Remember a socket. Returns true when the user was offline before (first tab). */
    add(userId, socketId) {
      const id = String(userId);
      const wasOffline = !online.has(id);
      if (wasOffline) online.set(id, new Set());
      online.get(id).add(socketId);
      return wasOffline;
    },

    /** Forget a socket. Returns true when the user has no sockets left (just went offline). */
    remove(userId, socketId) {
      const id = String(userId);
      const sockets = online.get(id);
      if (!sockets) return false;
      sockets.delete(socketId);
      if (sockets.size) return false;
      online.delete(id);
      return true;
    },

    isOnline: (userId) => online.has(String(userId)),
    socketIds: (userId) => [...(online.get(String(userId)) || [])],
    onlineCount: () => online.size,

    /** Send an event to every open tab / device of the given users (each socket gets it once). */
    emitToUsers(userIds, event, payload) {
      const targets = new Set();
      for (const id of userIds) for (const socketId of online.get(String(id)) || []) targets.add(socketId);
      for (const socketId of targets) io.to(socketId).emit(event, payload);
    }
  };
}
