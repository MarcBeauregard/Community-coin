// Checks the clans: a lobby played to its launch on a fake clock, then its clan over real sockets. Only founders (and
// the winning idea's creator) get in; posts, media (sniffed from the bytes, members-only), reactions, deletes,
// reports that hide, moderators' mutes, slow mode and appointments; and everything survives a restart, without the
// deleted text. Then the app, live as a founder, talks in the clan in Chromium.
// Usage: node web/lobbies/clan-check.mjs   (build the app first for the browser part: npm run build:lobbies)

import { createRequire } from "node:module";
import http from "node:http";
import { readFileSync, existsSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "./server/server.mjs";
import { simulatedSource } from "./server/sources.mjs";
import { sniff } from "./server/media.mjs";
import { connectClan } from "./src/realtime/client.js";

let failures = 0;
const check = (cond, msg) => { if (cond) console.log(`  ok  ${msg}`); else { failures++; console.log(`FAIL  ${msg}`); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return true; await wait(20); }
  return cond();
}

const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"), Buffer.alloc(64, 7)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(32)]);
check(sniff(PNG) === "image/png" && sniff(MP4) === "video/mp4" && sniff(Buffer.from("<svg onload=alert(1)>")) === null && sniff(Buffer.from("<html>")) === null,
  "files are recognised from their bytes; SVG and HTML are not media");

// ------------------------------------------------------------------ a lobby to its launch
const dataDir = mkdtempSync(join(tmpdir(), "clans-"));
let t = 1_700_000_000_000;
const opensAt = t - 3200 * 1000;
function playLobby() {
  const source = simulatedSource({ everySec: 1e9 });
  const chain = source.chain;
  const win = chain.ideas[0];
  const other = chain.ideas[1];
  for (const u of ["alice", "bob", "dave", "erin"]) chain.apply("pledge", { user: u, symbol: win.symbol, amount: 1_000_000_000n }, 3200);
  chain.apply("pledge", { user: "carol", symbol: other.symbol, amount: 1_000_000_000n }, 3200);
  return { source, creator: win.proposer };
}
const { source, creator } = playLobby();
let server = await createServer({ guests: true, devSessions: true, dataDir, batchMs: 30, now: () => t, lobbies: [{ id: 412, opensAt, source }] });
let base = `http://localhost:${server.port}`;
t = opensAt + 3300 * 1000;
await wait(150);
t = opensAt + 3600 * 1000;
await until(() => server.clans.list().length === 1);
const mint = server.clans.list()[0].mint;
check(!!mint && server.clans.isFounder(mint, "alice") && !server.clans.isFounder(mint, "carol"), "the lobby launched and its clan was born");

// ------------------------------------------------------------------ who gets in
const inbox = {};
const links = {};
function enter(who, token = server.auth.issue(who)) {
  inbox[who] = [];
  links[who] = connectClan({ base, mint, token, onMessage: (m) => inbox[who].push(m) });
  return links[who];
}
const last = (who, pred) => [...inbox[who]].reverse().find(pred);
for (const who of ["alice", "bob", "dave", "erin", creator]) enter(who);
enter("carol");
enter("guest", server.auth.issue("guest-x", { guest: true }));
enter("forged", "nope.nope");
await until(() => ["alice", "bob", "dave", "erin", creator].every((w) => inbox[w].some((m) => m.t === "hello")) && inbox.carol.some((m) => m.t === "closed"));
check(last("carol", (m) => m.t === "closed")?.code === 4403, "a wallet that backed another idea is not let in (4403)");
check(await until(() => last("guest", (m) => m.t === "closed")?.code === 4403), "a guest is not let in");
check(await until(() => last("forged", (m) => m.t === "closed")?.code === 4401), "a forged session is refused (4401)");
const hello = last("alice", (m) => m.t === "hello");
check(hello.role === "founder" && hello.rank >= 1 && hello.founders === server.clans.get(mint).founders.size && hello.channels.length === 5, "a founder's hello: role, rank, the founders, the channels");
check(last(creator, (m) => m.t === "hello").role === "creator", `the winning idea's creator (@${creator}) is the clan's first moderator`);
for (const w of ["carol", "guest", "forged"]) links[w].close();

// ------------------------------------------------------------------ posts
links.alice.post("general", "  gm founders‮  ");
check(await until(() => last("bob", (m) => m.t === "post")?.line.text === "gm founders"), "a post reaches every member, cleaned");
const first = last("bob", (m) => m.t === "post").line;
links.alice.post("general", "again");
check(await until(() => last("alice", (m) => m.t === "error")?.code === "TooFast"), "posting too fast is refused");
t += 1000;
links.alice.post("nowhere", "x");
check(await until(() => last("alice", (m) => m.t === "error")?.code === "UnknownChannel"), "an unknown channel is refused");
links.bob.slow("general", 30);
check(await until(() => last("bob", (m) => m.t === "error")?.code === "NotAllowed"), "a founder cannot set slow mode");
links[creator].slow("general", 30);
check(await until(() => last("alice", (m) => m.t === "slow")?.sec === 30), "the creator sets slow mode, everyone is told");
links.alice.post("general", "slow?");
check(await until(() => last("alice", (m) => m.t === "error")?.code === "SlowMode"), "slow mode holds a member back");
links[creator].slow("general", 0);
await until(() => last("alice", (m) => m.t === "slow")?.sec === 0);

// ------------------------------------------------------------------ media
const upload = (who, body, token = server.auth.issue(who)) => fetch(`${base}/clans/${encodeURIComponent(mint)}/media`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body });
const png = await (await upload("alice", PNG)).json();
check(png.type === "image/png" && /^[0-9a-f]{64}$/.test(png.id), "a founder uploads an image");
check((await upload("alice", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>"))).status === 415, "an SVG is refused");
check((await upload("alice", Buffer.concat([PNG, Buffer.alloc(8 * 1024 * 1024)]))).status === 413, "a file over 8 MB is refused");
check((await upload("carol", PNG)).status === 403, "a non-member cannot upload");
const file = await fetch(`${base}/media/${png.id}?token=${encodeURIComponent(server.auth.issue("bob"))}`);
check(file.status === 200 && file.headers.get("content-type") === "image/png" && file.headers.get("x-content-type-options") === "nosniff" && /sandbox/.test(file.headers.get("content-security-policy")),
  "members fetch it with headers that keep it an image");
check((await fetch(`${base}/media/${png.id}?token=${encodeURIComponent(server.auth.issue("carol"))}`)).status === 404, "a non-member cannot fetch it");
t += 1000;
links.alice.post("memes", "", [png.id]);
check(await until(() => last("bob", (m) => m.t === "post")?.line.media?.[0]?.id === png.id), "a post can carry media and nothing else");
t += 1000;
links.alice.post("memes", "fake", ["f".repeat(64)]);
check(await until(() => last("alice", (m) => m.t === "error")?.code === "UnknownMedia"), "media that was not uploaded to this clan is refused");

// ------------------------------------------------------------------ reactions, deletes, reports
links.bob.react(first.id, "fire", true);
links.dave.react(first.id, "fire", true);
check(await until(() => last("alice", (m) => m.t === "update")?.line.reactions.fire === 2), "reactions are counted per member");
links.bob.react(first.id, "fire", false);
check(await until(() => last("bob", (m) => m.t === "update" && m.line.reactions.fire === 1)?.line.mine.length === 0), "a reaction can be taken back");
links.bob.react(first.id, "poop", true);
check(await until(() => last("bob", (m) => m.t === "error")?.code === "UnknownReaction"), "only the clan's reactions exist");
links.bob.remove(first.id);
check(await until(() => last("bob", (m) => m.t === "error")?.code === "NotAllowed"), "a founder cannot delete someone else's message");
t += 1000;
links.erin.post("general", "buy my bag lol scam link");
await until(() => last("alice", (m) => m.t === "post")?.line.from === "erin");
const spam = last("alice", (m) => m.t === "post").line;
links.alice.report(spam.id); links.bob.report(spam.id); links.bob.report(spam.id);
check(await until(() => inbox.bob.filter((m) => m.t === "reported").length === 2) && !last("alice", (m) => m.t === "update" && m.line.id === spam.id && m.line.hidden), "a report counts once per member; two do not hide");
links.dave.report(spam.id);
check(await until(() => last("alice", (m) => m.t === "update" && m.line.id === spam.id)?.line.hidden), "the third report hides the message");
const seen = (who) => last(who, (m) => m.t === "update" && m.line.id === spam.id)?.line;
check(seen("alice").text === "" && seen("erin").text !== "" && seen(creator).text !== "" && seen(creator).reported === 3, "hidden from members; its author and the moderators still see it, with the count");
links[creator].restore(spam.id);
check(await until(() => seen("alice")?.hidden === false && seen("alice").text !== ""), "a moderator restores it");
links.erin.remove(spam.id);
check(await until(() => seen("alice")?.deleted && seen("alice").text === ""), "its author deletes it: the text is gone for everyone");

// ------------------------------------------------------------------ moderators
links[creator].mute("bob", 10);
check(await until(() => last("alice", (m) => m.t === "muted")?.user === "bob"), "the creator mutes a member for 10 minutes, everyone is told");
t += 1000;
links.bob.post("general", "can I talk");
check(await until(() => last("bob", (m) => m.t === "error")?.code === "Muted"), "a muted member cannot post");
t += 10 * 60_000;
links.bob.post("general", "back");
check(await until(() => last("alice", (m) => m.t === "post")?.line.text === "back"), "the mute ends on its own");
links.dave.mute("erin", 5);
check(await until(() => last("dave", (m) => m.t === "error")?.code === "NotAllowed"), "a founder cannot mute");
links[creator].mute(creator, 5);
check(await until(() => last(creator, (m) => m.t === "error")?.code === "NotAllowed"), "nobody mutes the creator");
links.alice.mod("bob", true);
check(await until(() => last("alice", (m) => m.t === "error")?.code === "NotAllowed"), "only the creator names moderators");
links[creator].mod("dave", true);
await until(() => last("alice", (m) => m.t === "mods")?.mods.includes("dave"));
check(last("alice", (m) => m.t === "mods")?.mods.includes("dave"), "the creator names a founder moderator");
t += 1000;
links.erin.post("general", "rude");
await until(() => last("alice", (m) => m.t === "post")?.line.text === "rude");
links.dave.remove(last("alice", (m) => m.t === "post").line.id);
check(await until(() => last("alice", (m) => m.t === "update")?.line.deleted), "a moderator deletes someone else's message");
links.dave.mute(creator, 5);
check(await until(() => last("dave", (m) => m.t === "error")?.code === "NotAllowed"), "a moderator cannot mute the creator");
links.alice.history("general");
check(await until(() => last("alice", (m) => m.t === "history")?.lines.length >= 3), "history pages back through a channel");

// ------------------------------------------------------------------ a restart
for (const l of Object.values(links)) l.close();
await server.close();
server = await createServer({ guests: true, devSessions: true, dataDir, batchMs: 30, now: () => t, lobbies: [{ id: 412, opensAt, source: simulatedSource({ everySec: 1e9 }) }] });
base = `http://localhost:${server.port}`;
check(server.clans.isFounder(mint, "alice") && server.clans.get(mint).founders.size === hello.founders, "after a restart the clan and its founders are still there");
enter("alice");
await until(() => inbox.alice.some((m) => m.t === "hello"));
const again = last("alice", (m) => m.t === "hello");
const general = again.channels.find((c) => c.id === "general").lines;
check(general.some((l) => l.text === "gm founders" && l.reactions.fire === 1) && again.mods.includes("dave"), "messages, reactions and moderators survive it");
check(general.some((l) => l.id === spam.id && l.deleted), "a deleted message stays a tombstone");
const logs = readdirSync(join(dataDir, "clans")).map((f) => readFileSync(join(dataDir, "clans", f), "utf8")).join("");
check(!logs.includes("scam link") && !logs.includes("rude") && logs.includes("gm founders"), "the log no longer holds deleted text");
check((await fetch(`${base}/media/${png.id}?token=${encodeURIComponent(server.auth.issue("bob"))}`)).status === 200, "media survives it");
links.alice.close();

// ------------------------------------------------------------------ the app, live, as a founder
const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "lobbies");
// NO_BROWSER=1 skips the browser part (CI without Chromium).
if (existsSync(join(dist, "index.html")) && !process.env.NO_BROWSER) {
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
  // A fresh lobby, live, two minutes before the launch; the app signs in as Alice, who backed the winner.
  let t2 = Date.now();
  const opens2 = t2 - 3480 * 1000;
  const play = playLobby();
  const s2 = await createServer({ devSessions: true, batchMs: 30, now: () => t2, lobbies: [{ id: 412, opensAt: opens2, source: play.source }] });
  const base2 = `http://localhost:${s2.port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto(`http://localhost:${files.address().port}/index.html?live=${encodeURIComponent(base2)}&as=alice#/lobby`);
  await page.waitForTimeout(1000);
  t2 = opens2 + 3600 * 1000;
  check(await page.getByText(/Welcome, Founder #\d/).waitFor({ timeout: 4000 }).then(() => true, () => false), "live, the app shows Alice her founder number");
  await page.getByRole("button", { name: "Enter the clan" }).click();
  await page.waitForTimeout(800);
  check(await page.getByText("Founders only").first().isVisible(), "she enters the clan");
  const m2 = s2.clans.list()[0].mint;
  const peer = [];
  const bob = connectClan({ base: base2, mint: m2, token: s2.auth.issue("bob"), onMessage: (m) => peer.push(m) });
  await until(() => peer.some((m) => m.t === "hello"));
  bob.post("general", "welcome alice");
  check(await page.getByText("welcome alice").waitFor({ timeout: 3000 }).then(() => true, () => false), "a founder's post appears in the app");
  await page.getByPlaceholder("Message #general").fill("hi bob, from the app");
  await page.keyboard.press("Enter");
  check(await until(() => peer.some((m) => m.t === "post" && m.line.text === "hi bob, from the app")), "her post from the app reaches the clan");
  await page.getByRole("button", { name: /^Hype/ }).first().click();
  check(await until(() => peer.some((m) => m.t === "update" && m.line.reactions.fire === 1)), "a reaction from the app is counted on the server");
  await page.getByRole("button", { name: "Report message from bob" }).click();
  check(await page.getByText("Reported to the clan’s moderators").waitFor({ timeout: 2000 }).then(() => true, () => false), "she can report a message");
  await page.getByRole("button", { name: "Delete your message" }).first().click();
  check(await until(() => peer.some((m) => m.t === "update" && m.line.deleted)), "she deletes her own message");
  t2 += 1000; // the server's clock: a moment between two of her posts
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Share an image or clip" }).click()]);
  await chooser.setFiles({ name: "meme.png", mimeType: "image/png", buffer: PNG });
  check(await until(() => peer.some((m) => m.t === "post" && m.line.media.length === 1)), "she shares an image: uploaded, then posted");
  check(errors.length === 0, `no script errors${errors.length ? `: ${errors[0]}` : ""}`);
  bob.close();
  await browser.close();
  files.close();
  await s2.close();
} else {
  console.log("  --  browser part skipped (app not built, or NO_BROWSER set)");
}

await server.close();
rmSync(dataDir, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
