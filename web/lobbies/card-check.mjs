// Checks the birth card in Chromium: drawn at 1200 × 630 with the coin's logo and the founder's number, shown in
// its sheet, saved as a PNG, shared through the device's share sheet where there is one (with the image and its
// caption), its caption copied where there is not, and offered only to founders.
// Usage: node web/lobbies/card-check.mjs   (after npm run build:lobbies)

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
async function open(query, { share = false, width = 1440 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, permissions: ["clipboard-read", "clipboard-write"], acceptDownloads: true });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  if (share) await page.addInitScript(() => {
    window.__shared = [];
    navigator.canShare = (d) => !!d?.files?.length;
    navigator.share = async (d) => { window.__shared.push({ text: d.text, title: d.title, files: d.files.map((f) => ({ name: f.name, type: f.type, size: f.size })) }); };
  });
  await page.goto(`${app}?freeze&scene=${query}`);
  await page.waitForTimeout(600);
  return page;
}

{
  const page = await open("launch-founder");
  await page.getByRole("button", { name: "Share birth card" }).click();
  const img = page.getByRole("img", { name: /Birth card: practice lobby, Founder #\d+ of \$WIF/ });
  check(await img.waitFor({ timeout: 5000 }).then(() => true, () => false), "the founder's card is drawn and shown, described for screen readers");
  const facts = await img.evaluate(async (el) => {
    const c = document.createElement("canvas");
    c.width = el.naturalWidth; c.height = el.naturalHeight;
    const g = c.getContext("2d");
    g.drawImage(el, 0, 0);
    const px = (x, y) => [...g.getImageData(x, y, 1, 1).data];
    return { w: el.naturalWidth, h: el.naturalHeight, coin: px(300, 315), ground: px(20, 610), text: px(640, 300) };
  });
  check(facts.w === 1200 && facts.h === 630, "1200 × 630, the size link previews use");
  check(facts.coin.slice(0, 3).some((v) => v > 60) && facts.ground.slice(0, 3).every((v) => v < 40), "the coin's logo sits in its glow on black");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save image" }).click()]);
  const path = await download.path();
  const bytes = readFileSync(path);
  check(/^founder-\d+-wif\.png$/.test(download.suggestedFilename()) && bytes.subarray(1, 4).toString() === "PNG", `Save image gives a PNG named for the founder (${download.suggestedFilename()})`);
  check(await page.getByText("Image saved").isVisible(), "and says it is saved");
  await page.getByRole("button", { name: "Copy caption" }).click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check(/^I’m Founder #\d+ of \$WIF in a Community Coin practice lobby\. \d+ of us picked it together in one hour\. http:\/\/localhost:\d+\/index\.html$/.test(clip), "without a share sheet, the caption (saying it was practice, with the way to the app) can be copied");
  check(await page.getByRole("dialog").isVisible(), "the sheet stays open after saving and copying");
  await page.getByRole("button", { name: "Story" }).click();
  await page.getByText("Story card ready").waitFor({ state: "attached", timeout: 5000 });
  const story = await page.getByRole("img", { name: /Birth card/ }).evaluate(async (el) => { await el.decode().catch(() => {}); return [el.naturalWidth, el.naturalHeight]; });
  check(story[0] === 1080 && story[1] === 1920, "Story draws the card at 1080 × 1920 for stories");
  check((await page.getByRole("img", { name: /Birth card/ }).getAttribute("alt")).includes("raised"), "the alt text says everything the card says");
  check(page.errors.length === 0, "no script errors");
  await page.context().close();
}
{
  const page = await open("sheet-card", { share: true, width: 390 });
  await page.getByRole("img", { name: /Birth card/ }).waitFor({ timeout: 5000 });
  check(await page.getByRole("button", { name: "Share…" }).isVisible(), "on a device that shares files, Share… comes first");
  await page.getByRole("button", { name: "Share…" }).click();
  await page.waitForTimeout(300);
  const shared = await page.evaluate(() => window.__shared);
  check(shared.length === 1 && shared[0].files[0].type === "image/png" && shared[0].files[0].size > 20000 && /^I’m Founder #/.test(shared[0].text), "sharing hands over the image and its caption");
  check(await page.getByText("Shared").isVisible(), "and confirms");
  await page.context().close();
}
{
  const page = await open("launch-refund");
  check((await page.getByRole("button", { name: "Share birth card" }).count()) === 0, "someone refunded has no card to share: only founders do");
  await page.context().close();
}

await browser.close();
files.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
