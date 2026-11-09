# The closed beta: one container serves the app and its hourly practice lobbies (no real SOL, nothing on chain).
# Build from the repository root:
#   docker build -f web/lobbies/Dockerfile -t social-launch-beta .
# Run (see README, « Héberger la bêta fermée »):
#   docker run -p 8790:8790 -v sl-data:/data -e SESSION_SECRET=… -e STATS_TOKEN=… -e LOBBY_HOST=<wallet> social-launch-beta

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY web ./web
RUN node web/lobbies/build.mjs

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8790 DATA_DIR=/data
# The server's own dependencies, at the versions the lockfile pins.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
# The server, and what it imports of the app (the program's rules, the wire format).
COPY web/src ./web/src
COPY web/lobbies/server ./web/lobbies/server
COPY web/lobbies/src ./web/lobbies/src
COPY web/lobbies/indexer.mjs ./web/lobbies/indexer.mjs
COPY --from=build /app/web/dist/lobbies ./web/dist/lobbies
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "web/lobbies/server/server.mjs", "--schedule", "hourly", "--guests", "--trust-proxy", "--static", "web/dist/lobbies"]
