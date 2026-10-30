// The lobbies' realtime server: one WebSocket room per lobby (presence, chat, live race, phases, the clock) and
// Sign-In With Solana. The server's clock is the only clock: clients render from the `now` it sends.
//
//   node web/lobbies/server/server.mjs --port 8790 [--guests] [--dev-sessions] [--data <dir>] [--sfu <wss url>]
//          [--origins https://app.example] [--trust-proxy] [--max-per-ip 50] [--http-per-min 120] [--lobby 412 --opens-at <ms>]
//          [--rpc <url> --program <id>]    (race from the chain through the indexer; else the simulated demo lobby)
//
//   GET  /auth/nonce                  → { nonce, issuedAt, message(address) is signInMessage(...) }
//   POST /auth/verify {address, nonce, signature(base64)} → { token }
//   POST /auth/guest                  → { token }  (read-only; only with --guests)
//   GET  /lobbies/:id                 → the room's snapshot
//   POST /auth/dev {sub}              → { token }  (tests and local development only: --dev-sessions)
//   GET  /clans/:mint                 → a launched lobby's clan: its founders by rank
//   POST /clans/:mint/media           → { id, type, size }  (members; Authorization: Bearer <token>; raw bytes)
//   GET  /media/:id?token=…           → the file (members of the clan it was shared in)
//   POST /voice/token {lobby | clan}  → { url, token, canPublish }  (an SFU access token; 503 without --sfu)
//   WS   /ws?lobby=:id&token=…        → hello, then chat / race / presence / phase / clock; send chat, listen, ping
//   WS   /ws?clan=:mint&token=…       → the clan's channels (clan-room.mjs); members only

import http from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { createAuth, signInMessage } from "./auth.mjs";
import { createRoom } from "./room.mjs";
import { simulatedSource, chainSource } from "./sources.mjs";
import { createCrank, stateOfRules, rulesExecutor } from "./crank.mjs";
import { createClans } from "./clans.mjs";
import { createClanRoom, fileStore } from "./clan-room.mjs";
import { createMedia } from "./media.mjs";
import { sfuToken, sfuAdmin } from "./voice.mjs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization" };
const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", "x-content-type-options": "nosniff", "cache-control": "no-store", ...CORS });
  res.end(JSON.stringify(body));
};
const readBody = (req) => new Promise((resolve) => {
  let b = "";
  req.on("data", (c) => { b += c; if (b.length > 4096) req.destroy(); });
  req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve({}); } });
});
// A raw body up to `max` bytes; null if it is larger (refused at once if it says so, else the rest is drained
// unread so the answer still reaches the client).
const readBytes = (req, max) => new Promise((resolve) => {
  if (Number(req.headers["content-length"]) > max) { req.resume(); return resolve(null); }
  const parts = [];
  let size = 0;
  req.on("data", (c) => { size += c.length; if (size <= max) parts.push(c); });
  req.on("end", () => resolve(size > max ? null : Buffer.concat(parts)));
  req.on("error", () => resolve(null));
});
const bearer = (req, url) => (req.headers.authorization ?? "").replace(/^Bearer /, "") || url.searchParams.get("token");

export function createServer({ port = 0, guests = false, devSessions = false, dataDir = null, voice = null, lobbies, auth = createAuth(), now = () => Date.now(), batchMs = 250, maxPerRoom = 20000,
  maxPerIp = 50, httpPerMin = 120, origins = null, trustProxy = false }) {
  // Abuse limits: sockets per address, HTTP requests per address and minute, and (in production) the app's origins.
  // Behind a proxy, `trustProxy` reads the client's address from X-Forwarded-For.
  const ipOf = (req) => (trustProxy && String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim()) || req.socket.remoteAddress;
  const sockets = new Map(); // ip -> open sockets
  const hits = new Map(); // ip -> { n, since }
  const tooMany = (ip) => {
    const t = Date.now();
    const h = hits.get(ip);
    if (!h || t - h.since > 60_000) { hits.set(ip, { n: 1, since: t }); if (hits.size > 100_000) hits.clear(); return false; }
    return ++h.n > httpPerMin;
  };
  const originOk = (req) => !origins || origins.includes(req.headers.origin);
  // Voice: `voice` is the SFU ({ url for clients, adminUrl, apiKey, apiSecret }). A change of who may speak is pushed
  // to it at once; the next token carries the same right.
  const admin = voice ? sfuAdmin({ url: voice.adminUrl ?? voice.url.replace(/^ws/, "http"), apiKey: voice.apiKey, apiSecret: voice.apiSecret, fetchImpl: voice.fetch, now }) : null;
  const setPublish = (room) => (user, can) => admin?.setCanPublish(room, user, can).catch((e) => console.error(e.message));
  const rooms = new Map(lobbies.map((l) => [String(l.id), createRoom({ ...l, now, onStage: setPublish(`lobby-${l.id}`) })]));
  // Clans are forever: with a data directory, the registry, every clan's channels and the media survive restarts.
  if (dataDir) mkdirSync(join(dataDir, "clans"), { recursive: true });
  const clans = createClans({ store: dataDir ? fileStore(join(dataDir, "clans.jsonl")) : null });
  const media = createMedia({ dir: dataDir ? join(dataDir, "media") : null });
  const clanRooms = new Map();
  const clanRoom = (mint) => {
    if (!clans.get(mint)) return null;
    if (!clanRooms.has(mint)) {
      const store = dataDir ? fileStore(join(dataDir, "clans", `${mint.replace(/[^\w-]/g, "_")}.jsonl`)) : undefined;
      clanRooms.set(mint, createClanRoom({ mint, clans, media, store, now, onVoice: setPublish(`clan-${mint}`) }));
    }
    return clanRooms.get(mint);
  };
  // A lobby played on the program's rules gets the crank on those rules; a lobby on a cluster brings its own
  // (`crank` built with a clusterExecutor). Either way its events go to the room and the clan registry.
  for (const l of lobbies) {
    const room = rooms.get(String(l.id));
    const onEvents = (events) => { clans.apply(events, now()); room.announce(events, clans); };
    if (l.crank) room.setCrank(l.crank(onEvents));
    else if (l.source.chain) room.setCrank(createCrank({ state: () => stateOfRules(l.source.chain), execute: rulesExecutor(l.source.chain), onEvents }));
  }
  const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") return json(res, 204, {});
    if (tooMany(ipOf(req))) return json(res, 429, { error: "Too many requests" });
    const url = new URL(req.url, "http://x");
    if (req.method === "GET" && url.pathname === "/auth/nonce") {
      try { return json(res, 200, { ...auth.nonce(), domain: auth.domain }); } catch (e) { return json(res, 429, { error: e.message }); }
    }
    if (req.method === "POST" && url.pathname === "/auth/verify") {
      try { return json(res, 200, { token: auth.verify(await readBody(req)) }); } catch (e) { return json(res, 401, { error: e.message }); }
    }
    if (req.method === "POST" && url.pathname === "/auth/guest") {
      if (!guests) return json(res, 403, { error: "Guests are not allowed" });
      return json(res, 200, { token: auth.issue(`guest-${randomUUID().slice(0, 8)}`, { guest: true }) });
    }
    if (req.method === "POST" && url.pathname === "/auth/dev") {
      if (!devSessions) return json(res, 404, { error: "Not found" });
      const { sub } = await readBody(req);
      return json(res, 200, { token: auth.issue(String(sub ?? "dev").slice(0, 64)) });
    }
    const up = /^\/clans\/([^/]+)\/media$/.exec(url.pathname);
    if (req.method === "POST" && up) {
      const session = auth.session(bearer(req, url));
      const room = clanRoom(decodeURIComponent(up[1]));
      if (!session || session.guest || !room?.isMember(session.sub)) return json(res, 403, { error: "Members only" });
      const buf = await readBytes(req, media.maxBytes);
      if (!buf) return json(res, 413, { error: "File too large" });
      try { return json(res, 200, media.put(buf, { clan: room.mint, by: session.sub, at: now() })); } catch (e) { return json(res, 415, { error: e.message }); }
    }
    if (req.method === "POST" && url.pathname === "/voice/token") {
      if (!voice) return json(res, 503, { error: "Voice is not configured on this server" });
      const session = auth.session(bearer(req, url));
      if (!session) return json(res, 401, { error: "Sign in first" });
      const { lobby, clan } = await readBody(req);
      let room, canPublish;
      if (clan !== undefined) {
        const c = clanRoom(String(clan));
        if (session.guest || !c?.isMember(session.sub)) return json(res, 403, { error: "Founders only" });
        room = `clan-${c.mint}`;
        canPublish = c.canSpeak(session.sub);
      } else {
        const r = rooms.get(String(lobby));
        if (!r) return json(res, 404, { error: "Unknown lobby" });
        room = `lobby-${r.id}`;
        canPublish = !session.guest && r.stage.isSpeaker(session.sub); // listeners, guests included, only listen
      }
      return json(res, 200, { url: voice.url, room, canPublish, token: sfuToken({ apiKey: voice.apiKey, apiSecret: voice.apiSecret, identity: session.sub, room, canPublish, now: now() }) });
    }
    const md = /^\/media\/([0-9a-f]{64})$/.exec(url.pathname);
    if (req.method === "GET" && md) {
      const file = media.get(md[1]);
      const session = auth.session(bearer(req, url));
      if (!file || !session || !clanRoom(file.clan)?.isMember(session.sub)) return json(res, 404, { error: "Not found" });
      res.writeHead(200, { ...CORS, "content-type": file.type, "content-length": file.bytes.length, "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox", "content-disposition": "inline", "cache-control": "private, max-age=31536000, immutable" });
      return res.end(file.bytes);
    }
    const c = /^\/clans\/([^/]+)$/.exec(url.pathname);
    if (req.method === "GET" && c) {
      const clan = clans.toJSON(decodeURIComponent(c[1]));
      return json(res, clan ? 200 : 404, clan ?? { error: "No clan for this mint" });
    }
    const m = /^\/lobbies\/(\d+)$/.exec(url.pathname);
    if (req.method === "GET" && m && rooms.has(m[1])) return json(res, 200, rooms.get(m[1]).snapshot());
    json(res, 404, { error: "Not found" });
  });

  const wss = new WebSocketServer({ server, maxPayload: 2048 });
  wss.on("connection", (ws, req) => {
    const ip = ipOf(req);
    if (!originOk(req)) return ws.close(4403, "Unknown origin");
    if ((sockets.get(ip) ?? 0) >= maxPerIp) return ws.close(4429, "Too many connections from this address");
    sockets.set(ip, (sockets.get(ip) ?? 0) + 1);
    ws.on("close", () => { const n = sockets.get(ip) - 1; if (n > 0) sockets.set(ip, n); else sockets.delete(ip); });
    const url = new URL(req.url, "http://x");
    const session = auth.session(url.searchParams.get("token"));
    if (url.pathname !== "/ws" || !session) return ws.close(4401, "Sign in first");
    if (url.searchParams.has("clan")) {
      const clan = clanRoom(url.searchParams.get("clan"));
      if (!clan) return ws.close(4404, "Unknown clan");
      const id = randomUUID();
      const send = (s) => { if (ws.readyState === ws.OPEN && ws.bufferedAmount < 1 << 20) ws.send(s); };
      const hello = clan.join(id, session, send);
      if (!hello) return ws.close(4403, "Founders only");
      send(JSON.stringify(hello));
      ws.on("message", (data) => {
        const out = clan.receive(id, data.toString());
        if (out === "close") return ws.close(4408, "Closed by the server");
        if (out) send(JSON.stringify(out));
      });
      ws.on("close", () => clan.leave(id));
      return;
    }
    const room = rooms.get(url.searchParams.get("lobby") ?? "");
    if (!room) return ws.close(4404, "Unknown lobby");
    if (room.size() >= maxPerRoom) return ws.close(4429, "Lobby full");
    const id = randomUUID();
    const send = (s) => { if (ws.readyState === ws.OPEN && ws.bufferedAmount < 1 << 20) ws.send(s); };
    send(JSON.stringify(room.join(id, session, send)));
    ws.on("message", (data) => {
      const out = room.receive(id, data.toString());
      if (out === "close") return ws.close(4408, "Too many messages");
      if (out) send(JSON.stringify(out));
    });
    ws.on("close", () => room.leave(id));
  });

  const timer = setInterval(() => { for (const r of rooms.values()) r.tick(); }, batchMs);
  return new Promise((resolve) => server.listen(port, () => resolve({
    port: server.address().port, rooms, auth, clans, clanRoom, media,
    close: () => new Promise((r) => { clearInterval(timer); for (const c of wss.clients) c.terminate(); wss.close(); server.close(r); }),
  })));
}

export { signInMessage };

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? undefined : process.argv[i + 1]; };
  const id = Number(arg("lobby") ?? 412);
  const opensAt = Number(arg("opens-at") ?? Date.now() - 1452 * 1000);
  const source = arg("rpc") ? chainSource({ rpc: arg("rpc"), programId: arg("program"), lobby: id }) : simulatedSource();
  const s = await createServer({ port: Number(arg("port") ?? 8790), guests: process.argv.includes("--guests"), devSessions: process.argv.includes("--dev-sessions"),
    maxPerIp: Number(arg("max-per-ip") ?? 50), httpPerMin: Number(arg("http-per-min") ?? 120), origins: arg("origins")?.split(","), trustProxy: process.argv.includes("--trust-proxy"),
    dataDir: arg("data"), lobbies: [{ id, opensAt, source }],
    // --sfu wss://… with LIVEKIT_API_KEY and LIVEKIT_API_SECRET in the environment
    voice: arg("sfu") ? { url: arg("sfu"), apiKey: process.env.LIVEKIT_API_KEY, apiSecret: process.env.LIVEKIT_API_SECRET } : null });
  console.log(`lobby ${id} live on :${s.port} (${arg("rpc") ? "race from the chain" : "simulated race"})`);
}
