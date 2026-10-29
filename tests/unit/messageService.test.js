/**
 * Unit tests — message rules: sending, deleting "for me" / "for everyone", editing, reacting, and the
 * conversation list (last message + unread). Runs against the in-memory database stand-in.
 */
import "../helpers/env.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { installFakeDb, resetDb, makeUser, makeFriends, store } from "../helpers/fakeDb.js";
import { config } from "../../config/env.js";
import { saveFile, statFile, initStorage } from "../../services/storage.js";
import { friendsWithMeta } from "../../services/friends.js";
import {
  sendText, createFileMessage, loadConversation, deleteMessage, editMessage, toggleReaction,
  markConversationRead, ServiceError
} from "../../services/messageService.js";
import { DELETED_PREVIEW } from "../../services/messages.js";

installFakeDb();
await initStorage();

let alice, bob, carol;
beforeEach(async () => {
  resetDb();
  config.deleteForEveryoneMinutes = 0;
  alice = await makeUser("Alice");
  bob = await makeUser("Bob");
  carol = await makeUser("Carol");
  await makeFriends(alice, bob);
  await makeFriends(alice, carol);
});

const id = (u) => String(u._id);
const rejects = (promise, pattern) => assert.rejects(promise, (e) => e instanceof ServiceError && pattern.test(e.message));

let clock = 0;
/**
 * Sends one text from `from` to `to` and returns its id. Each message gets its own timestamp (one second
 * apart, a few minutes in the past) so the tests never depend on how fast the computer is.
 */
async function say(from, to, text) {
  const payload = await sendText(id(from), { receiverId: id(to), message: text });
  const doc = store.Message.find((m) => String(m._id) === payload._id);
  doc.createdAt = new Date(Date.now() - 600_000 + (clock += 1000));
  return payload._id;
}

/** Stores a real file on disk and a file message pointing at it. */
async function sendPhoto(from, to) {
  const key = `${"ab".repeat(16)}${Math.floor(Math.random() * 1e6)}.png`.slice(0, 40);
  const stored = key.replace(/[^a-f0-9.png]/g, "a");
  await saveFile("chat", stored, Buffer.from("fake image bytes"), { mime: "image/png" });
  const payload = await createFileMessage(id(from), id(to), { type: "image", file: { stored, name: "pic.png", size: 16, mime: "image/png" } });
  return { messageId: payload._id, stored };
}

// ---------------------------------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------------------------------

test("sendText stores a message for friends", async () => {
  const payload = await sendText(id(alice), { receiverId: id(bob), message: "  hello  " });
  assert.equal(payload.message, "hello");
  assert.equal(payload.sender, id(alice));
  assert.equal(payload.deleted, false);
  assert.equal(store.Message.length, 1);
});

test("sendText refuses strangers, yourself, empty text and invalid ids", async () => {
  const dave = await makeUser("Dave");
  await rejects(sendText(id(alice), { receiverId: id(dave), message: "hi" }), /friend request/i);
  await rejects(sendText(id(alice), { receiverId: id(alice), message: "hi" }), /yourself/i);
  await rejects(sendText(id(alice), { receiverId: id(bob), message: "   " }), /invalid/i);
  await rejects(sendText(id(alice), { receiverId: "nope", message: "hi" }), /invalid/i);
});

test("a reply target from another conversation is ignored", async () => {
  const other = await say(alice, carol, "secret to carol");
  const payload = await sendText(id(alice), { receiverId: id(bob), message: "re", replyTo: other });
  assert.equal(payload.replyTo, null);
});

// ---------------------------------------------------------------------------------------------------
// Delete for me
// ---------------------------------------------------------------------------------------------------

test("DELETE FOR ME hides the message only for the person who deleted it", async () => {
  const messageId = await say(alice, bob, "hello bob");
  const result = await deleteMessage(id(alice), messageId, "me");

  assert.equal(result.scope, "me");
  assert.deepEqual(result.recipients, [id(alice)], "only the deleting user is notified");
  assert.equal((await loadConversation(id(alice), id(bob))).length, 0, "gone for Alice");
  const forBob = await loadConversation(id(bob), id(alice));
  assert.equal(forBob.length, 1, "Bob still sees it");
  assert.equal(forBob[0].message, "hello bob");
  assert.equal(forBob[0].deleted, false);
});

test("the receiver can also delete a message for themselves", async () => {
  const messageId = await say(alice, bob, "hi");
  await deleteMessage(id(bob), messageId, "me");
  assert.equal((await loadConversation(id(bob), id(alice))).length, 0);
  assert.equal((await loadConversation(id(alice), id(bob))).length, 1);
});

test("when BOTH people delete for themselves the record and its file are erased", async () => {
  const { messageId, stored } = await sendPhoto(alice, bob);
  assert.ok(await statFile("chat", stored), "file exists before");

  await deleteMessage(id(alice), messageId, "me");
  assert.equal(store.Message.length, 1, "kept while Bob can still see it");
  assert.ok(await statFile("chat", stored), "file kept while Bob can still see it");

  await deleteMessage(id(bob), messageId, "me");
  assert.equal(store.Message.length, 0, "record removed");
  assert.equal(await statFile("chat", stored), null, "file removed from storage");
});

test("deleting for me twice is harmless", async () => {
  const messageId = await say(alice, bob, "x");
  await deleteMessage(id(alice), messageId, "me");
  await deleteMessage(id(alice), messageId, "me");
  assert.equal(store.Message[0].deletedFor.length, 1);
});

test("call history can be deleted for me", async () => {
  const call = await (await import("../../models/Message.js")).default.create({ sender: alice._id, receiver: bob._id, type: "call", call: { kind: "audio", status: "completed", duration: 5 } });
  await deleteMessage(id(bob), String(call._id), "me");
  assert.equal((await loadConversation(id(bob), id(alice))).length, 0);
  assert.equal((await loadConversation(id(alice), id(bob))).length, 1);
});

// ---------------------------------------------------------------------------------------------------
// Delete for everyone
// ---------------------------------------------------------------------------------------------------

test("DELETE FOR EVERYONE turns the message into a tombstone for both people", async () => {
  const messageId = await say(alice, bob, "oops wrong chat");
  const result = await deleteMessage(id(alice), messageId, "everyone");

  assert.equal(result.scope, "everyone");
  assert.deepEqual(result.recipients.sort(), [id(alice), id(bob)].sort(), "both people are notified");

  for (const [me, other] of [[alice, bob], [bob, alice]]) {
    const [m] = await loadConversation(id(me), id(other));
    assert.equal(m.deleted, true);
    assert.equal(m.message, "", "text is never sent again");
    assert.equal(m.file, null);
    assert.deepEqual(m.reactions, {});
  }
  assert.equal(store.Message[0].message, "", "the text is erased from the database itself");
});

test("delete for everyone erases the stored file and the shared-media entry", async () => {
  const { messageId, stored } = await sendPhoto(alice, bob);
  await deleteMessage(id(alice), messageId, "everyone");
  assert.equal(await statFile("chat", stored), null);
  assert.equal(store.Message[0].file, undefined);
  const [m] = await loadConversation(id(bob), id(alice));
  assert.equal(m.file, null);
});

test("only the SENDER can delete for everyone", async () => {
  const messageId = await say(alice, bob, "mine");
  await rejects(deleteMessage(id(bob), messageId, "everyone"), /only the sender/i);
  assert.equal(store.Message[0].deletedForEveryone, false);
});

test("a stranger cannot delete (or even see) someone else's message", async () => {
  const messageId = await say(alice, bob, "private");
  await rejects(deleteMessage(id(carol), messageId, "me"), /not found/i);
  await rejects(deleteMessage(id(carol), messageId, "everyone"), /not found/i);
});

test("call history cannot be deleted for everyone", async () => {
  const Message = (await import("../../models/Message.js")).default;
  const call = await Message.create({ sender: alice._id, receiver: bob._id, type: "call", call: { kind: "video", status: "missed" } });
  await rejects(deleteMessage(id(alice), String(call._id), "everyone"), /call history/i);
});

test("delete for everyone twice is idempotent", async () => {
  const messageId = await say(alice, bob, "x");
  await deleteMessage(id(alice), messageId, "everyone");
  const again = await deleteMessage(id(alice), messageId, "everyone");
  assert.equal(again.scope, "everyone");
});

test("DELETE_FOR_EVERYONE_MINUTES limits how long it stays possible", async () => {
  const messageId = await say(alice, bob, "old");
  store.Message[0].createdAt = new Date(Date.now() - 30 * 60_000);
  config.deleteForEveryoneMinutes = 10;
  await rejects(deleteMessage(id(alice), messageId, "everyone"), /within 10 minutes/i);
  assert.equal((await deleteMessage(id(alice), messageId, "me")).scope, "me", "delete for me is never limited");
  config.deleteForEveryoneMinutes = 60;
  const fresh = await say(alice, bob, "new");
  assert.equal((await deleteMessage(id(alice), fresh, "everyone")).scope, "everyone");
});

test("a tombstone can still be removed from my own chat", async () => {
  const messageId = await say(alice, bob, "x");
  await deleteMessage(id(alice), messageId, "everyone");
  await deleteMessage(id(bob), messageId, "me");
  assert.equal((await loadConversation(id(bob), id(alice))).length, 0);
  assert.equal((await loadConversation(id(alice), id(bob))).length, 1, "Alice still sees her own tombstone");
});

test("invalid scope or id is rejected", async () => {
  const messageId = await say(alice, bob, "x");
  await rejects(deleteMessage(id(alice), messageId, "nobody"), /delete for me/i);
  await rejects(deleteMessage(id(alice), messageId, undefined), /delete for me/i);
  await rejects(deleteMessage(id(alice), "not-an-id", "me"), /invalid/i);
});

// ---------------------------------------------------------------------------------------------------
// Interaction with other features
// ---------------------------------------------------------------------------------------------------

test("a deleted message cannot be edited, reacted to or replied to", async () => {
  const messageId = await say(alice, bob, "x");
  await deleteMessage(id(alice), messageId, "everyone");
  await rejects(editMessage(id(alice), messageId, "new text"), /not found/i);
  await rejects(toggleReaction(id(bob), messageId, "👍"), /not found/i);
  const reply = await sendText(id(bob), { receiverId: id(alice), message: "re", replyTo: messageId });
  assert.equal(reply.replyTo, null);
});

test("replies that quoted a message show the deleted placeholder afterwards", async () => {
  const original = await say(alice, bob, "secret text");
  await sendText(id(bob), { receiverId: id(alice), message: "answer", replyTo: original });
  await deleteMessage(id(alice), original, "everyone");
  const convo = await loadConversation(id(bob), id(alice));
  const answer = convo.find((m) => m.message === "answer");
  assert.equal(answer.replyInfo.text, DELETED_PREVIEW);
  assert.equal(JSON.stringify(convo).includes("secret text"), false, "the original text is nowhere in the payload");
});

test("reactions toggle on and off", async () => {
  const messageId = await say(alice, bob, "x");
  let r = await toggleReaction(id(bob), messageId, "👍");
  assert.deepEqual(r.payload.reactions, { [id(bob)]: "👍" });
  r = await toggleReaction(id(bob), messageId, "👍");
  assert.deepEqual(r.payload.reactions, {});
  await rejects(toggleReaction(id(bob), messageId, "💩"), /unsupported/i);
});

test("editing: only the author, only text-like messages", async () => {
  const messageId = await say(alice, bob, "typo");
  await rejects(editMessage(id(bob), messageId, "hacked"), /not found/i);
  const done = await editMessage(id(alice), messageId, "fixed");
  assert.equal(done.payload.message, "fixed");
  assert.equal(done.payload.edited, true);
});

// ---------------------------------------------------------------------------------------------------
// Conversation list (sidebar)
// ---------------------------------------------------------------------------------------------------

test("sidebar: last message, unread count, newest conversation first", async () => {
  await say(alice, bob, "first");
  await say(bob, alice, "second");
  await say(carol, alice, "from carol");
  const list = await friendsWithMeta(id(alice));
  assert.deepEqual(list.map((f) => f.username), ["Carol", "Bob"], "most recent first");
  assert.equal(list[0].lastMessage.text, "from carol");
  assert.equal(list[0].unread, 1);
  assert.equal(list[1].lastMessage.text, "second");
  assert.equal(list[1].unread, 1);
});

test("sidebar: deleting for me falls back to the previous message and lowers unread", async () => {
  await say(bob, alice, "one");
  const two = await say(bob, alice, "two");
  let bobEntry = (await friendsWithMeta(id(alice))).find((f) => f.username === "Bob");
  assert.equal(bobEntry.unread, 2);

  await deleteMessage(id(alice), two, "me");
  bobEntry = (await friendsWithMeta(id(alice))).find((f) => f.username === "Bob");
  assert.equal(bobEntry.lastMessage.text, "one");
  assert.equal(bobEntry.unread, 1);
});

test("sidebar: delete for everyone shows the placeholder and no longer counts as unread", async () => {
  const messageId = await say(bob, alice, "unsent");
  await deleteMessage(id(bob), messageId, "everyone");
  const bobEntry = (await friendsWithMeta(id(alice))).find((f) => f.username === "Bob");
  assert.equal(bobEntry.lastMessage.text, DELETED_PREVIEW);
  assert.equal(bobEntry.unread, 0);
});

test("markConversationRead only touches messages sent TO me", async () => {
  await say(bob, alice, "to alice");
  await say(alice, bob, "to bob");
  const { modified } = await markConversationRead(id(alice), id(bob));
  assert.equal(modified, 1);
  assert.ok(store.Message.find((m) => m.message === "to alice").readAt);
  assert.equal(store.Message.find((m) => m.message === "to bob").readAt, null);
});

test("cleanup of the temporary upload folder", () => {
  fs.rmSync(path.resolve(config.uploadDir), { recursive: true, force: true });
});
