// Load: thousands of people in one lobby. Starts the realtime server in its own process, opens N sockets (5000 by
// default, each a distinct wallet), then measures what each of them lives: joining, a chat message reaching
// everyone, the race deltas and presence arriving, and the server's memory. Fails above the budgets below.
// (All the sockets come from one address here, so the per-address limits are raised for the run.)
// Usage: node web/lobbies/load-check.mjs [clients=5000]

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { readFileSync } from "node:fs";

const N = Number(process.argv[2] ?? 5000);
const BUDGET = { joinP95: 3000, chatP95: 1000, chatMax: 2500, rssMB: 1024 };
const PORT = 8800 + Math.floor(Math.random() * 100);
const base = `http://127.0.0.1:${PORT}`;

let failures = 0;
const check = (cond, msg) => { if (cond) console.log(`  ok  ${msg}`); else { failures++; console.log(`FAIL  ${msg}`); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? NaN; };

const server = spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), "server", "server.mjs"), "--port", String(PORT), "--dev-sessions", "--guests", "--max-per-ip", String(N + 10), "--http-per-min", String(N * 2)], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((resolve) => server.stdout.on("data", (d) => { if (String(d).includes("live on")) resolve(); }));

const readRss = () => {
  try { return Number(String(readFileSync(`/proc/${server.pid}/status`)).match(/VmRSS:\s+(\d+)/)[1]) / 1024; } catch { return NaN; }
};

// Tokens: one session per wallet, as many sockets as people.
const tokens = [];
for (let i = 0; i < N; i += 200) {
  tokens.push(...(await Promise.all(Array.from({ length: Math.min(200, N - i) }, (_, k) =>
    fetch(`${base}/auth/dev`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sub: `w${i + k}` }) }).then((r) => r.json()).then((b) => b.token)))));
}

const clients = [];
const joinMs = [];
const t0 = Date.now();
for (let i = 0; i < N; i += 250) {
  await Promise.all(tokens.slice(i, i + 250).map((token, k) => new Promise((resolve) => {
    const started = Date.now();
    const c = { got: { race: 0, presence: 0 }, chat: new Map(), ws: new WebSocket(`ws://127.0.0.1:${PORT}/ws?lobby=412&token=${encodeURIComponent(token)}`) };
    c.ws.on("message", (data) => {
      const m = JSON.parse(data);
      if (m.t === "hello") { joinMs.push(Date.now() - started); resolve(); }
      else if (m.t === "chat") c.chat.set(m.line.text, Date.now());
      else if (m.t in c.got) c.got[m.t]++;
    });
    c.ws.on("error", () => resolve());
    clients[i + k] = c;
  })));
}
const joinedIn = Date.now() - t0;
check(joinMs.length === N, `${N} people joined one lobby in ${(joinedIn / 1000).toFixed(1)} s`);
check(pct(joinMs, 95) <= BUDGET.joinP95, `joining: p50 ${pct(joinMs, 50)} ms, p95 ${pct(joinMs, 95)} ms (budget ${BUDGET.joinP95})`);

await wait(1500);
const inside = (await (await fetch(`${base}/lobbies/412`)).json()).inside;
check(inside === N, `presence counts ${inside} people inside`);

// Chat: 10 messages from 10 people, 3.1 s apart per person (slow mode is per person), each must reach everyone.
const sent = new Map();
for (let j = 0; j < 10; j++) {
  const text = `load message ${j}`;
  sent.set(text, Date.now());
  clients[j * 7].ws.send(JSON.stringify({ t: "chat", text }));
  await wait(150);
}
await wait(2500);
const lat = [];
let missing = 0;
for (const c of clients) for (const [text, at] of sent) { const got = c.chat.get(text); if (got) lat.push(got - at); else missing++; }
check(missing === 0, `every message reached all ${N} people (${missing} missed)`);
check(pct(lat, 95) <= BUDGET.chatP95 && Math.max(...lat) <= BUDGET.chatMax, `chat fan-out: p50 ${pct(lat, 50)} ms, p95 ${pct(lat, 95)} ms, max ${Math.max(...lat)} ms (budget p95 ${BUDGET.chatP95})`);

const raced = clients.filter((c) => c.got.race > 0).length;
check(raced === N, `the race's deltas reached ${raced} of ${N} (batched, only what changed)`);
const mem = readRss();
check(mem <= BUDGET.rssMB, `server memory with ${N} sockets: ${Math.round(mem)} MB (budget ${BUDGET.rssMB})`);

// Leaving: everyone goes, presence follows.
for (const c of clients) c.ws.terminate();
await wait(1500);
check((await (await fetch(`${base}/lobbies/412`)).json()).inside === 0, "when everyone leaves, presence goes back to 0");
server.kill();

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
