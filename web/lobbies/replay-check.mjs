// Checks the race over the hour and its replay: the samples (src/race/curve.js), the race read between them and its
// changes of leader; then in the app, the hour in 30 seconds from the launch screen, what happened in words, playing
// and pausing, a still image for less motion, and a video made on the device. Live, the server keeps the curve and
// hands it to a late joiner.
// Usage: node web/lobbies/replay-check.mjs   (after npm run build:lobbies)

import { createRequire } from "node:module";
import http from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { addSample, standingsAt, leadChanges, CURVE_STEP } from "./src/race/curve.js";
import { createDemoLobby } from "./src/demo/lobby.js";
import { trend } from "./src/demo/select.js";
import { createServer } from "./server/server.mjs";
import { simulatedSource } from "./server/sources.mjs";
import { connectLobby } from "./src/realtime/client.js";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
let failures = 0;
const check = (cond, msg) => { if (cond) console.log(`  ok  ${msg}`); else { failures++; console.log(`FAIL  ${msg}`); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ the curve, without a browser
{
  let c = [];
  for (let t = 0; t <= 60; t++) c = addSample(c, t, { A: t, B: 30 });
  check(c.length >= 4 && c.length <= 6 && c.every((p, i) => !i || p.t - c[i - 1].t <= CURVE_STEP), "one sample per 15 s at most, none skipped");
  check(c[c.length - 1].t === 60 && c[c.length - 1].v.A === 60, "the last sample is always the latest");
  check(addSample(c, 10, { A: 1, B: 1 }) === c, "the clock never runs back");
  check(addSample(c, 61, { A: 60, B: 30 }) === c, "nothing changed, nothing added");
  const s = standingsAt([{ t: 0, v: { A: 0, B: 10 } }, { t: 100, v: { A: 20, B: 10 } }], 75);
  check(s.map((x) => x.ticker).join() === "A,B" && s[0].sol === 15, "between samples, the straight line, leader first");
  check(JSON.stringify(leadChanges([{ t: 0, v: { A: 0, B: 1 } }, { t: 1, v: { A: 2, B: 1 } }, { t: 2, v: { A: 3, B: 1 } }])) === '[{"t":0,"ticker":"B"},{"t":1,"ticker":"A"}]', "each change of leader, once");
  let big = [];
  for (let t = 0; t < 20000; t += 16) big = addSample(big, t, { A: t });
  check(big.length <= 260, `a long hour stays small (${big.length} samples)`);
  const demo = createDemoLobby();
  const end = demo.seedCurve[demo.seedCurve.length - 1].v;
  check(demo.ideas.every((d) => Math.abs(end[d.symbol] - Number(d.pledged) / 1e9) < 0.001), "the demo's curve ends on the chain's own totals");
  check(leadChanges(demo.seedCurve).map((x) => x.ticker).join(" ") === "POPCAT WIF", "in the demo, $POPCAT leads early and $WIF overtakes");
  const curve = [{ t: 0, v: { A: 0 } }, { t: 600, v: { A: 4 } }, { t: 1200, v: { A: 10 } }];
  const tr = trend({ curve }, "A");
  check(tr.points.length === 3 && tr.text === "up 6.0 SOL in the last 10 minutes", "an idea's curve, and what it gained in the last ten minutes, in words");
  check(trend({ curve: [{ t: 0, v: { A: 1 } }, { t: 300, v: { A: 1, B: 1 } }, { t: 900, v: { A: 1, B: 2 } }] }, "A").text === "no new SOL in the last 10 minutes", "a still idea says so");
  check(trend({ curve: curve.slice(0, 1) }, "A") === null, "no curve before two samples");
  check(trend({ curve: [{ t: 0, v: { A: 0 } }, { t: 1439, v: { A: 171 } }, { t: 3010, v: { A: 171.2 } }] }, "A").text === null, "a gap in the samples (the server joined late) is never put into words");
}

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "dist", "lobbies");
const shots = join(dist, "shots");
mkdirSync(shots, { recursive: true });
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

async function open(query, { width = 1440, height = 900, reducedMotion = "no-preference", ms = 4000 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion, acceptDownloads: true });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.addInitScript((ms) => { window.__replayMs = ms; }, ms);
  await page.goto(`${app}${query}`);
  await page.waitForTimeout(700);
  return page;
}
const sheet = (page) => page.getByRole("dialog", { name: "The hour in 30 seconds" });
// The canvas's pixels: how much of it is not black (a drawn frame) and a cheap fingerprint of the frame.
const pixels = (page) => page.evaluate(() => {
  const c = document.querySelector(".replay canvas");
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let lit = 0, sum = 0;
  for (let i = 0; i < d.length; i += 4 * 97) { if (d[i] + d[i + 1] + d[i + 2] > 60) lit++; sum = (sum + d[i] * 3 + d[i + 1] * 7 + d[i + 2]) % 1e9; }
  return { lit, sum };
});

{
  // Each idea's small curve, and its words for a screen reader.
  const page = await open("?freeze&scene=lobby");
  check(await page.locator(".idea .spark").count() === 5, "every idea in the race has its curve");
  check(await page.getByRole("button", { name: /dogwifhat.*up [\d.]+ SOL in the last 10 minutes/ }).count() === 1, "and says what it gained, in words");
  await page.context().close();
}
{
  const page = await open("?freeze&scene=launch-founder");
  const open1 = page.getByRole("button", { name: "Watch the hour in 30 seconds" });
  check(await open1.isVisible(), "the launch screen offers the hour in 30 seconds");
  await open1.click();
  check(await sheet(page).isVisible(), "it opens the replay");
  await page.waitForTimeout(900);
  const a1 = await pixels(page);
  await page.screenshot({ path: join(shots, "replay-mid-1440.png") });
  await page.waitForTimeout(500);
  const a2 = await pixels(page);
  check(a1.lit > 50 && a1.sum !== a2.sum, "it plays by itself: the frames move");
  const story = sheet(page).getByRole("list", { name: "What happened" });
  check(await story.getByText("$POPCAT leads").isVisible() && await story.getByText("$WIF takes the lead").isVisible(), "what happened, in words: who led, who overtook");
  check(await story.getByText(/Pledges lock · \$WIF wins with/).isVisible() && await story.getByText("$WIF launches").isVisible(), "the lock and the launch");
  await page.getByRole("button", { name: "Pause" }).click();
  const p1 = await pixels(page);
  await page.waitForTimeout(400);
  check((await pixels(page)).sum === p1.sum, "Pause stops it");
  await page.getByRole("button", { name: /Resume/ }).click();
  await page.waitForTimeout(3600);
  check(await page.getByRole("button", { name: /^Play/ }).isVisible(), "at the end, Play again");
  await page.screenshot({ path: join(shots, "replay-end-1440.png") });
  // A video, made on this device.
  await page.getByRole("button", { name: "Make a video" }).click();
  check(await page.getByText(/Recording… \d+ s/).isVisible() && await page.getByRole("button", { name: "Recording the replay" }).isVisible(), "making the video shows how long is left; its name stays still for screen readers");
  check(await page.getByRole("button", { name: "Save video" }).waitFor({ timeout: 9000 }).then(() => true, () => false), "then offers to save it");
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 3000 }).catch(() => null), page.getByRole("button", { name: "Save video" }).click()]);
  const size = dl ? readFileSync(await dl.path()).length : 0;
  check(!!dl && /^lobby-replay-wif\.(webm|mp4)$/.test(dl.suggestedFilename()) && size > 10_000, `the video saves (${dl?.suggestedFilename()}, ${Math.round(size / 1024)} KB)`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  check(await page.evaluate(() => document.activeElement?.classList.contains("replay-open")), "closing it gives focus back to the button that opened it");
  check(page.errors.length === 0, `no script errors${page.errors.length ? `: ${page.errors.join(" | ")}` : ""}`);
  await page.context().close();
}
{
  const page = await open("?freeze&scene=launch-founder", { reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Watch the hour in 30 seconds" }).click();
  await page.waitForTimeout(700);
  const a1 = await pixels(page);
  await page.waitForTimeout(500);
  check(a1.lit > 50 && (await pixels(page)).sum === a1.sum && await page.getByRole("button", { name: /^Play/ }).isVisible(), "less motion: a still of the launch, and Play to watch it");
  await page.context().close();
}
{
  const page = await open("?freeze&scene=launch-refund", { width: 390, height: 844 });
  await page.getByRole("button", { name: "Watch the hour in 30 seconds" }).click();
  await page.waitForTimeout(600);
  const box = await page.locator(".replay canvas").boundingBox();
  check(box && box.x >= 0 && box.x + box.width <= 390 && box.width > 250, "phone: the replay fits, and is big enough to watch");
  const act = await page.getByRole("button", { name: /Pause|Play/ }).boundingBox();
  check(act && act.y + act.height <= 844, "its controls are on screen");
  await page.screenshot({ path: join(shots, "replay-390.png") });
  await page.context().close();
}

// ------------------------------------------------------------------ live: the server keeps the curve
{
  const source = simulatedSource({ everySec: 1 });
  const server = await createServer({ guests: true, batchMs: 30, lobbies: [{ id: 412, opensAt: Date.now() - 2000 * 1000, source }] });
  const base = `http://localhost:${server.port}`;
  const first = [];
  const c1 = connectLobby({ base, lobby: 412, token: server.auth.issue("early"), onMessage: (m) => first.push(m) });
  await wait(2500);
  const late = [];
  const c2 = connectLobby({ base, lobby: 412, token: server.auth.issue("late"), onMessage: (m) => late.push(m) });
  await wait(400);
  const hello = late.find((m) => m.t === "hello");
  check(Array.isArray(hello?.curve) && hello.curve.length > 10, `a late joiner gets the race so far (${hello?.curve?.length} samples)`);
  const now = Math.floor((hello.now - hello.opensAt) / 1000);
  check(hello.curve.every((p) => p.t <= now), "never samples from the future");
  const lastRace = hello.race.find((r) => r.symbol === "WIF");
  check(Math.abs(hello.curve[hello.curve.length - 1].v.WIF - Number(lastRace.pledged) / 1e9) < 0.01, "its last sample is the race now");
  c1.close(); c2.close();
  await server.close();
}

await browser.close();
files.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
