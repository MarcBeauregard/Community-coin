// Checks the closed beta as it is hosted: one server serves the app and its practice lobby (no ?live= needed), the
// lobby opens empty and the app says so, testers send feedback, the team reads the counts, and sessions and feedback
// survive a restart.
// Usage: node web/lobbies/beta-check.mjs   (after npm run build:lobbies)

import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "./server/server.mjs";
import { practiceSource } from "./server/sources.mjs";
import { createAuth } from "./server/auth.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
let failures = 0;
const check = (cond, msg) => { if (cond) console.log(`  ok  ${msg}`); else { failures++; console.log(`FAIL  ${msg}`); } };

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "lobbies");
const dataDir = mkdtempSync(join(tmpdir(), "beta-"));
const HOST = "Host1111111111111111111111111111111111111";
const lobby = (id, opensAt) => ({ id, opensAt, source: practiceSource({ id, host: HOST }), name: "Friday beta hour", theme: "Anything goes", hostName: "Marc" });
const t = Date.now();
const start = (more = {}) => createServer({ guests: true, devSessions: true, batchMs: 30, dataDir, staticDir: dist, statsToken: "s3cret", lobbies: [lobby(9, t - 600_000), lobby(10, t + 3_000_000)], ...more });
let server = await start();
const base = `http://localhost:${server.port}`;
const get = (path, headers = {}) => fetch(`${base}${path}`, { headers }).then(async (r) => ({ status: r.status, body: r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text() }));

// ------------------------------------------------------------------ the server, without a browser
{
  const h = await get("/health");
  check(h.status === 200 && h.body.ok && h.body.lobbies === 2, "/health answers, with its lobbies");
  const l = await get("/lobbies");
  check(l.body.current === 9 && l.body.lobbies.length === 2, "/lobbies names the lobby on now, not the next one");
  check(l.body.lobbies[0].name === "Friday beta hour" && l.body.lobbies[0].phase !== undefined, "with its name and phase");
  const page = await get("/");
  check(page.status === 200 && page.body.includes('<meta name="lobby-server" content="same-origin">'), "the app is served, and told its lobby server is this one");
  check((await get("/../../package.json")).status === 404, "nothing outside the app is served");
  check((await get("/stats")).status === 404 && (await get("/stats", { authorization: "Bearer nope" })).status === 404, "/stats is hidden without the token");
  const ideas = server.rooms.get("9").summary();
  check(ideas.inside === 0, "the practice lobby opens with nobody inside");
}

// ------------------------------------------------------------------ a tester, in a browser
const browser = await chromium.launch();
async function open(path, { width = 1440, height = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto(`${base}${path}`);
  await page.waitForTimeout(1200);
  return page;
}
const visible = (loc) => loc.first().waitFor({ timeout: 4000 }).then(() => true, () => false);
{
  const page = await open("/");
  check(await visible(page.getByText("Friday beta hour")), "the page alone joins the lobby on now: its name, from the server");
  check(await page.getByText(/Wif|Popcat|Bonk/).count() === 0, "no demo idea or crowd anywhere");
  await page.goto(`${base}/#/lobby`);
  await page.waitForTimeout(1200);
  check(await visible(page.getByText("No idea in the race yet")), "the empty lobby says there is no idea yet");
  check(await page.getByText("Hosted by Marc").count() === 1, "and who hosts it");
  await page.getByRole("button", { name: "Beta feedback" }).click();
  const sheet = page.getByRole("dialog", { name: "Beta feedback" });
  check(await visible(sheet), "the feedback sheet opens from the lobby");
  check(await sheet.getByRole("button", { name: "Send feedback" }).isDisabled(), "nothing to send before a rating or words");
  await sheet.getByRole("group", { name: "Your rating, 1 to 5" }).getByRole("button", { name: "4" }).click();
  await sheet.getByRole("textbox").fill("The empty lobby was clear. I wanted to see last hour's winner.");
  await sheet.getByRole("button", { name: "Send feedback" }).click();
  check(await visible(sheet.getByText("Your feedback reached the team.")), "it is sent, and thanked");
  await sheet.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Beta feedback" }).click();
  await sheet.getByRole("textbox").fill("again");
  await sheet.getByRole("button", { name: "Send feedback" }).click();
  check(await visible(sheet.getByRole("alert").filter({ hasText: "One message a minute" })), "a second one within the minute is refused, in words");
  check(page.errors.length === 0, `no script errors${page.errors.length ? `: ${page.errors.join(" | ")}` : ""}`);
  await page.context().close();
}
{
  // A signed-in tester proposes the first idea; a guest on a phone sees it arrive.
  const alice = await open("/?as=alice#/lobby");
  const phone = await open("/#/lobby", { width: 390, height: 844 });
  check(await visible(phone.getByText("No idea in the race yet")), "phone: the empty lobby too");
  await alice.getByRole("button", { name: "Propose", exact: true }).first().click();
  const sheet = alice.getByRole("dialog", { name: "Propose an idea" });
  await sheet.getByLabel(/Ticker/).fill("BETA");
  await sheet.getByLabel(/^Name/).fill("Beta Cat");
  await sheet.getByLabel(/pitch/).fill("The first coin of the beta");
  await sheet.getByRole("button", { name: "Put it in the race" }).click();
  await alice.waitForTimeout(800);
  check(await visible(phone.getByText("$BETA").or(phone.getByText("Beta Cat"))), "the first idea reaches everyone inside");
  check(alice.errors.length === 0 && phone.errors.length === 0, `no script errors${[...alice.errors, ...phone.errors].join(" | ")}`);
  await alice.context().close();
  await phone.context().close();
}
{
  // An hour that ends with no idea at all: nobody is stuck in it, the next lobby is one tap away.
  const ended = await createServer({ guests: true, batchMs: 30, staticDir: dist, lobbies: [
    { id: 20, opensAt: Date.now() - 3_700_000, source: practiceSource({ id: 20, host: HOST }), name: "The empty hour" },
    { id: 21, opensAt: Date.now() - 100_000, source: practiceSource({ id: 21, host: HOST }), name: "The next hour" }] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://localhost:${ended.port}/?lobby=20#/lobby`);
  check(await visible(page.getByText("No winner: every pledge is refunded")), "an hour with no idea ends with no winner, said plainly");
  check(await page.getByText("Hosted by Host…1111").count() === 1, "a host without a display name shows as a short address");
  await page.getByRole("button", { name: "Join the next lobby" }).click();
  check(await visible(page.getByRole("heading", { name: "The next hour" })), "and the next lobby is one tap away");
  check(errors.length === 0, `no script errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  await ctx.close();
  await ended.close();
}
await browser.close();

// ------------------------------------------------------------------ what the team reads
{
  const s = await get("/stats", { authorization: "Bearer s3cret" });
  check(s.status === 200 && s.body.feedback.length === 1 && s.body.feedback[0].rating === 4 && s.body.feedback[0].lobby === 9, "/stats with the token: the feedback, with its lobby");
  const l9 = s.body.lobbies.find((x) => x.id === 9);
  check(l9 && l9.visitors >= 3 && l9.proposers === 1 && l9.signedIn >= 1 && s.body.people >= 3, "and the counts: visitors, signed in, proposers");
  check(!JSON.stringify(s.body).includes("alice"), "the counts name nobody");
}
// ------------------------------------------------------------------ a restart
{
  await server.close();
  server = await start({ port: 0 });
  const s = await fetch(`http://localhost:${server.port}/stats`, { headers: { authorization: "Bearer s3cret" } }).then((r) => r.json());
  check(s.feedback.length === 1, "the feedback survives a restart");
  const secret = Buffer.from("x".repeat(40));
  const token = createAuth({ secret }).issue("bob");
  check(createAuth({ secret }).session(token)?.sub === "bob" && !createAuth().session(token), "with SESSION_SECRET a session survives a restart; without it, it doesn't");
  await server.close();
}
rmSync(dataDir, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
