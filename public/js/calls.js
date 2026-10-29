/**
 * public/js/calls.js — WebRTC audio / video calls
 * ------------------------------------------------------------------------------------------
 * How a call works:
 *   1. Caller: getUserMedia (mic/cam) -> RTCPeerConnection -> createOffer -> "call:invite" (server relays it).
 *   2. Callee: sees the incoming-call card; on Accept: getUserMedia -> setRemoteDescription(offer)
 *      -> createAnswer -> "call:answer".
 *   3. Both sides exchange ICE candidates ("call:ice") until a direct peer-to-peer path is found.
 *   4. Media flows browser-to-browser. Mute / camera / screen-share are local track switches.
 * Signalling happens in server.js; STUN/TURN servers come from /api/calls/ice-config.
 */

/* NOOK — WebRTC audio / video calling (signalling over Socket.IO) */
(() => {
  const { socket, toast, avatarHTML, ic, getFriend, fmtDuration } = window.NookApp;
  const $ = (id) => document.getElementById(id);
  const stage = document.querySelector(".call-stage");

  // `call` is the active call object, `incoming` the ringing one (only one of each at a time).
  let call = null;          // active call
  let incoming = null;      // ringing incoming call
  const iceBuffer = {};     // remote ICE that arrived before we were ready
  let iceConfig = null;
  let tone = null;

  /* ----- tones (WebAudio) ----- */
  let ctx;
  /** One tone through Web Audio — used for the ringtone and the "calling…" ringback. */
  function blip(freq, dur, vol = 0.06) {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") ctx.resume();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = freq; g.gain.value = vol; o.connect(g); g.connect(ctx.destination);
      o.start(); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur); o.stop(ctx.currentTime + dur);
    } catch {}
  }
  function startTone(kind) {
    stopTone();
    const play = () => kind === "ring" ? (blip(880, 0.35), setTimeout(() => blip(660, 0.35), 380)) : blip(440, 0.8, 0.035);
    play(); tone = setInterval(play, kind === "ring" ? 1700 : 3200);
  }
  function stopTone() { clearInterval(tone); tone = null; }

  /* ----- helpers ----- */
  /** STUN/TURN servers from the server (cached). */
  async function getIce() {
    if (iceConfig) return iceConfig;
    try { iceConfig = (await (await fetch("/api/calls/ice-config")).json()).iceServers; } catch {}
    return (iceConfig = iceConfig || [{ urls: "stun:stun.l.google.com:19302" }]);
  }
  /** Asks for microphone (+ camera for video calls). Falls back to audio-only if the camera is unavailable. */
  async function getMedia(kind) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Calls need HTTPS (or localhost) and a browser with camera/microphone support.");
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: kind === "video" ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false });
    } catch (err) {
      if (kind === "video") {
        try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); toast("Camera unavailable — continuing with audio only.", "info"); return s; } catch {}
      }
      throw new Error("Microphone/camera permission was denied or no device was found.");
    }
  }
  /** Creates the RTCPeerConnection, wires ICE / track / state events and adds our local tracks. */
  async function makePC(c) {
    const pc = new RTCPeerConnection({ iceServers: await getIce() });
    c.pc = pc; c.remoteStream = new MediaStream(); c.localIce = [];
    $("remoteVideo").srcObject = c.remoteStream;
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      const cand = e.candidate.toJSON ? e.candidate.toJSON() : e.candidate;
      if (c.id) socket.emit("call:ice", { callId: c.id, candidate: cand }); else c.localIce.push(cand);
    };
    pc.ontrack = (e) => { e.streams[0]?.getTracks().forEach((t) => { if (!c.remoteStream.getTracks().includes(t)) c.remoteStream.addTrack(t); }); $("remoteVideo").play?.().catch(() => {}); };
    pc.onconnectionstatechange = () => {
      if (call !== c) return;
      const s = pc.connectionState;
      if (s === "connected") onConnected(c);
      else if (s === "disconnected") setStatus("Reconnecting…");
      else if (s === "failed") { toast("Call connection failed. A TURN server may be required on this network.", "error"); hangup(); }
    };
    c.localStream.getTracks().forEach((t) => pc.addTrack(t, c.localStream));
    return pc;
  }
  async function flushRemoteIce(c) {
    const list = iceBuffer[c.id] || []; delete iceBuffer[c.id];
    for (const cand of list) { try { await c.pc.addIceCandidate(cand); } catch {} }
  }

  /* ----- UI ----- */
  function showOverlay(c) {
    stage.classList.remove("connected", "has-remote-video");
    $("callAvatar").innerHTML = avatarHTML(c.peer, "avatar-xl", false);
    $("callName").textContent = c.peer.username; $("callTitle").textContent = c.peer.username;
    setStatus(c.isCaller ? "Calling…" : "Connecting…");
    $("callOverlay").hidden = false;
    $("peerMuted").hidden = true;
    const hasVideo = c.localStream?.getVideoTracks().length > 0;
    const lv = $("localVideo"); lv.srcObject = c.localStream; lv.classList.toggle("show", hasVideo); lv.classList.remove("screen");
    syncControls(c);
  }
  function setStatus(text) { $("callStatus").textContent = text; if (!call?.startedAt) $("callTimer").textContent = text; }
  function syncControls(c) {
    const a = c.localStream?.getAudioTracks()[0], v = c.localStream?.getVideoTracks()[0];
    const mic = $("ctrlMic"), cam = $("ctrlCam"), scr = $("ctrlScreen");
    mic.classList.toggle("off", a ? !a.enabled : true); mic.innerHTML = ic(a && a.enabled ? "mic" : "mic-off");
    cam.classList.toggle("off", v ? !v.enabled : true); cam.innerHTML = ic(v && v.enabled ? "video" : "video-off");
    scr.classList.toggle("on", Boolean(c.screenStream));
    scr.style.display = navigator.mediaDevices?.getDisplayMedia && c.pc?.getSenders().some((s) => s.track?.kind === "video") ? "" : "none";
  }
  function onConnected(c) {
    if (c.startedAt) return;
    stopTone(); c.startedAt = Date.now();
    stage.classList.add("connected");
    $("callStatus").textContent = "Connected";
    c.peerVideo = c.kind === "video";
    updateRemoteVideo(c);
    c.timerInt = setInterval(() => { $("callTimer").textContent = fmtDuration((Date.now() - c.startedAt) / 1000); }, 1000);
    $("callTimer").textContent = "0:00";
  }
  function updateRemoteVideo(c) { stage.classList.toggle("has-remote-video", Boolean(c.peerVideo && c.remoteStream.getVideoTracks().length)); }

  /* ----- start (caller) ----- */
  /** CALLER: begin a voice or video call with a friend. */
  async function start(friend, kind) {
    if (!friend) return;
    if (call || incoming) return toast("You're already in a call.", "info");
    const c = { id: null, peerId: friend.id, peer: friend, kind, isCaller: true, startedAt: null };
    call = c;
    try {
      c.localStream = await getMedia(kind);
      if (c.localStream.getVideoTracks().length === 0) c.kind = "audio";
      showOverlay(c); startTone("ringback");
      const pc = await makePC(c);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("call:invite", { to: friend.id, kind: c.kind, offer: { type: offer.type, sdp: offer.sdp } }, async (res) => {
        if (res?.error) { toast(res.error, "info"); return cleanup(); }
        c.id = res.callId;
        c.localIce.splice(0).forEach((cand) => socket.emit("call:ice", { callId: c.id, candidate: cand }));
        if (c.cancelled) socket.emit("call:end", { callId: c.id });
      });
    } catch (err) {
      toast(err.message || "Could not start the call.", "error"); cleanup();
    }
  }

  /* ----- incoming (callee) ----- */
  socket.on("call:incoming", (data) => {
    if (call || incoming) return; // server also guards, this covers extra tabs
    incoming = data;
    const peer = getFriend(data.from.id) || { id: data.from.id, username: data.from.username, photo: data.from.photo };
    incoming.peer = peer;
    $("incomingAvatar").innerHTML = avatarHTML(peer, "avatar-md", false);
    $("incomingName").textContent = peer.username;
    $("incomingKind").textContent = data.kind === "video" ? "Incoming video call" : "Incoming voice call";
    $("incomingCall").hidden = false; startTone("ring");
    if (document.hidden && "Notification" in window && Notification.permission === "granted") { try { new Notification(`${peer.username} is calling`, { body: $("incomingKind").textContent }); } catch {} }
    incoming.timeout = setTimeout(() => dismissIncoming(), 46000);
  });
  function dismissIncoming() { if (!incoming) return; clearTimeout(incoming.timeout); delete iceBuffer[incoming.callId]; incoming = null; $("incomingCall").hidden = true; stopTone(); }

  $("declineCall").onclick = () => { if (!incoming) return; socket.emit("call:reject", { callId: incoming.callId }); dismissIncoming(); };
  $("acceptCall").onclick = async () => {
    if (!incoming || call) return;
    const inc = incoming; clearTimeout(inc.timeout); incoming = null; $("incomingCall").hidden = true; stopTone();
    const c = { id: inc.callId, peerId: inc.from.id, peer: inc.peer, kind: inc.kind, isCaller: false, startedAt: null };
    call = c;
    try {
      c.localStream = await getMedia(inc.kind);
      showOverlay(c);
      const pc = await makePC(c);
      await pc.setRemoteDescription(inc.offer);
      const ice = iceBuffer[inc.callId] || []; iceBuffer[c.id] = ice; await flushRemoteIce(c);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("call:answer", { callId: c.id, answer: { type: answer.type, sdp: answer.sdp } }, (res) => { if (res?.error) { toast(res.error, "info"); cleanup(); } });
    } catch (err) {
      toast(err.message || "Could not join the call.", "error");
      socket.emit("call:reject", { callId: inc.callId }); cleanup();
    }
  };
  socket.on("call:taken", ({ callId }) => { if (incoming?.callId === callId) { dismissIncoming(); } });

  /* ----- signalling events ----- */
  socket.on("call:answered", async ({ callId, answer }) => {
    if (!call || call.id !== callId) return;
    try { await call.pc.setRemoteDescription(answer); await flushRemoteIce(call); stopTone(); setStatus("Connecting…"); } catch (e) { console.error(e); }
  });
  socket.on("call:ice", async ({ callId, candidate }) => {
    if (call && call.id === callId && call.pc?.remoteDescription) { try { await call.pc.addIceCandidate(candidate); } catch {} return; }
    (iceBuffer[callId] = iceBuffer[callId] || []).push(candidate);
  });
  socket.on("call:media", ({ callId, audio, video }) => {
    if (!call || call.id !== callId) return;
    $("peerMuted").hidden = audio; call.peerVideo = video; updateRemoteVideo(call);
  });
  socket.on("call:ended", ({ callId, reason, by, duration }) => {
    if (incoming?.callId === callId) { dismissIncoming(); toast("Call ended.", "info"); return; }
    if (!call || (call.id && call.id !== callId)) return;
    const mine = by === CURRENT_USER_ID;
    const msg = { declined: mine ? "" : "Call declined.", "no-answer": "No answer.", cancelled: "", hangup: duration ? `Call ended · ${fmtDuration(duration)}` : "Call ended.", disconnected: "Call disconnected." }[reason];
    if (msg) toast(msg, "info");
    cleanup();
  });

  /* ----- controls ----- */
  /** End the call from our side (or cancel it while it is still ringing). */
  function hangup() {
    if (!call) return;
    if (call.id) socket.emit("call:end", { callId: call.id }); else call.cancelled = true;
    cleanup();
  }
  function sendMedia() {
    if (!call?.id) return;
    const a = call.localStream.getAudioTracks()[0], v = call.localStream.getVideoTracks()[0];
    socket.emit("call:media", { callId: call.id, audio: a ? a.enabled : false, video: Boolean(call.screenStream) || (v ? v.enabled : false) });
  }
  $("ctrlHang").onclick = hangup;
  $("ctrlMic").onclick = () => { const a = call?.localStream.getAudioTracks()[0]; if (!a) return; a.enabled = !a.enabled; syncControls(call); sendMedia(); };
  $("ctrlCam").onclick = () => {
    const v = call?.localStream.getVideoTracks()[0];
    if (!v) return toast("This is a voice call — start a video call to use the camera.", "info");
    v.enabled = !v.enabled; $("localVideo").classList.toggle("show", v.enabled || Boolean(call.screenStream)); syncControls(call); sendMedia();
  };
  $("ctrlScreen").onclick = async () => {
    if (!call) return;
    const sender = call.pc.getSenders().find((s) => s.track?.kind === "video" || s.kind === "video");
    if (!sender) return;
    if (call.screenStream) return stopScreen();
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
      call.screenStream = screen;
      await sender.replaceTrack(screen.getVideoTracks()[0]);
      const lv = $("localVideo"); lv.srcObject = screen; lv.classList.add("show", "screen");
      screen.getVideoTracks()[0].onended = stopScreen;
      syncControls(call); sendMedia();
    } catch { /* cancelled */ }
  };
  async function stopScreen() {
    if (!call?.screenStream) return;
    call.screenStream.getTracks().forEach((t) => t.stop()); call.screenStream = null;
    const cam = call.localStream.getVideoTracks()[0];
    const sender = call.pc.getSenders().find((s) => s.kind === "video" || s.track?.kind === "video");
    if (sender && cam) await sender.replaceTrack(cam);
    const lv = $("localVideo"); lv.srcObject = call.localStream; lv.classList.remove("screen"); lv.classList.toggle("show", Boolean(cam && cam.enabled));
    syncControls(call); sendMedia();
  }

  /** Release the camera / microphone, close the connection and hide the call screen. */
  function cleanup() {
    stopTone();
    const c = call; call = null;
    if (c) {
      clearInterval(c.timerInt);
      c.screenStream?.getTracks().forEach((t) => t.stop());
      c.localStream?.getTracks().forEach((t) => t.stop());
      try { c.pc?.close(); } catch {}
      delete iceBuffer[c.id];
    }
    $("remoteVideo").srcObject = null; $("localVideo").srcObject = null;
    $("callOverlay").hidden = true; stage.classList.remove("connected", "has-remote-video");
  }
  window.addEventListener("beforeunload", () => { if (call?.id) socket.emit("call:end", { callId: call.id }); });
  if ("Notification" in window && Notification.permission === "default") document.addEventListener("click", () => Notification.requestPermission().catch(() => {}), { once: true });

  window.NookCalls = { start, hangup };
})();
