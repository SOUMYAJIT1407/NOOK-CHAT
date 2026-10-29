# Deploying NOOK CHAT to the cloud

NOOK is a single Node.js process (Express + Socket.IO) that talks to MongoDB. It needs **no disk**,
**no Redis** and **no extra services**: sessions, chat history *and uploaded files* all live in MongoDB.
That makes it easy to host almost anywhere that runs Node 20+ **and supports WebSockets**.

## 0. Before you start (all hosts)

1. **MongoDB Atlas** (free tier is enough): create a cluster → *Database Access* → add a user →
   *Network Access* → allow your host. Cloud hosts rarely have a fixed IP, so most people add
   `0.0.0.0/0` (allow from anywhere — protected by the user name + password).
2. Copy the connection string (*Connect → Drivers*). URL-encode special characters in the password
   (`@` → `%40`, `#` → `%23`).
3. Generate a session secret:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
4. **Never upload your `.env` file or commit it.** Enter the values as environment variables in the
   host's dashboard instead (the app reads real environment variables first, `.env` is optional).

> **If your database password has ever been in a public place** (a repository, a shared zip, a chat),
> change it in Atlas → *Database Access* and use the new one. Old copies of this project's
> `.env.example` contained a real connection string; the one in this version only has placeholders.

### Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `MONGO_URI` | **yes** | MongoDB connection string |
| `SESSION_SECRET` | **yes** in production | ≥ 16 random characters. The server refuses to start in production with a weak one |
| `NODE_ENV` | recommended | `production` on a host (HTTPS cookies, caching, strict checks) |
| `PORT` | no | Hosts set this automatically. Default `3000` |
| `TRUST_PROXY` | no | Number of proxies in front of the app. Default `1` in production |
| `STORAGE_DRIVER` | no | `gridfs` (default, files in MongoDB) or `local` (needs a persistent disk) |
| `MAX_UPLOAD_MB` | no | Default `25` |
| `DELETE_FOR_EVERYONE_MINUTES` | no | `0` = always allowed (default). `60` = only within one hour of sending |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` | no | Enables "Continue with Google" |
| `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` | no | TURN relay so calls work on strict networks |
| `CORS_ORIGIN` | no | Only if the web page is served from another domain |
| `AUTH_RATE_LIMIT` | no | Login/register attempts per IP per 15 min (default 30) |

All of them are validated at start-up; the log tells you exactly what is wrong.

## 1. Render (easiest, free tier available)

1. Push this folder to a GitHub repository (`.env` is git-ignored).
2. Render → **New + → Blueprint** → select the repo. `render.yaml` pre-fills everything.
3. Paste `MONGO_URI` when asked. `SESSION_SECRET` is generated for you.
4. After the first deploy open `https://<your-app>.onrender.com`.

Free Render services go to sleep after ~15 minutes without traffic (the first visit then takes ~30 s) —
upgrade the plan for an always-on chat.

## 2. Railway / Heroku / any "buildpack" host

* Build: `npm ci --omit=dev`  Start: `npm start` (a `Procfile` is included).
* Set `NODE_ENV=production`, `MONGO_URI`, `SESSION_SECRET`. The platform provides `PORT`.

## 3. Docker (Fly.io, Cloud Run, Azure, AWS, your own server)

```bash
docker build -t nook-chat .
docker run -d -p 3000:3000 --name nook \
  -e NODE_ENV=production -e MONGO_URI="mongodb+srv://..." -e SESSION_SECRET="..." \
  nook-chat
```
The image runs as an unprivileged user and has a built-in health check on `/healthz`.

* **Cloud Run:** WebSockets work, but set *minimum instances = 1*, *maximum instances = 1* and a long
  request timeout (3600 s) — see "Scaling" below.
* **Fly.io:** `fly launch`, then `fly secrets set MONGO_URI=... SESSION_SECRET=...`, keep one machine.

## 4. Your own Linux server (VPS) with Nginx + HTTPS

```bash
git clone <repo> && cd nook-chat && npm ci --omit=dev
cp .env.example .env && nano .env          # fill in MONGO_URI, SESSION_SECRET, NODE_ENV=production
sudo npm i -g pm2 && pm2 start server.js --name nook && pm2 save && pm2 startup
```
Nginx must forward WebSocket upgrades:
```nginx
server {
  server_name chat.example.com;
  client_max_body_size 30m;                       # uploads up to MAX_UPLOAD_MB
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;   # needed for secure cookies / Google sign-in
    proxy_read_timeout 3600s;                     # keep idle sockets open
  }
}
```
Then `sudo certbot --nginx -d chat.example.com` for free HTTPS.

## 5. After deploying — checklist

* [ ] `https://<your-domain>/healthz` shows `{"status":"ok"}` and `/readyz` shows `ready`
* [ ] Register two accounts (one in a private window), add each other, chat → messages arrive instantly
* [ ] Typing in one window shows the "typing…" bubble in the other
* [ ] Delete a message "for me" and "for everyone" and check both windows
* [ ] Send an image and a PDF; refresh the page — they are still there (stored in MongoDB)
* [ ] **HTTPS is required** for voice messages, camera, microphone and screen sharing (browsers block them on plain http, except `localhost`)
* [ ] Google sign-in: add `https://<your-domain>/auth/google/callback` to *Authorized redirect URIs* and set `GOOGLE_CALLBACK_URL` to the same value
* [ ] Calls between two different networks: add a TURN server (free tiers exist at e.g. metered.ca), otherwise some pairs cannot connect

## 6. Scaling: this app is designed to run as ONE instance

Who is online, who is typing, active calls and the login rate-limiter are kept **in the memory of the
single server process**. One small instance comfortably serves hundreds of simultaneous users.
To run several instances you must first:

1. use sticky sessions at the load balancer (Socket.IO long-polling needs them), and
2. add the Socket.IO Redis adapter and move presence / typing / call state into Redis, and
3. move the rate limiter to a shared store.

Until then keep the instance count at **1** (Render/Railway/Fly default to one).

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `SESSION_SECRET is missing or too weak` and the app exits | Set a real secret (see step 0.3) in the host's variables |
| `MONGO_URI is missing` | Add the variable in the host dashboard |
| Log says `Connection attempt … failed` | Atlas *Network Access* does not allow the host, or the user/password is wrong |
| Login works locally but you bounce back to the login page online | The host's proxy is not forwarding `X-Forwarded-Proto: https`; set `TRUST_PROXY=1` |
| Messages only arrive after a refresh | WebSockets are blocked by the proxy (Nginx `Upgrade` headers, see step 4) |
| Uploads fail with 413 | Proxy body limit is too small (`client_max_body_size`) |
| Camera/microphone buttons do nothing | The page is not on HTTPS |
| Google button says "not set up" | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` missing |
