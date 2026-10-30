// Checks the built lobbies app (web/dist/lobbies) in headless Chromium:
//   1. tokens.js and the CSS variables agree;
//   2. every scene renders at 390, 768, 1280 and 1440 px with no script error, no horizontal scroll, no failed
//      request, and an accessible name on every button; a screenshot of each goes to the shots directory;
//   3. the whole hour works by hand: join, propose, pledge, withdraw, pledge again, skip to lock, launch as founder,
//      enter the clan, open a channel, join Campfire, react and send a message; then the refund path.
// Usage: node web/lobbies/visual.mjs [shots-dir]   (build first: node web/lobbies/build.mjs)

import { createRequire } from "node:module";
import http from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "dist", "lobbies");
const shots = process.argv[2] || join(dist, "shots");
mkdirSync(shots, { recursive: true });

const WIDTHS = [[390, 844], [768, 1024], [1280, 800], [1440, 900]];
const SCENES = ["discover", "listening", "lobby", "lobby-stage", "lobby-chat", "lobby-backed", "lobby-locked", "sheet-pledge", "sheet-propose",
  "sheet-host", "sheet-wallet", "launch-founder", "launch-refund", "clan", "clan-voice"];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg" };

let failures = 0;
function check(cond, message) {
  if (cond) console.log(`  ok  ${message}`);
  else { failures++; console.log(`FAIL  ${message}`); }
}

const server = http.createServer((req, res) => {
  const path = join(dist, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/\/$/, "/index.html"));
  if (!path.startsWith(dist) || !existsSync(path)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" });
  res.end(readFileSync(path));
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch();

async function open(width, height, query = "") {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("response", (r) => { if (r.status() >= 400 && r.url().startsWith(base)) errors.push(`${r.status()} ${r.url()}`); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto(`${base}index.html${query}`);
  await page.waitForTimeout(700);
  return { page, errors: () => errors.filter((e) => !/fonts\.g|ERR_FAILED/.test(e)) };
}

// 1. tokens
{
  const { color } = await import(pathToFileURL(join(here, "src/tokens.js")).href);
  const { page } = await open(1440, 900, "?freeze");
  const css = await page.evaluate((names) => names.map((n) => getComputedStyle(document.documentElement).getPropertyValue(`--${n}`).trim()), Object.keys(color));
  const norm = (v) => v.replace(/\s+/g, "").toLowerCase();
  const drift = Object.keys(color).filter((k, i) => norm(css[i]) !== norm(color[k]));
  check(drift.length === 0, `tokens.js and styles.css agree${drift.length ? ` (drift: ${drift.join(", ")})` : ""}`);
  await page.close();
}

// 2. every scene at every width
for (const scene of SCENES) {
  for (const [w, h] of WIDTHS) {
    const { page, errors } = await open(w, h, `?freeze&scene=${scene}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    const unnamed = await page.evaluate(() => [...document.querySelectorAll("button")].filter((b) => !(b.getAttribute("aria-label") || b.textContent.trim())).length);
    await page.screenshot({ path: join(shots, `${scene}-${w}.png`) });
    check(errors().length === 0 && overflow <= 0 && unnamed === 0,
      `${scene} @${w}${errors().length ? ` errors: ${errors().join(" | ")}` : ""}${overflow > 0 ? ` overflow ${overflow}px` : ""}${unnamed ? ` ${unnamed} unnamed buttons` : ""}`);
    await page.close();
  }
}

// 3. the hour, by hand
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const phone = w < 900;
  const { page, errors } = await open(w, h);
  const click = (name, opts = {}) => page.getByRole("button", { name, exact: true, ...opts }).first().click();
  const balance = async () => Number((await page.locator(".wallet-pill .num").first().textContent()).replace(/[^0-9.]/g, ""));
  const start = await balance();
  await click("Join the lobby");
  check(await page.locator(".lobby").isVisible(), `@${w} joining opens the lobby`);

  await click(phone ? "Propose" : "Propose an idea");
  await page.getByPlaceholder("Pigeon Wizard").fill("Lazy Llama");
  await page.getByPlaceholder("WZRD").fill("WIF");
  check(await page.getByText("is already in the race").isVisible(), `@${w} a taken ticker is refused`);
  await page.getByPlaceholder("WZRD").fill("llama");
  await page.getByPlaceholder("Why should").fill("The llama does nothing and wins anyway.");
  await click("Put it in the race");
  check(await page.getByText("Lazy Llama").first().isVisible(), `@${w} the proposed idea joins the race`);

  await page.locator(".idea", { hasText: "dogwifhat" }).click();
  await click(phone ? "Pledge" : "Pledge 1.0 SOL");
  check(await page.getByText("Full refund at 00:55").isVisible(), `@${w} the pledge sheet says what happens if it loses`);
  await click("Confirm pledge");
  await page.waitForTimeout(1500);
  check(await page.getByText("Backing with 1.0 SOL").isVisible(), `@${w} the pledge is confirmed`);
  await click("Withdraw");
  check(await page.getByRole("button", { name: phone ? "Pledge" : "Pledge 1.0 SOL", exact: true }).isVisible(), `@${w} withdrawing frees the pledge`);
  await click(phone ? "Pledge" : "Pledge 1.0 SOL");
  await click("Confirm pledge");
  await page.waitForTimeout(1500);

  if (phone) await click("Stage");
  await click("Demo · skip to lock");
  await page.waitForTimeout(8000);
  check(await page.getByText("is alive.").isVisible(), `@${w} the winner launches at 01:00`);
  check(await page.getByText(/Welcome, Founder #/).isVisible(), `@${w} the backer of the winner is a founder`);

  await click("Enter the clan");
  if (phone) await page.locator(".mrow", { hasText: "memes" }).click();
  else await page.locator(".chan", { hasText: "memes" }).click();
  await click(phone ? "Join Campfire voice" : "Join Campfire");
  check(await page.locator(".call").isVisible(), `@${w} joining Campfire opens the call`);
  await click("Mute microphone");
  check(await page.getByRole("button", { name: "Unmute microphone" }).first().isVisible(), `@${w} mute toggles`);
  const heart = page.locator(".react").first();
  await heart.click();
  check((await heart.getAttribute("aria-pressed")) === "true", `@${w} reactions toggle`);
  await page.getByPlaceholder("Message #memes").fill("gm founders");
  await page.keyboard.press("Enter");
  check(await page.getByText("gm founders").isVisible(), `@${w} a message is sent with Enter`);
  check(errors().length === 0, `@${w} no script errors during the hour${errors().length ? `: ${errors().join(" | ")}` : ""}`);
  await page.close();
  void start;
}

// The refund path: back a loser, let it lock.
{
  const { page } = await open(1440, 900);
  await page.getByRole("button", { name: "Join the lobby" }).click();
  await page.locator(".idea", { hasText: "Floki" }).click();
  await page.getByRole("button", { name: "Pledge 1.0 SOL" }).click();
  await page.getByRole("button", { name: "Confirm pledge" }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Demo · skip to lock" }).click();
  await page.waitForTimeout(8000);
  check(await page.getByText("Your 1.0 SOL is back in your wallet").isVisible(), "a losing pledge is refunded at launch");
  await page.close();
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
