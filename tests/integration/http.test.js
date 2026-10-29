/**
 * Integration tests — the real Express app over real HTTP (database = in-memory stand-in).
 * Covers: health checks, login, security headers, search by name, file upload, and — most
 * importantly — WHO may open a shared file, before and after "Delete for me" / "Delete for everyone".
 */
import "../helpers/env.js";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { resetDb, makeFriends, makeUser, store } from "../helpers/fakeDb.js";
import { startTestApp, makeLoginUser, Client } from "../helpers/testApp.js";
import { deleteMessage } from "../../services/messageService.js";
import { config } from "../../config/env.js";

let app, alice, bob, carol, A, B, C; // A/B/C = logged-in HTTP clients of Alice/Bob/Carol
const id = (u) => String(u._id);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

before(async () => { app = await startTestApp(); });
after(async () => { await app.close(); fs.rmSync(config.uploadDir, { recursive: true, force: true }); });

beforeEach(async () => {
  resetDb();
  app.emitted.length = 0;
  alice = await makeLoginUser("Alice");
  bob = await makeLoginUser("Bob");
  carol = await makeLoginUser("Carol");
  await makeFriends(alice, bob);
  A = await new Client(app.url).login(alice);
  B = await new Client(app.url).login(bob);
  C = await new Client(app.url).login(carol);
});

/** Alice sends Bob a photo; returns { messageId, url }. */
async function sharePhoto() {
  const res = await A.upload(id(bob), PNG);
  assert.equal(res.status, 200);
  const { message } = await res.json();
  return { messageId: message._id, url: new URL(message.file.url, app.url).pathname };
}

// ---------------------------------------------------------------------------------------------------
// Platform basics
// ---------------------------------------------------------------------------------------------------

test("health checks: /healthz is always ok, /readyz reflects the database", async () => {
  const live = await fetch(`${app.url}/healthz`);
  assert.equal(live.status, 200);
  assert.equal((await live.json()).status, "ok");
  const ready = await fetch(`${app.url}/readyz`);
  assert.equal(ready.status, 503, "no database connection in tests -> not ready");
});

test("security headers are set and the server does not advertise Express", async () => {
  const res = await fetch(`${app.url}/healthz`);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.equal(res.headers.get("x-powered-by"), null);
  assert.match(res.headers.get("permissions-policy"), /camera=\(self\)/);
});

test("unknown URLs: JSON 404 for the API, a friendly page otherwise", async () => {
  const api = await fetch(`${app.url}/api/nothing-here`);
  assert.equal(api.status, 404);
  assert.equal((await api.json()).success, false);
  const page = await fetch(`${app.url}/no-such-page`);
  assert.equal(page.status, 404);
  assert.match(await page.text(), /couldn.t find that page/);
});

test("pages: home is public, chat needs a login", async () => {
  assert.equal((await fetch(`${app.url}/`)).status, 200);
  const res = await fetch(`${app.url}/chat`, { redirect: "manual" });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/login");
  assert.equal((await A.request("/chat")).status, 200);
});

test("login: a wrong password shows the error and does not start a session", async () => {
  const anon = new Client(app.url);
  const res = await anon.request("/login", { method: "POST", body: new URLSearchParams({ email: alice.email, password: "WrongPass1!" }), headers: { "content-type": "application/x-www-form-urlencoded" } });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Invalid email or password/);
  assert.equal((await anon.request("/chat")).status, 302);
});

// ---------------------------------------------------------------------------------------------------
// Search friends by name
// ---------------------------------------------------------------------------------------------------

test("search by name: matches any characters of a name, best matches first, never yourself", async () => {
  for (const name of ["Natalie", "Khalid", "Zed"]) await makeUser(name);
  const names = async (q) => (await A.json(`/api/users/search?q=${encodeURIComponent(q)}`)).users.map((u) => u.username);

  assert.deepEqual(await names("ali"), ["Khalid", "Natalie"], "names containing the text (Alice herself is excluded)");
  assert.deepEqual(await names("BO"), ["Bob"], "case-insensitive");
  assert.deepEqual(await names("ntl"), ["Natalie"], "scattered letters, in order (n..t..l), still match");
  assert.deepEqual(await names("etn"), [], "the same letters in the wrong order do not match");
  assert.deepEqual(await names("qqq"), []);
  assert.deepEqual(await names(""), []);
  assert.equal((await names("a.*")).length, 0, "regex characters in the query are treated as plain text");
});

test("search by name: a long 'almost matching' query is answered quickly (no catastrophic regex)", async () => {
  // 29 a's can never contain 30 a's in order. A single regex like a.*a.*a... could take forever on
  // the database; the app only ever runs cheap single-character regexes and checks the order in JS.
  await makeUser("a".repeat(29));
  await makeUser("a".repeat(28) + "b");
  const started = Date.now();
  const result = await A.json(`/api/users/search?q=${"a".repeat(30)}`);
  assert.equal(result.success, true);
  assert.deepEqual(result.users, [], "no name has 30 a's");
  assert.ok(Date.now() - started < 1000, "answered in well under a second");
  const some = await A.json(`/api/users/search?q=${"a".repeat(28)}`);
  assert.equal(some.users.length, 2, "28 a's are contained in both names");
});

test("search by name: tells you who is already a friend", async () => {
  const { users } = await A.json("/api/users/search?q=bo");
  assert.equal(users[0].username, "Bob");
  assert.equal(users[0].relationship, "friends");
  assert.equal(users[0].password, undefined, "no secrets in the response");
});

// ---------------------------------------------------------------------------------------------------
// File sharing and who may open a file
// ---------------------------------------------------------------------------------------------------

test("upload: creates a live image message for both people", async () => {
  const res = await A.upload(id(bob), PNG, { query: "&caption=look" });
  const { message } = await res.json();
  assert.equal(message.type, "image");
  assert.equal(message.message, "look");
  assert.equal(message.deleted, false);
  const live = app.emitted.find((e) => e.event === "new-message");
  assert.deepEqual(live.users.sort(), [id(alice), id(bob)].sort());
});

test("upload: refused for non-friends, empty files and oversized files", async () => {
  assert.equal((await A.upload(id(carol), PNG)).status, 400, "carol is not Alice's friend");
  assert.equal((await A.upload(id(bob), Buffer.alloc(0))).status, 400);
  const big = await A.upload(id(bob), Buffer.alloc(1.5 * 1024 * 1024), { name: "big.bin", type: "application/octet-stream" });
  assert.equal(big.status, 413);
  assert.match((await big.json()).message, /max 1 MB/);
  assert.equal(store.Message.length, 0, "nothing was stored");
});

test("file access: only the two people in the chat can open an image", async () => {
  const { url } = await sharePhoto();
  for (const [who, client] of [["sender", A], ["receiver", B]]) {
    const res = await client.request(url);
    assert.equal(res.status, 200, who);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG, `${who} gets the exact bytes`);
  }
  assert.equal((await C.request(url)).status, 404, "a logged-in stranger");
  assert.equal((await fetch(`${app.url}${url}`)).status, 401, "not logged in at all");
  assert.equal((await A.request("/files/not-a-valid-key")).status, 404);
});

test("file access: images display inline, other types download, and files can never run scripts", async () => {
  const { url } = await sharePhoto();
  const inline = await A.request(url);
  assert.match(inline.headers.get("content-disposition"), /^inline/);
  assert.match(inline.headers.get("content-security-policy"), /default-src 'none'/);
  assert.equal((await (await A.request(`${url}?download=1`)).headers.get("content-disposition")).startsWith("attachment"), true);

  const html = await (await A.upload(id(bob), Buffer.from("<script>alert(1)</script>"), { name: "evil.html", type: "text/html" })).json();
  const res = await B.request(html.message.file.url);
  assert.match(res.headers.get("content-disposition"), /^attachment/, "html is never rendered in the page");
  assert.equal(html.message.type, "file");
});

test("file access: HTTP Range requests work (needed for voice notes on iPhone/Safari)", async () => {
  const { url } = await sharePhoto();
  const res = await A.request(url, { headers: { range: "bytes=0-9" } });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), `bytes 0-9/${PNG.length}`);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG.subarray(0, 10));
  assert.equal((await A.request(url, { headers: { range: "bytes=9999-" } })).status, 416);
});

test("DELETE FOR ME: the file disappears for me, but the other person can still open it", async () => {
  const { messageId, url } = await sharePhoto();
  await deleteMessage(id(bob), messageId, "me");
  assert.equal((await B.request(url)).status, 404, "Bob deleted it for himself");
  assert.equal((await A.request(url)).status, 200, "Alice still has it");
});

test("DELETE FOR EVERYONE: the file is gone for both people and erased from storage", async () => {
  const { messageId, url } = await sharePhoto();
  const stored = url.split("/").pop();
  assert.ok(fs.existsSync(`${config.uploadDir}/files/${stored}`));
  await deleteMessage(id(alice), messageId, "everyone");
  assert.equal((await A.request(url)).status, 404);
  assert.equal((await B.request(url)).status, 404);
  assert.equal(fs.existsSync(`${config.uploadDir}/files/${stored}`), false, "removed from disk");
});

test("shared media list skips deleted items", async () => {
  const one = await sharePhoto();
  await sharePhoto();
  assert.equal((await B.json(`/api/users/${id(alice)}/shared`)).items.length, 2);
  await deleteMessage(id(bob), one.messageId, "me");
  assert.equal((await B.json(`/api/users/${id(alice)}/shared`)).items.length, 1, "Bob deleted one for himself");
  assert.equal((await A.json(`/api/users/${id(bob)}/shared`)).items.length, 2, "Alice is unaffected");
  await deleteMessage(id(alice), one.messageId, "everyone");
  assert.equal((await A.json(`/api/users/${id(bob)}/shared`)).items.length, 1, "deleted for everyone leaves the list");
  assert.equal((await C.request(`/api/users/${id(alice)}/shared`)).status, 403, "strangers cannot list it");
});

test("profile picture: validated type, publicly viewable, replaceable", async () => {
  const bad = await A.request("/api/users/avatar", { method: "POST", body: Buffer.from("x"), headers: { "x-file-type": "application/pdf" } });
  assert.equal(bad.status, 400);
  const ok = await A.request("/api/users/avatar", { method: "POST", body: PNG, headers: { "x-file-type": "image/png" } });
  const { photo } = await ok.json();
  assert.match(photo, /^\/avatars\/[a-f0-9]{24}\.png$/);
  const view = await fetch(`${app.url}${photo}`); // no login needed
  assert.equal(view.status, 200);
  assert.equal(view.headers.get("content-type"), "image/png");
  assert.match(view.headers.get("cache-control"), /immutable/);
  assert.equal((await fetch(`${app.url}/avatars/${"0".repeat(24)}.png`)).status, 404);
});
