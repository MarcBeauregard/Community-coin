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
# The server needs only these three packages.
RUN npm init -y >/dev/null && npm install --omit=dev --ignore-scripts ws@8.18.0 buffer@6.0.3 @solana/web3.js@1.98.4 && npm cache clean --force
COPY --from=build /app/web/src ./web/src
COPY --from=build /app/web/lobbies ./web/lobbies
COPY --from=build /app/web/dist/lobbies ./web/dist/lobbies
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["sh", "-c", "exec node web/lobbies/server/server.mjs --schedule hourly --guests --trust-proxy --static web/dist/lobbies ${ORIGINS:+--origins $ORIGINS}"]
