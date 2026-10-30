// Checks voice: the SFU access tokens, the lobby stage's rules, the server deciding who may publish (and telling the
// SFU at once when that changes), the clan Campfire, and the host running the stage from the app in Chromium.
// The SFU itself is faked: its admin API records the calls it gets.
// Usage: node web/lobbies/voice-check.mjs   (build the app first for the browser part: npm run build:lobbies)

import { createRequire } from "node:module";
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { sfuToken, readSfuToken, createStage, MAX_SPEAKERS } from "./server/voice.mjs";
import { createServer } from "./server/server.mjs";
import { simulatedSource } from "./server/sources.mjs";
import { connectLobby, connectClan, voiceToken } from "./src/realtime/client.js";

let failures = 0;
const check = (cond, msg) => { if (cond) console.log(`  ok  ${msg}`); else { failures++; console.log(`FAIL  ${msg}`); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return true; await wait(20); }
  return cond();
}

// ------------------------------------------------------------------ tokens
{
  const tok = sfuToken({ apiKey: "key", apiSecret: "secret", identity: "alice", room: "lobby-1", canPublish: false, now: 1_000_000 });
  const p = readSfuToken(tok, "secret");
  check(p && p.iss === "key" && p.sub === "alice" && p.video.room === "lobby-1" && p.video.roomJoin && p.video.canSubscribe && !p.video.canPublish && p.exp - p.iat === 7200,
    "a listener's token joins and listens, and cannot publish");
  check(readSfuToken(tok, "other") === null && readSfuToken(tok.replace(/.$/, (c) => (c === "A" ? "B" : "A")), "secret") === null, "a token signed with another secret, or altered, is refused");
  const spk = readSfuToken(sfuToken({ apiKey: "key", apiSecret: "secret", identity: "bob", room: "lobby-1", canPublish: true }), "secret");
  check(spk.video.canPublish && spk.video.canPublishSources.join() === "microphone" && !spk.video.canPublishData, "a speaker's token publishes the microphone only");
}

// ------------------------------------------------------------------ the stage's rules
{
  const st = createStage({ host: "host" });
  check(st.isSpeaker("host") && st.view().speakers.join() === "host", "the host is on stage from the start");
  check(st.bring("host", "a") === "NoHandRaised", "nobody is pulled on stage without raising a hand");
  st.raise("a", true); st.raise("b", true); st.raise("a", true);
  check(st.view().hands.join() === "a,b", "hands queue in the order raised, once each");
  check(st.bring("b", "a") === "NotAllowed", "a listener cannot bring anyone up");
  check(st.bring("host", "a") === null && st.isSpeaker("a") && st.view().hands.join() === "b", "the host brings a raised hand up");
  check(st.raise("a", true) === "AlreadySpeaking", "a speaker has no hand to raise");
  check(st.cohost("a", "b", true) === "NotAllowed" && st.cohost("host", "a", true) === null, "only the host makes a speaker co-host");
  check(st.bring("a", "b") === null && st.isSpeaker("b"), "a co-host brings people up");
  check(st.down("a", "host") === "NotAllowed" && st.down("b", "a") === "NotAllowed", "nobody moves the host; a speaker cannot move a co-host");
  check(st.down("b", "b") === null && !st.isSpeaker("b"), "a speaker steps down");
  for (let i = 0; i < MAX_SPEAKERS + 2; i++) st.raise(`p${i}`, true);
  let full = null;
  for (let i = 0; i < MAX_SPEAKERS + 2 && !full; i++) full = st.bring("host", `p${i}`);
  check(full === "StageFull" && st.view().speakers.length === MAX_SPEAKERS, `the stage holds ${MAX_SPEAKERS} speakers`);
  st.leave("a");
  check(!st.isSpeaker("a") && !st.view().cohosts.includes("a"), "leaving the lobby leaves the stage");
  const late = createStage({ host: () => null });
  check(late.bring("x", "y") === "NotAllowed" && late.view().speakers.length === 0, "before the host is known, nobody runs the stage");
}

// ------------------------------------------------------------------ the server and the SFU
const calls = [];
const fakeSfu = async (url, init) => {
  const auth = readSfuToken(init.headers.authorization.replace("Bearer ", ""), "s3cret");
  calls.push({ url, admin: auth?.video?.roomAdmin === true && auth.video.room === JSON.parse(init.body).room, ...JSON.parse(init.body) });
  return { ok: true, status: 200 };
};
const voice = { url: "wss://sfu.example", apiKey: "k", apiSecret: "s3cret", fetch: fakeSfu };
const source = simulatedSource({ everySec: 1e9 });
const host = source.chain.lobby.host;
const server = await createServer({ guests: true, devSessions: true, voice, batchMs: 30, lobbies: [{ id: 412, opensAt: Date.now() - 1000 * 1000, source }] });
const base = `http://localhost:${server.port}`;
const tokens = { host: server.auth.issue(host), alice: server.auth.issue("alice"), guest: server.auth.issue("guest-1", { guest: true }) };
const inbox = { host: [], alice: [], guest: [] };
const links = Object.fromEntries(Object.keys(inbox).map((w) => [w, connectLobby({ base, lobby: 412, token: tokens[w], onMessage: (m) => inbox[w].push(m) })]));
await until(() => Object.values(inbox).every((m) => m.some((x) => x.t === "hello")));
const last = (w, pred) => [...inbox[w]].reverse().find(pred);
check(inbox.alice.find((m) => m.t === "hello").stage.host === host, `the hello carries the stage, hosted by the lobby's host (@${host})`);
const t0 = await voiceToken(base, tokens.alice, { lobby: 412 });
check(t0.url === voice.url && t0.room === "lobby-412" && !t0.canPublish && !readSfuToken(t0.token, "s3cret").video.canPublish, "a listener gets a listening token");
check((await voiceToken(base, tokens.guest, { lobby: 412 })).canPublish === false, "a guest may listen");
links.guest.hand(true);
check(await until(() => last("guest", (m) => m.t === "error")?.code === "SignInToSpeak"), "a guest cannot raise a hand");
links.alice.hand(true);
check(await until(() => last("host", (m) => m.t === "stage")?.hands.includes("alice")), "a raised hand reaches the host");
links.alice.bring("alice");
check(await until(() => last("alice", (m) => m.t === "error")?.code === "NotAllowed"), "nobody brings themselves up");
links.host.bring("alice");
check(await until(() => last("alice", (m) => m.t === "stage")?.speakers.includes("alice")), "the host brings Alice up; everyone sees it");
check(await until(() => calls.some((c) => c.identity === "alice" && c.permission.canPublish && c.room === "lobby-412" && c.admin)), "the SFU is told at once that she may publish (an admin token for that room)");
check((await voiceToken(base, tokens.alice, { lobby: 412 })).canPublish, "her next token publishes");
links.host.down("alice");
check(await until(() => calls.some((c) => c.identity === "alice" && !c.permission.canPublish)), "moved back to the audience, she is cut off at the SFU");
check(!(await voiceToken(base, tokens.alice, { lobby: 412 })).canPublish, "and her next token only listens");
links.alice.hand(true);
await until(() => last("host", (m) => m.t === "stage")?.hands.includes("alice"));
links.host.bring("alice");
await until(() => last("host", (m) => m.t === "stage")?.speakers.includes("alice"));
const before = calls.length;
links.alice.close();
check(await until(() => last("host", (m) => m.t === "stage" && !m.speakers.includes("alice"))) && await until(() => calls.length > before && !calls.at(-1).permission.canPublish),
  "closing her last tab takes her off the stage and off the SFU");
const nope = await fetch(`${base}/voice/token`, { method: "POST", headers: { authorization: "Bearer forged.x" }, body: "{}" });
check(nope.status === 401, "no token without a session");

// ------------------------------------------------------------------ the Campfire
server.clans.apply([
  { event: "Launched", mint: "MINT1", creator: "kai", name: "dogwifhat", symbol: "WIF" },
  { event: "LobbyLaunched", lobby: "l", mint: "MINT1", idea: 0, pot: 5n, founders: 2 },
  { event: "FounderJoined", lobby: "l", user: "alice", mint: "MINT1", amount: 3n, seq: 0 },
  { event: "FounderJoined", lobby: "l", user: "bob", mint: "MINT1", amount: 2n, seq: 1 },
]);
const ct = await voiceToken(base, server.auth.issue("bob"), { clan: "MINT1" });
check(ct.room === "clan-MINT1" && ct.canPublish, "a founder may talk in the Campfire");
check(await voiceToken(base, server.auth.issue("carol"), { clan: "MINT1" }).then(() => false, (e) => e.status === 403), "a non-member gets no Campfire token");
const cin = { kai: [], bob: [] };
const kai = connectClan({ base, mint: "MINT1", token: server.auth.issue("kai"), onMessage: (m) => cin.kai.push(m) });
const bob = connectClan({ base, mint: "MINT1", token: server.auth.issue("bob"), onMessage: (m) => cin.bob.push(m) });
await until(() => cin.kai.some((m) => m.t === "hello") && cin.bob.some((m) => m.t === "hello"));
bob.campfire(true);
check(await until(() => cin.kai.some((m) => m.t === "campfire" && m.people.includes("bob"))), "joining the Campfire is seen by the clan");
kai.mute("bob", 15);
check(await until(() => calls.some((c) => c.room === "clan-MINT1" && c.identity === "bob" && !c.permission.canPublish)), "a muted member is silenced at the SFU at once");
check(!(await voiceToken(base, server.auth.issue("bob"), { clan: "MINT1" })).canPublish, "and their next token only listens");
kai.mute("bob", 0);
check(await until(() => calls.some((c) => c.room === "clan-MINT1" && c.identity === "bob" && c.permission.canPublish)), "unmuted, they may talk again");
bob.close();
check(await until(() => cin.kai.some((m) => m.t === "campfire" && !m.people.includes("bob"))), "leaving takes them out of the Campfire");
kai.close();
for (const l of Object.values(links)) l.close();

const quiet = await createServer({ lobbies: [{ id: 1, opensAt: Date.now(), source: simulatedSource() }] });
check((await fetch(`http://localhost:${quiet.port}/voice/token`, { method: "POST", body: "{}" })).status === 503, "a server without an SFU says so (503)");
await quiet.close();

// ------------------------------------------------------------------ the host runs the stage from the app
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
  const browser = await chromium.launch();
  const app = (as) => browser.newPage({ viewport: { width: 1440, height: 900 } }).then(async (page) => {
    page.errors = [];
    page.on("pageerror", (e) => page.errors.push(e.message));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
    await page.goto(`http://localhost:${files.address().port}/index.html?live=${encodeURIComponent(base)}&as=${encodeURIComponent(as)}#/lobby`);
    await page.waitForTimeout(1000);
    return page;
  });
  const hostPage = await app(host);
  const dave = await app("dave");
  await dave.getByRole("button", { name: "Listen in" }).click();
  await dave.getByRole("button", { name: "Raise hand to pitch" }).click();
  check(await dave.getByText("Hand raised · the host will bring you up").waitFor({ timeout: 3000 }).then(() => true, () => false), "a listener raises a hand from the app");
  check(await hostPage.getByRole("region", { name: "Raised hands" }).or(hostPage.getByLabel("Raised hands")).getByText("dave").waitFor({ timeout: 3000 }).then(() => true, () => false), "the host sees the raised hand");
  await hostPage.getByRole("button", { name: "Bring up" }).click();
  check(await dave.getByText("You’re on stage · mic live").waitFor({ timeout: 3000 }).then(() => true, () => false), "brought up, the listener is on stage in their app");
  check(await until(() => calls.some((c) => c.identity === "dave" && c.permission.canPublish)), "and the SFU lets them publish");
  await dave.getByRole("button", { name: "Step down" }).click();
  check(await dave.getByText(/You’re back in the audience|Listening · you can raise your hand/).first().waitFor({ timeout: 3000 }).then(() => true, () => false), "they step down from the app");
  check(hostPage.errors.length === 0 && dave.errors.length === 0, "no script errors");
  await browser.close();
  files.close();
} else {
  console.log("  --  browser part skipped (app not built, or NO_BROWSER set)");
}

await server.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
