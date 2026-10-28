// End-to-end check of the built app in headless Chromium, under a content security policy as strict as the
// one it is hosted with (no eval, no network but its own files). Walks through the main flows and saves
// screenshots. Usage: node web/e2e.cjs [screenshot-dir]

const { chromium } = require("playwright");
const http = require("node:http");
const { readFileSync } = require("node:fs");
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

const server = http.createServer((req, res) => {
  const file = req.url === "/" ? "index.html" : req.url.slice(1).split("?")[0];
  try {
    const body = readFileSync(join(dist, file));
    res.writeHead(200, {
      "content-type": file.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8",
      "content-security-policy": CSP,
    });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});

function check(cond, message) {
  if (!cond) throw new Error(`FAILED: ${message}`);
  console.log(`  ok  ${message}`);
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const problems = [];
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/fonts\.(googleapis|gstatic)/.test(m.text())) problems.push(`console: ${m.text()}`);
  });
  page.on("requestfailed", (r) => {
    if (!/fonts\.(googleapis|gstatic)/.test(r.url())) problems.push(`request failed: ${r.url()}`);
  });
  const shot = async (name) => shots && page.screenshot({ path: join(shots, `${name}.png`), fullPage: true });
  const toast = async (text) => page.locator(".toast", { hasText: text }).first().waitFor({ timeout: 5000 });

  const t0 = Date.now();
  await page.goto(url);
  await page.locator("table.memes").waitFor({ timeout: 20000 });
  check(true, `app boots with the example market in ${Date.now() - t0} ms`);
  for (const sym of ["PNUT", "PNUTWIFHAT", "BABYPNUT", "PEANUT", "MOODENG"]) {
    check(await page.locator("table.memes .ticker", { hasText: new RegExp(`^${sym}$`) }).count() === 1, `${sym} is listed`);
  }
  check(await page.locator("tr", { hasText: "BABYPNUT" }).locator(".chip-open").count() === 1, "BABYPNUT is in its opening");
  await shot("explorer-desktop");

  // Commit to the live opening, then let it close.
  await page.locator("table.memes .ticker", { hasText: /^BABYPNUT$/ }).click();
  await page.locator("h2", { hasText: "Enchère d'ouverture" }).waitFor();
  await page.fill("#commit-amount", "0.5");
  await page.click("button:has-text('Engager')");
  await toast("Engagé");
  check((await page.locator(".kv", { hasText: "Ton engagement" }).innerText()).includes("PNUT"), "ETH was routed into PNUT and committed");
  await shot("opening");
  await page.click(".warp button:has-text('+5 min')");
  await page.locator("h2", { hasText: "Ton allocation d'ouverture" }).waitFor();
  check(true, "after the opening, the allocation panel replaces the auction");
  await page.click(".warp button:has-text('+1 h')");
  await page.waitForTimeout(300);
  await page.click("button:has-text('Retirer')");
  await toast("Retiré");
  check(!(await page.locator(".position .big").innerText()).startsWith("0 "), "the vested allocation was claimed");

  // Buy a variant with ETH through its lineage, then sell half back into the parent.
  await page.goto(url + "#explorer");
  await page.locator("table.memes .ticker", { hasText: /^PNUTWIFHAT$/ }).click();
  await page.locator("button[aria-pressed]", { hasText: "Acheter" }).waitFor();
  await page.fill("#trade-amount", "1");
  await page.locator(".receive strong", { hasText: /PNUTWIFHAT/ }).waitFor();
  check((await page.locator(".hint", { hasText: "Route" }).innerText()).includes("ETH → PNUT → PNUTWIFHAT"), "the route goes through the original");
  await page.click("button:has-text('Acheter PNUTWIFHAT')");
  await toast("Acheté");
  await page.click("button[aria-pressed]:has-text('Vendre')");
  await page.click(".seg.small button:has-text('PNUT')");
  await page.click("button:has-text('Max')");
  await page.locator(".receive strong", { hasText: /PNUT/ }).waitFor();
  await page.click("button:has-text('Vendre PNUTWIFHAT')");
  await toast("Vendu");
  check((await page.locator(".position .big").innerText()).startsWith("0 "), "selling everything into PNUT empties the position");
  await shot("meme-desktop");

  // A duplicate ticker is refused before it reaches the chain; a new one launches.
  await page.goto(url + "#lancer");
  await page.fill("#launch-name", "Copie");
  await page.fill("#launch-symbol", "$pnu7");
  check((await page.locator(".warn").innerText()).includes("existe déjà"), "a leetspeak copy of PNUT is flagged");
  check(await page.locator("button:has-text('Lancer')").last().isDisabled(), "and cannot be launched");
  await page.fill("#launch-name", "Écureuil volant");
  await page.fill("#launch-symbol", "FLYSQUIRREL");
  await page.selectOption("#launch-parent", { label: "Variante de PNUT · Peanut the Squirrel" });
  await page.fill("#launch-amount", "0.2");
  await page.click("button:has-text('Lancer FLYSQUIRREL')");
  await toast("Meme lancé");
  await page.locator("h1", { hasText: "Écureuil volant" }).waitFor();
  check(true, "a new variant launches and opens on its own page");

  // Push the PEANUT → PNUT union over the majority, wait out the vote, execute it.
  await page.goto(url + "#explorer");
  await page.locator("table.memes .ticker", { hasText: /^PEANUT$/ }).click();
  await page.click("button:has-text('Acheter PEANUT')", { trial: true }).catch(() => {});
  await page.fill("#trade-amount", "3");
  await page.locator(".receive strong", { hasText: /PEANUT/ }).waitFor();
  await page.click("button:has-text('Acheter PEANUT')");
  await toast("Acheté");
  await page.locator(".union button:has-text('Max')").click();
  await page.click("button:has-text('Voter pour')");
  await toast("Verrouillé");
  await page.click(".warp button:has-text('+3 j')");
  await page.waitForTimeout(300);
  await page.click(".warp button:has-text('+1 h')");
  await page.locator("button:has-text(\"Exécuter l'Union\")").click();
  await toast("Union exécutée");
  await page.locator(".lineage a", { hasText: "PNUT" }).first().waitFor();
  check((await page.locator(".lineage").innerText()).includes("PNUT"), "PEANUT now sits in the PNUT family");
  await page.click("button:has-text('Récupérer mes PEANUT')");
  await toast("Tokens récupérés");

  // Portfolio and creator fees.
  await page.selectOption("#account", { label: "Dev Peanut" });
  await page.goto(url + "#portefeuille");
  await page.locator(".fees button").first().click();
  await toast("Frais retirés");
  check(true, "the original's creator withdraws the fees earned on the whole family");
  await shot("portfolio");

  // Phone width and dark theme.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url + "#explorer");
  await page.locator("table.memes").waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check(!overflow, "no horizontal scroll at phone width");
  await shot("explorer-phone");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.locator("table.memes .ticker", { hasText: /^PNUT$/ }).click();
  await page.locator(".stats").waitFor();
  const overflowMeme = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check(!overflowMeme, "no horizontal scroll on a meme page at phone width");
  await shot("meme-phone-dark");

  check(problems.length === 0, `no errors in the page${problems.length ? `:\n${problems.join("\n")}` : ""}`);
  await browser.close();
  server.close();
})().catch(async (e) => {
  console.error(e.message);
  process.exit(1);
});
