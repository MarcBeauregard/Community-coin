// Wallet-mode check: a local Hardhat node stands in for the network and a minimal injected wallet
// (window.ethereum forwarding to it) stands in for MetaMask. Deploys the hub with scripts/deploy.js, builds the
// app against it, then launches, commits, buys and sells through real signed transactions.
// Usage: node web/e2e-wallet.cjs

const { chromium } = require("playwright");
const { spawn, execFileSync } = require("node:child_process");
const http = require("node:http");
const { readFileSync, mkdtempSync } = require("node:fs");
const { join } = require("node:path");
const os = require("node:os");

const root = join(__dirname, "..");
const PORT = 8545;
const rpcUrl = `http://127.0.0.1:${PORT}`;

function check(cond, message) {
  if (!cond) throw new Error(`FAILED: ${message}`);
  console.log(`  ok  ${message}`);
}

async function rpc(method, params = []) {
  const res = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await res.json()).result;
}

(async () => {
  const node = spawn("npx", ["hardhat", "node", "--port", String(PORT)], { cwd: root, stdio: "ignore" });
  const cleanup = [() => node.kill()];
  try {
    for (let i = 0; !(await rpc("eth_chainId").catch(() => null)); i++) {
      if (i > 60) throw new Error("hardhat node did not start");
      await new Promise((r) => setTimeout(r, 500));
    }
    const out = execFileSync("npx", ["hardhat", "run", "scripts/deploy.js", "--network", "localhost"], { cwd: root, encoding: "utf8" });
    const hub = out.match(/Deployed\s+(0x[0-9a-fA-F]{40})/)[1];
    check(/Verified/.test(out), `hub deployed and verified at ${hub}`);

    const dist = mkdtempSync(join(os.tmpdir(), "cc-wallet-"));
    execFileSync("node", ["web/build.mjs"], {
      cwd: root,
      env: { ...process.env, OUTDIR: dist, DEPLOYMENTS_JSON: JSON.stringify({ 31337: { name: "Hardhat local", hub } }) },
    });
    const server = http.createServer((req, res) => {
      const file = req.url === "/" ? "index.html" : req.url.slice(1).split("?")[0];
      try {
        res.writeHead(200, { "content-type": file.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8" }).end(readFileSync(join(dist, file)));
      } catch {
        res.writeHead(404).end();
      }
    });
    await new Promise((r) => server.listen(0, r));
    cleanup.push(() => server.close());

    const browser = await chromium.launch();
    cleanup.push(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const problems = [];
    page.on("pageerror", (e) => problems.push(e.message));
    // The injected wallet: every request goes to the node, which holds unlocked test accounts.
    await page.addInitScript((url) => {
      let id = 0;
      window.ethereum = {
        isMetaMask: false,
        async request({ method, params = [] }) {
          if (method === "eth_requestAccounts") method = "eth_accounts";
          const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
          const body = await res.json();
          if (body.error) throw Object.assign(new Error(body.error.message), body.error);
          return body.result;
        },
        on() {},
        removeListener() {},
      };
    }, rpcUrl);
    const toast = (text) =>
      page.locator(".toast", { hasText: text }).first().waitFor({ timeout: 20000 }).catch(async (e) => {
        throw new Error(`${e.message.split("\n")[0]}\ntoasts on screen: ${(await page.locator(".toast").allInnerTexts()).join(" | ") || "none"}`);
      });
    const warp = async (s) => {
      await rpc("evm_increaseTime", [s]);
      await rpc("evm_mine");
    };

    const connect = async () => {
      await page.locator(".ranked-row:not(.head)").first().waitFor({ timeout: 20000 });
      await page.click("button[aria-label='Account']");
      await page.click(".menu button:has-text('Connect wallet')");
      await page.locator(".pill", { hasText: "Hardhat local" }).waitFor({ timeout: 20000 });
    };
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await connect();
    check(true, "the app connects to the deployed hub through the wallet");
    check((await page.locator("button[aria-label='Demo clock']").count()) === 0, "no time travel on a real network");

    await page.goto(page.url().split("#")[0] + "#launch");
    await page.fill("#launch-name", "Wallet Coin");
    await page.fill("#launch-symbol", "WALLET");
    await page.fill("#launch-amount", "0.5");
    await page.click("button:has-text('Launch WALLET')");
    await toast("Meme launched");
    await page.locator("h1", { hasText: "WALLET" }).waitFor({ timeout: 20000 });
    check(true, "a meme launches with a signed transaction");
    await page.locator("#opening-title").waitFor();

    await warp(3700); // past the opening and the vesting
    await page.goto(page.url().split("#")[0] + "#market");
    await page.reload();
    await connect();
    await page.locator(".ranked-row", { hasText: "WALLET" }).first().click();
    await page.locator("#position").getByRole("button", { name: /Claim/ }).click();
    await toast("Claimed");
    await page.fill("#trade-amount", "0.2");
    await page.locator("[data-testid=receive]", { hasText: /WALLET/ }).waitFor({ timeout: 20000 });
    await page.click("button:has-text('Buy WALLET')");
    await toast("Bought");
    await page.locator("[aria-label='Side'] button", { hasText: "Sell" }).click();
    await page.fill("#trade-amount", "1000000");
    await page.locator("[data-testid=receive]", { hasText: /ETH/ }).waitFor({ timeout: 20000 });
    await page.click("button:has-text('Sell WALLET')");
    await toast("Sold");
    check(true, "claim, buy and sell go through the wallet");
    check(problems.length === 0, `no errors in the page${problems.length ? `:\n${problems.join("\n")}` : ""}`);
  } finally {
    for (const f of cleanup.reverse()) await Promise.resolve(f()).catch(() => {});
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
