// Checks the first minute in a lobby: three short cards on how it works, shown once, by keyboard and on a phone,
// never over the scenes, and gone for good once read or skipped.
// Usage: node web/lobbies/intro-check.mjs   (after npm run build:lobbies)

import { createRequire } from "node:module";
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
let failures = 0;
const check = (cond, msg) => { if (cond) console.log(`  ok  ${msg}`); else { failures++; console.log(`FAIL  ${msg}`); } };

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

async function open(query, { width = 1440, height = 900, context = null } = {}) {
  const ctx = context ?? await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto(`${app}${query}`);
  await page.waitForTimeout(700);
  return page;
}
const intro = (page) => page.getByRole("region", { name: "How a lobby works" });

{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let page = await open("?freeze#/lobby", { context });
  check(await intro(page).isVisible(), "a first visit to a lobby opens on how it works");
  check(await intro(page).getByText("1 of 3").isVisible() && await intro(page).getByRole("heading", { name: "Your pledge is your vote" }).isVisible(), "card 1: your pledge is your vote");
  check(await page.getByRole("button", { name: /^Pledge/ }).first().isEnabled(), "the lobby stays usable around it");
  await intro(page).getByRole("button", { name: "Next" }).click();
  check(await intro(page).getByRole("heading", { name: "Lost? Refunded at the lock" }).isVisible(), "card 2: lost, refunded at 00:55");
  await intro(page).getByRole("button", { name: "Next" }).click();
  check(await intro(page).getByRole("heading", { name: "Won? You’re a founder" }).isVisible() && await intro(page).getByRole("button", { name: "Skip" }).count() === 0, "card 3: won, a founder; no Skip on the last card");
  await intro(page).getByRole("button", { name: "Got it" }).click();
  check(await intro(page).count() === 0, "Got it closes it");
  await page.reload();
  await page.waitForTimeout(500);
  check(await intro(page).count() === 0, "and it does not come back");
  check(page.errors.length === 0, `no script errors${page.errors.length ? `: ${page.errors.join(" | ")}` : ""}`);
  await context.close();
}
{
  const page = await open("?freeze#/lobby");
  await intro(page).getByRole("button", { name: "Skip" }).click();
  await page.reload();
  await page.waitForTimeout(500);
  check(await intro(page).count() === 0, "Skip on the first card is for good too");
  await page.context().close();
}
{
  // Keyboard: Next keeps focus on the button, the last one hands it to the race.
  const page = await open("?freeze#/lobby");
  await intro(page).getByRole("button", { name: "Next" }).focus();
  await page.keyboard.press("Enter");
  check(await page.evaluate(() => document.activeElement?.textContent) === "Next", "keyboard: focus stays on Next");
  await page.keyboard.press("Enter");
  check(await page.evaluate(() => document.activeElement?.textContent) === "Got it", "and lands on Got it");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(100);
  check(await page.evaluate(() => document.activeElement?.classList.contains("idea")), "closing it puts focus on the first idea");
  await page.context().close();
}
{
  const page = await open("?freeze#/lobby", { width: 390, height: 844 });
  const box = await intro(page).boundingBox();
  check(box && box.x >= 0 && box.x + box.width <= 390, "phone: the cards fit");
  const pledge = await page.getByRole("button", { name: /^Pledge/ }).first().boundingBox();
  check(pledge && pledge.y + pledge.height <= 844, "and the Pledge button stays on screen");
  await page.context().close();
}
{
  const page = await open("?freeze&scene=lobby");
  check(await intro(page).count() === 0, "scenes (screenshots) never show it");
  await page.context().close();
}

await browser.close();
files.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
