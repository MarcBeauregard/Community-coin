// Checks wallet connection in the app: a stand-in Phantom is injected into Chromium; it signs with a real ed25519
// key held by this script, so the server's Sign-In With Solana check is the real one. Covers: no wallet installed,
// connecting, a cancelled request, a guest asked to connect when they try to chat, signing in live and chatting as
// the wallet, coming back without a new signature, switching accounts in the wallet, disconnecting, the phone tab.
// Usage: node web/lobbies/wallet-check.mjs   (after npm run build:lobbies)

import { generateKeyPairSync, sign } from "node:crypto";
import { createRequire } from "node:module";
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { PublicKey } from "@solana/web3.js";
import { createServer } from "./server/server.mjs";
import { simulatedSource } from "./server/sources.mjs";
import { connectLobby } from "./src/realtime/client.js";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
let failures = 0;
const check = (cond, msg) => { if (cond) console.log(`  ok  ${msg}`); else { failures++; console.log(`FAIL  ${msg}`); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await cond()) return true; await wait(40); }
  return cond();
}

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

// Two accounts the stand-in wallet can hold.
const keys = [0, 1].map(() => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { address: new PublicKey(publicKey.export({ format: "der", type: "spki" }).subarray(12)).toBase58(), privateKey };
});
let signs = 0;

const browser = await chromium.launch();
// A page with the stand-in Phantom. `mode`: "ok" | "reject" (the person cancels).
async function open(url, { wallet = true, mode = "ok", account = 0, width = 1440, context = null } = {}) {
  const ctx = context ?? await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  if (wallet) {
    await page.exposeFunction("__walletSign", (i, bytes) => { signs++; return [...sign(null, Buffer.from(bytes), keys[i].privateKey)]; });
    await page.addInitScript(({ mode, account, addresses }) => {
      const listeners = {};
      let current = account;
      let trusted = localStorage.getItem("__trusted") === "1";
      const key = () => ({ toBase58: () => addresses[current], toString: () => addresses[current] });
      window.__wallet = {
        switchTo(i) { current = i; (listeners.accountChanged ?? []).forEach((f) => f(key())); },
        calls: { connect: 0, silent: 0 },
      };
      window.phantom = { solana: {
        isPhantom: true, publicKey: null,
        async connect(opts) {
          if (opts?.onlyIfTrusted) { window.__wallet.calls.silent++; if (!trusted) throw { code: 4001, message: "User rejected the request." }; }
          else { window.__wallet.calls.connect++; await new Promise((r) => setTimeout(r, 250)); if (mode === "reject") throw { code: 4001, message: "User rejected the request." }; }
          trusted = true; localStorage.setItem("__trusted", "1");
          this.publicKey = key();
          return { publicKey: key() };
        },
        async signMessage(bytes) { return { signature: Uint8Array.from(await window.__walletSign(current, [...bytes])) }; },
        async disconnect() { trusted = false; localStorage.removeItem("__trusted"); (listeners.disconnect ?? []).forEach((f) => f()); },
        on(ev, f) { (listeners[ev] ??= []).push(f); },
        off(ev, f) { listeners[ev] = (listeners[ev] ?? []).filter((x) => x !== f); },
      } };
    }, { mode, account, addresses: keys.map((k) => k.address) });
  }
  await page.goto(url);
  await page.waitForTimeout(700);
  return page;
}
const pill = (page) => page.locator(".wallet-pill").first();

// ------------------------------------------------------------------ demo (no server)
{
  const page = await open(`${app}?freeze`, { wallet: false });
  check((await pill(page).textContent()).includes("Connect"), "without a wallet the corner says Connect");
  await pill(page).click();
  await page.waitForTimeout(300);
  check(await page.getByRole("dialog", { name: "Connect a wallet" }).isVisible(), "it opens the wallet sheet");
  check(await page.getByText("No wallet found in this browser").isVisible() && await page.getByRole("button", { name: /Phantom.*Get it/ }).isVisible(), "no wallet installed: it says so, and offers to get one");
  check(await page.getByText("Only your address is shared").isVisible(), "it says what connecting shares");
  await page.context().close();
}
{
  const page = await open(`${app}?freeze`, { mode: "reject" });
  await pill(page).click();
  await page.getByRole("button", { name: /Phantom/ }).click();
  check(await page.getByRole("alert").filter({ hasText: "You cancelled in Phantom. Nothing was shared." }).waitFor({ timeout: 3000 }).then(() => true, () => false), "cancelling in the wallet is explained, the sheet stays");
  check((await pill(page).textContent()).includes("Connect"), "and nothing is connected");
  await page.context().close();
}
{
  const page = await open(`${app}?freeze`);
  await pill(page).click();
  check(await page.getByRole("button", { name: /Phantom.*Detected/ }).isVisible(), "an installed wallet shows as detected, first");
  await page.getByRole("button", { name: /Phantom/ }).click();
  check(await page.getByText("Approve in Phantom").waitFor({ timeout: 1500 }).then(() => true, () => false), "while the wallet asks, the row says where to look");
  const short = `${keys[0].address.slice(0, 4)}…${keys[0].address.slice(-4)}`;
  check(await until(async () => (await pill(page).textContent()).includes(short)), "connected: the corner shows the address");
  check(signs === 0, "without a server, connecting asks for no signature");
  await pill(page).click();
  await page.waitForTimeout(300);
  check(await page.getByText(/^Practice SOL/).isVisible(), "the wallet sheet says the demo balance is not the wallet's");
  await page.getByRole("button", { name: "Disconnect" }).click();
  check(await until(async () => (await pill(page).textContent()).includes("Connect")), "disconnecting puts Connect back");
  check(page.errors.length === 0, `no script errors (demo)${page.errors.length ? `: ${page.errors.join(" | ")}` : ""}`);
  await page.context().close();
}

// ------------------------------------------------------------------ live: sign in, chat as the wallet, come back, switch
const server = await createServer({ guests: true, batchMs: 50, lobbies: [{ id: 412, opensAt: Date.now() - 1452 * 1000, source: simulatedSource({ everySec: 5 }) }] });
const base = `http://localhost:${server.port}`;
const peer = [];
const cp = connectLobby({ base, lobby: 412, token: server.auth.issue("peer"), onMessage: (m) => peer.push(m) });
const live = `${app}?live=${encodeURIComponent(base)}#/lobby`;
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let page = await open(live, { context });
  await page.getByPlaceholder(/Message/).fill("gm from my wallet");
  await page.keyboard.press("Enter");
  check(await page.getByText("Connect a wallet to chat.").waitFor({ timeout: 3000 }).then(() => true, () => false), "a guest who tries to chat is offered to connect, with the reason");
  await page.getByRole("button", { name: /Phantom/ }).click();
  check(await until(() => signs === 1), "live: the wallet signs the server's one-time message");
  check(await until(async () => (await pill(page).textContent()).includes(keys[0].address.slice(0, 4))), "and the app is signed in as that address");
  check(await until(() => peer.some((m) => m.t === "chat" && m.line.text === "gm from my wallet" && m.line.from === keys[0].address)), "the message typed before connecting goes out by itself, from the wallet's address");
  check(await page.getByText("gm from my wallet").first().isVisible() && await page.locator(".msg", { hasText: "gm from my wallet" }).getByText("you", { exact: true }).isVisible(), "and shows as theirs: \"you\", not someone else");
  await page.close();
  page = await open(live, { context });
  check(await until(async () => (await pill(page).textContent()).includes(keys[0].address.slice(0, 4))), "coming back reconnects quietly");
  check(signs === 1, "without signing again");
  await page.evaluate(() => window.__wallet.switchTo(1));
  check(await page.getByText("You switched accounts in Phantom").waitFor({ timeout: 3000 }).then(() => true, () => false), "switching accounts in the wallet signs out, and says why");
  check(await until(async () => (await pill(page).textContent()).includes("Connect")), "back to Connect");
  check(page.errors.length === 0, `no script errors (live)${page.errors.length ? `: ${page.errors.join(" | ")}` : ""}`);
  await context.close();
}
{
  // An iPhone: wallets are apps the page can't see; the sheet offers to reopen the page inside them.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", hasTouch: true, isMobile: true });
  const page = await open(`${app}?freeze`, { wallet: false, context: ctx });
  await page.route(/phantom\.app/, (r) => r.abort()); // the request is the proof; nothing leaves this machine
  await page.getByRole("button", { name: "Connect" }).last().click();
  const row = page.getByRole("button", { name: /Phantom.*Open in Phantom/ });
  check(await row.isVisible() && await page.getByText("On a phone, your wallet is an app").isVisible(), "on an iPhone with no wallet seen, the sheet offers to open the page in Phantom");
  const [req] = await Promise.all([page.waitForRequest(/phantom\.app\/ul\/browse\//, { timeout: 3000 }).catch(() => null), row.click()]);
  check(!!req && decodeURIComponent(req.url()).includes("index.html"), "and Open in Phantom takes this page into Phantom's browser");
  await ctx.close();
}
{
  const page = await open(`${app}?freeze`, { width: 390 });
  check(await page.getByRole("button", { name: "Connect" }).last().isVisible(), "on a phone, the tab bar offers Connect");
  await page.context().close();
}

cp.close();
await browser.close();
await server.close();
files.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
