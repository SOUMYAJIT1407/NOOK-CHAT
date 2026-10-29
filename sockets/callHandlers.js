/**
 * sockets/callHandlers.js — WebRTC call SIGNALLING (audio / video).
 * ------------------------------------------------------------------------------------------
 * The audio/video itself flows directly between the two browsers (peer-to-peer). This server only
 * relays the "offer", "answer" and network "ICE candidates" so the browsers can find each other,
 * and records a call log entry in the chat ("Voice call · 2:13", "Missed video call"...).
 *
 *   call:invite  caller -> server -> callee    (carries the WebRTC offer)
 *   call:answer  callee -> server -> caller    (carries the answer)
 *   call:ice     both ways                      (network candidates)
 *   call:media   both ways                      (mic / camera / screen-share state, UI hints)
 *   call:reject  callee declined
 *   call:end     either side hung up / caller cancelled
 */
import User from "../models/User.js";
import Message from "../models/Message.js";
import { areFriends } from "../services/friends.js";
import { serializeOne } from "../services/messages.js";
import { isObjectId } from "../services/messageService.js";

// How long the callee's phone "rings" before the call is logged as missed.
const RING_TIMEOUT_MS = 45_000;

export function createCallManager({ presence }) {
  // Active calls live in memory only (a call cannot outlive a server restart anyway).
  const calls = new Map();     // callId -> call
  const userCall = new Map();  // userId -> callId

  /** Save a call entry in the chat history and push it live to both people. */
  async function logCall({ caller, callee, kind, status, duration = 0 }) {
    try {
      const message = await Message.create({ sender: caller, receiver: callee, type: "call", call: { kind, status, duration } });
      presence.emitToUsers([caller, callee], "new-message", await serializeOne(message));
    } catch (error) {
      console.error("[call] could not log call:", error.message);
    }
  }

  /** Ends a call exactly once: clears timers/maps, tells both sides, and writes the call log. */
  async function finishCall(call, { status, reason, by }) {
    if (!calls.has(call.id)) return;
    clearTimeout(call.timer);
    calls.delete(call.id);
    if (userCall.get(call.caller) === call.id) userCall.delete(call.caller);
    if (userCall.get(call.callee) === call.id) userCall.delete(call.callee);

    const duration = call.answeredAt ? Math.round((Date.now() - call.answeredAt) / 1000) : 0;
    presence.emitToUsers([call.caller, call.callee], "call:ended", { callId: call.id, reason, by: by || null, duration });
    await logCall({ caller: call.caller, callee: call.callee, kind: call.kind, status, duration });
  }

  const otherParty = (call, userId) => (call.caller === userId ? call.callee : call.caller);

  /** Attach the call events to one connected socket. */
  function register(socket) {
    const userId = socket.userId;

    // CALLER -> server: "I want to call `to`", carrying the caller's WebRTC offer (SDP). The server
    // checks friendship / busy / offline, then rings the callee with "call:incoming".
    socket.on("call:invite", async ({ to, kind, offer } = {}, callback) => {
      const reply = (data) => typeof callback === "function" && callback(data);
      try {
        to = String(to || "");
        kind = kind === "video" ? "video" : "audio";
        if (!isObjectId(to) || to === userId || !offer) throw new Error("Invalid call request.");
        if (!(await areFriends(userId, to))) throw new Error("You can call only your friends.");
        if (userCall.has(userId)) throw new Error("You are already in a call.");

        if (!presence.isOnline(to)) {
          await logCall({ caller: userId, callee: to, kind, status: "missed" });
          throw new Error("They are offline right now. A missed call was left for them.");
        }
        if (userCall.has(to)) {
          await logCall({ caller: userId, callee: to, kind, status: "busy" });
          throw new Error("They are on another call.");
        }

        const caller = await User.findById(userId).select("username photo");
        const call = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, caller: userId, callee: to, kind, answeredAt: null, timer: null };
        call.timer = setTimeout(() => finishCall(call, { status: "missed", reason: "no-answer" }), RING_TIMEOUT_MS);
        calls.set(call.id, call);
        userCall.set(userId, call.id);
        userCall.set(to, call.id);

        presence.emitToUsers([to], "call:incoming", {
          callId: call.id, kind, offer,
          from: { id: userId, username: caller.username, photo: caller.photo || "" }
        });
        reply({ success: true, callId: call.id });
      } catch (error) {
        reply({ error: error.message });
      }
    });

    // CALLEE -> server: accepted; carries the WebRTC answer, which we forward to the caller.
    socket.on("call:answer", ({ callId, answer } = {}, callback) => {
      const reply = (data) => typeof callback === "function" && callback(data);
      const call = calls.get(callId);
      if (!call || call.callee !== userId || call.answeredAt || !answer) return reply({ error: "Call no longer available." });
      call.answeredAt = Date.now();
      clearTimeout(call.timer);
      presence.emitToUsers([call.caller], "call:answered", { callId, answer });
      // The callee may have several tabs open: tell the others the call was taken so they stop ringing.
      for (const sid of presence.socketIds(userId)) if (sid !== socket.id) socket.nsp.to(sid).emit("call:taken", { callId });
      reply({ success: true });
    });

    // Both sides trickle network candidates (ICE) here; we simply relay them to the other party.
    socket.on("call:ice", ({ callId, candidate } = {}) => {
      const call = calls.get(callId);
      if (!call || ![call.caller, call.callee].includes(userId) || !candidate) return;
      presence.emitToUsers([otherParty(call, userId)], "call:ice", { callId, candidate });
    });

    // Tells the other side when mic / camera / screen-share is switched on or off (UI hints only).
    socket.on("call:media", ({ callId, audio, video } = {}) => {
      const call = calls.get(callId);
      if (!call || ![call.caller, call.callee].includes(userId)) return;
      presence.emitToUsers([otherParty(call, userId)], "call:media", { callId, audio: Boolean(audio), video: Boolean(video) });
    });

    // CALLEE declined while it was ringing.
    socket.on("call:reject", ({ callId } = {}) => {
      const call = calls.get(callId);
      if (!call || call.callee !== userId || call.answeredAt) return;
      finishCall(call, { status: "declined", reason: "declined", by: userId });
    });

    // Either side hung up (or the caller cancelled before an answer).
    socket.on("call:end", ({ callId } = {}) => {
      const call = calls.get(callId);
      if (!call || ![call.caller, call.callee].includes(userId)) return;
      const status = call.answeredAt ? "completed" : call.caller === userId ? "missed" : "declined";
      finishCall(call, { status, reason: call.answeredAt ? "hangup" : status === "missed" ? "cancelled" : "declined", by: userId });
    });
  }

  /** A user's last tab closed: drop any call they were part of. */
  function onUserGone(userId) {
    const callId = userCall.get(userId);
    const call = callId && calls.get(callId);
    if (call) finishCall(call, { status: call.answeredAt ? "completed" : "missed", reason: "disconnected", by: userId });
  }

  /** Stop all timers (used on shutdown). */
  function shutdown() {
    for (const call of calls.values()) clearTimeout(call.timer);
    calls.clear();
    userCall.clear();
  }

  return { register, onUserGone, shutdown };
}
