// End-to-end check of the built app in headless Chromium, under a content security policy as strict as the
// one it is hosted with (no eval, no network but its own files). Follows the dashboard-design QA pass:
//   1. known totals: the demo history is replayed separately in Node, and the KPIs and lists must match it;
//   2. words audit: no sentences outside the places made for them (explanations, empty states, the welcome band, How
//      it works, the tour, tooltips), and no French anywhere, tooltips included;
//   3. the main flows, at desktop and phone width, light and dark; the trade breakdown, the receipt and the chain
//      must agree to the wei; every glossary button has a definition;
//   4. the guided tour, completed with real transactions;
//   5. no horizontal scroll on any page at 320, 375, 768, 1024 and 1440 px.
// Usage: node web/e2e.cjs [screenshot-dir]

const { chromium } = require("playwright");
const { buildSync } = require("esbuild");
const http = require("node:http");
const { readFileSync, writeFileSync, rmSync } = require("node:fs");
const { join } = require("node:path");

const dist = join(__dirname, "dist");
const shots = process.argv[2];
const CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com",
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
// Leftovers of the French interface: accented letters and the words it used most.
const FRENCH = /[àâçéèêëîïôûùœ]|\b(le|la|les|des|du|une|et|ou|pour|avec|sans|dans|sur|tu|ton|toi|aucun|aucune|retirer|lancer|engager|voter|frais|prix|famille|variante|racine|marché|réserve|ouverture|vente|achat)\b/i;

/** Replays the demo history without the interface and returns what the market page should show. */
async function expectedTotals() {
  const entry = join(__dirname, ".expected.mjs");
  buildSync({
    stdin: {
      contents: `
        import { LocalChain } from "./chain.js";
        import { Hub } from "./hub.js";
        import { seed, DEMO_ACCOUNTS } from "./seed.js";
        export async function run() {
          const chain = await LocalChain.create(DEMO_ACCOUNTS);
          const hub = await Hub.deploy(chain, chain.accounts[0].address, [300, 3600, 5000, 259200]);
          const accountOf = (n) => chain.accounts.find((a) => a.name === n).address;
          await seed({ hub, accountOf, run: (a, fn, args, v) => hub.write(accountOf(a), fn, args, v), warp: async (s) => chain.warp(s) });
          const out = { roots: {}, count: Number(await hub.read("memeCount")) };
          for (let i = 0; i < out.count; i++) {
            const t = await hub.read("allMemes", [i]);
            const m = await hub.read("memes", [t]);
            if (m.parent === "0x0000000000000000000000000000000000000000")
              out.roots[await hub.token(t, "symbol")] = Number(m.settled ? m.vQuote - m.floor : m.batchQuote) / 1e18;
          }
          return out;
        }`,
      resolveDir: join(__dirname, "src"),
      loader: "js",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: entry,
    logLevel: "warning",
  });
  try {
    return await (await import(entry)).run();
  } finally {
    rmSync(entry, { force: true });
  }
}

const server = http.createServer((req, res) => {
  const path = req.url.split("?")[0];
  const file = path === "/" ? "index.html" : path.slice(1);
  try {
    const body = readFileSync(join(dist, file));
    res.writeHead(200, { "content-type": file.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8", "content-security-policy": CSP });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});

(async () => {
  const expected = await expectedTotals();
  await new Promise((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}/?e2e`; // ?e2e exposes the session to read the chain directly
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const problems = [];
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/fonts\.(googleapis|gstatic)/.test(m.text())) problems.push(`console: ${m.text()}`);
  });
  const shot = async (name) => {
    if (!shots) return;
    await page.waitForFunction(() => !document.querySelector(".mint")); // let the minting moment finish
    await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true });
  };
  const toast = (text) => page.locator(".toast", { hasText: text }).first().waitFor({ timeout: 5000 });
  /** Waits until the trade panel shows a quote for the amount just typed. */
  const quoted = () =>
    page.waitForFunction(() => {
      const t = document.querySelector("[data-testid=receive]")?.textContent.trim();
      return t && t !== "—";
    });
  const kpi = (id) => page.locator(`[data-kpi="${id}"] .kpi-value`).innerText();
  const warp = async (label) => {
    await page.click("button[aria-label='Demo clock']");
    await page.click(`.menu button:text-is("${label}")`);
    await toast("+");
  };
  const wordsAudit = () =>
    page.evaluate(() => {
      const skip = (el) => el.closest(".empty, .empty-state, .explain, .welcome, .how, .tour, .demo-note, .example, #tip, .toasts, noscript, script, style");
      const found = [];
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const text = n.textContent.trim();
        if (!text || skip(n.parentElement)) continue;
        if (text.split(/\s+/).length >= 6 && /[.!?:]\s|[.!?]$/.test(text)) found.push(text);
      }
      return found;
    });
  /** Every string a reader can meet on the current screen: text, tooltips, labels, placeholders and the title. */
  const frenchAudit = async (where) => {
    const hits = await page.evaluate((source) => {
      const re = new RegExp(source, "i");
      const attrs = [...document.querySelectorAll("[data-tip], [aria-label], [placeholder], [title], option")].flatMap((el) =>
        [el.dataset.tip, el.getAttribute("aria-label"), el.getAttribute("placeholder"), el.getAttribute("title"), el.tagName === "OPTION" ? el.textContent : null]);
      return [document.title, document.body.innerText, ...attrs].filter(Boolean).flatMap((t) => t.split("\n")).filter((t) => re.test(t));
    }, FRENCH.source);
    check(hits.length === 0, `no French on ${where}${hits.length ? `: ${[...new Set(hits)].join(" | ")}` : ""}`);
  };

  /** Glossary keys of every info button on the current screen. */
  const terms = new Set();
  const collectTerms = async () => (await page.evaluate(() => [...document.querySelectorAll("[data-term]")].map((e) => e.dataset.term))).forEach((k) => terms.add(k));
  /** Reads the hub from the page's own session (exposed by ?e2e). Arguments and results are strings. */
  const read = (fn, args = []) => page.evaluate(async ([fn, args]) => String(await globalThis.__cc.session.hub.read(fn, args)), [fn, args]);
  const addressOf = (name) => page.evaluate((n) => globalThis.__cc.session.chain.accounts.find((a) => a.name === n).address, name);
  const tokenOf = async (ticker) => read("tokenOfKey", [await read("symbolKey", [ticker])]);

  const t0 = Date.now();
  await page.goto(url);
  await page.locator(".ranked-row:not(.head)").first().waitFor({ timeout: 20000 });
  check(true, `app boots with the example market in ${Date.now() - t0} ms`);
  const boot = await page.evaluate(() => {
    const at = (n) => performance.getEntriesByName(n)[0]?.startTime;
    return { seeded: at("cc:seeded") - at("cc:boot"), ready: at("cc:ready") - at("cc:boot"), script: at("cc:boot") };
  });
  check(boot.ready < 4000, `demo chain built and seeded in ${boot.seeded.toFixed(0)} ms, first screen ${boot.ready.toFixed(0)} ms after the script started (script start ${boot.script.toFixed(0)} ms)`);
  check((await page.evaluate(() => document.documentElement.lang)) === "en", "the page is declared English");

  // 1. Known totals against the independent replay.
  const rootRows = page.locator("[aria-label='Families'] .ranked-row:not(.head):not(.variant)");
  const shown = {};
  for (const row of await rootRows.all()) shown[(await row.locator(".meme-sym").innerText()).trim()] = num(await row.locator(".col-res").innerText());
  for (const [sym, eth] of Object.entries(expected.roots)) check(Math.abs(shown[sym] - eth) < 0.006, `${sym} reserve shows ${shown[sym]} ETH, expected ${eth.toFixed(4)}`);
  const lockedExpected = Object.values(expected.roots).reduce((a, b) => a + b, 0);
  check(Math.abs(num(await kpi("locked")) - lockedExpected) < 0.006, `ETH locked tile matches the families (${lockedExpected.toFixed(3)} ETH)`);
  check(num(await kpi("memes")) === expected.count, `meme count tile matches (${expected.count})`);
  check((await page.locator("[aria-label='Families'] .ranked-row:not(.head)").count()) === expected.count, "every meme has one row");
  const shares = await page.locator("[aria-label='Families'] .col-share:not(:empty)").allInnerTexts();
  const shareSum = shares.slice(1).reduce((s, t) => s + num(t), 0);
  check(Math.abs(shareSum - 100) <= 2, `family shares add up to 100% (${shareSum})`);
  const openings = num(await kpi("openings"));
  check(openings === (await page.locator(".todo li", { hasText: "Opening" }).count()), "live openings tile matches the to-do list");

  // 2. Words audit.
  let sentences = await wordsAudit();
  check(sentences.length === 0, `no sentences on the market page${sentences.length ? `: ${sentences.join(" | ")}` : ""}`);
  await frenchAudit("the market page");
  await collectTerms();
  check((await page.locator(".welcome").count()) === 1, "a first visit opens on the welcome band");
  await shot("market-desktop");

  // 3. Flows. Join the live opening from the to-do list.
  await page.locator(".todo li", { hasText: "BABYPNUT" }).getByRole("link", { name: "Commit" }).click();
  await page.locator("#opening-title").waitFor();
  await page.fill("#commit-amount", "0.5");
  await page.locator("#opening form").getByRole("button", { name: "Commit" }).click();
  await toast("Committed");
  check((await page.locator("#opening .facts div:has(> dt:text-is('You'))").innerText()).includes("PNUT"), "ETH was routed into PNUT and committed");
  check((await page.locator("[data-testid=estimate]").count()) === 1, "the opening estimates your share before you commit");
  await collectTerms();
  sentences = await wordsAudit();
  check(sentences.length === 0, `no sentences on a meme page${sentences.length ? `: ${sentences.join(" | ")}` : ""}`);
  await frenchAudit("a meme page in its opening");
  await warp("5 min");
  await page.locator("[aria-label='Side']").waitFor();
  check(true, "after the opening, the trade panel replaces the auction");
  await warp("1 hour");
  await page.locator("#position").getByRole("button", { name: /Claim/ }).click();
  await toast("Claimed");
  check(num(await page.locator("[data-testid=position]").innerText()) > 0, "the vested allocation was claimed");

  // Buy a variant with ETH through its lineage, then sell everything back into the parent.
  await page.goto(url + "#market");
  await page.locator(".ranked-row", { hasText: "PNUTWIFHAT" }).first().click();
  await page.locator("[aria-label='Side']").waitFor();
  check((await page.locator(".route").first().innerText()).replace(/\s+/g, " ").includes("ETH PNUT PNUTWIFHAT"), "the route goes through the original");
  await page.fill("#trade-amount", "1");
  await quoted();
  const breakdown = page.locator("[data-testid=breakdown]");
  await breakdown.waitFor();
  const hopsOf = (box) => box.locator(".flow-hop").evaluateAll((els) => els.map((e) => ({ fee: e.dataset.fee, reserve: e.dataset.reserve, out: e.dataset.out })));
  const before = { hops: await hopsOf(breakdown), out: await breakdown.getAttribute("data-out") };
  check(before.hops.length === 2, "the breakdown shows both curves the ETH goes through");
  const pnut = await tokenOf("PNUT"), dev = await addressOf("Dev Peanut");
  const fees0 = BigInt(await read("feesOf", [dev, "0x0000000000000000000000000000000000000000"])), reserve0 = BigInt(await read("realReserve", [pnut]));
  await collectTerms();
  await page.click("button:has-text('Buy PNUTWIFHAT')");
  await toast("Bought");
  const receipt = page.locator("[data-testid=receipt]");
  await receipt.waitFor();
  const after = { hops: await hopsOf(receipt), out: await receipt.getAttribute("data-out") };
  check(JSON.stringify(after) === JSON.stringify(before), "the receipt equals the breakdown shown before, to the wei");
  const fees1 = BigInt(await read("feesOf", [dev, "0x0000000000000000000000000000000000000000"])), reserve1 = BigInt(await read("realReserve", [pnut]));
  check(String(fees1 - fees0) === after.hops[0].fee && String(reserve1 - reserve0) === after.hops[0].reserve,
    "and the chain agrees: PNUT's creator fee and PNUT's reserve moved by exactly the receipt's amounts");
  await page.locator("[aria-label='Side'] button", { hasText: "Sell" }).click();
  await page.locator("[aria-label='Receive in'] button", { hasText: "PNUT" }).click();
  await page.locator("#trade form").getByRole("button", { name: "Max" }).click();
  await quoted();
  await page.click("button:has-text('Sell PNUTWIFHAT')");
  await toast("Sold");
  check(num(await page.locator("[data-testid=position]").innerText()) === 0, "selling everything into PNUT empties the position");
  await frenchAudit("a trading meme page");
  await shot("meme-desktop");

  // A duplicate ticker is refused before it reaches the chain; a new variant launches.
  await page.goto(url + "#launch");
  await page.locator("#launch-name").waitFor();
  await page.fill("#launch-name", "Copy");
  await page.fill("#launch-symbol", "$pnu7");
  check((await page.locator("[data-testid=ticker-status]").innerText()) === "Taken", "a leetspeak copy of PNUT is flagged");
  check(await page.locator("form button.wide").isDisabled(), "and cannot be launched");
  check((await page.locator("#ticker-help").innerText()).includes("variant"), "the form says why and offers a variant instead");
  await collectTerms();
  await frenchAudit("the launch page");
  await page.fill("#launch-name", "Flying Squirrel");
  await page.fill("#launch-symbol", "FLYSQUIRREL");
  await page.selectOption("#launch-parent", { label: "Variant of PNUT" });
  await page.fill("#launch-amount", "0.2");
  await shot("launch-desktop");
  await page.click("button:has-text('Launch FLYSQUIRREL')");
  await toast("Meme launched");
  await page.locator("h1", { hasText: "FLYSQUIRREL" }).waitFor();
  check(true, "a new variant launches and opens on its own page");

  // Push the PEANUT → PNUT union over the majority, wait out the vote, execute it.
  await page.goto(url + "#market");
  await page.locator(".ranked-row", { hasText: "PEANUT" }).filter({ hasNotText: "PNUT " }).last().click();
  await page.locator("h1", { hasText: "PEANUT" }).waitFor();
  check((await page.locator("[data-union='0'] .before-after").count()) === 1, "the vote shows what would change if it passed");
  await collectTerms();
  await page.fill("#trade-amount", "3");
  await quoted();
  await page.click("button:has-text('Buy PEANUT')");
  await toast("Bought");
  await page.locator("[data-union='0']").getByRole("button", { name: "Max" }).click();
  await page.click("button:has-text('Vote for')");
  await toast("Vote recorded");
  await warp("3 days");
  await warp("1 hour");
  await page.locator("[data-union='0']").getByRole("button", { name: "Execute" }).click();
  await toast("Union executed");
  await page.locator(".crumbs a", { hasText: "PNUT" }).first().waitFor();
  check((await page.locator(".crumbs").innerText()).includes("PNUT"), "PEANUT now sits in the PNUT family");
  await page.locator("[data-union='0']").getByRole("button", { name: "Unlock" }).click();
  await toast("Tokens unlocked");

  // Another account: the original's creator withdraws the fees earned on the whole family.
  await page.click("button[aria-label='Account']");
  await page.click(".menu button:has-text('Dev Peanut')");
  await page.goto(url + "#portfolio");
  await page.locator(".todo li", { hasText: "Fees" }).first().getByRole("button", { name: "Withdraw" }).click();
  await toast("Fees withdrawn");
  check(true, "the original's creator withdraws fees from the to-do list");
  await frenchAudit("the portfolio");
  await shot("portfolio");

  // Links shared while the site was French still land on the right page.
  await page.goto(url + "#regles");
  await page.locator("h1", { hasText: "How it works" }).waitFor();
  check(true, "an old French link to the rules opens How it works");
  await frenchAudit("How it works");
  const glossary = await page.evaluate(() => [...document.querySelectorAll("[data-glossary]")].map((e) => [e.dataset.glossary, e.querySelector("dd").textContent.trim()]));
  check(glossary.length >= 20 && glossary.every(([, text]) => text.length > 20), `the glossary defines ${glossary.length} terms, none empty`);
  await collectTerms();
  const missing = [...terms].filter((k) => !glossary.some(([g]) => g === k));
  check(terms.size >= 15 && missing.length === 0, `every one of the ${terms.size} info buttons met has its glossary entry${missing.length ? `: missing ${missing}` : ""}`);
  await shot("how-desktop");
  await page.goto(url + "#unions");
  await page.locator("h1", { hasText: "Unions" }).waitFor();
  await frenchAudit("the unions page");

  // Phone width and dark theme.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(url + "#market");
  await page.locator(".ranked-row:not(.head)").first().waitFor();
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal scroll at phone width");
  await page.locator(".bottom-tabs a", { hasText: "Unions" }).click();
  await page.locator("h1", { hasText: "Unions" }).waitFor();
  check(true, "the bottom tabs navigate on a phone");
  await shot("unions-phone");
  await page.goto(url + "#market");
  await page.locator(".ranked-row", { hasText: "PNUT" }).first().click();
  await page.locator("#chart-title").waitFor();
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal scroll on a meme page at phone width");
  check((await page.evaluate(() => document.documentElement.dataset.theme)) === "dark", "the house theme is dark");
  await shot("meme-phone-dark");
  await page.click("button[aria-label='Switch to light theme']");
  check((await page.evaluate(() => document.documentElement.dataset.theme)) === "light", "the theme switch turns the page light");
  await shot("meme-phone-light");
  await page.goto(url + "#market");
  await page.locator(".ranked-row:not(.head)").first().waitFor();
  check((await page.evaluate(() => document.documentElement.dataset.theme)) === "light", "and the choice is remembered");
  await shot("market-phone-light");

  // A fresh demo: every page at every width, then the guided tour from the welcome band.
  const fresh = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  fresh.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  await fresh.goto(url);
  await fresh.locator(".ranked-row:not(.head)").first().waitFor({ timeout: 20000 });
  const hrefOf = (sym) => fresh.evaluate((s) => [...document.querySelectorAll("a.ranked-row")].find((a) => a.querySelector(".meme-sym")?.textContent.trim() === s)?.getAttribute("href"), sym);
  const routes = { market: "#market", opening: await hrefOf("BABYPNUT"), trading: await hrefOf("PNUTWIFHAT"), vote: await hrefOf("PEANUT"), launch: "#launch", unions: "#unions", portfolio: "#portfolio", how: "#how" };
  const wide = [];
  for (const width of [320, 375, 768, 1024, 1440]) {
    await fresh.setViewportSize({ width, height: 860 });
    for (const [name, hash] of Object.entries(routes)) {
      await fresh.evaluate((h) => (location.hash = h), hash);
      await fresh.locator("main h1").first().waitFor();
      await fresh.waitForTimeout(80);
      if (await fresh.evaluate(() => document.documentElement.scrollWidth > innerWidth)) wide.push(`${name}@${width}`);
    }
  }
  check(wide.length === 0, `no horizontal scroll on ${Object.keys(routes).length} pages at 320, 375, 768, 1024 and 1440 px${wide.length ? `: ${wide.join(", ")}` : ""}`);

  await fresh.setViewportSize({ width: 1440, height: 900 });
  await fresh.evaluate(() => (location.hash = "#market"));
  await fresh.getByRole("button", { name: "Take the 2-minute tour" }).click();
  const step = () => fresh.locator("[data-tour-step]").getAttribute("data-tour-step");
  const stepIs = (id) => fresh.locator(`[data-tour-step='${id}']`).waitFor({ timeout: 8000 });
  const ftoast = (text) => fresh.locator(".toast", { hasText: text }).first().waitFor({ timeout: 8000 });
  await stepIs("commit");
  await fresh.locator("#opening .btn-lg").click();
  await ftoast("Committed");
  await stepIs("warp");
  await fresh.click("button[aria-label='Demo clock']");
  await fresh.click('.menu button:text-is("1 hour")');
  await stepIs("claim");
  await fresh.locator("#position .btn").click();
  await ftoast("Claimed");
  await stepIs("buy");
  await fresh.locator("#trade [data-testid=breakdown]").waitFor();
  await fresh.locator("#trade .btn-lg").click();
  await ftoast("Bought");
  await stepIs("sell");
  await fresh.locator("[aria-label='Side'] button", { hasText: "Sell" }).click();
  await fresh.locator("#trade form").getByRole("button", { name: "Max" }).click();
  await fresh.locator("#trade [data-testid=breakdown]").waitFor();
  const spikeKept = await fresh.locator("#trade [data-testid=breakdown] .hot-text").count();
  await fresh.locator("#trade .btn-lg").click();
  await ftoast("Sold");
  await stepIs("union");
  await fresh.locator(".tour").getByRole("button", { name: "Next" }).click();
  await stepIs("end");
  await fresh.locator(".tour").getByRole("button", { name: "Finish" }).click();
  check((await fresh.locator(".tour").count()) === 0 && spikeKept > 0, `the guided tour runs to the end on real transactions (${await step().catch(() => "closed")}), the sale showing its spike share`);
  await fresh.close();

  check(problems.length === 0, `no errors in the page${problems.length ? `:\n${problems.join("\n")}` : ""}`);
  await browser.close();
  server.close();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
