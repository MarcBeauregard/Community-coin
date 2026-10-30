// Checks the realtime lobby: the room's rules on a fake clock, the server over real sockets (Sign-In With Solana,
// sessions, chat, presence, race deltas, phases), and the app joining it in Chromium.
// Usage: node web/lobbies/realtime-check.mjs   (build the app first for the browser part: npm run build:lobbies)

import { generateKeyPairSync, sign } from "node:crypto";
import { createRequire } from "node:module";
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { PublicKey } from "@solana/web3.js";
import { createRoom, cleanText, phaseAt } from "./server/room.mjs";
import { createAuth, signInMessage } from "./server/auth.mjs";
import { createServer } from "./server/server.mjs";
import { simulatedSource } from "./server/sources.mjs";
import { connectLobby, guestSession } from "./src/realtime/client.js";

let failures = 0;
const check = (cond, msg) => { if (cond) console.log(`  ok  ${msg}`); else { failures++; console.log(`FAIL  ${msg}`); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return true; await wait(25); }
  return cond();
}

// ------------------------------------------------------------------ the room, on a fake clock
{
  let t = 1_000_000;
  const now = () => t;
  const ideas = [{ index: 0, symbol: "WIF", name: "dogwifhat", pledged: 5n, backers: 1 }];
  const room = createRoom({ id: 1, opensAt: t - 1000 * 1000, source: { ideas: () => ideas }, now });
  const inbox = { a: [], b: [], g: [] };
  const hello = room.join("a", { sub: "alice" }, (s) => inbox.a.push(JSON.parse(s)));
  room.join("a2", { sub: "alice" }, () => {});
  room.join("b", { sub: "bob" }, (s) => inbox.b.push(JSON.parse(s)));
  room.join("g", { sub: "guest-1", guest: true }, (s) => inbox.g.push(JSON.parse(s)));
  await wait(0);
  check(hello.phase === "floor" && hello.race.length === 1 && hello.now === t, "hello carries the server clock, the phase and the race");
  room.tick();
  const p = inbox.b.find((m) => m.t === "presence");
  check(p && p.inside === 3 && p.listening === 0, "presence counts people, not tabs");
  check(!inbox.b.some((m) => m.t === "race"), "the first tick sends no race the hello already had");
  room.receive("a", JSON.stringify({ t: "chat", text: "  gm‮  lobby \u0007" }));
  check(inbox.b.some((m) => m.t === "chat" && m.line.text === "gm lobby" && m.line.from === "alice"), "chat is cleaned of control and bidi characters and broadcast");
  check(room.receive("a", JSON.stringify({ t: "chat", text: "again" })).code === "SlowMode", "slow mode: one message every 3 s");
  t += 3000;
  check(room.receive("a", JSON.stringify({ t: "chat", text: "x".repeat(500) })) === null && inbox.b.at(-1).line.text.length === 200, "messages are capped at 200 characters");
  check(room.receive("g", JSON.stringify({ t: "chat", text: "hi" })).code === "SignInToChat", "guests read but cannot write");
  check(room.receive("b", "{nope").code === "BadMessage", "malformed messages are refused");
  ideas[0] = { ...ideas[0], pledged: 9n, backers: 2 };
  room.receive("b", JSON.stringify({ t: "listen", on: true }));
  inbox.b.length = 0;
  room.tick();
  const race = inbox.b.find((m) => m.t === "race");
  check(race && race.ideas.length === 1 && race.ideas[0].pledged === "9", "the race goes out as deltas, amounts in lamports as strings");
  check(inbox.b.some((m) => m.t === "presence" && m.listening === 1), "listening is counted");
  inbox.b.length = 0;
  room.tick();
  check(inbox.b.length === 0, "nothing changed, nothing sent");
  t += 2_400_000;
  room.tick();
  check(inbox.b.some((m) => m.t === "phase" && m.phase === "lock"), "phase changes are pushed on the server clock");
  let closed = false;
  for (let i = 0; i < 40 && !closed; i++) closed = room.receive("b", JSON.stringify({ t: "ping" })) === "close";
  check(closed, "flooding closes the connection");
  check(phaseAt(-1) === "soon" && phaseAt(3600) === "done" && cleanText("​", 10) === "", "phases and cleaning at the edges");
}

// ------------------------------------------------------------------ Sign-In With Solana
{
  const auth = createAuth({ domain: "test" });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const address = new PublicKey(publicKey.export({ format: "der", type: "spki" }).subarray(12)).toBase58();
  const { nonce, issuedAt } = auth.nonce();
  const sig = sign(null, Buffer.from(signInMessage("test", address, nonce, issuedAt)), privateKey).toString("base64");
  const token = auth.verify({ address, nonce, signature: sig });
  check(auth.session(token)?.sub === address, "a wallet signature gives a session for that address");
  let reused = false;
  try { auth.verify({ address, nonce, signature: sig }); } catch { reused = true; }
  check(reused, "a nonce works once");
  const n2 = auth.nonce();
  let forged = false;
  try { auth.verify({ address, nonce: n2.nonce, signature: sig }); } catch { forged = true; }
  check(forged, "a signature over another nonce is refused");
  check(auth.session(token.replace(/.$/, (c) => (c === "A" ? "B" : "A"))) === null, "a tampered token is refused");
}

// ------------------------------------------------------------------ the server, over sockets
const opensAt = Date.now() - 1452 * 1000;
const server = await createServer({ guests: true, batchMs: 100, lobbies: [{ id: 412, opensAt, source: simulatedSource({ everySec: 1 }) }] });
const base = `http://localhost:${server.port}`;
{
  const token = server.auth.issue("alice");
  const a = [], b = [];
  const ca = connectLobby({ base, lobby: 412, token, onMessage: (m) => a.push(m) });
  const cb = connectLobby({ base, lobby: 412, token: server.auth.issue("bob"), onMessage: (m) => b.push(m) });
  await until(() => a.some((m) => m.t === "hello") && b.some((m) => m.t === "hello"));
  const hello = a.find((m) => m.t === "hello");
  check(hello && hello.race.length === 5 && Math.abs(ca.now() - Date.now()) < 1000, "a client joins, gets the race, and follows the server clock");
  check(await until(() => b.some((m) => m.t === "presence" && m.inside === 2)), "both are seen inside");
  ca.chat("gm from alice");
  check(await until(() => b.some((m) => m.t === "chat" && m.line.text === "gm from alice" && m.line.from === "alice")), "chat reaches the other client");
  check(await until(() => b.some((m) => m.t === "race")), "the crowd's pledges arrive as race deltas");
  const guest = await guestSession(base);
  const g = [];
  const cg = connectLobby({ base, lobby: 412, token: guest, onMessage: (m) => g.push(m) });
  await until(() => g.some((m) => m.t === "hello"));
  cg.chat("hello?");
  check(await until(() => g.some((m) => m.t === "error" && m.code === "SignInToChat")), "a guest is told to sign in to chat");
  const bad = [];
  connectLobby({ base, lobby: 412, token: "forged.token", onMessage: (m) => bad.push(m) });
  check(await until(() => bad.some((m) => m.t === "closed" && m.code === 4401)), "a socket without a valid session is refused");
  const snap = await (await fetch(`${base}/lobbies/412`)).json();
  check(snap.lobby === 412 && snap.inside >= 2, "the HTTP snapshot shows the room");
  ca.close(); cb.close(); cg.close();
}

// ------------------------------------------------------------------ the app, live, in Chromium
const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "lobbies");
// NO_BROWSER=1 skips the browser part (CI without Chromium).
if (existsSync(join(dist, "index.html")) && !process.env.NO_BROWSER) {
  const require = createRequire(import.meta.url);
  const { chromium } = require("playwright");
  const TYPES = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg" };
  const files = http.createServer((req, res) => {
    const p = join(dist, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/\/$/, "/index.html"));
    if (!p.startsWith(dist) || !existsSync(p)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" });
    res.end(readFileSync(p));
  });
  await new Promise((r) => files.listen(0, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  const peer = [];
  const cp = connectLobby({ base, lobby: 412, token: server.auth.issue("carol"), onMessage: (m) => peer.push(m) });
  await page.goto(`http://localhost:${files.address().port}/index.html?live=${encodeURIComponent(base)}#/lobby`);
  await page.waitForTimeout(1500);
  check(await page.getByText(/2 inside/).first().isVisible(), "the app shows the server's presence");
  cp.chat("hello from the server side");
  await page.waitForTimeout(800);
  check(await page.getByText("hello from the server side").isVisible(), "a message sent by someone else appears in the app");
  await page.getByPlaceholder(/Message/).fill("hi from the app");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  check(!peer.some((m) => m.t === "chat" && m.line.text === "hi from the app"), "a guest's message never reaches the room");
  check(await page.getByText("Connect a wallet to chat.").isVisible(), "the app tells a guest to connect a wallet");
  cp.close();
  await browser.close();
  files.close();
} else {
  console.log("  --  browser part skipped (app not built, or NO_BROWSER set)");
}

// ------------------------------------------------------------------ abuse limits
{
  const tight = await createServer({ guests: true, maxPerIp: 2, httpPerMin: 4, origins: ["https://app.example"], lobbies: [{ id: 1, opensAt: Date.now(), source: simulatedSource() }] });
  const b = `http://localhost:${tight.port}`;
  const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push((await fetch(`${b}/lobbies/1`)).status);
  check(statuses.slice(0, 4).every((x) => x === 200) && statuses[4] === 429, "HTTP requests per address are limited (429)");
  const { default: WS } = await import("ws");
  const open = (origin) => new Promise((resolve) => {
    const ws = new WS(`ws://localhost:${tight.port}/ws?lobby=1&token=${encodeURIComponent(tight.auth.issue("x"))}`, { headers: origin ? { origin } : {} });
    ws.on("message", () => resolve({ ws, ok: true }));
    ws.on("close", (code) => resolve({ ws, code }));
  });
  check((await open("https://evil.example")).code === 4403, "a socket from another origin is refused");
  const a1 = await open("https://app.example"), a2 = await open("https://app.example"), a3 = await open("https://app.example");
  check(a1.ok && a2.ok && a3.code === 4429, "sockets per address are limited (4429)");
  a1.ws.close(); a2.ws.close();
  await tight.close();
}

await server.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
