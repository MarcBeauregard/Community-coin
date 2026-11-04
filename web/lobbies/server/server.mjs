// The lobbies' realtime server: one WebSocket room per lobby (presence, chat, live race, phases, the clock) and
// Sign-In With Solana. The server's clock is the only clock: clients render from the `now` it sends.
//
//   node web/lobbies/server/server.mjs --port 8790 [--guests] [--dev-sessions] [--data <dir>] [--sfu <wss url>] [--welcome <text>]
//          [--origins https://app.example] [--trust-proxy] [--max-per-ip 50] [--http-per-min 120] [--lobby 412 --opens-at <ms>]
//          [--rpc <url> --program <id>]    (race from the chain through the indexer; else the simulated demo lobby)
//          [--schedule hourly --host <wallet> [--name …] [--theme …] [--host-name …]] [--static web/dist/lobbies]
//          (the closed beta: an empty practice lobby every hour, the app served from the same address)
//   env: PORT, DATA_DIR, ORIGINS (or Render's RENDER_EXTERNAL_URL), SESSION_SECRET (sessions survive restarts), STATS_TOKEN (GET /stats), LOBBY_HOST, …
//
//   GET  /health                      → { ok, lobbies }
//   GET  /lobbies                     → { lobbies: [{ id, opensAt, name, theme, phase, inside, listening }], current }
//   GET  /stats  (Bearer STATS_TOKEN) → the beta's counts per lobby, returning visitors, testers' feedback
//   POST /feedback {text, rating, lobby, screen} → { ok }  (one a minute per address)
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
import { createRoom, cleanText } from "./room.mjs";
import { simulatedSource, chainSource, practiceSource } from "./sources.mjs";
import { createCrank, stateOfRules, rulesExecutor } from "./crank.mjs";
import { createClans } from "./clans.mjs";
import { createClanRoom, fileStore } from "./clan-room.mjs";
import { createMedia } from "./media.mjs";
import { sfuToken, sfuAdmin } from "./voice.mjs";
import { mkdirSync, existsSync, readFileSync, statSync } from "node:fs";
import { join, normalize, extname } from "node:path";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization" };
const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", "x-content-type-options": "nosniff", "cache-control": "no-store", ...CORS });
  res.end(JSON.stringify(body));
};
// A small JSON object body (4 KB at most); anything else reads as {}.
const readBody = (req) => new Promise((resolve) => {
  let b = "";
  let over = false;
  req.on("data", (c) => { if (!over) { b += c; over = b.length > 4096; } });
  req.on("end", () => {
    if (over) return resolve({});
    try { const v = JSON.parse(b || "{}"); resolve(v && typeof v === "object" && !Array.isArray(v) ? v : {}); } catch { resolve({}); }
  });
  req.on("error", () => resolve({}));
});
const decode = (s) => { try { return decodeURIComponent(s); } catch { return null; } };
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
  maxPerIp = 50, httpPerMin = 120, origins = null, trustProxy = false, staticDir = null, statsToken = null }) {
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
  const rooms = new Map();
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
  // A lobby can join at any time (the hourly schedule adds the next one): its room, its crank, its events.
  function addLobby(l) {
    const room = createRoom({ ...l, now, onStage: setPublish(`lobby-${l.id}`) });
    rooms.set(String(l.id), room);
    const onEvents = (events) => { clans.apply(events, now()); room.announce(events, clans); };
    // On a cluster the indexer reads every event of the lobby's transactions, whoever sent them (someone else may
    // crank first): those feed the room and the clans, and the crank's own results are not counted twice.
    if (l.source.onEvents) l.source.onEvents(onEvents);
    if (l.crank) room.setCrank(l.crank(l.source.onEvents ? () => {} : onEvents));
    else if (l.source.chain) room.setCrank(createCrank({ state: () => stateOfRules(l.source.chain), execute: rulesExecutor(l.source.chain), onEvents }));
    return room;
  }
  for (const l of lobbies) addLobby(l);
  // What testers say (the beta): kept with the data, read with the stats.
  const feedback = [];
  const feedbackStore = dataDir ? fileStore(join(dataDir, "feedback.jsonl")) : null;
  for (const f of feedbackStore?.load?.() ?? []) feedback.push(f);
  const lastFeedback = new Map(); // ip -> time
  // The app itself, from this server: one address for the page and its lobby.
  const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp", ".ico": "image/x-icon", ".json": "application/json" };
  function serveStatic(url, res) {
    const rel = decode(url.pathname) ?? "/";
    const file = normalize(join(staticDir, rel.endsWith("/") ? `${rel}index.html` : rel));
    if (!file.startsWith(normalize(staticDir)) || !existsSync(file) || !statSync(file).isFile()) return false;
    let body = readFileSync(file);
    const ext = extname(file);
    // The page learns that its lobby server is this one (no ?live= needed).
    if (ext === ".html") body = Buffer.from(body.toString().replace("</head>", '<meta name="lobby-server" content="same-origin"></head>'));
    res.writeHead(200, { "content-type": TYPES[ext] ?? "application/octet-stream", "x-content-type-options": "nosniff",
      "cache-control": ext === ".html" ? "no-cache" : rel.startsWith("/chunks/") || rel.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=300" });
    res.end(body);
    return true;
  }
  const server = http.createServer((req, res) => handle(req, res).catch((e) => {
    // A request that breaks something answers 500; it never takes the server down.
    console.error(`${req.method} ${req.url}: ${e.message}`);
    if (!res.headersSent) json(res, 500, { error: "Server error" }); else res.end();
  }));
  async function handle(req, res) {
    if (req.method === "OPTIONS") return json(res, 204, {});
    if (tooMany(ipOf(req))) return json(res, 429, { error: "Too many requests" });
    const url = new URL(req.url, "http://x");
    if (req.method === "GET" && url.pathname === "/auth/nonce") {
      // The page's own site goes in the message when it is allowed to sign in here: one of --origins, or any page
      // on a development server without that list. A phishing site can't get a message for ours, nor ours for it.
      const origin = req.headers.origin;
      let site = null;
      if (origin && (!origins || origins.includes(origin))) { try { site = { domain: new URL(origin).host, uri: origin }; } catch { /* no site */ } }
      try { return json(res, 200, auth.nonce(site)); } catch (e) { return json(res, 429, { error: e.message }); }
    }
    if (req.method === "POST" && url.pathname === "/auth/verify") {
      // Sign-in failures are said in the server's own words, never an internal message.
      try { return json(res, 200, { token: auth.verify(await readBody(req)) }); } catch (e) { return json(res, 401, { error: /^[A-Z][\w ,.'’-]{3,80}$/.test(e.message) && !/Error|undefined|null|TypeError/.test(e.message) ? e.message : "Sign-in failed. Try again." }); }
    }
    if (req.method === "POST" && url.pathname === "/auth/guest") {
      if (!guests) return json(res, 403, { error: "Guests are not allowed" });
      return json(res, 200, { token: auth.issue(`guest-${randomUUID().slice(0, 8)}`, { guest: true }) });
    }
    if (req.method === "POST" && url.pathname === "/auth/dev") {
      if (!devSessions) return json(res, 404, { error: "Not found" });
      const { sub } = await readBody(req);
      if (sub !== undefined && typeof sub !== "string") return json(res, 400, { error: "sub is a string" });
      const name = cleanText(sub ?? "dev", 64).replace(/[\u202A-\u202E\u2066-\u2069]/g, "");
      if (!name) return json(res, 400, { error: "A name, please" });
      return json(res, 200, { token: auth.issue(name) });
    }
    const up = /^\/clans\/([^/]+)\/media$/.exec(url.pathname);
    if (req.method === "POST" && up) {
      const session = auth.session(bearer(req, url));
      const room = clanRoom(decode(up[1]) ?? "");
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
      if (![lobby, clan].every((v) => v === undefined || typeof v === "string" || typeof v === "number")) return json(res, 400, { error: "Bad request" });
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
      const clan = clans.toJSON(decode(c[1]) ?? "");
      return json(res, clan ? 200 : 404, clan ?? { error: "No clan for this mint" });
    }
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true, lobbies: rooms.size });
    if (req.method === "GET" && url.pathname === "/lobbies") {
      // The lobbies on this server, and the one to join now: the latest that has opened and not ended long ago, else
      // the next to open.
      const list = [...rooms.values()].map((r) => r.summary()).sort((a, b) => a.opensAt - b.opensAt);
      const t = now();
      const open = list.filter((l) => l.opensAt <= t && t < l.opensAt + 3600_000 + 15 * 60_000);
      const current = (open.at(-1) ?? list.find((l) => l.opensAt > t) ?? list.at(-1))?.id ?? null;
      return json(res, 200, { lobbies: list, current });
    }
    if (req.method === "GET" && url.pathname === "/stats") {
      // The beta's numbers, for whoever holds the stats token: counts per lobby, returning visitors, testers' words.
      if (!statsToken || bearer(req, url) !== statsToken) return json(res, 404, { error: "Not found" });
      const seen = new Set();
      const lobbiesOut = [...rooms.values()].sort((a, b) => a.summary().opensAt - b.summary().opensAt).map((r) => {
        const st = r.stats(seen);
        for (const u of r.visitors()) seen.add(u);
        return st;
      });
      return json(res, 200, { lobbies: lobbiesOut, people: seen.size, feedback: feedback.slice(-200) });
    }
    if (req.method === "POST" && url.pathname === "/feedback") {
      // A tester's words: a rating (1 to 5) and up to 1000 characters; one a minute per address.
      const ip = ipOf(req);
      if (Date.now() - (lastFeedback.get(ip) ?? 0) < 60_000) return json(res, 429, { error: "One message a minute" });
      const body = await readBody(req);
      const text = cleanText(body.text, 1000);
      const rating = Number.isInteger(body.rating) && body.rating >= 1 && body.rating <= 5 ? body.rating : null;
      if (!text && !rating) return json(res, 400, { error: "Say something, or give a rating" });
      const session = auth.session(bearer(req, url));
      const entry = { at: now(), rating, text, lobby: typeof body.lobby === "number" ? body.lobby : null, signedIn: !!(session && !session.guest), screen: cleanText(body.screen, 20) };
      feedback.push(entry);
      if (feedback.length > 5000) feedback.shift();
      feedbackStore?.append?.(entry);
      lastFeedback.set(ip, Date.now());
      return json(res, 200, { ok: true });
    }
    const m = /^\/lobbies\/(\d+)$/.exec(url.pathname);
    if (req.method === "GET" && m && rooms.has(m[1])) return json(res, 200, rooms.get(m[1]).snapshot());
    if (req.method === "GET" && staticDir && serveStatic(url, res)) return;
    json(res, 404, { error: "Not found" });
  }

  const wss = new WebSocketServer({ server, maxPayload: 8192 });
  // A socket's error (a frame over the limit, a broken peer) ends that socket, never the server.
  wss.on("error", (e) => console.error(`ws server: ${e.message}`));
  wss.on("connection", (ws, req) => {
    ws.on("error", () => ws.terminate());
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
      let hello;
      try { hello = clan.join(id, session, send); } catch (e) { console.error(e.message); return ws.close(1011, "Server error"); }
      if (!hello) return ws.close(4403, "Founders only");
      send(JSON.stringify(hello));
      ws.on("message", (data) => {
        const out = guarded(() => clan.receive(id, data.toString()));
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
      const out = guarded(() => room.receive(id, data.toString()));
      if (out === "close") return ws.close(4408, "Too many messages");
      if (out) send(JSON.stringify(out));
    });
    ws.on("close", () => room.leave(id));
  });

  // A message that breaks something is answered BadMessage: it never takes the server down.
  function guarded(fn) {
    try { return fn(); } catch (e) { console.error(`message: ${e.message}`); return { t: "error", code: "BadMessage" }; }
  }
  const timer = setInterval(() => { for (const r of rooms.values()) r.tick(); }, batchMs);
  return new Promise((resolve) => server.listen(port, () => resolve({
    port: server.address().port, rooms, auth, clans, clanRoom, media, addLobby, feedback,
    /** Takes a finished lobby off this server (its clan stays: clans are forever). */
    removeLobby: (id) => rooms.delete(String(id)),
    close: () => new Promise((r) => { clearInterval(timer); for (const c of wss.clients) c.terminate(); wss.close(); server.close(r); }),
  })));
}

export { signInMessage };

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? undefined : process.argv[i + 1]; };
  const flag = (n) => process.argv.includes(`--${n}`);
  // Sessions survive a restart when the signing key does: SESSION_SECRET (32 bytes or more, hex or text).
  const secret = process.env.SESSION_SECRET ? Buffer.from(process.env.SESSION_SECRET) : undefined;
  if (secret && secret.length < 32) throw new Error("SESSION_SECRET must be 32 characters or more");
  const common = { port: Number(process.env.PORT ?? arg("port") ?? 8790), guests: flag("guests"), devSessions: flag("dev-sessions"),
    maxPerIp: Number(arg("max-per-ip") ?? 50), httpPerMin: Number(arg("http-per-min") ?? 120), origins: (arg("origins") ?? process.env.ORIGINS ?? process.env.RENDER_EXTERNAL_URL)?.split(","), trustProxy: flag("trust-proxy"),
    dataDir: arg("data") ?? process.env.DATA_DIR, staticDir: arg("static") ?? null, statsToken: process.env.STATS_TOKEN ?? null,
    auth: secret ? createAuth({ secret }) : undefined,
    // --sfu wss://… with LIVEKIT_API_KEY and LIVEKIT_API_SECRET in the environment
    voice: arg("sfu") ? { url: arg("sfu"), apiKey: process.env.LIVEKIT_API_KEY, apiSecret: process.env.LIVEKIT_API_SECRET } : null };
  if (arg("schedule") === "hourly") {
    // The closed beta: a real practice lobby every hour, on the hour, empty at its opening; the next one is listed an
    // hour ahead, finished ones leave the server three hours after they opened (their clans stay).
    const host = arg("host") ?? process.env.LOBBY_HOST;
    if (!host) throw new Error("--schedule hourly needs --host <the host's wallet address> (or LOBBY_HOST)");
    const lobby = (opensAt) => ({ id: Math.floor(opensAt / 3_600_000), opensAt, source: practiceSource({ id: Math.floor(opensAt / 3_600_000), host }),
      name: arg("name") ?? process.env.LOBBY_NAME ?? "Social Launch hour", theme: arg("theme") ?? process.env.LOBBY_THEME ?? null,
      hostName: arg("host-name") ?? process.env.LOBBY_HOST_NAME ?? null, welcome: arg("welcome") ?? process.env.LOBBY_WELCOME ?? null });
    const hour = () => Math.floor(Date.now() / 3_600_000) * 3_600_000;
    const s = await createServer({ ...common, lobbies: [lobby(hour()), lobby(hour() + 3_600_000)] });
    setInterval(() => {
      const next = hour() + 3_600_000;
      if (!s.rooms.has(String(Math.floor(next / 3_600_000)))) s.addLobby(lobby(next));
      for (const [id, r] of s.rooms) if (r.summary().opensAt < Date.now() - 3 * 3_600_000) s.removeLobby(id);
    }, 60_000);
    console.log(`Social Launch beta on :${s.port}: a practice lobby every hour (host ${host})${common.staticDir ? `, app from ${common.staticDir}` : ""}`);
  } else {
    const id = Number(arg("lobby") ?? 412);
    const opensAt = Number(arg("opens-at") ?? Date.now() - 1452 * 1000);
    const source = arg("rpc") ? chainSource({ rpc: arg("rpc"), programId: arg("program"), lobby: id }) : simulatedSource();
    const s = await createServer({ ...common, lobbies: [{ id, opensAt, source, welcome: arg("welcome") ?? null }] });
    console.log(`lobby ${id} live on :${s.port} (${arg("rpc") ? "race from the chain" : "simulated race"})`);
  }
}
