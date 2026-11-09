// Checks the closed beta as it is hosted: one server serves the app and its practice lobby (no ?live= needed), the
// lobby opens empty and the app says so, testers send feedback, the team reads the counts, and sessions and feedback
// survive a restart.
// Usage: node web/lobbies/beta-check.mjs   (after npm run build:lobbies)

import { createRequire } from "node:module";
import http from "node:http";
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
  // Asked as written (fetch would tidy the path first): a path that climbs out of the app's folder.
  const raw = (path) => new Promise((resolve) => http.get({ host: "localhost", port: server.port, path }, (r) => { r.resume(); resolve(r.statusCode); }));
  check(await raw("/assets/../../../package.json") === 404 && await raw("/%2e%2e/%2e%2e/package.json") === 404 && await raw("/..%2f..%2fpackage.json") === 404, "nothing outside the app is served");
  check(await raw("/assets/coins/wif.png") === 200 && await raw("/app.js") === 200, "the app's own files are");
  check((await get("/stats")).status === 404 && (await get("/stats", { authorization: "Bearer nope" })).status === 404, "/stats is hidden without the token");
  const ideas = server.rooms.get("9").summary();
  check(ideas.inside === 0, "the practice lobby opens with nobody inside");
}

// ------------------------------------------------------------------ the limits per address
{
  // The page's files don't spend the API's budget; the API does, and says so.
  const tight = await createServer({ guests: true, staticDir: dist, httpPerMin: 5, lobbies: [lobby(30, t - 600_000)] });
  const at = (path, headers = {}) => fetch(`http://localhost:${tight.port}${path}`, { headers }).then((r) => r.status);
  const pages = await Promise.all(Array.from({ length: 30 }, () => at("/app.js")));
  check(pages.every((c) => c === 200), "thirty loads of the app's files are served, whatever the API's limit");
  const api = [];
  for (let i = 0; i < 7; i++) api.push(await at("/health"));
  check(api.slice(0, 5).every((c) => c === 200) && api[5] === 429 && api[6] === 429, "the API answers 429 past its limit per minute");
  await tight.close();
  // Whose address counts: the socket's; behind a proxy, the header that proxy writes, never one the visitor chose.
  const seen = async (opts, headers) => {
    const sv = await createServer({ guests: true, lobbies: [lobby(31, t - 600_000)], ...opts });
    const a = (await (await fetch(`http://localhost:${sv.port}/health`, { headers })).json()).address;
    await sv.close();
    return a;
  };
  const forged = { "x-forwarded-for": "203.0.113.7, 198.51.100.2", "cf-connecting-ip": "198.51.100.9" };
  check(/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(await seen({}, forged)), "with no proxy, the address is the socket's: headers are ignored");
  check(await seen({ trustProxy: "cf-connecting-ip" }, forged) === "198.51.100.9", "behind a proxy, it is the header that proxy writes");
  check(await seen({ trustProxy: "CF-Connecting-IP" }, { "x-forwarded-for": "203.0.113.7" }) === "203.0.113.7", "if that header is missing, X-Forwarded-For's first entry (as before)");
  check(await seen({ trustProxy: true }, forged) === "203.0.113.7", "and with no header named, X-Forwarded-For's first entry");
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
const until = async (fn, ms = 5000) => { for (const t0 = Date.now(); Date.now() - t0 < ms; await new Promise((r) => setTimeout(r, 100))) if (await fn()) return true; return false; };
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
{
  // A link to the real address can't point the page at another server, nor dress it up as a scene of the demo.
  const other = await createServer({ guests: true, batchMs: 30, lobbies: [{ id: 9, opensAt: Date.now() - 600_000, source: practiceSource({ id: 9, host: HOST }), name: "Someone else's lobby" }] });
  const page = await open(`/?live=${encodeURIComponent(`http://localhost:${other.port}`)}&scene=launch-founder&freeze&rpc=${encodeURIComponent(`http://localhost:${other.port}/rpc`)}#/lobby`);
  check(await visible(page.getByRole("heading", { name: "Friday beta hour" })), "a link with ?live= and ?scene= still opens this server's lobby");
  check(other.rooms.get("9").summary().inside === 0 && await page.getByText(/Someone else|founder #|You’re a founder/i).count() === 0, "the other server sees nobody, and no scene is shown");
  check(page.errors.length === 0, `no script errors${page.errors.length ? `: ${page.errors.join(" | ")}` : ""}`);
  await page.context().close();
  await other.close();
}
{
  // The server can't be reached at first: the page says so and shows no lobby at all (never the demo's, which would
  // read as a real one); it keeps trying, and comes in by itself.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  let down = true;
  await page.route("**/auth/guest", (route) => (down ? route.fulfill({ status: 429, contentType: "application/json", body: '{"error":"Too many requests"}' }) : route.continue()));
  await page.goto(`${base}/#/lobby`);
  check(await visible(page.getByRole("status").filter({ hasText: "Can’t reach the lobby server. Still trying." })), "a server that can't be reached: the page says so");
  await page.waitForTimeout(2500); // the demo's clock would have moved, and its crowd pledged
  const text = await page.locator("body").innerText();
  check(!/Friday Night Degens|mira\.sol|\$WIF|\$POPCAT|inside|Pledge|SOL\b/.test(text), `and shows no lobby, no idea, no number: nothing of the demo (${text.replace(/\n+/g, " | ").slice(0, 80)})`);
  check(await page.title() === "Social Launch", "nor in the tab's title");
  down = false;
  check(await visible(page.getByRole("heading", { name: "Friday beta hour" })), "it keeps trying, and comes into the real lobby by itself");
  check(await page.getByText(/Friday Night Degens|mira\.sol/).count() === 0 && await page.getByText("Hosted by Marc").count() === 1, "with the server's lobby only");
  check(errors.length === 0, `no script errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  await ctx.close();
}
{
  // The server comes back with a new signing key (or a session simply expired): the page signs in again as a guest
  // by itself, instead of asking for a reload it would loop on.
  const again = await createServer({ guests: true, batchMs: 30, staticDir: dist, lobbies: [lobby(40, Date.now() - 600_000)] });
  const port = again.port;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto(`http://localhost:${port}/#/lobby`);
  check(await visible(page.getByRole("heading", { name: "Friday beta hour" })), "in the lobby as a guest");
  await again.close();
  const reborn = await createServer({ port, guests: true, batchMs: 30, staticDir: dist, lobbies: [lobby(40, Date.now() - 600_000)] }); // a new key: createAuth() draws one
  check(await until(() => reborn.rooms.get("40").summary().inside === 1, 20000), "after the server's key changed, the page is back inside by itself");
  check(await page.getByText("The lobby closed this connection").count() === 0, "without being told to reload");
  await ctx.close();
  await reborn.close();
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
