# NOOK CHAT — architecture & feature reference

## Folder structure

```
server.js            start-up / graceful shutdown only
app.js               Express app: middleware order + routes (no listening)
config/              env.js (the ONLY place env vars are read), database.js, session.js
routes/              pageRoutes, authRoutes, oauthRoutes, userRoutes, friendRoutes,
                     uploadRoutes, fileRoutes, healthRoutes
sockets/             index.js (wiring), presence.js, chatHandlers.js, typingHandlers.js, callHandlers.js
services/            messageService.js (all chat rules), messages.js (JSON shapes),
                     friends.js, storage.js (GridFS or disk)
models/              User, FriendRequest, Message (Mongoose)
middleware/          authMiddleware, security headers, rateLimit, errorHandler
views/  public/      EJS pages, css, client js (chat.js, calls.js, ...), images
tests/               automated tests (npm test)
docs/                this file and DEPLOYMENT.md
```

Rule of thumb: **sockets and routes only translate** between the network and `services/`; the rules
(who may delete what, who may message whom) live in `services/messageService.js` where they are tested
without a browser.

## Typing indicator

```
Alice types ──"typing" {receiverId,isTyping:true}──► server ──"typing" {userId,isTyping}──► Bob
```
* **Client (`public/js/chat.js`, `notifyTyping`)**: first keystroke sends `typing`, then at most one
  keep-alive per 1.5 s. After 2.5 s of silence, an emptied box, a sent message, a blur or opening another
  chat it sends `isTyping:false`.
* **Server (`sockets/typingHandlers.js`)**: only friends are notified; events are throttled to one per
  700 ms per socket; if no event arrives for 6 s the server sends "stopped" itself; when a socket
  disconnects or a message is sent, typing stops immediately. Nothing is stored in the database and the
  friendship check is cached, so keystrokes cost no queries.
* **UI**: three bouncing dots as the last chat bubble (also in a brand-new empty chat), "typing…" in the
  chat header and under the friend's name in the conversation list. Respects `prefers-reduced-motion`.

## Deleting messages

Client sends `delete-message { messageId, scope: "me" | "everyone" }`; the rules are in
`services/messageService.js → deleteMessage`.

| | Delete for me | Delete for everyone |
|---|---|---|
| Who may use it | sender **or** receiver, any message (also call history) | **sender only**, not call history |
| What happens | the user's id is added to `deletedFor`; the message is hidden from that user's history, sidebar preview, unread count and file access | text, file and reactions are erased from MongoDB (and the stored file is deleted); a tombstone remains |
| Other person | unaffected | sees "🚫 This message was deleted" live; the original can no longer be opened, edited, reacted to or quoted |
| Live update | only the requester's own tabs | both people |
| Clean-up | when **both** people have deleted it for themselves, the record and its file are removed completely | idempotent — repeating it is harmless |
| Optional limit | – | `DELETE_FOR_EVERYONE_MINUTES` |

The client shows a two-button dialog; the receiver of a message is only offered "Delete for me".

## Socket.IO events (client ↔ server)

| Event | Direction | Purpose |
|---|---|---|
| `load-messages`, `chat-history` | → / ← | open a conversation |
| `send-message`, `new-message` | → / ← | text messages (files arrive via `POST /api/messages/upload`, then `new-message`) |
| `typing` | ↔ | typing indicator |
| `mark-read`, `messages-read`, `unread-cleared` | | seen ticks and unread counters |
| `edit-message`, `message-edited` | | edit own message |
| `delete-message`, `message-deleted` | | delete (scope `me` / `everyone`) |
| `react-message`, `message-reaction` | | emoji reactions |
| `user-status`, `profile-updated` | ← | presence and profile changes of friends |
| `friend-request`, `friend-request-updated` | ← | live friend requests |
| `call:*` | ↔ | WebRTC signalling (invite, answer, ice, media, reject, end) |

Every socket is authenticated by the login session cookie; every handler re-checks friendship.

## Security notes

* Passwords: bcrypt (cost 12). Sessions: signed httpOnly cookie, stored in MongoDB, `Secure` over HTTPS.
* Login/register are rate-limited per IP. Uploads are rate-limited and size-limited.
* Private files are only served to the two people in the chat and never after deletion;
  they are sent with `nosniff` and a locked-down Content-Security-Policy.
* The page-wide Content-Security-Policy is intentionally not set because the (unchanged) login/home
  pages use inline scripts and Google Fonts.
* `GET /logout` is a simple link (as in the original project); it can be forced by another site.
  If that matters to you, change it to a POST form.

## Tests

`npm test` runs 58 tests with Node's built-in test runner: services (sending, deleting, reactions,
sidebar), typing rules, socket handlers, and the HTTP layer (login, search, uploads, file access,
Range requests, health checks). The database is replaced by an in-memory stand-in
(`tests/helpers/fakeDb.js`) so they run anywhere — run the app against a real MongoDB before going live.
