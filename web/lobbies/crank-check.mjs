// Checks the end of a lobby hour: the crank's plan in every state, then a whole hour played on the program's rules
// through the server on a fake clock: the lock announces the winner, the launch the coin, each wallet hears what its
// pledge became (refund, or founder with a rank), the clan's members are exactly the winner's backers, and the lobby
// ends owing nothing. Then the app, live, goes from the lock to the launch screen.
// Usage: node web/lobbies/crank-check.mjs   (build the app first for the browser part: npm run build:lobbies)

import { createRequire } from "node:module";
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { planCrank, stateOfRules, NO_WINNER } from "./server/crank.mjs";
import { createServer } from "./server/server.mjs";
import { simulatedSource } from "./server/sources.mjs";
import { connectLobby } from "./src/realtime/client.js";

let failures = 0;
const check = (cond, msg) => { if (cond) console.log(`  ok  ${msg}`); else { failures++; console.log(`FAIL  ${msg}`); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return true; await wait(25); }
  return cond();
}
const ops = (list) => list.map((o) => o.op).join(",");

// ------------------------------------------------------------------ the plan
{
  const ideas = [{ symbol: "A", bondReturned: false }, { symbol: "B", bondReturned: false }];
  const pledges = [{ user: "u1", idea: 0, amount: 5n, settled: false }, { user: "u2", idea: 1, amount: 3n, settled: false }, { user: "u3", idea: 1, amount: 0n, settled: false }];
  const lobby = { lockAt: 3300, launchAt: 3600, finalized: false, launched: false, winner: NO_WINNER };
  check(planCrank({ lobby, ideas, pledges }, 3299).length === 0, "nothing before the lock");
  check(ops(planCrank({ lobby, ideas, pledges }, 3300)) === "finalize", "at the lock: finalize, nothing else");
  const fin = { ...lobby, finalized: true, winner: 0 };
  check(planCrank({ lobby: fin, ideas, pledges }, 3599).length === 0, "between the lock and the launch: nothing");
  check(ops(planCrank({ lobby: fin, ideas, pledges }, 3600)) === "launch_winner,claim_founder,refund,return_bond,return_bond",
    "at launch: the coin, then each pledge settled its way, then the bonds (an emptied pledge is skipped)");
  check(ops(planCrank({ lobby: fin, ideas, pledges, winnerTaken: true }, 3600)) === "void_winner", "a winner whose ticker was taken meanwhile is voided first");
  const none = { ...lobby, finalized: true, winner: NO_WINNER };
  check(ops(planCrank({ lobby: none, ideas, pledges }, 3600)) === "refund,refund,return_bond,return_bond", "no winner: everyone refunded, bonds back");
  const done = { ...fin, launched: true };
  const settled = pledges.map((p) => ({ ...p, settled: true }));
  check(planCrank({ lobby: done, ideas: ideas.map((d) => ({ ...d, bondReturned: true })), pledges: settled }, 9999).length === 0, "a settled lobby needs nothing");
  check(ops(planCrank({ lobby: done, ideas, pledges: [settled[0], pledges[1]] }, 3700)) === "refund,return_bond,return_bond", "a crank cut short resumes where it stopped");
}

// ------------------------------------------------------------------ an hour on the server, on a fake clock
let t = 1_000_000_000_000;
const opensAt = t - 3200 * 1000;
const source = simulatedSource({ everySec: 7, random: (() => { let x = 7; return () => ((x = (x * 16807) % 2147483647) / 2147483647); })() });
const chain = source.chain;
// Alice backs the leader, Bob another idea, Carol both then withdraws everything.
const leader = [...chain.ideas].sort((a, b) => (b.pledged > a.pledged ? 1 : -1))[0];
const other = chain.ideas.find((d) => d !== leader);
chain.apply("pledge", { user: "alice", symbol: leader.symbol, amount: 2_000_000_000n }, 3200);
chain.apply("pledge", { user: "bob", symbol: other.symbol, amount: 1_500_000_000n }, 3200);
chain.apply("pledge", { user: "carol", symbol: other.symbol, amount: 500_000_000n }, 3200);
chain.apply("withdraw", { user: "carol", symbol: other.symbol, amount: 500_000_000n }, 3201);
const bondsBefore = chain.ideas.length;
const server = await createServer({ guests: true, batchMs: 50, now: () => t, lobbies: [{ id: 412, opensAt, source }] });
const base = `http://localhost:${server.port}`;
const inbox = { alice: [], bob: [], carol: [] };
const links = Object.keys(inbox).map((who) => connectLobby({ base, lobby: 412, token: server.auth.issue(who), onMessage: (m) => inbox[who].push(m) }));
await until(() => Object.values(inbox).every((m) => m.some((x) => x.t === "hello")));

t = opensAt + 3300 * 1000;
check(await until(() => inbox.bob.some((m) => m.t === "locked")), "at the lock every client hears it");
const locked = inbox.bob.find((m) => m.t === "locked");
const winner = chain.ideas[chain.lobby.winner];
check(locked.winner === winner.index && winner.pledged === chain.ideas.reduce((a, d) => (d.pledged > a ? d.pledged : a), 0n), "the winner is the idea with the most SOL");
check(locked.pot === String(winner.pledged) && locked.total === String(chain.lobby.total), "the lock says the pot and the total, in lamports");
const pledgeFails = chain.apply("pledge", { user: "late", symbol: winner.symbol, amount: 1n }, 3301);
check(!pledgeFails.ok && pledgeFails.error === "PledgesLocked", "after the lock, pledges are refused by the program");
await wait(200);
check(!inbox.bob.some((m) => m.t === "launch"), "no launch before 01:00");

t = opensAt + 3600 * 1000;
check(await until(() => inbox.alice.some((m) => m.t === "settled")), "at 01:00 the crank launches and settles");
const launch = inbox.bob.find((m) => m.t === "launch");
check(launch && launch.symbol === winner.symbol && launch.founders === winner.backers && launch.pot === String(winner.pledged), "the launch announces the coin, its pot and its founders");
const a = inbox.alice.find((m) => m.t === "settled");
check(a.kind === "founder" && a.amount === "2000000000" && a.rank === winner.backers && a.mint === launch.mint, "Alice, on the winner, is a founder; her rank is her place among its backers (she came last)");
const b = inbox.bob.find((m) => m.t === "settled");
check(b && b.kind === "refund" && b.amount === "1500000000", "Bob, on another idea, is refunded to the lamport");
check(!inbox.carol.some((m) => m.t === "settled"), "Carol, who withdrew, has nothing to settle");
check(!inbox.alice.some((m) => m.t === "settled" && m.kind === "refund") && !inbox.bob.some((m) => m.t === "settled" && m.kind === "founder"), "each wallet hears only about its own pledge");

const clan = await (await fetch(`${base}/clans/${encodeURIComponent(launch.mint)}`)).json();
const backers = [...chain.pledges.values()].filter((p) => p.idea === winner.index && p.amount > 0n).map((p) => p.user).sort();
check(clan.founders.length === winner.backers && JSON.stringify(clan.founders.map((f) => f.user).sort()) === JSON.stringify(backers), "the clan's members are exactly the winner's backers");
check(clan.founders.every((f, i) => f.rank === i + 1) && clan.symbol === winner.symbol, "founders are ranked 1..n, in pledge order");
check(server.clans.isFounder(launch.mint, "alice") && !server.clans.isFounder(launch.mint, "bob"), "the registry answers who may write in the clan");
check((await fetch(`${base}/clans/nope`)).status === 404, "an unknown clan is a 404");

check([...chain.pledges.values()].every((p) => p.settled || p.amount === 0n), "every pledge is settled");
check(chain.ideas.every((d) => d.bond_returned) && chain.ideas.length === bondsBefore, "every proposer's bond is back");
check(chain.balance === 0n, "the lobby owes nothing: its balance is 0");
const sent = inbox.bob.length;
await wait(300);
check(inbox.bob.filter((m) => m.t === "launch").length === 1 && inbox.bob.length - sent < 3, "the crank runs once: no repeat announcements");

const late = [];
const cl = connectLobby({ base, lobby: 412, token: server.auth.issue("dave"), onMessage: (m) => late.push(m) });
await until(() => late.some((m) => m.t === "hello"));
const hello = late.find((m) => m.t === "hello");
check(hello.locked?.winner === winner.index && hello.launch?.mint === launch.mint, "a late joiner's hello carries the lock and the launch");
cl.close();
links.forEach((l) => l.close());

// ------------------------------------------------------------------ the app, live, from the lock to the launch
const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "lobbies");
if (existsSync(join(dist, "index.html"))) {
  const require = createRequire(import.meta.url);
  const { chromium } = require("playwright");
  const TYPES = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg" };
  const files = http.createServer((req, res) => {
    const p = join(dist, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/\/$/, "/index.html"));
    if (!p.startsWith(dist) || !existsSync(p)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" });
    res.end(readFileSync(p));
  });
  await new Promise((r) => files.listen(0, r));
  let t2 = Date.now();
  const opens2 = t2 - 3290 * 1000;
  const s2 = simulatedSource({ everySec: 5 });
  const server2 = await createServer({ guests: true, batchMs: 50, now: () => t2, lobbies: [{ id: 412, opensAt: opens2, source: s2 }] });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto(`http://localhost:${files.address().port}/index.html?live=${encodeURIComponent(`http://localhost:${server2.port}`)}#/lobby`);
  await page.waitForTimeout(1200);
  t2 = opens2 + 3300 * 1000;
  await page.waitForTimeout(800);
  const win2 = s2.chain.ideas[s2.chain.lobby.winner];
  check(await page.getByText(new RegExp(`\\$${win2.symbol} won · launch in`)).isVisible(), "the app shows who won at the lock");
  t2 = opens2 + 3600 * 1000;
  await page.waitForTimeout(1000);
  check(await page.getByText("is alive.").isVisible() && (await page.locator(".launch").count()) === 1, "at 01:00 the app moves to the launch");
  check(await page.getByText("You watched this one from the stands").isVisible(), "a guest is told only pledgers become founders");
  await browser.close();
  files.close();
  await server2.close();
} else {
  console.log("  --  app not built: browser part skipped (npm run build:lobbies)");
}

await server.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
