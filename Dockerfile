# NOOK CHAT — production image
#   docker build -t nook-chat .
#   docker run -p 3000:3000 -e MONGO_URI="..." -e SESSION_SECRET="..." -e NODE_ENV=production nook-chat
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install dependencies first so Docker can cache this layer until package*.json changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Application code (see .dockerignore: no node_modules, no .env, no tests).
COPY . .

# Only needed for STORAGE_DRIVER=local; harmless otherwise. Run as the unprivileged "node" user.
RUN mkdir -p uploads/files uploads/avatars && chown -R node:node /app
USER node

EXPOSE 3000

# /healthz answers while the process is alive (no database needed).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
