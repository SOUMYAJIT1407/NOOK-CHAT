/**
 * Unit tests — the real-time layer, without a network: a fake "socket" and a fake "presence" record
 * what the handlers would send. Covers the TYPING INDICATOR rules and the chat events (send, delete...).
 */
import "../helpers/env.js";
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { installFakeDb, resetDb, makeUser, makeFriends, store } from "../helpers/fakeDb.js";
import { createTyping } from "../../sockets/typingHandlers.js";
import { registerChatHandlers } from "../../sockets/chatHandlers.js";
import { sendText } from "../../services/messageService.js";
import Message from "../../models/Message.js";

installFakeDb();

let alice, bob, stranger, events, presence, handlers, socket;
const id = (u) => String(u._id);

/** Fake presence: records every emitted event instead of sending it. */
const makePresence = (log) => ({ emitToUsers: (ids, event, payload) => log.push({ ids: ids.map(String), event, payload }) });

/** Fake socket: remembers the handlers the code registers so a test can "receive" an event. */
function makeSocket(user) {
  const registered = {};
  return { registered, socket: { id: `sock-${id(user)}`, userId: id(user), on: (event, fn) => { registered[event] = fn; }, emit() {} } };
}

beforeEach(async () => {
  resetDb();
  alice = await makeUser("Alice");
  bob = await makeUser("Bob");
  stranger = await makeUser("Stranger");
  await makeFriends(alice, bob);
  events = [];
  presence = makePresence(events);
});

const typingEvents = () => events.filter((e) => e.event === "typing").map((e) => ({ to: e.ids[0], from: e.payload.userId, isTyping: e.payload.isTyping }));

// ---------------------------------------------------------------------------------------------------
// TYPING INDICATOR
// ---------------------------------------------------------------------------------------------------

function setupTyping() {
  const typing = createTyping({ presence });
  const { registered, socket: s } = makeSocket(alice);
  typing.register(s);
  return { typing, socket: s, send: (payload) => registered.typing(payload) };
}

afterEach(() => mock.timers.reset());

test("typing: a friend is told that I am typing", async () => {
  const { send } = setupTyping();
  await send({ receiverId: id(bob), isTyping: true });
  assert.deepEqual(typingEvents(), [{ to: id(bob), from: id(alice), isTyping: true }]);
});

test("typing: nothing is sent for strangers, yourself or invalid ids", async () => {
  const { send } = setupTyping();
  await send({ receiverId: id(stranger), isTyping: true });
  await send({ receiverId: id(alice), isTyping: true });
  await send({ receiverId: "garbage", isTyping: true });
  await send({});
  await send(undefined);
  assert.deepEqual(typingEvents(), []);
});

test("typing: rapid keystrokes are throttled (one event per 700 ms)", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { send } = setupTyping();
  for (let i = 0; i < 20; i++) { await send({ receiverId: id(bob), isTyping: true }); mock.timers.tick(20); } // 400 ms of fast typing
  assert.equal(typingEvents().length, 1, "20 keystrokes -> 1 event");
  mock.timers.tick(400);
  await send({ receiverId: id(bob), isTyping: true });
  assert.equal(typingEvents().length, 2, "after the throttle window the next keep-alive goes through");
});

test("typing: it stops by itself after 6 seconds of silence (the indicator can never get stuck)", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { send } = setupTyping();
  await send({ receiverId: id(bob), isTyping: true });
  mock.timers.tick(5900);
  assert.equal(typingEvents().length, 1, "still typing at 5.9 s");
  mock.timers.tick(200);
  assert.deepEqual(typingEvents().at(-1), { to: id(bob), from: id(alice), isTyping: false });
  mock.timers.tick(20_000);
  assert.equal(typingEvents().length, 2, "and it only stops once");
});

test("typing: keep-alives postpone the automatic stop", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { send } = setupTyping();
  for (let t = 0; t < 10; t++) { await send({ receiverId: id(bob), isTyping: true }); mock.timers.tick(1500); } // 15 s of typing
  assert.equal(typingEvents().filter((e) => !e.isTyping).length, 0, "no premature stop while the user keeps typing");
  mock.timers.tick(6100);
  assert.equal(typingEvents().filter((e) => !e.isTyping).length, 1);
});

test("typing: an explicit stop is sent once, and a stop without typing sends nothing", async () => {
  const { send } = setupTyping();
  await send({ receiverId: id(bob), isTyping: false });
  assert.deepEqual(typingEvents(), []);
  await send({ receiverId: id(bob), isTyping: true });
  await send({ receiverId: id(bob), isTyping: false });
  await send({ receiverId: id(bob), isTyping: false });
  assert.deepEqual(typingEvents().map((e) => e.isTyping), [true, false]);
});

test("typing: when the socket disconnects, typing stops immediately", async () => {
  const { send, typing, socket: s } = setupTyping();
  await send({ receiverId: id(bob), isTyping: true });
  typing.cleanup(s);
  assert.deepEqual(typingEvents().map((e) => e.isTyping), [true, false]);
});

// ---------------------------------------------------------------------------------------------------
// CHAT EVENTS (send / delete / read)
// ---------------------------------------------------------------------------------------------------

function setupChat(user) {
  const typing = { stopped: [], stop(sock, receiverId) { this.stopped.push(receiverId); } };
  const { registered, socket: s } = makeSocket(user);
  registerChatHandlers({ socket: s, presence, typing });
  /** Fires an event and waits for its acknowledgement, like the browser does. */
  const call = (event, ...args) => new Promise((resolve) => registered[event](...args, resolve));
  return { call, typing };
}

test("send-message: delivers to both people and ends the typing indicator", async () => {
  const chat = setupChat(alice);
  const ack = await chat.call("send-message", { receiverId: id(bob), message: "hello" });
  assert.equal(ack.success, true);
  const sent = events.find((e) => e.event === "new-message");
  assert.deepEqual(sent.ids.sort(), [id(alice), id(bob)].sort());
  assert.equal(sent.payload.message, "hello");
  assert.deepEqual(chat.typing.stopped, [id(bob)]);
});

test("send-message: errors come back as a friendly message, nothing is broadcast", async () => {
  const chat = setupChat(alice);
  const ack = await chat.call("send-message", { receiverId: id(stranger), message: "hi" });
  assert.match(ack.error, /friend request/i);
  assert.equal(events.length, 0);
});

test("delete-message (me): only my own tabs are told", async () => {
  const messageId = (await sendText(id(alice), { receiverId: id(bob), message: "x" }))._id;
  const chat = setupChat(alice);
  const ack = await chat.call("delete-message", { messageId, scope: "me" });
  assert.deepEqual({ success: ack.success, scope: ack.scope }, { success: true, scope: "me" });
  const e = events.find((x) => x.event === "message-deleted");
  assert.deepEqual(e.ids, [id(alice)]);
  assert.equal(e.payload.scope, "me");
  assert.equal(e.payload.messageId, messageId);
});

test("delete-message (everyone): both people are told", async () => {
  const messageId = (await sendText(id(alice), { receiverId: id(bob), message: "x" }))._id;
  const chat = setupChat(alice);
  const ack = await chat.call("delete-message", { messageId, scope: "everyone" });
  assert.equal(ack.success, true);
  const e = events.find((x) => x.event === "message-deleted");
  assert.deepEqual(e.ids.sort(), [id(alice), id(bob)].sort());
  assert.equal(e.payload.scope, "everyone");
  assert.ok(e.payload.deletedAt);
});

test("delete-message: the receiver cannot delete for everyone; nobody is told", async () => {
  const messageId = (await sendText(id(alice), { receiverId: id(bob), message: "x" }))._id;
  const chat = setupChat(bob);
  const ack = await chat.call("delete-message", { messageId, scope: "everyone" });
  assert.match(ack.error, /only the sender/i);
  assert.equal(events.length, 0);
  assert.equal(store.Message[0].deletedForEveryone, false);
});

test("delete-message: missing scope and garbage input are refused", async () => {
  const messageId = (await sendText(id(alice), { receiverId: id(bob), message: "x" }))._id;
  const chat = setupChat(alice);
  assert.match((await chat.call("delete-message", { messageId })).error, /delete for me/i);
  assert.match((await chat.call("delete-message", { messageId: { $ne: null }, scope: "me" })).error, /invalid/i);
  assert.match((await chat.call("delete-message", undefined)).error, /invalid/i);
  assert.equal(events.length, 0);
});

test("handlers survive missing acknowledgement callbacks and unexpected errors", async () => {
  const { registered } = (() => { const r = makeSocket(alice); registerChatHandlers({ socket: r.socket, presence, typing: { stop() {} } }); return r; })();
  registered["delete-message"]({ messageId: "x", scope: "me" }); // no callback -> must not throw
  const originalLog = console.error, originalFind = Message.find;
  console.error = () => {};
  try {
    Message.find = () => { throw new Error("database exploded: secret detail"); }; // simulate a database failure
    const chat = setupChat(alice);
    const ack = await chat.call("load-messages", id(bob));
    assert.equal(ack.error, "Something went wrong. Please try again.", "internal details are never leaked");
  } finally { console.error = originalLog; Message.find = originalFind; }
});

test("mark-read tells the sender their messages were seen", async () => {
  await sendText(id(bob), { receiverId: id(alice), message: "read me" });
  const chat = setupChat(alice);
  await chat.call("mark-read", { userId: id(bob) });
  const seen = events.find((e) => e.event === "messages-read");
  assert.deepEqual(seen.ids, [id(bob)]);
  assert.equal(seen.payload.by, id(alice));
});
