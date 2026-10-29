# NOOK CHAT — Messenger

Real-time chat built with **Node.js, Express, MongoDB and Socket.IO**: friend search, typing indicator,
**delete for me / delete for everyone**, image & file sharing, voice messages, WebRTC voice/video calls,
Google sign-in, dark/light theme, fully responsive.

## Run it locally

```bash
npm install        # only if node_modules is missing
npm start          # or: npm run dev   (auto-restart)
```
Open <http://localhost:3000>. The included `.env` (`PORT`, `MONGO_URI`, `SESSION_SECRET`) is read as-is —
the app never writes to it. Everything else is optional (see `.env.example`).

## Put it on the internet

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** — step-by-step for Render, Railway/Heroku, Docker and a
Linux server with Nginx, plus a checklist and troubleshooting table. Included: `Dockerfile`,
`.dockerignore`, `render.yaml`, `Procfile`, health checks at `/healthz` and `/readyz`.

Short version: set `NODE_ENV=production`, `MONGO_URI`, `SESSION_SECRET` as **environment variables on the
host** (do not upload `.env`), keep **one instance**, and use HTTPS.

## New in this version

* **Typing indicator** — animated bubble in the chat, "typing…" in the header and the conversation list.
  Throttled, auto-expiring and cleaned up on send/disconnect, so it can never get stuck.
* **Delete for me / Delete for everyone** — two-option dialog. *For me* hides the message only for you;
  *for everyone* (sender only) erases the content and the file and leaves "This message was deleted" for
  both people. Optional time limit: `DELETE_FOR_EVERYONE_MINUTES`.
* **Cloud-ready structure** — `config/`, `sockets/`, `services/`, `routes/`, `middleware/`; env validation
  with clear errors; MongoDB-backed sessions; uploads stored in MongoDB (GridFS) so redeploys never lose
  them; secure cookies behind HTTPS proxies; security headers; rate limiting; graceful shutdown;
  centralised error pages; automated tests.

## Features

* Pages: home, login and register keep their original design; register has a password strength meter
* Messenger: search people by any characters of a name, friend requests, unread badges, seen ticks,
  reply / edit / react, emoji picker, image viewer, drag-and-drop and paste uploads (up to 25 MB),
  profile photo and bio, call history in the chat
* Calls: voice and video, mute, camera, screen share (HTTPS required for camera/mic)

## Scripts

| Command | What it does |
|---|---|
| `npm start` | production start |
| `npm run dev` | start with auto-restart (nodemon) |
| `npm test` | run the 58 automated tests |

## More documentation

* [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — folder map, how typing and deleting work, socket events, security notes
* [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — hosting guide
"# nook" 
