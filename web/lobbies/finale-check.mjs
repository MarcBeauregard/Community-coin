// Checks the last five minutes of a lobby (00:50 to 00:55): the live gap between the top two, the lock countdown
// that takes over the clock, the offer to move a pledge that is out of the top two (one gesture, or set aside), the
// tap on phones when the lead changes, and nothing of it for someone who asked for less motion.
// Usage: node web/lobbies/finale-check.mjs   (after npm run build:lobbies)

import { createRequire } from "node:module";
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { finale } from "./src/demo/select.js";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
let failures = 0;
const check = (cond, msg) => { if (cond) console.log(`  ok  ${msg}`); else { failures++; console.log(`FAIL  ${msg}`); } };

// ------------------------------------------------------------------ the rules, without a browser
{
  const ideas = [{ id: "a", ticker: "A", total: 10, rank: 1 }, { id: "b", ticker: "B", total: 6.8, rank: 2 }, { id: "c", ticker: "C", total: 3, rank: 3 }];
  const at = (elapsed, more = {}) => finale({ elapsed, launched: null, pledge: null, nudgeOff: null, ...more }, ideas);
  check(at(2999) === null && at(3300) === null, "the finale is 00:50 to 00:55, not before, not after the lock");
  check(at(3000)?.text === "$A leads $B by 3.2 SOL", "it says who leads whom, by how much");
  check(at(3000).lockIn === "05:00" && !at(3000).urgent && at(3240).urgent, "it counts down to the lock, urgent in the last minute");
  check(at(3100, { pledge: { symbol: "C", amount: 2 } }).nudge?.text === "$C is 3rd. Move your 2.0 SOL to $A?", "a pledge out of the top two is offered a move to the leader");
  check(at(3100, { pledge: { symbol: "B", amount: 2 } }).nudge === null, "a pledge in the top two is left alone");
  check(at(3100, { pledge: { symbol: "C", amount: 2 }, nudgeOff: "C" }).nudge === null, "set aside, the offer stays away for that pledge");
  const tie = finale({ elapsed: 3100, launched: null, pledge: null }, [{ ...ideas[0], total: 5 }, { ...ideas[1], total: 5.01 }]);
  check(tie.tied && tie.text === "$A and $B are tied", "a gap under 0.1 SOL reads as a tie");
}

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

async function open(query, { width = 1440, height = 900, reducedMotion = "no-preference" } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion, hasTouch: width < 600, isMobile: width < 600 });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.addInitScript(() => { window.__buzz = []; navigator.vibrate = (p) => { window.__buzz.push(p); return true; }; });
  await page.goto(`${app}${query}`);
  await page.waitForTimeout(700);
  return page;
}
const visible = (loc) => loc.first().waitFor({ timeout: 3000 }).then(() => true, () => false);

{
  const page = await open("?freeze&scene=lobby-backed");
  check(await page.locator(".finale").count() === 0, "earlier in the hour there is no finale");
  check(await page.getByRole("timer", { name: /^Launch in/ }).isVisible(), "and the clock counts to the launch");
  await page.context().close();
}
{
  // A desktop never vibrates, even after clicks.
  const page = await open("?freeze&scene=lobby-finale-close");
  await page.locator(".idea", { hasText: "Popcat" }).click();
  await page.getByRole("group", { name: "Pledge amount in SOL" }).getByRole("button", { name: "5", exact: true }).click();
  await page.getByRole("button", { name: /^Pledge/ }).click();
  await page.getByRole("button", { name: /^Confirm/ }).click();
  check(await visible(page.getByText("$POPCAT leads $WIF by 1.8 SOL")) && (await page.evaluate(() => window.__buzz)).length === 0, "desktop: the lead changes without any vibration");
  await page.context().close();
}
{
  const page = await open("?freeze&scene=lobby-finale");
  const panel = page.getByRole("region", { name: "Final minutes" });
  check(await visible(panel), "at 00:51 the ideas open on the final minutes");
  check(await panel.getByText("$WIF leads $POPCAT by 52.6 SOL").isVisible(), "with the live gap between the top two");
  check(await page.getByRole("timer", { name: "Pledges lock in 04:00" }).isVisible(), "the clock now counts to the lock");
  check(await panel.getByText("$BRETT is 4th. Move your 2.0 SOL to $WIF?").isVisible(), "a pledge in 4th is offered a move to the leader");
  await panel.getByRole("button", { name: "Move to $WIF" }).click();
  check(await visible(page.getByText("Backing with 2.0 SOL")), "one tap moves it: the dock shows the pledge on $WIF");
  check(await page.getByText(/Moved your 2\.0 SOL to \$WIF/).first().isVisible(), "and says so");
  check(await panel.getByText(/Move your/).count() === 0, "the offer is gone once the pledge leads");
  check(page.errors.length === 0, `no script errors${page.errors.length ? `: ${page.errors.join(" | ")}` : ""}`);
  await page.context().close();
}
{
  const page = await open("?freeze&scene=lobby-finale");
  await page.getByRole("button", { name: "Keep it" }).click();
  check(await page.getByText(/Move your/).count() === 0 && await page.getByText(/Backing with 2\.0 SOL/).isVisible(), "Keep it sets the offer aside, the pledge stays where it was");
  await page.context().close();
}
{
  // A phone: the lead changes under the person's own pledge, and the phone taps once.
  const page = await open("?freeze&scene=lobby-finale-close", { width: 390, height: 844 });
  const panel = page.getByRole("region", { name: "Final minutes" });
  check(await visible(panel.getByText("$WIF leads $POPCAT by 3.2 SOL")), "phone: the finale is at the top of the ideas");
  check((await page.evaluate(() => window.__buzz)).length === 0, "before the person touches the page, no vibration (browsers refuse it)");
  await page.locator(".idea", { hasText: "Popcat" }).click();
  await page.getByRole("group", { name: "Pledge amount in SOL" }).getByRole("button", { name: "5", exact: true }).click();
  await page.getByRole("button", { name: /^Pledge/ }).click();
  await page.getByRole("button", { name: /^Confirm/ }).click();
  check(await visible(panel.getByText("$POPCAT leads $WIF by 1.8 SOL")), "a pledge turns the race, the gap follows");
  check(await page.getByRole("status").filter({ hasText: "$POPCAT leads" }).count() === 1, "a screen reader hears the new leader");
  check(JSON.stringify(await page.evaluate(() => window.__buzz)) === "[[30,60,30]]", "and the phone taps for the lead change");
  const box = await panel.boundingBox();
  check(box && box.x >= 0 && box.x + box.width <= 390, "the panel fits the phone");
  check(page.errors.length === 0, `no script errors (phone)${page.errors.length ? `: ${page.errors.join(" | ")}` : ""}`);
  await page.context().close();
}
{
  const page = await open("?freeze&scene=lobby-finale-close", { width: 390, height: 844, reducedMotion: "reduce" });
  check(await visible(page.getByRole("region", { name: "Final minutes" })), "less motion: the finale is still there");
  await page.locator(".idea", { hasText: "Popcat" }).click();
  await page.getByRole("group", { name: "Pledge amount in SOL" }).getByRole("button", { name: "5", exact: true }).click();
  await page.getByRole("button", { name: /^Pledge/ }).click();
  await page.getByRole("button", { name: /^Confirm/ }).click();
  check(await visible(page.getByText("$POPCAT leads $WIF by 1.8 SOL")), "the lead changes");
  check((await page.evaluate(() => window.__buzz)).length === 0, "but the phone never vibrates");
  await page.context().close();
}

await browser.close();
files.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
