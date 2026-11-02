// Checks two kinds of trust. Receipts: a settlement's transaction is linked on Solscan only when it is a real
// signature on a known cluster (never in a practice lobby, never made up). The network: a calm banner when the
// browser is offline, when the lobby server drops (reconnecting, then down after 15 s, then back online), and when
// Solana doesn't answer the app; the most pressing thing only.
// Usage: node web/lobbies/net-check.mjs   (after npm run build:lobbies)

import { createRequire } from "node:module";
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "./server/server.mjs";
import { simulatedSource, clusterOf } from "./server/sources.mjs";
import { connectLobby } from "./src/realtime/client.js";
import { isSignature, txUrl } from "./src/wallet/wallets.js";
import { netState } from "./src/demo/select.js";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
let failures = 0;
const check = (cond, msg) => { if (cond) console.log(`  ok  ${msg}`); else { failures++; console.log(`FAIL  ${msg}`); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SIG = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";

// ------------------------------------------------------------------ without a browser
check(isSignature(SIG) && !isSignature("practice-1") && !isSignature("So11111111111111111111111111111111111111112"), "a signature is 64 bytes of base58; an address or a label isn't");
check(txUrl(SIG, "devnet") === `https://solscan.io/tx/${SIG}?cluster=devnet` && txUrl(SIG, "mainnet") === `https://solscan.io/tx/${SIG}`, "Solscan links per cluster");
check(txUrl(SIG, null) === null && txUrl("fake", "devnet") === null, "no link for a local validator, or anything that isn't a signature");
check(clusterOf("https://api.devnet.solana.com") === "devnet" && clusterOf("http://127.0.0.1:8899") === null, "the cluster is read from the RPC address");
const n = { server: "ok", slow: false, offline: false, solana: "ok", back: false };
check(netState(n) === null && netState({ ...n, back: true }) === "back", "all well: nothing, or Back online for a moment");
check(netState({ ...n, offline: true, server: "down" }) === "offline" && netState({ ...n, server: "down", solana: "down" }) === "down"
  && netState({ ...n, solana: "down", slow: true }) === "solanaDown" && netState({ ...n, slow: true, solana: "slow" }) === "slow", "the most pressing thing first");

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
async function open(url, { context } = {}) {
  const page = await (context ?? browser).newPage({ viewport: { width: 1440, height: 900 } });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.addInitScript(() => localStorage.setItem("lobbies.intro", "1"));
  await page.goto(url);
  return page;
}
const banner = (page) => page.locator(".net-wrap, .net-inline");

// ------------------------------------------------------------------ receipts
{
  // A lobby on a cluster: the settlement carries its transaction.
  const onChain = { ...simulatedSource(), practice: false, cluster: "devnet" };
  const server = await createServer({ guests: true, devSessions: true, batchMs: 30, lobbies: [{ id: 412, opensAt: Date.now() - 1452 * 1000, source: onChain }] });
  const base = `http://localhost:${server.port}`;
  const got = [];
  const c = connectLobby({ base, lobby: 412, token: server.auth.issue("ana"), onMessage: (m) => got.push(m) });
  const page = await open(`${app}?live=${encodeURIComponent(base)}&as=cleo#/lobby`);
  await visible(page.getByText(/1 person inside|2 people inside/));
  await wait(300);
  const room = server.rooms.get("412");
  // Refunds come at the lock, the launch five minutes later.
  room.announce([{ event: "PledgeRefunded", user: "ana", amount: 10n ** 9n, signature: SIG }, { event: "PledgeRefunded", user: "cleo", amount: 2n * 10n ** 9n, signature: SIG }]);
  await wait(300);
  room.announce([{ event: "Launched", mint: "Mint111111111111111111111111111111111111111", symbol: "WIF", name: "dogwifhat" }, { event: "LobbyLaunched", mint: "Mint111111111111111111111111111111111111111", idea: 0, pot: 171n * 10n ** 9n, founders: 398 }]);
  await wait(200);
  const settled = got.find((m) => m.t === "settled");
  check(settled?.signature === SIG && settled.cluster === "devnet", "on a cluster, the settlement carries its transaction and cluster");
  check(await visible(page.getByRole("link", { name: /View on Solscan/ })), "the launch screen links the person's refund on Solscan");
  check(await page.getByText("Your 2.0 SOL is back in your wallet").isVisible() && await page.getByText("You watched this one from the stands").count() === 0, "a refund that came before the launch is kept: never 'watched from the stands'");
  check(await page.getByText("Practice launch").count() === 0, "a launch on a cluster is not called practice");
  check(await page.getByRole("link", { name: /View on Solscan/ }).getAttribute("href") === `https://solscan.io/tx/${SIG}?cluster=devnet`, "to its devnet transaction");
  c.close();
  await page.close();
  await server.close();
}
{
  // A practice lobby: never a transaction, whatever the event says.
  const server = await createServer({ guests: true, batchMs: 30, lobbies: [{ id: 412, opensAt: Date.now() - 1452 * 1000, source: simulatedSource() }] });
  const got = [];
  const c = connectLobby({ base: `http://localhost:${server.port}`, lobby: 412, token: server.auth.issue("ana"), onMessage: (m) => got.push(m) });
  await wait(200);
  server.rooms.get("412").announce([{ event: "PledgeRefunded", user: "ana", amount: 10n ** 9n, signature: SIG }]);
  await wait(100);
  check(got.some((m) => m.t === "settled") && !got.find((m) => m.t === "settled").signature, "a practice settlement never carries a transaction");
  c.close();
  await server.close();
}
{
  const page = await open(`${app}?freeze&scene=sheet-receipt`);
  const dlg = page.getByRole("dialog");
  check(await dlg.getByText(/no real SOL moved, so there is no transaction to look up/).isVisible() && await dlg.getByRole("link", { name: /Solscan/ }).count() === 0, "a practice receipt says there is nothing to look up, and links nothing");
  await page.close();
}

// ------------------------------------------------------------------ the network
{
  // The lobby server goes away, then comes back on the same address.
  const source = simulatedSource();
  let server = await createServer({ guests: true, batchMs: 30, lobbies: [{ id: 412, opensAt: Date.now() - 1452 * 1000, source }] });
  const port = server.port;
  const auth = server.auth; // the same signing key, as a restarted server keeps it
  const page = await open(`${app}?live=${encodeURIComponent(`http://localhost:${port}`)}#/lobby`);
  await visible(page.getByText(/1 person inside/));
  check(await banner(page).textContent() === "", "connected: no banner");
  await server.close();
  check(await visible(banner(page).getByText("Reconnecting to the lobby…")), "the server drops: Reconnecting to the lobby…");
  const [line, head] = [await banner(page).locator(".net").boundingBox(), await page.locator(".lobby-head").boundingBox()];
  check(line && head && line.y >= head.y + head.height - 1, "in a lobby the line sits under the header, never over the title or the clock");
  check(await visible(banner(page).getByText("Can’t reach the lobby server. Still trying."), 17000), "still gone after 15 s: it says so, calmly");
  check(await page.getByRole("status").filter({ hasText: "Can’t reach the lobby server" }).count() === 1, "in a status region, for screen readers");
  check(await page.getByText("1,284 inside").count() === 0 && await page.getByText(/1 person inside/).count() >= 1, "the count stays the lobby's last, never the demo's crowd");
  server = await createServer({ port, auth, guests: true, batchMs: 30, lobbies: [{ id: 412, opensAt: Date.now() - 1452 * 1000, source }] });
  check(await visible(banner(page).getByText("Back online"), 35000), "back: Back online");
  check(await banner(page).getByText("Back online").waitFor({ state: "detached", timeout: 5000 }).then(() => true, () => false), "and the banner goes");
  check(page.errors.length === 0, `no script errors${page.errors.length ? `: ${page.errors.join(" | ")}` : ""}`);
  await page.close();
  await server.close();
}
{
  // A pledge can't be confirmed while the lobby can't be reached, and says why.
  const source = simulatedSource();
  const server = await createServer({ guests: true, devSessions: true, batchMs: 30, lobbies: [{ id: 412, opensAt: Date.now() - 1452 * 1000, source }] });
  const page = await open(`${app}?live=${encodeURIComponent(`http://localhost:${server.port}`)}&as=cleo#/lobby`);
  await visible(page.getByText(/1 person inside/));
  await page.getByRole("button", { name: /^Pledge/ }).first().click();
  await server.close();
  check(await visible(page.getByRole("dialog").getByRole("alert").filter({ hasText: "The lobby server can’t be reached. Confirm when it’s back." })), "the pledge sheet says the lobby can't be reached");
  check(await page.getByRole("button", { name: "Confirm practice pledge" }).isDisabled(), "and Confirm waits for it");
  await page.close();
}
{
  // The browser offline.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await open(`${app}?freeze`, { context });
  await page.waitForTimeout(400);
  await context.setOffline(true);
  check(await visible(banner(page).getByText("You’re offline. The lobby catches up when you’re back.")), "offline: it says so");
  const box = await banner(page).locator(".net").boundingBox();
  check(box && box.x >= 0 && box.x + box.width <= 390, "the banner fits a phone");
  await context.setOffline(false);
  check(await visible(banner(page).getByText("Back online")), "online again: Back online, for a moment");
  check(await banner(page).getByText(/offline|slow/).count() === 0, "never 'slow' for the queue an outage left");
  await context.close();
}
{
  // Solana not answering: the app reads the wallet's balance from an RPC that fails.
  const rpc = http.createServer((req, res) => { res.writeHead(503); res.end(); });
  await new Promise((r) => rpc.listen(0, r));
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.addInitScript(() => {
    const key = { toBase58: () => "7Hq4dJ3xG1sT9bY2mQ5vRk8NwZcLp6EaFu4Kk2Pf", toString: () => "7Hq4dJ3xG1sT9bY2mQ5vRk8NwZcLp6EaFu4Kk2Pf" };
    window.phantom = { solana: { isPhantom: true, publicKey: null, async connect(o) { if (o?.onlyIfTrusted) throw { code: 4001 }; this.publicKey = key; return { publicKey: key }; }, on() {}, off() {}, async disconnect() {} } };
  });
  await page.goto(`${app}?freeze&rpc=${encodeURIComponent(`http://localhost:${rpc.address().port}`)}`);
  await page.waitForTimeout(500);
  await page.locator(".wallet-pill").first().click();
  await page.getByRole("button", { name: /Phantom/ }).click();
  check(await visible(banner(page).getByText("Solana isn’t answering. Your balance may be out of date.")), "Solana not answering: the banner says what it means for the person");
  await page.close();
  rpc.close();
}

await browser.close();
files.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
