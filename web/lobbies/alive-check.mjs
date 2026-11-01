// Checks that a live lobby feels like the people in it: the host's welcome pinned atop the chat (only when the host
// wrote one), arrivals said quietly in the chat (one line that keeps counting), and the faces of the people actually
// inside, each person counted once however many tabs they have.
// Usage: node web/lobbies/alive-check.mjs   (after npm run build:lobbies)

import { createRequire } from "node:module";
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "./server/server.mjs";
import { simulatedSource } from "./server/sources.mjs";
import { connectLobby } from "./src/realtime/client.js";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
let failures = 0;
const check = (cond, msg) => { if (cond) console.log(`  ok  ${msg}`); else { failures++; console.log(`FAIL  ${msg}`); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "lobbies");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg" };
const files = http.createServer((req, res) => {
  const p = join(dist, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/\/$/, "/index.html"));
  if (!p.startsWith(dist) || !existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" });
  res.end(readFileSync(p));
});
await new Promise((r) => files.listen(0, r));
const app = `http://localhost:${files.address().port}/index.html`;
const browser = await chromium.launch();
const visible = (loc, ms = 4000) => loc.first().waitFor({ timeout: ms }).then(() => true, () => false);

// ------------------------------------------------------------------ the server's presence
{
  const server = await createServer({ guests: true, batchMs: 30, lobbies: [{ id: 412, opensAt: Date.now() - 1452 * 1000, source: simulatedSource(), welcome: "Welcome in!\u0007  Animal coins only." }] });
  const base = `http://localhost:${server.port}`;
  const seen = [];
  const watcher = connectLobby({ base, lobby: 412, token: server.auth.issue("watcher"), onMessage: (m) => seen.push(m) });
  await wait(200);
  const hello = seen.find((m) => m.t === "hello");
  check(hello?.welcome?.text === "Welcome in! Animal coins only." && hello.welcome.from === "mira.sol", "the hello carries the host's welcome, cleaned, with who wrote it");
  const conns = ["ana", "ben", "ana"].map((who) => connectLobby({ base, lobby: 412, token: server.auth.issue(who), onMessage: () => {} }));
  const guest = await (await fetch(`${base}/auth/guest`, { method: "POST" })).json();
  conns.push(connectLobby({ base, lobby: 412, token: guest.token, onMessage: () => {} }));
  await wait(400);
  const p = seen.filter((m) => m.t === "presence").pop();
  check(p?.inside === 4 && p.guests === 1, `each person counted once, two tabs or not; guests among them (${p?.inside} inside, ${p?.guests} guest)`);
  check(JSON.stringify(p.people) === '["ben","ana","watcher"]', "the faces: signed-in people only, newest first");
  conns.forEach((c) => c.close());
  watcher.close();
  await server.close();
}

// ------------------------------------------------------------------ in the app
{
  const server = await createServer({ guests: true, batchMs: 30, lobbies: [{ id: 412, opensAt: Date.now() - 1452 * 1000, source: simulatedSource(), welcome: "Welcome in! Animal coins only." }] });
  const base = `http://localhost:${server.port}`;
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(`${app}?live=${encodeURIComponent(base)}#/lobby`);
  const welcome = page.getByRole("note", { name: "The host’s welcome" });
  check(await visible(welcome.getByText("Welcome in! Animal coins only.")), "the host's welcome is pinned atop the chat");
  check(await welcome.getByText("mira.sol").isVisible(), "signed by the host");
  const conns = ["ana", "ben", "cleo"].map((who) => connectLobby({ base, lobby: 412, token: server.auth.issue(who), onMessage: () => {} }));
  check(await visible(page.locator(".feed .sys", { hasText: /^3 people just arrived$/ })), "three arrivals make one quiet line: 3 people just arrived");
  check(await page.locator(".feed .sys", { hasText: /just arrived/ }).count() === 1, "not three lines");
  const faces = page.getByRole("list", { name: "Some of the people inside" });
  check(await visible(faces) && await faces.getByRole("listitem").count() === 4 && await faces.getByText("+1").isVisible(), "the stage shows the three faces inside, and +1 for the guest");
  check(await page.getByText("4 people inside").isVisible(), "and the count");
  check(!(await page.getByText("+1,269").count()), "never the demo's crowd");
  await welcome.getByRole("button", { name: "Hide the welcome" }).click();
  check(await welcome.count() === 0, "the welcome can be hidden");
  check(errors.length === 0, `no script errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  conns.forEach((c) => c.close());
  await page.close();
  await server.close();
}
{
  // No welcome written: nothing pinned (never the demo's).
  const server = await createServer({ guests: true, batchMs: 30, lobbies: [{ id: 412, opensAt: Date.now() - 1452 * 1000, source: simulatedSource() }] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(`${app}?live=${encodeURIComponent(`http://localhost:${server.port}`)}#/lobby`);
  await visible(page.getByText(/1 person inside/));
  check(await page.getByRole("note", { name: "The host’s welcome" }).count() === 0, "a lobby without a welcome pins nothing");
  await page.close();
  await server.close();
}
{
  // The demo: its host's welcome; arrivals as the clock runs.
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.addInitScript(() => localStorage.setItem("lobbies.intro", "1"));
  await page.goto(`${app}#/lobby`);
  check(await visible(page.getByRole("note", { name: "The host’s welcome" })), "demo: the host's welcome is pinned");
  check(await visible(page.locator(".feed .sys", { hasText: /just arrived/ }), 16000), "and people arrive as the hour runs");
  await page.close();
}

await browser.close();
files.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
