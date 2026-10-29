/**
 * public/js/chat.js — the Messenger front-end (runs in the browser after login)
 * ------------------------------------------------------------------------------------------
 * Talks to the server in two ways:
 *   • Socket.IO  — real-time: messages, typing, read receipts, reactions, presence, friend requests.
 *   • fetch()    — plain HTTP: search, friend requests, profile, file uploads.
 * It builds the whole UI from the data it receives; there is no framework. Rough layout:
 *   icons -> state -> helpers -> modals -> friend requests -> conversation list -> people search
 *   -> header/info panel -> open/close chat -> messages -> realtime events -> composer
 *   -> attachments/upload -> voice notes -> emoji -> lightbox -> profile -> theme -> boot.
 * Audio/video calling is in calls.js (it reuses the helpers exported at the bottom of this file).
 */

/* NOOK Messenger — client */
const socket = io();
const $ = (id) => document.getElementById(id);

/* ---------- icons ---------- */
// Inline SVG icon set (Feather style). <i data-icon="name"> placeholders in the HTML are replaced
// with the matching SVG by hydrate(), so no icon font or image requests are needed.
const ICONS = {
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  "user-plus": '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>',
  video: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
  "video-off": '<path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"/><line x1="1" y1="1" x2="23" y2="23"/>',
  mic: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
  "mic-off": '<line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
  paperclip: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  sun: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  "log-out": '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  "arrow-left": '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  "arrow-down": '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>',
  reply: '<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  "check-all": '<polyline points="18 6 9 17 4 12"/><polyline points="22 6 13 17"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  ban: '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>',
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>'
};
const ic = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;
function hydrate(root = document) {
  root.querySelectorAll("i[data-icon]").forEach((el) => { el.innerHTML = ic(el.dataset.icon); el.removeAttribute("data-icon"); });
}
hydrate();

/* ---------- state ---------- */
// All mutable UI state in one place:
//   friends     list shown in the sidebar        selected   the open conversation (a friend)
//   messages    messages of the open chat        replyTo    message being replied to
//   attachments files waiting to be sent         recorder   active voice-note recorder
const state = {
  friends: [], selected: null, messages: [], replyTo: null, query: "",
  attachments: [], newBelow: 0, searchSeq: 0, typingTimers: {}, recorder: null
};
let searchTimer = null, typingTimer = null, friendsRefreshTimer = null;
// Typing indicator (we are the one typing): who we last told "typing" and when.
let typingTo = null, typingSentAt = 0;
const app = $("app");

/* ---------- helpers ---------- */
/** Escape user text before putting it into HTML (prevents script injection / XSS). */
function escapeHtml(text = "") {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
/** Turn http(s) links in already-escaped text into clickable <a> tags. */
function linkify(escaped) {
  return escaped.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}
/** Round avatar: the profile photo if there is one, otherwise the first letter, plus an online dot. */
function avatarHTML(user, size = "avatar-md", dot = true) {
  const letter = escapeHtml((user.username || "N").charAt(0).toUpperCase());
  const inner = user.photo ? `<img src="${escapeHtml(user.photo)}" alt="">` : letter;
  return `<div class="avatar ${size} ${dot ? "" : "no-dot"}" data-uid="${escapeHtml(user.id || "")}">${inner}<i class="presence-dot ${user.isOnline ? "online" : ""}"></i></div>`;
}
const fmtTime = (d) => new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
function fmtDay(d) {
  const date = new Date(d), today = new Date(), y = new Date();
  y.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === y.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}
function fmtListTime(d) {
  if (!d) return "";
  const date = new Date(d), now = new Date();
  if (date.toDateString() === now.toDateString()) return fmtTime(date);
  if (now - date < 6 * 864e5) return date.toLocaleDateString([], { weekday: "short" });
  return date.toLocaleDateString([], { day: "numeric", month: "short" });
}
/** "Last seen 5m ago" style text. */
function formatLastSeen(date) {
  if (!date) return "Offline";
  const mins = Math.floor(Math.max(0, Date.now() - new Date(date).getTime()) / 60000);
  if (mins < 1) return "Last seen just now";
  if (mins < 60) return `Last seen ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Last seen ${hours}h ago`;
  return `Last seen ${new Date(date).toLocaleDateString([], { day: "numeric", month: "short" })}`;
}
const fmtSize = (n) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const fmtDuration = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(x).padStart(2, "0")}`; };
const extLabel = (name) => (name.includes(".") ? name.split(".").pop().slice(0, 4) : "FILE").toUpperCase();

/** Small notification in the corner (type: info | success | error). */
function toast(message, type = "info") {
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.textContent = message;
  $("toastStack").appendChild(node);
  setTimeout(() => node.classList.add("show"), 10);
  setTimeout(() => { node.classList.remove("show"); setTimeout(() => node.remove(), 250); }, 3400);
}
/** fetch() wrapper: parses JSON and throws an Error with the server's message on failure. */
async function fetchJSON(url, options = {}) {
  const res = await fetch(url, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.message || "Something went wrong.");
  return data;
}

/* highlight characters of a name that match the query */
/** Wrap the characters of `name` that match the search `query` in <mark> (substring first, else letters in order). */
function highlight(name, query) {
  if (!query) return escapeHtml(name);
  const lower = name.toLowerCase(), q = query.toLowerCase().replace(/\s+/g, "");
  const idx = lower.indexOf(query.toLowerCase());
  if (idx >= 0) return escapeHtml(name.slice(0, idx)) + `<mark>${escapeHtml(name.slice(idx, idx + query.length))}</mark>` + escapeHtml(name.slice(idx + query.length));
  let qi = 0, out = "";
  for (const ch of name) {
    if (qi < q.length && ch.toLowerCase() === q[qi]) { out += `<mark>${escapeHtml(ch)}</mark>`; qi++; } else out += escapeHtml(ch);
  }
  return out;
}
/** True when the query is inside the name, or its letters appear in the name in order ("ali" ~ "Natalie"). */
function nameMatches(name, query) {
  const n = name.toLowerCase(), q = query.toLowerCase().replace(/\s+/g, "");
  if (n.includes(query.toLowerCase())) return true;
  let qi = 0;
  for (const ch of n) if (ch === q[qi]) qi++;
  return qi === q.length;
}

/* ---------- modals / dialog ---------- */
function openModal(el) { el.hidden = false; requestAnimationFrame(() => el.classList.add("visible")); }
function closeModal(el) { el.classList.remove("visible"); setTimeout(() => { el.hidden = true; }, 180); }
document.querySelectorAll(".modal-backdrop").forEach((m) => {
  m.addEventListener("click", (e) => { if (e.target === m || e.target.closest("[data-close]")) closeModal(m); });
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  document.querySelectorAll(".modal-backdrop.visible").forEach(closeModal);
  closeLightbox(); hideEmoji(); hideReactPop();
});
/** Promise-based confirm / text-input dialog (used for edit and delete). Resolves to true / text / null. */
function dialog({ title, text = "", input = false, value = "", ok = "OK", danger = false }) {
  return new Promise((resolve) => {
    const modal = $("dialogModal"), okBtn = $("dialogOk"), field = $("dialogInput");
    $("dialogTitle").textContent = title; $("dialogText").textContent = text; $("dialogText").hidden = !text;
    field.hidden = !input; field.value = value;
    okBtn.textContent = ok; okBtn.classList.toggle("danger", danger);
    let done = false;
    const finish = (result) => { if (done) return; done = true; okBtn.onclick = null; modal.removeEventListener("click", onCancel); closeModal(modal); resolve(result); };
    const onCancel = (e) => { if (e.target === modal || e.target.closest("[data-close]")) finish(null); };
    modal.addEventListener("click", onCancel);
    okBtn.onclick = () => finish(input ? field.value : true);
    openModal(modal);
    if (input) setTimeout(() => field.focus(), 60);
  });
}

/**
 * "Delete message?" dialog with two choices. Resolves to "me", "everyone" or null (cancelled).
 * "Delete for everyone" is only offered when `canEveryone` (your own, non-call message).
 */
function deleteDialog({ canEveryone }) {
  return new Promise((resolve) => {
    const modal = $("deleteModal"), forMe = $("deleteMe"), forAll = $("deleteEveryone");
    $("deleteText").textContent = canEveryone
      ? "Delete it for everyone, or just remove it from your own chat."
      : "This only removes the message from your own chat. The other person keeps their copy.";
    forAll.hidden = !canEveryone;
    let done = false;
    const finish = (result) => {
      if (done) return; done = true;
      forMe.onclick = forAll.onclick = null; modal.removeEventListener("click", onBackdrop);
      closeModal(modal); resolve(result);
    };
    const onBackdrop = (e) => { if (e.target === modal || e.target.closest("[data-close]")) finish(null); };
    modal.addEventListener("click", onBackdrop);
    forMe.onclick = () => finish("me");
    forAll.onclick = () => finish("everyone");
    openModal(modal);
    setTimeout(() => (canEveryone ? forAll : forMe).focus(), 60);
  });
}

/* ---------- sounds / title ---------- */
let audioCtx;
/** Short notification sound generated with the Web Audio API (no audio file needed). */
function beep(freq = 880, dur = 0.12, vol = 0.05) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = freq; g.gain.value = vol; o.connect(g); g.connect(audioCtx.destination);
    o.start(); g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur); o.stop(audioCtx.currentTime + dur);
  } catch {}
}
function updateTitle() {
  const total = state.friends.reduce((n, f) => n + (f.unread || 0), 0);
  document.title = `${total ? `(${total}) ` : ""}Messenger — NOOK`;
}

/* ---------- friend requests ---------- */
function setRequestCount(count) {
  for (const id of ["requestBadge", "headerRequestBadge"]) { $(id).textContent = count; $(id).classList.toggle("has-count", count > 0); }
}
/** Fetches pending friend requests, updates the red badges and the requests list. */
async function loadRequests() {
  try {
    const data = await fetchJSON("/api/friends/requests");
    setRequestCount(data.count || 0);
    renderRequests(data.requests || []);
  } catch (e) { console.error(e); }
}
function renderRequests(requests) {
  const list = $("requestsList");
  if (!requests.length) {
    list.innerHTML = `<div class="modal-empty"><div class="empty-symbol">${ic("user-plus")}</div><h3>No pending requests</h3><p>New connection requests will appear here.</p></div>`;
    return;
  }
  list.innerHTML = requests.map(({ id, user }) => `<article class="request-card">
    ${avatarHTML(user)}
    <div class="request-user"><strong>${escapeHtml(user.username)}</strong><span>${user.isOnline ? "Online now" : escapeHtml(formatLastSeen(user.lastSeen))}</span><small>${escapeHtml(user.bio || "Wants to connect with you")}</small></div>
    <div class="request-actions"><button class="accept-request" data-id="${escapeHtml(id)}">Accept</button><button class="reject-request" data-id="${escapeHtml(id)}">Decline</button></div>
  </article>`).join("");
}
$("requestsList").addEventListener("click", async (e) => {
  const a = e.target.closest(".accept-request"), r = e.target.closest(".reject-request");
  const btn = a || r;
  if (!btn) return;
  const action = a ? "accept" : "reject";
  try {
    await fetchJSON(`/api/friends/requests/${btn.dataset.id}/${action}`, { method: "PATCH" });
    toast(action === "accept" ? "Friend request accepted." : "Request declined.", action === "accept" ? "success" : "info");
    await Promise.all([loadRequests(), loadFriends()]);
    if (state.query) runPeopleSearch(state.query);
  } catch (err) { toast(err.message, "error"); }
});
const openRequests = () => { openModal($("requestsModal")); loadRequests(); };
$("requestStrip").onclick = openRequests;
$("navRequests").onclick = openRequests;

/* ---------- conversation list ---------- */
/** Loads the conversation list (friends + last message + unread) from the server and renders it. */
async function loadFriends() {
  try {
    const data = await fetchJSON("/api/users/friends");
    state.friends = data.friends || [];
    if (state.selected) {
      const fresh = state.friends.find((f) => f.id === state.selected.id);
      if (fresh) state.selected = { ...state.selected, ...fresh };
    }
    renderFriends(); updateTitle();
  } catch { $("friendsList").innerHTML = `<div class="side-empty">Could not load connections.</div>`; }
}
const getFriend = (id) => state.friends.find((f) => f.id === String(id));

/** Draws the conversation list. While searching, it only shows friends whose names match. */
function renderFriends() {
  const q = state.query.trim();
  const list = q ? state.friends.filter((f) => nameMatches(f.username, q)) : state.friends;
  $("connCount").textContent = list.length;
  $("listSubtitle").textContent = state.friends.length ? `${state.friends.filter((f) => f.isOnline).length} of ${state.friends.length} online` : "Your conversations";
  if (!list.length) {
    $("friendsList").innerHTML = q
      ? `<div class="side-empty"><strong>No matching friends</strong><small>Check "People on NOOK" below to find new people.</small></div>`
      : `<div class="side-empty"><div class="empty-symbol">${ic("sparkle")}</div><strong>No connections yet</strong><small>Search a name above to find people and send a friend request.</small></div>`;
    return;
  }
  $("friendsList").innerHTML = list.map((u) => {
    const last = u.typing ? `<span class="friend-last typing">typing…</span>`
      : `<span class="friend-last">${u.lastMessage ? (u.lastMessage.mine ? "You: " : "") + escapeHtml(u.lastMessage.text) : escapeHtml(u.isOnline ? "Online" : formatLastSeen(u.lastSeen))}</span>`;
    return `<button class="friend-item ${state.selected?.id === u.id ? "active" : ""} ${u.unread ? "unread" : ""}" data-id="${escapeHtml(u.id)}">
      ${avatarHTML(u, "avatar-md")}
      <span class="friend-copy">
        <span class="friend-top"><strong>${highlight(u.username, q)}</strong><span class="friend-time">${u.lastMessage ? fmtListTime(u.lastMessage.at) : ""}</span></span>
        <span class="friend-bottom">${last}${u.unread ? `<b class="unread-badge">${u.unread > 99 ? "99+" : u.unread}</b>` : ""}</span>
      </span></button>`;
  }).join("");
}
$("friendsList").addEventListener("click", (e) => {
  const item = e.target.closest(".friend-item");
  if (!item) return;
  const f = getFriend(item.dataset.id);
  if (f) openChat(f);
});

/* ---------- people search (by any characters of a name) ---------- */
function relationshipButton(u) {
  if (u.relationship === "friends") return `<button class="relation-btn friends" data-open-chat="${escapeHtml(u.id)}" type="button">Message</button>`;
  if (u.relationship === "pending_sent") return `<button class="relation-btn pending" type="button" disabled>Request sent</button>`;
  if (u.relationship === "pending_received") return `<button class="relation-btn incoming" type="button" data-open-requests="1">Respond</button>`;
  return `<button class="relation-btn add-friend" type="button" data-user-id="${escapeHtml(u.id)}">Add friend</button>`;
}
/**
 * SEARCH FOR PEOPLE BY NAME. Calls GET /api/users/search?q=... (debounced by the input handler).
 * `searchSeq` makes sure a slow, older response can never overwrite a newer one.
 */
async function runPeopleSearch(query) {
  const seq = ++state.searchSeq;
  $("noSearchResults").hidden = true; $("searchLoading").hidden = false; $("searchResults").innerHTML = "";
  try {
    const data = await fetchJSON(`/api/users/search?q=${encodeURIComponent(query)}`);
    if (seq !== state.searchSeq) return;
    const users = (data.users || []).filter((u) => u.relationship !== "friends");
    $("searchLoading").hidden = true; $("resultCount").textContent = users.length;
    $("noSearchResults").hidden = users.length > 0;
    $("searchResults").innerHTML = users.map((u) => `<article class="person-card">
      ${avatarHTML(u)}
      <div class="person-info"><strong>${highlight(u.username, query)}</strong><small class="${u.isOnline ? "online-label" : ""}">${escapeHtml(u.isOnline ? "Online now" : formatLastSeen(u.lastSeen))}</small></div>
      ${relationshipButton(u)}</article>`).join("");
  } catch {
    if (seq !== state.searchSeq) return;
    $("searchLoading").hidden = true; $("noSearchResults").hidden = false; $("resultCount").textContent = "0";
  }
}
$("searchResults").addEventListener("click", async (e) => {
  if (e.target.closest("[data-open-requests]")) return openRequests();
  const chat = e.target.closest("[data-open-chat]");
  if (chat) { const f = getFriend(chat.dataset.openChat); if (f) openChat(f); return; }
  const add = e.target.closest(".add-friend");
  if (!add) return;
  add.disabled = true; add.textContent = "Sending…";
  try {
    const data = await fetchJSON(`/api/friends/requests/${add.dataset.userId}`, { method: "POST" });
    add.className = "relation-btn pending"; add.textContent = data.status === "friends" ? "Friends" : "Request sent";
    toast("Friend request sent.", "success");
  } catch (err) { add.disabled = false; add.textContent = "Add friend"; toast(err.message, "error"); }
});
$("userSearch").addEventListener("input", () => {
  const q = $("userSearch").value.trim();
  state.query = q;
  $("clearSearch").classList.toggle("visible", Boolean(q));
  clearTimeout(searchTimer);
  renderFriends();
  if (!q) { $("peopleSection").hidden = true; state.searchSeq++; return; }
  $("peopleSection").hidden = false; $("searchLoading").hidden = false; $("noSearchResults").hidden = true; $("searchResults").innerHTML = "";
  searchTimer = setTimeout(() => runPeopleSearch(q), 260);
});
$("clearSearch").onclick = () => { $("userSearch").value = ""; $("userSearch").dispatchEvent(new Event("input")); $("userSearch").focus(); };
$("newChatBtn").onclick = () => { app.classList.remove("chat-open"); $("userSearch").focus(); };

/* ---------- chat header / info panel ---------- */
function statusText(u) { return u.typing ? "typing…" : u.isOnline ? "Online" : formatLastSeen(u.lastSeen); }
/** Top bar of the chat: avatar, name, status and the voice / video / info buttons. */
function renderHeader() {
  const u = state.selected;
  if (!u) {
    $("chatHeader").innerHTML = `<div class="welcome-chat"><div class="welcome-orb">N</div><div><h1>Messenger</h1><p>Search for someone, send a request and start a conversation.</p></div></div>`;
    return;
  }
  $("chatHeader").innerHTML = `<div class="selected-user" id="headerUser">
      <button class="hbtn back-btn" id="backBtn" type="button" title="Back">${ic("arrow-left")}</button>
      ${avatarHTML(u, "avatar-md")}
      <div class="selected-copy"><strong>${escapeHtml(u.username)}</strong><span id="headerStatus" class="${u.typing ? "typing-label" : u.isOnline ? "online-label" : ""}">${escapeHtml(statusText(u))}</span></div>
    </div>
    <div class="header-actions">
      <button class="hbtn" id="callAudio" type="button" title="Voice call">${ic("phone")}</button>
      <button class="hbtn" id="callVideo" type="button" title="Video call">${ic("video")}</button>
      <button class="hbtn ${app.classList.contains("info-open") ? "active" : ""}" id="toggleInfo" type="button" title="Conversation info">${ic("info")}</button>
    </div>`;
  $("backBtn").onclick = (e) => { e.stopPropagation(); closeChat(); };
  $("callAudio").onclick = () => window.NookCalls?.start(state.selected, "audio");
  $("callVideo").onclick = () => window.NookCalls?.start(state.selected, "video");
  $("toggleInfo").onclick = toggleInfo;
  $("headerUser").onclick = () => { if (!app.classList.contains("info-open")) toggleInfo(); };
}
function toggleInfo() {
  const open = !app.classList.contains("info-open");
  app.classList.toggle("info-open", open);
  $("infoPanel").hidden = !open;
  $("toggleInfo")?.classList.toggle("active", open);
  if (open) renderInfo();
}
/** Right-hand panel: big avatar, bio, quick call buttons and the shared photos / files. */
async function renderInfo() {
  const u = state.selected, panel = $("infoPanel");
  if (!u || panel.hidden) return;
  panel.innerHTML = `<button class="info-close" type="button" id="infoClose">${ic("x")}</button>${avatarHTML(u, "avatar-xl")}<h3>${escapeHtml(u.username)}</h3><p class="sub ${u.isOnline ? "online-label" : ""}">${escapeHtml(statusText(u))}</p>
    <div class="bio">${escapeHtml(u.bio || "No bio yet.")}</div>
    <div class="info-actions"><button type="button" data-c="audio">${ic("phone")}Voice</button><button type="button" data-c="video">${ic("video")}Video</button></div>
    <div class="info-sec"><h4>SHARED MEDIA</h4><div id="sharedMedia" class="muted-note">Loading…</div></div>
    <div class="info-sec"><h4>SHARED FILES</h4><div id="sharedFiles" class="muted-note">Loading…</div></div>`;
  $("infoClose").onclick = toggleInfo;
  panel.querySelectorAll("[data-c]").forEach((b) => (b.onclick = () => window.NookCalls?.start(state.selected, b.dataset.c)));
  try {
    const data = await fetchJSON(`/api/users/${u.id}/shared`);
    if (state.selected?.id !== u.id) return;
    const imgs = data.items.filter((i) => i.type === "image"), files = data.items.filter((i) => i.type === "file");
    $("sharedMedia").className = ""; $("sharedFiles").className = "";
    $("sharedMedia").innerHTML = imgs.length ? `<div class="media-grid">${imgs.slice(0, 9).map((i) => `<img src="${escapeHtml(i.url)}" data-full="${escapeHtml(i.url)}" alt="">`).join("")}</div>` : `<span class="muted-note">No photos shared yet.</span>`;
    $("sharedFiles").innerHTML = files.length ? files.slice(0, 8).map((f) => `<a class="shared-file" href="${escapeHtml(f.url)}?download=1"><span class="file-ico">${escapeHtml(extLabel(f.name))}</span><div><strong>${escapeHtml(f.name)}</strong><small>${fmtSize(f.size)}</small></div>${ic("download")}</a>`).join("") : `<span class="muted-note">No files shared yet.</span>`;
    $("sharedMedia").querySelectorAll("img").forEach((img) => (img.onclick = () => openLightbox(img.dataset.full)));
  } catch { $("sharedMedia").textContent = "Unavailable."; $("sharedFiles").textContent = ""; }
}

/* ---------- open / close chat ---------- */
/** Opens a conversation: resets the composer, shows the chat (on phones the list slides away) and asks the server for history. */
function openChat(user) {
  stopTyping();
  const f = getFriend(user.id) || user;
  state.selected = { ...f };
  state.messages = []; state.newBelow = 0;
  clearReply(); clearAttachments(); cancelRecording(true); hideEmoji();
  app.classList.add("chat-open");
  renderHeader(); renderFriends(); renderInfo();
  $("messageForm").hidden = false;
  $("messages").innerHTML = `<div class="message-loading"><div class="loader"></div><span>Loading conversation…</span></div>`;
  socket.emit("load-messages", state.selected.id, (result) => {
    if (result?.error) {
      $("messages").innerHTML = `<div class="conversation-placeholder"><div class="placeholder-icon">${ic("info")}</div><h2>Chat unavailable</h2><p>${escapeHtml(result.error)}</p></div>`;
      $("messageForm").hidden = true;
    }
  });
  updateComposerState();
  if (window.matchMedia("(min-width: 901px)").matches) $("messageInput").focus();
}
function closeChat() {
  stopTyping();
  state.selected = null;
  app.classList.remove("chat-open", "info-open"); $("infoPanel").hidden = true;
  $("messageForm").hidden = true;
  $("messages").innerHTML = placeholderHTML();
  renderHeader(); renderFriends();
}
const placeholderHTML = () => `<div class="conversation-placeholder"><div class="placeholder-icon">${ic("sparkle")}</div><h2>Your conversations live here</h2><p>Pick a connection from the list to start chatting, share photos and files, or make a voice or video call.</p></div>`;

/** Tell the server the visible messages were seen (clears the unread badge, shows "seen" ticks to the sender). */
function markRead() {
  const u = state.selected;
  if (!u || document.visibilityState !== "visible") return;
  const f = getFriend(u.id);
  if (f && f.unread) { f.unread = 0; renderFriends(); updateTitle(); }
  socket.emit("mark-read", { userId: u.id });
}
document.addEventListener("visibilitychange", markRead);
window.addEventListener("focus", markRead);

/* ---------- messages ---------- */
const nearBottom = () => { const m = $("messages"); return m.scrollHeight - m.scrollTop - m.clientHeight < 140; };
function scrollToBottom(smooth = false) {
  const m = $("messages");
  m.scrollTo({ top: m.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  state.newBelow = 0; $("scrollDown").hidden = true;
}
$("messages").addEventListener("scroll", () => {
  if (nearBottom()) { state.newBelow = 0; $("scrollDown").hidden = true; $("scrollDownCount").hidden = true; }
  else $("scrollDown").hidden = false;
});
$("scrollDown").onclick = () => scrollToBottom(true);

socket.on("chat-history", ({ userId, messages }) => {
  if (!state.selected || state.selected.id !== String(userId)) return;
  state.messages = messages;
  renderMessages();
  markRead();
});
/** Full redraw of the open conversation (used when history arrives). */
function renderMessages() {
  const box = $("messages");
  box.innerHTML = "";
  if (!state.messages.length) {
    box.innerHTML = `<div class="conversation-placeholder"><div class="placeholder-icon">${ic("chat")}</div><h2>Start the conversation</h2><p>Say hello to ${escapeHtml(state.selected.username)} — or share a photo, file or voice note.</p></div>`;
    syncTypingBubble(); // the friend may already be typing their first message
    return;
  }
  let prev = null;
  for (const m of state.messages) { appendMessageEl(m, prev); prev = m; }
  syncTypingBubble();
  scrollToBottom();
}
function appendMessageEl(m, prev) {
  const box = $("messages");
  if (!prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString()) {
    const sep = document.createElement("div");
    sep.className = "date-sep"; sep.innerHTML = `<span>${escapeHtml(fmtDay(m.createdAt))}</span>`;
    box.appendChild(sep);
  }
  const row = buildMessage(m);
  if (prev && prev.sender !== m.sender) row.classList.add("gap");
  box.appendChild(row);
}

function callLogHTML(m) {
  const mine = m.sender === CURRENT_USER_ID, c = m.call, label = c.kind === "video" ? "Video call" : "Voice call";
  let title = label, sub = "";
  if (c.status === "completed") sub = `Duration ${fmtDuration(c.duration)}`;
  else if (c.status === "missed") { title = mine ? `${label} · No answer` : `Missed ${label.toLowerCase()}`; sub = mine ? "They didn't pick up" : "You missed this call"; }
  else if (c.status === "declined") { title = `${label} · Declined`; sub = mine ? "They declined" : "You declined"; }
  else if (c.status === "busy") { title = `${label} · Busy`; sub = "Line was busy"; }
  return `<div class="call-log ${c.status}"><span class="ico">${ic(c.kind === "video" ? "video" : "phone")}</span><div><strong>${title}</strong><small>${sub}</small></div></div>`;
}
function bodyHTML(m) {
  const text = m.message ? `<p>${linkify(escapeHtml(m.message))}</p>` : "";
  if (m.type === "image" && m.file) return { html: `<img class="msg-image" src="${escapeHtml(m.file.url)}" data-full="${escapeHtml(m.file.url)}" alt="${escapeHtml(m.file.name)}">${text}`, media: !m.message };
  if (m.type === "audio" && m.file) return { html: `<audio class="voice" controls preload="metadata" src="${escapeHtml(m.file.url)}"></audio>`, media: false };
  if (m.type === "file" && m.file) return { html: `<a class="file-card" href="${escapeHtml(m.file.url)}?download=1" download><span class="file-ico">${escapeHtml(extLabel(m.file.name))}</span><span class="file-info"><strong>${escapeHtml(m.file.name)}</strong><small>${fmtSize(m.file.size)}</small></span><span class="file-dl">${ic("download")}</span></a>${text}`, media: false };
  if (m.type === "call" && m.call) return { html: callLogHTML(m), media: false };
  return { html: text, media: false };
}
function tickHTML(m) {
  if (m.sender !== CURRENT_USER_ID || m.type === "call") return "";
  return `<span class="tick ${m.readAt ? "seen" : ""}" title="${m.readAt ? "Seen" : "Delivered"}">${ic(m.readAt ? "check-all" : "check")}</span>`;
}
/** Builds one message row: reply quote, body (text / image / file / voice / call), time, ticks, hover actions, reactions. */
function buildMessage(m) {
  const mine = m.sender === CURRENT_USER_ID;
  const row = document.createElement("div");
  row.className = `message-row ${mine ? "mine" : "theirs"}`;
  row.dataset.messageId = m._id;

  // A message deleted for everyone stays in the chat as a grey "This message was deleted" note.
  if (m.deleted) {
    row.classList.add("deleted");
    row.innerHTML = `<div class="message-wrap"><div class="message-actions"><button type="button" data-action="delete" title="Remove from my chat">${ic("trash")}</button></div><div class="message-bubble tombstone"><p>${ic("ban")}<span>${mine ? "You deleted this message" : "This message was deleted"}</span></p><div class="message-meta"><span class="time">${fmtTime(m.createdAt)}</span></div></div></div>`;
    return row;
  }

  const { html, media } = bodyHTML(m);
  const quote = m.replyInfo ? `<div class="quote" data-jump="${escapeHtml(m.replyInfo._id)}"><strong>${m.replyInfo.sender === CURRENT_USER_ID ? "You" : escapeHtml(state.selected?.username || "")}</strong><span>${escapeHtml(m.replyInfo.text)}</span></div>` : (m.replyTo ? `<div class="quote"><strong>Reply</strong><span>Original message unavailable</span></div>` : "");
  const canEdit = mine && ["text", "image", "file"].includes(m.type);
  // Either person can remove ANY message from their own chat; only the sender can delete for everyone.
  const deleteBtn = `<button type="button" data-action="delete" title="Delete">${ic("trash")}</button>`;
  const actions = m.type === "call" ? `<div class="message-actions">${deleteBtn}</div>` : `<div class="message-actions">
      <button type="button" data-action="react" title="React">${ic("smile")}</button>
      <button type="button" data-action="reply" title="Reply">${ic("reply")}</button>
      ${m.message ? `<button type="button" data-action="copy" title="Copy">${ic("copy")}</button>` : ""}
      ${canEdit ? `<button type="button" data-action="edit" title="Edit">${ic("edit")}</button>` : ""}
      ${deleteBtn}</div>`;
  row.innerHTML = `<div class="message-wrap">${actions}<div class="message-bubble ${media ? "media-only" : ""}">${quote}<div class="body">${html}</div><div class="message-meta"><span class="time">${fmtTime(m.createdAt)}</span><span class="edited">${m.edited ? "· edited" : ""}</span>${tickHTML(m)}</div></div><div class="reaction-line"></div></div>`;
  renderReactions(row, m.reactions || {});
  return row;
}
function renderReactions(row, reactions) {
  const counts = {};
  Object.entries(reactions || {}).forEach(([uid, emoji]) => { if (emoji) { counts[emoji] = counts[emoji] || { n: 0, mine: false }; counts[emoji].n++; if (uid === CURRENT_USER_ID) counts[emoji].mine = true; } });
  row.querySelector(".reaction-line").innerHTML = Object.entries(counts).map(([e, c]) => `<span class="${c.mine ? "mine-react" : ""}" data-emoji="${e}">${e} ${c.n}</span>`).join("");
  const msg = state.messages.find((x) => x._id === row.dataset.messageId);
  if (msg) msg.reactions = reactions;
}

$("messages").addEventListener("click", (e) => {
  const img = e.target.closest(".msg-image"); if (img) return openLightbox(img.dataset.full);
  const row = e.target.closest(".message-row"); if (!row) return;
  const id = row.dataset.messageId, m = state.messages.find((x) => x._id === id);
  const jump = e.target.closest("[data-jump]");
  if (jump) { const t = document.querySelector(`[data-message-id="${jump.dataset.jump}"]`); if (t) { t.scrollIntoView({ behavior: "smooth", block: "center" }); t.classList.add("flash"); setTimeout(() => t.classList.remove("flash"), 1300); } return; }
  const chip = e.target.closest(".reaction-line span");
  if (chip) return socket.emit("react-message", { messageId: id, emoji: chip.dataset.emoji }, (r) => r?.error && toast(r.error, "error"));
  const btn = e.target.closest("[data-action]");
  if (!btn || !m) { if (window.matchMedia("(max-width: 900px)").matches) { document.querySelectorAll(".show-actions").forEach((x) => x.classList.remove("show-actions")); row.querySelector(".message-wrap").classList.add("show-actions"); } return; }
  const action = btn.dataset.action;
  if (action === "delete") return deleteMessage(m);
  if (action === "reply") setReply(m);
  if (action === "copy") navigator.clipboard?.writeText(m.message).then(() => toast("Message copied.", "success"));
  if (action === "react") showReactPop(btn, id);
  if (action === "edit") editMessage(m);
});

/* reactions popover */
const REACTIONS = ["❤️", "👍", "😂", "😮", "😢", "🔥"];
/** Floating emoji picker for reacting to a message. */
function showReactPop(anchor, messageId) {
  const pop = $("reactPop");
  pop.innerHTML = REACTIONS.map((e) => `<button type="button" data-e="${e}">${e}</button>`).join("");
  pop.hidden = false;
  const r = anchor.getBoundingClientRect(), w = 6 * 40 + 14;
  pop.style.left = `${Math.min(Math.max(8, r.left - w / 2), window.innerWidth - w - 8)}px`;
  pop.style.top = `${Math.max(8, r.top - 54)}px`;
  pop.onclick = (e) => { const b = e.target.closest("[data-e]"); if (!b) return; hideReactPop(); socket.emit("react-message", { messageId, emoji: b.dataset.e }, (res) => res?.error && toast(res.error, "error")); };
}
function hideReactPop() { $("reactPop").hidden = true; }
document.addEventListener("mousedown", (e) => { if (!e.target.closest("#reactPop,[data-action='react']")) hideReactPop(); if (!e.target.closest("#emojiPop,#emojiButton")) hideEmoji(); });

async function editMessage(m) {
  const text = await dialog({ title: "Edit message", input: true, value: m.message, ok: "Save" });
  if (text === null || !text.trim() || text.trim() === m.message) return;
  socket.emit("edit-message", { messageId: m._id, text }, (r) => r?.error && toast(r.error, "error"));
}
/** Asks "for me" or "for everyone", then tells the server. The row changes when the server confirms. */
async function deleteMessage(m) {
  const canEveryone = m.sender === CURRENT_USER_ID && m.type !== "call" && !m.deleted;
  const scope = await deleteDialog({ canEveryone });
  if (!scope) return;
  socket.emit("delete-message", { messageId: m._id, scope }, (r) => r?.error && toast(r.error, "error"));
}

/* If an image fails to load, show a clear placeholder instead of an invisible empty bubble.
   (The "error" event does not bubble, so we listen in the capture phase.) */
$("messages").addEventListener("error", (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains("msg-image")) return;
  const note = document.createElement("div");
  note.className = "img-missing";
  note.textContent = "🖼️ Image unavailable";
  img.replaceWith(note);
}, true);

/* realtime message events */
// A message arrived (ours or theirs, text/file/call). Update the sidebar preview + unread badge,
// and if that chat is open append it and keep the view scrolled / show the "new messages" button.
socket.on("new-message", (m) => {
  const other = m.sender === CURRENT_USER_ID ? m.receiver : m.sender;
  const mine = m.sender === CURRENT_USER_ID;
  let f = getFriend(other);
  if (!f) { loadFriends(); }
  else {
    f.lastMessage = { text: previewOf(m), at: m.createdAt, mine };
    f.typing = false;
    if (state.selected?.id === other) state.selected.typing = false;
    if (!mine && m.type !== "call" && !(state.selected?.id === other && document.visibilityState === "visible")) f.unread = (f.unread || 0) + 1;
    state.friends.sort((a, b) => new Date(b.lastMessage?.at || 0) - new Date(a.lastMessage?.at || 0) || a.username.localeCompare(b.username));
    renderFriends(); updateTitle();
  }
  const inChat = state.selected?.id === other;
  if (!inChat) {
    if (!mine && m.type !== "call") { beep(); toast(`${f?.username || "New message"}: ${previewOf(m).slice(0, 60)}`, "info"); }
    return;
  }
  if (state.messages.some((x) => x._id === m._id)) return;
  const stick = nearBottom() || mine;
  const prev = state.messages[state.messages.length - 1] || null;
  document.querySelector("#messages .conversation-placeholder")?.remove();
  state.messages.push(m);
  appendMessageEl(m, prev);
  syncTypingBubble();
  if (stick) scrollToBottom(true);
  else { state.newBelow++; $("scrollDown").hidden = false; $("scrollDownCount").hidden = false; $("scrollDownCount").textContent = state.newBelow; }
  if (!mine && m.type !== "call") { markRead(); if (document.visibilityState !== "visible") beep(); }
});
function previewOf(m) {
  return m.type === "image" ? "📷 Photo" : m.type === "file" ? `📎 ${m.file?.name || "File"}` : m.type === "audio" ? "🎤 Voice message" : m.type === "call" ? (m.call?.kind === "video" ? "📹 Video call" : "📞 Voice call") : m.message;
}
socket.on("messages-read", ({ by, at }) => {
  if (state.selected?.id !== String(by)) return;
  state.messages.forEach((m) => { if (m.sender === CURRENT_USER_ID && !m.readAt) m.readAt = at; });
  document.querySelectorAll(".message-row.mine .tick:not(.seen)").forEach((t) => { t.classList.add("seen"); t.innerHTML = ic("check-all"); t.title = "Seen"; });
});
socket.on("unread-cleared", ({ userId }) => { const f = getFriend(userId); if (f && f.unread) { f.unread = 0; renderFriends(); updateTitle(); } });
socket.on("message-edited", (d) => {
  const m = state.messages.find((x) => x._id === d._id); if (m) { m.message = d.message; m.edited = true; }
  const row = document.querySelector(`[data-message-id="${d._id}"]`); if (!row || !m) return;
  const body = row.querySelector(".body"), fresh = bodyHTML(m); body.innerHTML = fresh.html;
  row.querySelector(".edited").textContent = "· edited";
});
// A message was deleted.
//   scope "everyone": the row becomes a "This message was deleted" note for both people.
//   scope "me":       the row simply disappears (this event only reaches the person who deleted it).
socket.on("message-deleted", ({ messageId, scope }) => {
  const index = state.messages.findIndex((x) => x._id === messageId);
  const m = state.messages[index];
  const row = document.querySelector(`[data-message-id="${messageId}"]`);

  if (scope === "everyone") {
    if (m) {
      Object.assign(m, { deleted: true, message: "", file: null, reactions: {}, edited: false });
      if (row) { const fresh = buildMessage(m); if (row.classList.contains("gap")) fresh.classList.add("gap"); row.replaceWith(fresh); }
    }
    // Messages that quoted it now show the placeholder text instead of the old content.
    document.querySelectorAll(`[data-jump="${messageId}"] span`).forEach((el) => { el.textContent = "🚫 This message was deleted"; });
  } else if (index >= 0) {
    state.messages.splice(index, 1);
    row?.remove();
    removeOrphanSeparators();
    if (!state.messages.length && state.selected) renderMessages();
  }

  if (state.replyTo?._id === messageId) clearReply();
  scheduleFriendsRefresh();                       // sidebar preview / unread badge may change
  if (!$("infoPanel").hidden) renderInfo();       // shared photos / files may change
});
/** Remove date headings that no longer have a message under them. */
function removeOrphanSeparators() {
  document.querySelectorAll("#messages .date-sep").forEach((sep) => {
    const next = sep.nextElementSibling;
    if (!next || next.classList.contains("date-sep") || next.classList.contains("typing-row")) sep.remove();
  });
}
/** Reload the conversation list shortly after a change (several quick changes cause one request). */
function scheduleFriendsRefresh() {
  clearTimeout(friendsRefreshTimer);
  friendsRefreshTimer = setTimeout(loadFriends, 250);
}
socket.on("message-reaction", ({ messageId, reactions }) => {
  const row = document.querySelector(`[data-message-id="${messageId}"]`); if (row) renderReactions(row, reactions);
});

/* typing */
// The other person is typing. We show an animated bubble in the chat, "typing…" in the header and
// in the sidebar. The server stops it after 6 s of silence; this timer is only a safety net in
// case the "stopped typing" message gets lost.
socket.on("typing", ({ userId, isTyping }) => {
  const f = getFriend(userId); if (!f) return;
  f.typing = Boolean(isTyping); clearTimeout(state.typingTimers[userId]);
  if (isTyping) state.typingTimers[userId] = setTimeout(() => { f.typing = false; refreshTyping(f); }, 7000);
  refreshTyping(f);
});
function refreshTyping(f) {
  if (state.selected?.id === f.id) {
    state.selected.typing = f.typing;
    const s = $("headerStatus");
    if (s) { s.textContent = statusText(f); s.className = f.typing ? "typing-label" : f.isOnline ? "online-label" : ""; }
    syncTypingBubble();
  }
  renderFriends();
}
/** Keeps the animated "..." bubble as the very last row of the open chat while the friend is typing. */
function syncTypingBubble() {
  const box = $("messages");
  let row = box.querySelector(".typing-row");
  const show = Boolean(state.selected?.typing) && !box.querySelector(".message-loading");
  // Brand-new conversation: the big "Start the conversation" placeholder fills the whole pane, so
  // hide it while the friend is typing (otherwise the bubble would have no room) and bring it back after.
  const placeholder = box.querySelector(".conversation-placeholder");
  if (placeholder) placeholder.hidden = show;
  if (!show) { row?.remove(); return; }
  const stick = nearBottom();
  if (!row) {
    row = document.createElement("div");
    row.className = "message-row theirs typing-row";
    row.innerHTML = `<div class="message-wrap"><div class="message-bubble typing-bubble" role="status" aria-label="${escapeHtml(state.selected.username)} is typing"><i></i><i></i><i></i></div></div>`;
  }
  if (row !== box.lastElementChild) box.appendChild(row); // always below the newest message
  if (stick) scrollToBottom();
}

/* presence + profile updates */
// Presence: a friend came online / went offline.
socket.on("user-status", ({ userId, isOnline }) => {
  const f = getFriend(userId); if (!f) return;
  f.isOnline = isOnline; if (!isOnline) { f.lastSeen = new Date().toISOString(); f.typing = false; }
  if (state.selected?.id === f.id) {
    if (!isOnline) { state.selected.typing = false; syncTypingBubble(); } state.selected.isOnline = isOnline; state.selected.lastSeen = f.lastSeen; const s = $("headerStatus"); if (s) { s.textContent = statusText(state.selected); s.className = isOnline ? "online-label" : ""; } document.querySelectorAll(`#chatHeader .presence-dot`).forEach((d) => d.classList.toggle("online", isOnline)); }
  renderFriends();
});
socket.on("profile-updated", (u) => {
  if (u.id === CURRENT_USER_ID) { Object.assign(CURRENT_USER, u); renderMe(); return; }
  const f = getFriend(u.id); if (!f) return;
  Object.assign(f, { photo: u.photo, bio: u.bio });
  if (state.selected?.id === f.id) { Object.assign(state.selected, { photo: u.photo, bio: u.bio }); renderHeader(); renderInfo(); }
  renderFriends();
});
socket.on("friend-request", () => { loadRequests(); beep(660); toast("You have a new friend request.", "success"); });
socket.on("friend-request-updated", () => { loadFriends(); loadRequests(); });
socket.on("connect_error", () => toast("Connection problem — retrying…", "error"));
socket.on("connect", () => { state.friends.forEach((f) => { f.typing = false; }); if (state.selected) { state.selected.typing = false; syncTypingBubble(); } loadFriends(); if (state.selected) socket.emit("load-messages", state.selected.id, () => {}); });

/* ---------- composer ---------- */
const input = $("messageInput");
/** Grow the message box with its content (up to 140px). */
function autosize() { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 140)}px`; }
/** Show the send button when there is text/attachments, otherwise the microphone button. */
function updateComposerState() {
  const has = input.value.trim().length > 0 || state.attachments.length > 0;
  $("sendButton").hidden = !has; $("micButton").hidden = has;
}
/**
 * We are typing: tell the server (and so the other person) — but not on every keystroke.
 *   • first keystroke -> "typing" immediately, then a keep-alive at most every 1.5 s
 *   • 2.5 s without typing, an emptied box, a sent message or another chat -> "stopped typing"
 */
function notifyTyping() {
  const to = state.selected?.id;
  if (!to) return;
  if (!input.value.trim()) return stopTyping();
  if (typingTo && typingTo !== to) stopTyping();
  const now = Date.now();
  if (typingTo !== to || now - typingSentAt > 1500) {
    socket.emit("typing", { receiverId: to, isTyping: true });
    typingTo = to; typingSentAt = now;
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(stopTyping, 2500);
}
function stopTyping() {
  clearTimeout(typingTimer);
  if (typingTo) socket.emit("typing", { receiverId: typingTo, isTyping: false });
  typingTo = null; typingSentAt = 0;
}
input.addEventListener("input", () => { autosize(); updateComposerState(); notifyTyping(); });
input.addEventListener("blur", stopTyping);
input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("messageForm").requestSubmit(); } });

function setReply(m) {
  state.replyTo = m;
  const box = $("replyPreview"); box.hidden = false;
  box.innerHTML = `<div><strong>Replying to ${m.sender === CURRENT_USER_ID ? "yourself" : escapeHtml(state.selected.username)}</strong><span>${escapeHtml(previewOf(m) || "")}</span></div><button type="button" id="cancelReply">${ic("x")}</button>`;
  $("cancelReply").onclick = clearReply; input.focus();
}
function clearReply() { state.replyTo = null; $("replyPreview").hidden = true; $("replyPreview").innerHTML = ""; }

$("messageForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const u = state.selected; if (!u) return;
  const text = input.value.trim(), replyTo = state.replyTo?._id || null;
  const files = state.attachments.slice();
  if (!text && !files.length) return;
  input.value = ""; autosize(); clearReply();
  stopTyping();
  if (files.length) {
    for (let i = 0; i < files.length; i++) await sendFile(files[i], { caption: i === 0 ? text : "", replyTo: i === 0 ? replyTo : null, to: u.id });
    state.attachments = state.attachments.filter((a) => !files.includes(a)); renderTray();
  } else {
    socket.emit("send-message", { receiverId: u.id, message: text, replyTo }, (r) => r?.error && toast(r.error, "error"));
  }
  updateComposerState(); input.focus();
});

/* ---------- attachments / upload ---------- */
const MAX_BYTES = 25 * 1024 * 1024;
/** Validates files (size <= 25 MB) from the picker / drag-drop / paste and adds them to the preview tray. */
function addFiles(fileList) {
  if (!state.selected) return toast("Open a conversation first.", "error");
  for (const file of fileList) {
    if (file.size > MAX_BYTES) { toast(`${file.name} is larger than 25 MB.`, "error"); continue; }
    if (!file.size) continue;
    state.attachments.push({ file, id: Math.random().toString(36).slice(2), progress: 0, preview: file.type.startsWith("image/") && !file.type.includes("svg") ? URL.createObjectURL(file) : null });
  }
  renderTray(); updateComposerState();
}
function renderTray() {
  const tray = $("attachTray");
  tray.hidden = !state.attachments.length;
  tray.innerHTML = state.attachments.map((a) => `<div class="attach-chip" data-id="${a.id}">
    ${a.preview ? `<img src="${a.preview}" alt="">` : `<span class="file-ico">${escapeHtml(extLabel(a.file.name))}</span>`}
    <div><strong>${escapeHtml(a.file.name)}</strong><small>${fmtSize(a.file.size)}</small></div>
    <button type="button" data-remove="${a.id}">${ic("x")}</button><span class="bar"><i style="width:${a.progress}%"></i></span></div>`).join("");
}
function clearAttachments() { state.attachments.forEach((a) => a.preview && URL.revokeObjectURL(a.preview)); state.attachments = []; renderTray(); }
$("attachTray").addEventListener("click", (e) => {
  const b = e.target.closest("[data-remove]"); if (!b) return;
  state.attachments = state.attachments.filter((a) => a.id !== b.dataset.remove); renderTray(); updateComposerState();
});
$("attachButton").onclick = () => $("fileInput").click();
$("fileInput").onchange = (e) => { addFiles([...e.target.files]); e.target.value = ""; };

/**
 * Uploads one file to POST /api/messages/upload as a raw body, with progress for the tray bar.
 * The server stores it, creates the chat message and pushes it live to both users.
 */
function sendFile(att, { caption = "", replyTo = null, to, voice = false } = {}) {
  const file = att.file || att;
  return new Promise((resolve) => {
    const params = new URLSearchParams({ to });
    if (caption) params.set("caption", caption); if (replyTo) params.set("replyTo", replyTo); if (voice) params.set("voice", "1");
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/messages/upload?${params}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name || "voice-message.webm"));
    xhr.setRequestHeader("X-File-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => { if (att.id && e.lengthComputable) { att.progress = Math.round((e.loaded / e.total) * 100); const bar = document.querySelector(`.attach-chip[data-id="${att.id}"] .bar i`); if (bar) bar.style.width = `${att.progress}%`; } };
    xhr.onload = () => {
      let data = {}; try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && data.success) { if (att.preview) URL.revokeObjectURL(att.preview); } else toast(data.message || "Upload failed.", "error");
      resolve(data);
    };
    xhr.onerror = () => { toast("Upload failed — check your connection.", "error"); resolve({}); };
    xhr.send(file);
  });
}

/* drag & drop + paste */
let dragDepth = 0;
const body = $("chatBody");
["dragenter", "dragover"].forEach((ev) => body.addEventListener(ev, (e) => { if (!e.dataTransfer?.types?.includes("Files") || !state.selected) return; e.preventDefault(); if (ev === "dragenter") dragDepth++; $("dropOverlay").classList.add("show"); }));
body.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $("dropOverlay").classList.remove("show"); });
body.addEventListener("drop", (e) => { e.preventDefault(); dragDepth = 0; $("dropOverlay").classList.remove("show"); if (e.dataTransfer?.files?.length) addFiles([...e.dataTransfer.files]); });
input.addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); addFiles(files.map((f, i) => (f.name && f.name !== "image.png" ? f : new File([f], `pasted-${Date.now()}-${i}.${(f.type.split("/")[1] || "png")}`, { type: f.type })))); }
});

/* ---------- voice messages ---------- */
function stopStream(r) { r?.stream?.getTracks().forEach((t) => t.stop()); }
/** Voice note: records the microphone with MediaRecorder (needs HTTPS or localhost). */
async function startRecording() {
  if (!state.selected) return;
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return toast("Voice recording isn't supported here (needs HTTPS or localhost).", "error");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream), chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.chunks = chunks; rec.startedAt = Date.now(); rec.target = state.selected.id;
    rec.start(); state.recorder = rec;
    $("composerRow").hidden = true; $("recordBar").hidden = false; $("recordTime").textContent = "0:00";
    rec.timer = setInterval(() => { $("recordTime").textContent = fmtDuration((Date.now() - rec.startedAt) / 1000); }, 500);
  } catch { toast("Microphone permission was denied.", "error"); }
}
function cancelRecording(silent) {
  const rec = state.recorder; if (!rec) return;
  clearInterval(rec.timer); rec.onstop = null; try { rec.stop(); } catch {} stopStream(rec); state.recorder = null;
  $("recordBar").hidden = true; $("composerRow").hidden = false;
}
function finishRecording() {
  const rec = state.recorder; if (!rec) return;
  clearInterval(rec.timer);
  rec.onstop = async () => {
    stopStream(rec);
    const type = rec.mimeType || "audio/webm", blob = new Blob(rec.chunks, { type });
    if (blob.size < 800) return toast("Recording was too short.", "info");
    const ext = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "m4a" : "webm";
    await sendFile(new File([blob], `voice-message.${ext}`, { type: type.split(";")[0] }), { to: rec.target, voice: true });
  };
  try { rec.stop(); } catch {}
  state.recorder = null; $("recordBar").hidden = true; $("composerRow").hidden = false;
}
$("micButton").onclick = startRecording;
$("recordCancel").onclick = () => cancelRecording();
$("recordSend").onclick = finishRecording;

/* ---------- emoji picker ---------- */
const EMOJI = {
  SMILEYS: "😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 😉 😍 🥰 😘 😋 😛 😜 🤪 😎 🤩 🥳 😏 😌 😴 🤔 🤗 🤭 😬 🙄 😢 😭 😤 😡 🥺 😱 😳 🤯 😷".split(" "),
  GESTURES: "👍 👎 👏 🙌 🙏 🤝 💪 👌 ✌️ 🤞 🤟 🤙 👋 ✋ 👀 🧠".split(" "),
  HEARTS: "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💕 💖 💯 🔥 ✨ ⭐ 🎉 🎁".split(" "),
  MISC: "☕ 🍕 🍔 🍿 🎵 🎮 ⚽ 🚀 🌈 ☀️ 🌙 🌸 🐶 🐱 🦄 💡".split(" ")
};
/** Builds the emoji picker grid once, the first time it is opened. */
function buildEmoji() {
  $("emojiPop").innerHTML = Object.entries(EMOJI).map(([k, list]) => `<h6>${k}</h6><div class="emoji-grid">${list.map((e) => `<button type="button" data-e="${e}">${e}</button>`).join("")}</div>`).join("");
}
function hideEmoji() { $("emojiPop").hidden = true; }
$("emojiButton").onclick = () => { const pop = $("emojiPop"); if (pop.hidden) { if (!pop.innerHTML) buildEmoji(); pop.hidden = false; } else hideEmoji(); };
$("emojiPop").addEventListener("click", (e) => {
  const b = e.target.closest("[data-e]"); if (!b) return;
  const s = input.selectionStart ?? input.value.length;
  input.value = input.value.slice(0, s) + b.dataset.e + input.value.slice(input.selectionEnd ?? s);
  input.focus(); input.selectionStart = input.selectionEnd = s + b.dataset.e.length; autosize(); updateComposerState();
});

/* ---------- lightbox ---------- */
/** Full-screen image viewer with a download button. */
function openLightbox(url) { $("lightboxImg").src = url; $("lightboxDl").href = `${url}?download=1`; $("lightbox").hidden = false; }
function closeLightbox() { $("lightbox").hidden = true; $("lightboxImg").src = ""; }
$("lightboxClose").onclick = closeLightbox;
$("lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox") closeLightbox(); });
$("infoPanel").addEventListener("click", (e) => { const i = e.target.closest("img[data-full]"); if (i) openLightbox(i.dataset.full); });

/* ---------- my profile ---------- */
function renderMe() {
  $("meAvatar").innerHTML = avatarHTML({ ...CURRENT_USER, isOnline: true }, "avatar-md");
  $("meName").textContent = CURRENT_USER.username;
  $("meBio").textContent = CURRENT_USER.bio || "Online now";
  $("profileAvatar").innerHTML = avatarHTML({ ...CURRENT_USER, isOnline: true }, "avatar-lg", false);
}
function openProfile() {
  renderMe();
  $("profileUsername").value = CURRENT_USER.username; $("profileEmail").value = CURRENT_USER.email;
  $("profileBio").value = CURRENT_USER.bio || ""; $("bioCount").textContent = `${$("profileBio").value.length}/160`;
  openModal($("profileModal"));
}
$("meCard").onclick = openProfile; $("navProfile").onclick = openProfile;
$("profileBio").addEventListener("input", () => { $("bioCount").textContent = `${$("profileBio").value.length}/160`; });
$("saveProfile").onclick = async () => {
  try { const d = await fetchJSON("/api/users/profile", { method: "PATCH", body: JSON.stringify({ bio: $("profileBio").value }) }); CURRENT_USER.bio = d.bio; renderMe(); closeModal($("profileModal")); toast("Profile updated.", "success"); }
  catch (e) { toast(e.message, "error"); }
};
$("changePhoto").onclick = () => $("photoInput").click();
$("photoInput").onchange = async (e) => {
  const file = e.target.files[0]; e.target.value = ""; if (!file) return;
  if (file.size > 3 * 1024 * 1024) return toast("Photo must be under 3 MB.", "error");
  try {
    const res = await fetch("/api/users/avatar", { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-File-Type": file.type }, body: file });
    const d = await res.json(); if (!d.success) throw new Error(d.message);
    CURRENT_USER.photo = d.photo; renderMe(); toast("Profile photo updated.", "success");
  } catch (err) { toast(err.message || "Upload failed.", "error"); }
};
$("removePhoto").onclick = async () => { try { await fetchJSON("/api/users/avatar", { method: "DELETE" }); CURRENT_USER.photo = ""; renderMe(); } catch (e) { toast(e.message, "error"); } };

/* ---------- theme + nav ---------- */
/** Dark / light theme; the choice is remembered in localStorage. */
function applyTheme(t) { document.documentElement.dataset.theme = t; try { localStorage.setItem("nook-theme", t); } catch {} $("themeToggle").innerHTML = ic(t === "dark" ? "moon" : "sun"); document.querySelector('meta[name="theme-color"]').content = t === "dark" ? "#080b1e" : "#eef0fb"; }
$("themeToggle").onclick = () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
$("navChats").onclick = () => { app.classList.remove("chat-open"); $("userSearch").value = ""; $("userSearch").dispatchEvent(new Event("input")); };

/* ---------- expose for calls.js ---------- */
// Hand the pieces calls.js needs to the global scope.
window.NookApp = { socket, toast, avatarHTML, ic, hydrate, getFriend, openChat, fmtDuration, escapeHtml };

/* ---------- boot ---------- */
applyTheme(document.documentElement.dataset.theme || "dark");
renderMe(); renderHeader();
$("messages").innerHTML = placeholderHTML();
loadFriends(); loadRequests();
setInterval(loadRequests, 30000);
setInterval(() => { if (document.visibilityState === "visible") renderFriends(); }, 60000);
