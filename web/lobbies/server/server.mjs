// The lobbies' realtime server: one WebSocket room per lobby (presence, chat, live race, phases, the clock) and
// Sign-In With Solana. The server's clock is the only clock: clients render from the `now` it sends.
//
//   node web/lobbies/server/server.mjs --port 8790 [--guests] [--lobby 412 --opens-at <ms>]
//          [--rpc <url> --program <id>]    (race from the chain through the indexer; else the simulated demo lobby)
//
//   GET  /auth/nonce                  → { nonce, issuedAt, message(address) is signInMessage(...) }
//   POST /auth/verify {address, nonce, signature(base64)} → { token }
//   POST /auth/guest                  → { token }  (read-only; only with --guests)
//   GET  /lobbies/:id                 → the room's snapshot
//   WS   /ws?lobby=:id&token=…        → hello, then chat / race / presence / phase / clock; send chat, listen, ping

import http from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { createAuth, signInMessage } from "./auth.mjs";
import { createRoom } from "./room.mjs";
import { simulatedSource, chainSource } from "./sources.mjs";

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" });
  res.end(JSON.stringify(body));
};
const readBody = (req) => new Promise((resolve) => {
  let b = "";
  req.on("data", (c) => { b += c; if (b.length > 4096) req.destroy(); });
  req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve({}); } });
});

export function createServer({ port = 0, guests = false, lobbies, auth = createAuth(), now = () => Date.now(), batchMs = 250, maxPerRoom = 20000 }) {
  const rooms = new Map(lobbies.map((l) => [String(l.id), createRoom({ ...l, now })]));
  const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") return json(res, 204, {});
    const url = new URL(req.url, "http://x");
    if (req.method === "GET" && url.pathname === "/auth/nonce") return json(res, 200, { ...auth.nonce(), domain: auth.domain });
    if (req.method === "POST" && url.pathname === "/auth/verify") {
      try { return json(res, 200, { token: auth.verify(await readBody(req)) }); } catch (e) { return json(res, 401, { error: e.message }); }
    }
    if (req.method === "POST" && url.pathname === "/auth/guest") {
      if (!guests) return json(res, 403, { error: "Guests are not allowed" });
      return json(res, 200, { token: auth.issue(`guest-${randomUUID().slice(0, 8)}`, { guest: true }) });
    }
    const m = /^\/lobbies\/(\d+)$/.exec(url.pathname);
    if (req.method === "GET" && m && rooms.has(m[1])) return json(res, 200, rooms.get(m[1]).snapshot());
    json(res, 404, { error: "Not found" });
  });

  const wss = new WebSocketServer({ server, maxPayload: 2048 });
  wss.on("connection", (ws, req) => {
    const url = new URL(req.url, "http://x");
    const session = auth.session(url.searchParams.get("token"));
    const room = rooms.get(url.searchParams.get("lobby") ?? "");
    if (url.pathname !== "/ws" || !session || !room) return ws.close(4401, !session ? "Sign in first" : "Unknown lobby");
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
    port: server.address().port, rooms, auth,
    close: () => new Promise((r) => { clearInterval(timer); for (const c of wss.clients) c.terminate(); wss.close(); server.close(r); }),
  })));
}

export { signInMessage };

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? undefined : process.argv[i + 1]; };
  const id = Number(arg("lobby") ?? 412);
  const opensAt = Number(arg("opens-at") ?? Date.now() - 1452 * 1000);
  const source = arg("rpc") ? chainSource({ rpc: arg("rpc"), programId: arg("program"), lobby: id }) : simulatedSource();
  const s = await createServer({ port: Number(arg("port") ?? 8790), guests: process.argv.includes("--guests"), lobbies: [{ id, opensAt, source }] });
  console.log(`lobby ${id} live on :${s.port} (${arg("rpc") ? "race from the chain" : "simulated race"})`);
}
