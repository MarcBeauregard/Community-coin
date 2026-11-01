// Checks reminders for a lobby that hasn't opened: the sheet says when it opens and what each kind of reminder can
// do; Notify me asks the browser, then a notification comes 5 minutes before the opening (the page's clock is
// fast-forwarded), kept across a reload; a refusal is explained; the calendar file has the hour and its alarm.
// Usage: node web/lobbies/remind-check.mjs   (after npm run build:lobbies)

import { createRequire } from "node:module";
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { nextOpening, icsFor, googleCalendarUrl, armReminders } from "./src/remind/remind.js";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
let failures = 0;
const check = (cond, msg) => { if (cond) console.log(`  ok  ${msg}`); else { failures++; console.log(`FAIL  ${msg}`); } };

// ------------------------------------------------------------------ without a browser
{
  const now = new Date(2026, 10, 1, 20, 10).getTime();
  check(nextOpening("21:00", now) === new Date(2026, 10, 1, 21, 0).getTime(), "21:00 later today is today");
  check(nextOpening("09:00", now) === new Date(2026, 10, 2, 9, 0).getTime(), "an hour already past is tomorrow's");
  const lobby = { id: "arc", name: "Retro Arcade Hour", theme: "8-bit mascots, chiptune pitches on stage.", host: "pixel" };
  const at = Date.UTC(2026, 10, 1, 21, 0);
  const ics = icsFor(lobby, at, "https://example.org/lobbies/");
  check(ics.includes("DTSTART:20261101T210000Z") && ics.includes("DTEND:20261101T220000Z") && ics.includes("TRIGGER:-PT5M"), "the calendar event is the lobby's hour, with an alarm 5 minutes before");
  check(ics.includes("SUMMARY:Retro Arcade Hour · Community Coin lobby") && ics.includes("8-bit mascots\\, chiptune") && ics.split("\r\n").length > 10, "named, its text escaped, lines as calendars expect");
  const g = new URL(googleCalendarUrl(lobby, at, "https://example.org/"));
  check(g.hostname === "calendar.google.com" && g.searchParams.get("dates") === "20261101T210000Z/20261101T220000Z", "and a Google Calendar link for the same hour");
  const fired = [];
  const off = armReminders({ a: { at: Date.now() + 5 * 60_000 + 30, notify: true }, b: { at: Date.now() - 1, notify: true }, c: { at: Date.now() + 9e5, notify: false } }, (id) => fired.push(id));
  await new Promise((r) => setTimeout(r, 120));
  off();
  check(fired.join() === "a", "a reminder fires 5 minutes before; a past one, or one without notifications, never");
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

// A page whose clock starts at 20:10 local, with a stand-in for the browser's notifications. `answer`: what the
// person says when asked ("granted" | "denied"), or null for a browser without notifications.
async function open({ answer = "granted", context = null, width = 1440 } = {}) {
  const ctx = context ?? await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.clock.install({ time: new Date(2026, 10, 1, 20, 10) });
  await page.addInitScript((answer) => {
    window.__shown = [];
    if (answer === null) { delete window.Notification; return; }
    const saved = localStorage.getItem("__perm") ?? "default";
    class N { constructor(title, opts) { window.__shown.push({ title, ...opts }); } close() {} }
    N.permission = saved;
    N.requestPermission = async () => { N.permission = answer; localStorage.setItem("__perm", answer); return answer; };
    window.Notification = N;
  }, answer);
  await page.goto(`${app}?freeze`);
  await page.clock.runFor(800);
  return page;
}
const sheet = (page) => page.getByRole("dialog", { name: "Remind me" });

{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  let page = await open({ context });
  const card = page.locator("article, li, .lobby-card, .card").filter({ hasText: "Retro Arcade Hour" }).first();
  await card.getByRole("button", { name: /Remind/ }).click();
  check(await sheet(page).isVisible(), "Remind opens the reminder sheet");
  check(await sheet(page).getByText(/Opens today at (0?9:00 PM|21:00) · hosted by @pixel/).isVisible(), "it says when the lobby opens");
  check(await sheet(page).getByText("From this page: keep a tab of it open.", { exact: false }).isVisible(), "and, honestly, what a notification from a page can do");
  await sheet(page).getByRole("button", { name: "Notify me" }).click();
  check(await sheet(page).getByText(/Notification at (0?8:55 PM|20:55)/).isVisible(), "allowed: the notification is set for 5 minutes before");
  await page.keyboard.press("Escape");
  check(await card.getByRole("button", { name: /^On$|Reminder on/ }).isVisible(), "the lobby's card shows the reminder on");
  await page.close();
  // Reloaded: the reminder is still there, and still fires.
  page = await open({ context });
  await page.clock.runFor(45 * 60 * 1000 + 300);
  const shown = await page.evaluate(() => window.__shown);
  check(shown.length === 1 && shown[0].title === "Retro Arcade Hour opens in 5 minutes", `kept across a reload, the notification comes at 20:55 (${shown.map((n) => n.title).join(" | ")})`);
  check(await page.getByText("Retro Arcade Hour opens in 5 minutes").first().isVisible(), "and the open page says it too");
  // Off.
  await page.locator("article, li, .lobby-card, .card").filter({ hasText: "Retro Arcade Hour" }).first().getByRole("button", { name: /^On$|Reminder on/ }).click();
  await sheet(page).getByRole("button", { name: "Turn off" }).click();
  check(await sheet(page).getByRole("button", { name: "Notify me" }).isVisible(), "Turn off turns it off");
  check(page.errors.length === 0, `no script errors${page.errors.length ? `: ${page.errors.join(" | ")}` : ""}`);
  await context.close();
}
{
  const page = await open({ answer: "denied" });
  await page.locator("article, li, .lobby-card, .card").filter({ hasText: "Retro Arcade Hour" }).first().getByRole("button", { name: /Remind/ }).click();
  await sheet(page).getByRole("button", { name: "Notify me" }).click();
  check(await sheet(page).getByRole("alert").filter({ hasText: "Notifications are blocked for this site" }).isVisible(), "refused: it says how to allow them, or to use the calendar");
  // The calendar, one tap.
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 3000 }).catch(() => null), sheet(page).getByRole("button", { name: "Other calendars" }).click()]);
  const ics = dl ? readFileSync(await dl.path(), "utf8") : "";
  check(dl?.suggestedFilename() === "retro-arcade-hour.ics" && ics.includes("BEGIN:VEVENT") && ics.includes("TRIGGER:-PT5M"), "Other calendars saves the event with its alarm");
  const g = sheet(page).getByRole("link", { name: /Google Calendar/ });
  check((await g.getAttribute("href")).startsWith("https://calendar.google.com/calendar/render?") && await g.getAttribute("target") === "_blank", "Google Calendar opens its new-event page");
  await page.context().close();
}
{
  const page = await open({ answer: null, width: 390 });
  await page.getByRole("button", { name: "Remind me when it opens" }).first().click();
  await sheet(page).getByRole("button", { name: "Notify me" }).click();
  check(await sheet(page).getByRole("alert").filter({ hasText: "can’t show notifications" }).isVisible(), "a browser without notifications says so, and points to the calendar");
  const box = await sheet(page).boundingBox();
  check(box && box.x >= 0 && box.x + box.width <= 390, "phone: the sheet fits");
  await page.context().close();
}

await browser.close();
files.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
