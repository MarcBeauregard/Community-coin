// End-to-end check of the built app in headless Chromium, under a content security policy as strict as the
// one it is hosted with (no eval, no network but its own files). Follows the dashboard-design QA pass:
//   1. known totals: the demo history is replayed separately in Node, and the KPIs and lists must match it;
//   2. words audit: no sentences on screen outside tooltips and empty states, and no French anywhere, tooltips included;
//   3. the main flows, at desktop and phone width, light and dark.
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
  const file = req.url === "/" ? "index.html" : req.url.slice(1).split("?")[0];
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
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const problems = [];
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/fonts\.(googleapis|gstatic)/.test(m.text())) problems.push(`console: ${m.text()}`);
  });
  const shot = async (name) => shots && page.screenshot({ path: join(shots, `${name}.png`), fullPage: true });
  const toast = (text) => page.locator(".toast", { hasText: text }).first().waitFor({ timeout: 5000 });
  const kpi = (id) => page.locator(`[data-kpi="${id}"] .kpi-value`).innerText();
  const warp = async (label) => {
    await page.click("button[aria-label='Demo clock']");
    await page.click(`.menu button:text-is("${label}")`);
    await toast("+");
  };
  const wordsAudit = () =>
    page.evaluate(() => {
      const skip = (el) => el.closest(".empty, .empty-state, .prose, #tip, .toasts, noscript, script, style");
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

  const t0 = Date.now();
  await page.goto(url);
  await page.locator(".ranked-row:not(.head)").first().waitFor({ timeout: 20000 });
  check(true, `app boots with the example market in ${Date.now() - t0} ms`);
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
  await shot("market-desktop");

  // 3. Flows. Join the live opening from the to-do list.
  await page.locator(".todo li", { hasText: "BABYPNUT" }).getByRole("link", { name: "Commit" }).click();
  await page.locator("#opening-title").waitFor();
  await page.fill("#commit-amount", "0.5");
  await page.locator("#opening form").getByRole("button", { name: "Commit" }).click();
  await toast("Committed");
  check((await page.locator(".facts div", { hasText: "You" }).innerText()).includes("PNUT"), "ETH was routed into PNUT and committed");
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
  await page.locator("[data-testid=receive]", { hasText: /PNUTWIFHAT/ }).waitFor();
  await page.click("button:has-text('Buy PNUTWIFHAT')");
  await toast("Bought");
  await page.locator("[aria-label='Side'] button", { hasText: "Sell" }).click();
  await page.locator("[aria-label='Receive in'] button", { hasText: "PNUT" }).click();
  await page.locator("#trade form").getByRole("button", { name: "Max" }).click();
  await page.locator("[data-testid=receive]", { hasText: /PNUT/ }).waitFor();
  await page.click("button:has-text('Sell PNUTWIFHAT')");
  await toast("Sold");
  check(num(await page.locator("[data-testid=position]").innerText()) === 0, "selling everything into PNUT empties the position");
  await frenchAudit("a trading meme page");
  await shot("meme-desktop");

  // A duplicate ticker is refused before it reaches the chain; a new variant launches.
  await page.goto(url + "#launch");
  await page.fill("#launch-name", "Copy");
  await page.fill("#launch-symbol", "$pnu7");
  check((await page.locator("[data-testid=ticker-status]").innerText()) === "Taken", "a leetspeak copy of PNUT is flagged");
  check(await page.locator("form button.wide").isDisabled(), "and cannot be launched");
  await frenchAudit("the launch page");
  await page.fill("#launch-name", "Flying Squirrel");
  await page.fill("#launch-symbol", "FLYSQUIRREL");
  await page.selectOption("#launch-parent", { label: "Variant of PNUT" });
  await page.fill("#launch-amount", "0.2");
  await page.click("button:has-text('Launch FLYSQUIRREL')");
  await toast("Meme launched");
  await page.locator("h1", { hasText: "FLYSQUIRREL" }).waitFor();
  check(true, "a new variant launches and opens on its own page");

  // Push the PEANUT → PNUT union over the majority, wait out the vote, execute it.
  await page.goto(url + "#market");
  await page.locator(".ranked-row", { hasText: "PEANUT" }).filter({ hasNotText: "PNUT " }).last().click();
  await page.locator("h1", { hasText: "PEANUT" }).waitFor();
  await page.fill("#trade-amount", "3");
  await page.locator("[data-testid=receive]", { hasText: /PEANUT/ }).waitFor();
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
  await page.locator("h1", { hasText: "Rules" }).waitFor();
  check(true, "an old French link opens the Rules page");
  await frenchAudit("the rules");
  await page.goto(url + "#unions");
  await page.locator("h1", { hasText: "Unions" }).waitFor();
  await frenchAudit("the unions page");

  // Phone width and dark theme.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(url + "#market");
  await page.locator(".ranked-row:not(.head)").first().waitFor();
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal scroll at phone width");
  await page.click(".menu-button");
  await page.locator(".menu-grid a", { hasText: "Unions" }).click();
  await page.locator("h1", { hasText: "Unions" }).waitFor();
  check((await page.locator(".phone-menu").count()) === 0, "the phone menu closes on navigation");
  await shot("unions-phone");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(url + "#market");
  await page.locator(".ranked-row", { hasText: "PNUT" }).first().click();
  await page.locator("#chart-title").waitFor();
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal scroll on a meme page at phone width");
  await shot("meme-phone-dark");

  check(problems.length === 0, `no errors in the page${problems.length ? `:\n${problems.join("\n")}` : ""}`);
  await browser.close();
  server.close();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
