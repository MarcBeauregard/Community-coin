// Checks reporting and removing an idea: anyone signed in reports an idea to the host (once, counted, not named);
// the host or a co-host removes it, in a practice lobby, before the lock; everyone on it gets their practice SOL back
// at once, its proposer the bond; it can't be backed again. The lobby program has no such instruction yet (PLAN.md).
// Usage: node web/lobbies/moderate-check.mjs   (after npm run build:lobbies)

import { createRequire } from "node:module";
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "./server/server.mjs";
import { simulatedSource } from "./server/sources.mjs";
import { connectLobby } from "./src/realtime/client.js";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
let failures = 0;
const check = (cond, msg) => { if (cond) console.log(`  ok  ${msg}`); else { failures++; console.log(`FAIL  ${msg}`); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SOL = 1_000_000_000n;

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
const visible = (loc, ms = 4000) => loc.first().waitFor({ timeout: ms }).then(() => true, () => false);

const source = simulatedSource({ everySec: 1e9 });
const server = await createServer({ guests: true, devSessions: true, batchMs: 30, lobbies: [{ id: 412, opensAt: Date.now() - 1452 * 1000, source }] });
const base = `http://localhost:${server.port}`;
const conn = (who) => {
  const got = [];
  const c = connectLobby({ base, lobby: 412, token: server.auth.issue(who), onMessage: (m) => got.push(m) });
  return { c, got, last: (t) => got.filter((m) => m.t === t).pop() };
};
const ana = conn("ana"), cleo = conn("cleo"), ben = conn("ben"), host = conn("mira.sol"), cleoTab2 = conn("cleo");
await wait(200);
ana.c.practice("propose", { symbol: "PIGW", name: "Pigeon Wizard" });
await wait(100);
cleo.c.practice("pledge", { symbol: "PIGW", amount: String(2n * SOL) });
await wait(150);
check(BigInt(cleo.last("practice").holds) === source.chain.ideas.find((d) => d.symbol === "PIGW").pledged, "the pledge's answer says what the idea now holds, with it");
check(cleoTab2.last("mine") && BigInt(cleoTab2.last("mine").balance) === 8n * SOL && cleoTab2.last("mine").mine?.symbol === "PIGW", "Cleo's other tab follows her pledge");
check(BigInt(cleo.last("practice").balance) === 8n * SOL && BigInt(ana.last("practice").balance) === 10n * SOL - source.chain.lobby.bond, "before: Cleo has 2 SOL on $PIGW, Ana's bond is in");

// ------------------------------------------------------------------ reports
const guestTok = (await (await fetch(`${base}/auth/guest`, { method: "POST" })).json()).token;
const guest = []; const g = connectLobby({ base, lobby: 412, token: guestTok, onMessage: (m) => guest.push(m) });
await wait(150);
g.report("PIGW");
ben.c.report("PIGW"); ben.c.report("PIGW"); cleo.c.report("PIGW");
await wait(200);
check(guest.some((m) => m.code === "SignInToReport"), "a guest can't report");
check(host.last("reports")?.reports.PIGW === 2, "the host sees 2 reports: once each, the guest's not counted");
check(!ben.got.some((m) => m.t === "reports"), "nobody else sees the reports");
check(JSON.stringify(host.last("reports")).includes("ben") === false, "and the host sees how many, not who");

// ------------------------------------------------------------------ removing
ben.c.remove("PIGW");
await wait(150);
check(ben.got.some((m) => m.code === "HostOnly"), "only the host (or a co-host) can remove an idea");
host.c.remove("PIGW");
await wait(200);
const gone = ben.last("removed");
check(gone?.symbol === "PIGW" && !gone.race.some((r) => r.symbol === "PIGW"), "removed: everyone gets the race without it");
const back = cleo.last("refunded");
check(back && BigInt(back.amount) === 2n * SOL && BigInt(back.balance) === 10n * SOL && back.mine === null, "Cleo's 2 SOL is back at once");
const bond = ana.last("refunded");
check(bond && BigInt(bond.bond) === source.chain.lobby.bond && BigInt(bond.balance) === 10n * SOL, "Ana's bond is back");
cleo.c.practice("pledge", { symbol: "PIGW", amount: String(SOL) });
await wait(150);
check(cleo.last("practice")?.error === "IdeaRemoved", "a removed idea can't be backed again");
const late = conn("late");
await wait(150);
check(!late.last("hello").race.some((r) => r.symbol === "PIGW"), "and a late joiner never sees it");

// ------------------------------------------------------------------ what a raw client can't do
{
  // An oversized frame ends that socket, never the server (it once killed the process).
  const { WebSocket } = await import("ws");
  const tok = server.auth.issue("big");
  const raw = new WebSocket(`${base.replace("http", "ws")}/ws?lobby=412&token=${encodeURIComponent(tok)}`);
  await new Promise((r) => raw.on("open", r));
  raw.send(JSON.stringify({ t: "chat", text: "x".repeat(3000) }));
  await wait(300);
  const alive = await fetch(`${base}/lobbies/412`).then((r) => r.ok, () => false);
  check(alive && raw.readyState !== 1, "an oversized frame closes that socket; the server lives on");
  // Text that isn't text (an object posing as a string) is a bad message, never a crash.
  const poke = [];
  const pc = connectLobby({ base, lobby: 412, token: server.auth.issue("poker"), onMessage: (m) => poke.push(m) });
  await wait(150);
  const rawPoke = new WebSocket(`${base.replace("http", "ws")}/ws?lobby=412&token=${encodeURIComponent(server.auth.issue("poker2"))}`);
  const pokeGot = [];
  rawPoke.on("message", (d) => pokeGot.push(JSON.parse(d)));
  await new Promise((r) => rawPoke.on("open", r));
  rawPoke.send(JSON.stringify({ t: "chat", text: { toString: 1 } }));
  rawPoke.send(JSON.stringify({ t: "propose", symbol: "OKAY", name: { toString: 1 } }));
  await wait(300);
  check(await fetch(`${base}/lobbies/412`).then((r) => r.ok, () => false) && pokeGot.some((m) => m.code === "EmptyMessage" || m.code === "BadMessage"), "an object for text is refused; the server lives on");
  const vt = await fetch(`${base}/voice/token`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${server.auth.issue("poker")}` }, body: JSON.stringify({ lobby: { toString: 1 } }) });
  check(vt.status === 400 || vt.status === 503, `and over HTTP it is a bad request, not a server error (${vt.status})`);
  rawPoke.close(); pc.close();
  // Ideas as the app lets anyone write them.
  for (const [symbol, name] of [["<IMG>", "x"], ["SOL", "Solana"], ["TOOLONGX", "Long"], ["OK", "<script>x</script>"]]) ben.c.practice("propose", { symbol, name });
  await wait(300);
  const refused = ben.got.filter((m) => m.t === "practice" && m.op === "propose" && !m.ok).map((m) => m.error);
  check(refused.length === 4 && refused.filter((e) => e === "BadIdea").length === 3 && refused.includes("MemeExists"), `bad tickers, markup in names and well-known coins are refused (${refused.join(", ")})`);
  check(!source.chain.ideas.some((d) => ["<IMG>", "SOL", "TOOLONGX", "OK"].includes(d.symbol)), "and none of them is in the race");
}

// ------------------------------------------------------------------ the lock's settlements carry the practice SOL
{
  const room = server.rooms.get("412");
  room.announce([{ event: "PledgeRefunded", user: "cleo", amount: SOL }, { event: "BondReturned", idea: 0, proposer: "ana", amount: source.chain.lobby.bond }]);
  await wait(150);
  const r = cleo.got.filter((m) => m.t === "settled").pop();
  check(r?.kind === "refund" && r.balance !== undefined, "a refund at the lock says the person's practice SOL now (no stale balance)");
  const b = ana.got.filter((m) => m.t === "settled" && m.kind === "bond").pop();
  check(b && BigInt(b.amount) === source.chain.lobby.bond && b.balance !== undefined, "and the proposer hears their bond is back, with their SOL");
}

// ------------------------------------------------------------------ in the app
{
  ana.c.practice("propose", { symbol: "FROG", name: "Frog Prince" });
  await wait(100);
  cleo.c.practice("pledge", { symbol: "FROG", amount: String(SOL) });
  ben.c.report("FROG");
  await wait(150);
  const hostPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const cleoPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  for (const p of [hostPage, cleoPage]) { p.errors = []; p.on("pageerror", (e) => p.errors.push(e.message)); await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort()); await p.addInitScript(() => localStorage.setItem("lobbies.intro", "1")); }
  await hostPage.goto(`${app}?live=${encodeURIComponent(base)}&as=mira.sol#/lobby`);
  await cleoPage.goto(`${app}?live=${encodeURIComponent(base)}&as=cleo#/lobby`);
  check(await hostPage.getByRole("button", { name: /from the race$/ }).count() === 0 || await hostPage.locator(".idea[aria-pressed=true]", { hasText: "Frog Prince" }).count() === 1, "the host sees no Remove on the leader by default");
  const card = hostPage.locator(".idea", { hasText: "Frog Prince" });
  check(await visible(card.getByText("Reported · 1")), "the host sees the report on the idea's card");
  await card.click();
  await hostPage.getByRole("button", { name: "Remove $FROG from the race" }).click();
  const dlg = hostPage.getByRole("dialog", { name: "Remove this idea?" });
  check(await dlg.getByText(/1\.0 SOL from 1 backer · reported by 1/).isVisible() && await dlg.getByText(/Every pledge on it is refunded now/).isVisible(), "removing says what happens to the money first");
  await dlg.getByRole("button", { name: "Remove $FROG" }).click();
  await dlg.getByRole("button", { name: "Remove $FROG" }).click({ timeout: 300 }).catch(() => {}); // a double click
  await hostPage.waitForTimeout(400);
  check(await hostPage.evaluate(() => !/Remove/.test(document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent ?? "")), "after removing, the focus is not on another idea's Remove");
  check(await hostPage.getByText("That idea is no longer in the race.").count() === 0, "a double click removes once, without a false error");
  check(await visible(hostPage.getByText("$FROG is out of the race. Everyone on it is refunded.")), "the host is told it's done");
  check(await hostPage.locator(".idea", { hasText: "Frog Prince" }).count() === 0, "and it's gone from the race");
  check(await visible(cleoPage.getByText("The host removed $FROG: your 1.0 SOL is back.")), "Cleo is told why it went, and her own amount");
  check(await cleoPage.getByText("The host removed $FROG from the race. Pledges on it are refunded.").count() === 0, "not a generic line on top of it");
  check(hostPage.errors.length + cleoPage.errors.length === 0, `no script errors${[...hostPage.errors, ...cleoPage.errors].join(" | ")}`);
  await hostPage.close(); await cleoPage.close();
}
{
  // The demo: report from the dock, once.
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(`${app}?freeze&scene=lobby`);
  await page.locator(".idea", { hasText: "Popcat" }).click();
  await page.getByRole("button", { name: "Report $POPCAT" }).click();
  const dlg = page.getByRole("dialog", { name: "Report this idea?" });
  check(await dlg.getByText(/sees how many people reported it, not who/).isVisible(), "reporting says what the host sees");
  await dlg.getByRole("button", { name: "Report $POPCAT" }).click();
  check(await visible(page.getByText("Reported. The host will look at $POPCAT.")), "reported");
  check(await page.getByRole("button", { name: "$POPCAT reported" }).isDisabled(), "and only once");
  check(await page.getByRole("button", { name: /Remove .* from the race/ }).count() === 0, "someone who isn't the host can't remove");
  await page.close();
}

{
  // A phone, backing an idea: the report button stays inside the dock.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(`${app}?freeze&scene=lobby-backed`);
  await page.waitForTimeout(500);
  const [flag, dockBox] = [await page.locator(".dock-flag").boundingBox(), await page.locator(".dock").boundingBox()];
  check(flag && dockBox && flag.x + flag.width <= dockBox.x + dockBox.width - 8, "phone, backing: the report button fits in the dock");
  await page.getByRole("button", { name: /^Withdraw/ }).click();
  const btns = page.getByRole("dialog").locator(".sheet-actions .btn");
  const heights = await btns.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  check(heights.length === 2 && heights.every((h) => h <= 56), `phone: a sheet's actions are one line each (${heights.map(Math.round).join(", ")} px)`);
  await page.close();
}
[ana, cleo, ben, host, late, cleoTab2].forEach((x) => x.c.close());
g.close();
await server.close();
await browser.close();
files.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
