// Wallet-mode check, without a validator: web/mock-cluster.mjs stands in for a Solana cluster (JSON-RPC over HTTP,
// accounts in the program's layout, transactions executed on the program's rules) and a minimal injected wallet
// (window.phantom.solana) stands in for Phantom: it serializes the transaction the app built and sends it to the
// cluster, unsigned. The app is built against that cluster, then connects, reads the market, buys, sells into the
// parent, commits to an opening, launches, claims, and meets a wallet refusal and a trade refused by the program.
// Usage: node web/e2e-wallet.mjs

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import http from "node:http";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { PublicKey } from "@solana/web3.js";
import { MockCluster } from "./mock-cluster.mjs";
import { Scenario, span, lamports } from "./src/scenario.js";
import { Addresses, PROGRAM_ID } from "./src/solana.js";
import { symbolKey } from "./src/protocol.js";

const { chromium } = createRequire(import.meta.url)("playwright");
const web = dirname(fileURLToPath(import.meta.url));
const CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
].join("; ");

function check(cond, message) {
  if (!cond) throw new Error(`FAILED: ${message}`);
  console.log(`  ok  ${message}`);
}
const num = (text) => Number(text.replace(/[\s,]/g, "").replace("−", "-").match(/-?[\d.]+/)[0]);

// The cluster holds the demo history, ending about now (BABYPNUT is in its opening), and a wallet with 200 SOL.
const A = new Addresses(PROGRAM_ID);
const seed = JSON.parse(readFileSync(join(web, "src/seed.json"), "utf8"));
const idOf = (name) => PublicKey.findProgramAddressSync([Buffer.from("test"), Buffer.from(name)], PublicKey.default)[0].toBase58();
const start = Math.floor(Date.now() / 1000) - span(seed) - 20;
const history = new Scenario(seed, { idOf, mintOf: (key) => A.mint(key), start });
for (const step of seed.steps) history.step(step);
const WALLET = idOf("Phantom wallet");
history.engine.state.lamports.set(WALLET, lamports("200"));
const cluster = new MockCluster({ engine: history.engine, addresses: A, start: history.now });
const engine = () => cluster.engine;
const balance = (ticker) => engine().balance(A.mint(symbolKey(ticker)), WALLET);
check(engine().state.order.length === 5, "the cluster holds the demo market, its accounts laid out as the program lays them out");

const server = http.createServer((req, res) => {
  const path = req.url.split("?")[0];
  if (req.method === "POST" && path === "/rpc") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const call = JSON.parse(body);
      const answer = (one) => {
        try {
          return { jsonrpc: "2.0", id: one.id, result: cluster.rpc(one) };
        } catch (e) {
          problems.push(`rpc ${one.method}: ${e.message}`);
          return { jsonrpc: "2.0", id: one.id, error: { code: -32000, message: e.message } };
        }
      };
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(Array.isArray(call) ? call.map(answer) : answer(call)));
    });
    return;
  }
  const file = path === "/" ? "index.html" : path.slice(1);
  try {
    res.writeHead(200, { "content-type": file.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8", "content-security-policy": CSP }).end(readFileSync(join(dist, file)));
  } catch {
    res.writeHead(404).end();
  }
});
const problems = [];
await new Promise((r) => server.listen(0, r));
const origin = `http://127.0.0.1:${server.address().port}`;
const dist = mkdtempSync(join(os.tmpdir(), "cc-wallet-"));
execFileSync("node", [join(web, "build.mjs")], {
  env: { ...process.env, OUTDIR: dist, DEPLOYMENTS_JSON: JSON.stringify({ test: { name: "Test cluster", rpc: `${origin}/rpc`, programId: PROGRAM_ID } }) },
});

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/fonts\.(googleapis|gstatic)/.test(m.text())) problems.push(`console: ${m.text()}`);
  });
  // The injected wallet. `__reject` makes it refuse the next request, as a person declining would.
  await page.addInitScript((address) => {
    const publicKey = { toBase58: () => address, toString: () => address };
    globalThis.phantom = {
      solana: {
        isPhantom: true,
        publicKey,
        connect: async () => ({ publicKey }),
        async signAndSendTransaction(tx) {
          if (globalThis.__reject) {
            globalThis.__reject = false;
            throw Object.assign(new Error("User rejected the request."), { code: 4001 });
          }
          const raw = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
          let bin = "";
          for (const b of raw) bin += String.fromCharCode(b);
          const res = await fetch("/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendTransaction", params: [btoa(bin), { encoding: "base64" }] }) });
          const json = await res.json();
          if (json.error) throw new Error(json.error.message);
          return { signature: json.result };
        },
      },
    };
  }, WALLET);
  const toast = (text, timeout = 15000) => page.locator(".toast", { hasText: text }).first().waitFor({ timeout });
  const breakdown = page.locator("[data-testid=breakdown]");

  await page.goto(`${origin}/?e2e`);
  await page.locator(".ranked-row:not(.head)").first().waitFor({ timeout: 20000 });
  await page.click("button[aria-label='Account']");
  await page.click(".menu button:has-text('Connect wallet')");
  await page.locator(".pill", { hasText: "Test cluster" }).waitFor({ timeout: 15000 });
  await page.locator(".ranked-row:not(.head)").first().waitFor();
  check((await page.locator("[aria-label='Families'] .ranked-row:not(.head)").count()) === 5, "the wallet connects and the market is read from the cluster");
  check(num(await page.locator(".account .tnum").innerText()) === 200, "the wallet's SOL balance shows");
  const pnutReserve = Number(engine().state.memes.get(A.mint("PNUT")).vQuote - engine().state.memes.get(A.mint("PNUT")).floor) / 1e9;
  const shown = num(await page.locator("[aria-label='Families'] .ranked-row", { hasText: "PNUT" }).first().locator(".col-res").innerText());
  check(Math.abs(shown - pnutReserve) < 0.06, `PNUT's reserve read from its account: ${shown} SOL`);

  // Buy a variant through its lineage: the breakdown, the receipt and the cluster agree.
  const href = (ticker) => `#meme-${A.mint(symbolKey(ticker))}`;
  await page.evaluate((h) => (location.hash = h), href("PNUTWIFHAT"));
  await page.fill("#trade-amount", "2");
  await breakdown.waitFor();
  const promised = await breakdown.getAttribute("data-out");
  await page.click("button:has-text('Buy PNUTWIFHAT')");
  await toast("Bought");
  const receipt = page.locator("[data-testid=receipt]");
  await receipt.waitFor();
  check((await receipt.getAttribute("data-out")) === promised, "the receipt, read from the transaction's logs, equals the breakdown shown before");
  check(String(balance("PNUTWIFHAT") * 10n ** 12n) === promised, "and the cluster holds exactly that in the wallet's token account");
  check(cluster.sent.at(-1).ops.join() === "buySol" && !cluster.sent.at(-1).err, "one buy_sol instruction, with the accounts the program expects");

  // Sell everything into the parent: the wallet's PNUT account is created in the same transaction.
  await page.locator("[aria-label='Side'] button", { hasText: "Sell" }).click();
  await page.locator("[aria-label='Receive in'] button", { hasText: "PNUT" }).click();
  await page.locator("#trade form").getByRole("button", { name: "Max" }).click();
  await breakdown.waitFor();
  await page.click("button:has-text('Sell PNUTWIFHAT')");
  await toast("Sold");
  check(balance("PNUTWIFHAT") === 0n && balance("PNUT") > 0n, "selling into PNUT empties the position and pays PNUT into a new token account");

  // A refusal in the wallet, then a trade the program refuses because someone else traded first.
  await page.evaluate(() => (globalThis.__reject = true));
  await page.locator("[aria-label='Side'] button", { hasText: "Buy" }).click();
  await page.locator("[aria-label='Pay with'] button", { hasText: "SOL" }).click();
  await page.fill("#trade-amount", "1");
  await breakdown.waitFor();
  const sentBefore = cluster.sent.length;
  await page.click("button:has-text('Buy PNUTWIFHAT')");
  await toast("You declined in your wallet");
  check(cluster.sent.length === sentBefore, "declining in the wallet sends nothing");
  await page.fill("#trade-amount", "5");
  await breakdown.waitFor();
  const alice = idOf("Alice");
  engine().buySol(alice, A.mint("PNUT"), lamports("150"), 0n, cluster.now()); // a big buy lands first
  await page.click("button:has-text('Buy PNUTWIFHAT')");
  await toast("The price moved more than 1%");
  check(cluster.sent.at(-1).err?.InstructionError?.[1]?.Custom === 6011, "the program refuses it (Slippage) and the page says why");

  // Commit to the live opening, launch a root, then claim once the opening tokens have vested.
  await page.evaluate((h) => (location.hash = h), href("BABYPNUT"));
  await page.locator("#opening .btn-lg").waitFor();
  await page.fill("#commit-amount", "3");
  await page.locator("#opening form").getByRole("button", { name: "Commit" }).click();
  await toast("Committed");
  check(engine().commitment(A.mint("BABYPNUT"), WALLET).committed > 0n, "the commit is in the wallet's commitment account");
  await page.evaluate(() => (location.hash = "#launch"));
  await page.fill("#launch-name", "Phantom Squirrel");
  await page.fill("#launch-symbol", "PHANTOM");
  await page.fill("#launch-amount", "2");
  await page.click("button:has-text('Launch PHANTOM')");
  await toast("Meme launched");
  await page.locator("h1", { hasText: "PHANTOM" }).waitFor({ timeout: 15000 });
  check(engine().state.memes.has(A.mint("PHANTOM")), "a new root launches, its mint derived from its ticker");
  cluster.warp(2 * 3600);
  await page.evaluate((h) => (location.hash = h), href("BABYPNUT"));
  await page.locator("#position").getByRole("button", { name: /Claim \d/ }).waitFor({ timeout: 20000 }); // the next refresh sees the clock
  await page.locator("#position").getByRole("button", { name: /Claim/ }).click();
  await toast("Claimed");
  check(balance("BABYPNUT") > 0n, "the vested opening tokens are claimed into the wallet");

  check(problems.length === 0, `no errors in the page or the cluster${problems.length ? `:\n${problems.join("\n")}` : ""}`);
} catch (e) {
  if (problems.length) console.error(problems.join("\n"));
  throw e;
} finally {
  await browser.close();
  server.close();
  rmSync(dist, { recursive: true, force: true });
}
