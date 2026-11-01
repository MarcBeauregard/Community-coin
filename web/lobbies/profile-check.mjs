// Checks the founder profile: the clans and the person's number in each, the ideas they proposed and what came of
// them, their lobbies and their streak; a launch adds to it; live, it is the signed-in wallet's own, kept on this
// device, and a guest sees none of the demo's.
// Usage: node web/lobbies/profile-check.mjs   (after npm run build:lobbies)

import { createRequire } from "node:module";
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "./server/server.mjs";
import { simulatedSource } from "./server/sources.mjs";

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
async function open(query, { width = 1440 } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.addInitScript(() => localStorage.setItem("lobbies.intro", "1"));
  await page.goto(`${app}${query}`);
  await page.waitForTimeout(700);
  return page;
}
const sheet = (page) => page.getByRole("dialog", { name: "Founder profile" });
const section = (page, name) => sheet(page).getByRole("region", { name });

{
  const page = await open("?freeze");
  await page.getByRole("button", { name: "Your profile" }).click();
  check(await sheet(page).isVisible(), "Your profile opens the founder profile");
  check(await sheet(page).getByText("3 lobbies in a row").isVisible(), "the streak: three lobbies with a pledge");
  const clans = section(page, "Clans");
  check(await clans.getByRole("listitem").count() === 3 && await clans.getByText("Founder #212 of 1,102").isVisible(), "each clan with the person's number in it");
  check(await section(page, "Ideas you proposed").getByText("Didn’t win · bond returned").isVisible(), "the ideas they proposed, and what came of them");
  check(await section(page, "Lobbies").getByRole("listitem").count() === 3, "their lobbies");
  await clans.getByRole("button", { name: /Bonk/ }).click();
  check(await page.getByRole("heading", { level: 1, name: /Bonk/ }).first().isVisible() && await sheet(page).count() === 0, "a clan opens from the profile");
  check(page.errors.length === 0, `no script errors${page.errors.length ? `: ${page.errors.join(" | ")}` : ""}`);
  await page.close();
}
{
  // A pledge now, an idea proposed now: both in the profile while the lobby runs.
  const page = await open("?freeze&scene=lobby-backed");
  await page.getByRole("button", { name: "Propose an idea" }).click();
  await page.getByLabel("Name").fill("Pigeon Wizard");
  await page.getByLabel("Ticker").fill("PIGW");
  await page.getByLabel(/One-line pitch/).fill("A pigeon who casts spells on the city.");
  await page.getByRole("button", { name: "Put it in the race" }).click();
  await page.waitForTimeout(300);
  await page.evaluate(() => { location.hash = "#/discover"; });
  await page.getByRole("button", { name: "Your profile" }).click();
  check(await sheet(page).getByText("4 lobbies in a row").isVisible(), "an open pledge counts in the streak");
  check(await section(page, "Lobbies").getByText(/1\.0 SOL on \$WIF · racing/).isVisible(), "the lobby running now, first");
  check(await section(page, "Ideas you proposed").getByText(/Racing · #6/).isVisible(), "and the idea just proposed, racing");
  await page.close();
}
{
  // After a launch: the new clan and the lobby, at the person's founder number.
  const page = await open("?freeze&scene=launch-founder");
  const rank = (await page.getByText(/Welcome, Founder #\d+/).textContent()).match(/#(\d+)/)[1];
  await page.goto(`${app}?freeze&scene=launch-founder#/discover`);
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Your profile" }).click();
  check(await section(page, "Lobbies").getByText(`Founder #${rank} of $WIF`).isVisible(), `the launch is in the lobbies: Founder #${rank} of $WIF`);
  check(await section(page, "Clans").getByRole("listitem").count() === 4, "and its clan with the others");
  await page.close();
}
{
  // Live as a guest: nothing of the demo's.
  const server = await createServer({ guests: true, batchMs: 50, lobbies: [{ id: 412, opensAt: Date.now() - 1452 * 1000, source: simulatedSource() }] });
  const page = await open(`?live=${encodeURIComponent(`http://localhost:${server.port}`)}#/discover`);
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Your profile" }).click();
  check(await sheet(page).getByText("Connect your wallet to see the lobbies you were in.").isVisible(), "live, a guest is asked to connect");
  check(await sheet(page).getByText(/lobbies in a row|Founder #212/).count() === 0, "and sees none of the demo's history");
  await page.close();
  await server.close();
}
{
  // A clan opens a lobby for its coin's little sibling: pinned in the clan, listed with the lobbies, said in the clan.
  const page = await open("?freeze&scene=clan");
  await page.getByRole("button", { name: "Open a sibling lobby" }).click();
  const dlg = page.getByRole("dialog", { name: "A sibling lobby" });
  check(await dlg.getByLabel("Lobby name").inputValue() === "Bonk Family Hour" && await dlg.getByLabel("Theme").inputValue() === "A little sibling for $BONK", "the sibling lobby comes named for the clan");
  await dlg.getByRole("button", { name: "Open the lobby" }).click();
  const pinned = page.getByRole("group", { name: "Sibling lobby" });
  check(await pinned.getByText("Bonk Family Hour").isVisible() && await pinned.getByText("Sibling lobby · opens 22:00").isVisible(), "it is pinned in the clan, with its hour");
  check(await page.getByText("I opened a sibling lobby for $BONK: Bonk Family Hour, at 22:00. Founders, come pitch.").isVisible(), "and said in the clan");
  await pinned.getByRole("button", { name: "Remind" }).click();
  check(await page.getByRole("dialog", { name: "Remind me" }).getByText("Bonk Family Hour").isVisible(), "its reminder is one tap away");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  await page.getByRole("button", { name: "Lobbies" }).first().click();
  check(await page.getByText("$BONK clan · you host").first().isVisible(), "it is listed with the lobbies, as the clan's");
  check(page.errors.length === 0, `no script errors (sibling)${page.errors.length ? `: ${page.errors.join(" | ")}` : ""}`);
  await page.close();
}
{
  const page = await open("?freeze&scene=clan", { width: 390 });
  check(await page.getByRole("button", { name: "Open a sibling lobby" }).isVisible(), "phone: the clan offers a sibling lobby too");
  await page.close();
}
{
  const page = await open("?freeze&scene=sheet-profile", { width: 390 });
  const box = await sheet(page).boundingBox();
  check(box && box.x >= 0 && box.x + box.width <= 390, "phone: the profile fits");
  await page.close();
}

await browser.close();
files.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
