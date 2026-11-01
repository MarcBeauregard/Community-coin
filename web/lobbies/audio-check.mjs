// Checks the app's voice audio in Chromium: LiveKit loads only when someone joins the voice; a listener joins with a
// listening token; brought on stage, their real (fake-device) microphone turns on; the faces of whoever the room
// hears light up; a browser that blocks sound gets a "Tap to hear" button; a blocked microphone and a dropped
// network are explained; leaving disconnects. LiveKit's Room is stood in for (no SFU runs here); its events are
// LiveKit's own names, so the app's handling is the real one.
// Usage: node web/lobbies/audio-check.mjs   (after npm run build:lobbies)

import { createRequire } from "node:module";
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { RoomEvent } from "livekit-client";
import { createServer } from "./server/server.mjs";
import { simulatedSource } from "./server/sources.mjs";
import { readSfuToken } from "./server/voice.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
let failures = 0;
const check = (cond, msg) => { if (cond) console.log(`  ok  ${msg}`); else { failures++; console.log(`FAIL  ${msg}`); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await cond()) return true; await wait(50); }
  return cond();
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

const admin = [];
const voice = { url: "ws://127.0.0.1:9", apiKey: "k", apiSecret: "secret", fetch: async (_u, init) => { admin.push(JSON.parse(init.body)); return { ok: true, status: 200 }; } };
const source = simulatedSource({ everySec: 1e9 });
const host = source.chain.lobby.host;
const server = await createServer({ guests: true, devSessions: true, voice, batchMs: 40, lobbies: [{ id: 412, opensAt: Date.now() - 1452 * 1000, source }] });
const base = `http://localhost:${server.port}`;
const appUrl = (as) => `http://localhost:${files.address().port}/index.html?live=${encodeURIComponent(base)}&as=${encodeURIComponent(as)}#/lobby`;

const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });

// The stand-in Room: records what the app asks, and lets the test play the SFU's events.
function fakeLiveKit({ RoomEvent, autoplay }) {
  const calls = { connect: [], mic: [], startAudio: 0, disconnect: 0 };
  class Room {
    constructor() { this.handlers = {}; this.canPlaybackAudio = autoplay; this.localParticipant = { permissions: { canPublish: true }, setMicrophoneEnabled: async (on) => {
      calls.mic.push(on);
      if (on) { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); this.stream = s; } else this.stream?.getTracks().forEach((t) => t.stop());
    } }; window.__lk.room = this; }
    on(ev, f) { (this.handlers[ev] ??= []).push(f); return this; }
    emit(ev, ...args) { (this.handlers[ev] ?? []).forEach((f) => f(...args)); }
    async connect(url, token) { calls.connect.push({ url, token }); await new Promise((r) => setTimeout(r, 150)); }
    async startAudio() { calls.startAudio++; this.canPlaybackAudio = true; this.emit(RoomEvent.AudioPlaybackStatusChanged); }
    async disconnect() { calls.disconnect++; this.emit(RoomEvent.Disconnected); }
  }
  window.__lk = { calls, room: null };
  window.__lobbiesLiveKit = { Room, RoomEvent, Track: { Kind: { Audio: "audio" } } };
}
async function open(as, { autoplay = true, fake = true, grantMic = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: grantMic ? ["microphone"] : [] });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.requested = [];
  page.on("request", (r) => page.requested.push(r.url()));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  if (fake) await page.addInitScript(fakeLiveKit, { RoomEvent: JSON.parse(JSON.stringify(RoomEvent)), autoplay });
  await page.goto(appUrl(as));
  await page.waitForTimeout(900);
  await page.getByRole("tab", { name: "Stage" }).click().catch(() => {});
  return page;
}
const lk = (page) => page.evaluate(() => window.__lk.calls);
const emit = (page, ev, ...args) => page.evaluate(([ev, args]) => window.__lk.room.emit(ev, ...args), [ev, args]);

// ------------------------------------------------------------------ LiveKit loads only for voice
{
  const page = await open("loader", { fake: false });
  check(!page.requested.some((u) => /chunks\/livekit/.test(u)), "the app opens without loading LiveKit");
  await page.getByRole("button", { name: "Listen in" }).click();
  check(await until(() => page.requested.some((u) => /chunks\/livekit/.test(u))), "joining the voice loads it");
  check(await page.getByText("Voice couldn’t connect").first().waitFor({ timeout: 20000 }).then(() => true, () => false), "an SFU that can't be reached is explained; the lobby keeps working");
  await page.context().close();
}

// ------------------------------------------------------------------ listen, get brought up, speak, be heard
const hostPage = await open(host);
const dave = await open("dave");
await dave.getByRole("button", { name: "Listen in" }).click();
check(await until(async () => (await lk(dave)).connect.length === 1), "listening joins the stage's voice room");
const joined = (await lk(dave)).connect[0];
const claims = readSfuToken(joined.token, "secret");
check(joined.url === voice.url && claims.video.room === "lobby-412" && claims.sub === "dave" && !claims.video.canPublish, "with a listening token from the server");
check((await lk(dave)).mic.length === 0, "a listener's microphone is never asked for");
await dave.getByRole("button", { name: "Raise hand to pitch" }).click();
await hostPage.getByRole("button", { name: "Bring up" }).click();
check(await until(async () => (await lk(dave)).mic.at(-1) === true), "brought on stage, the microphone turns on");
check(await dave.getByText("You’re on stage · mic live").waitFor({ timeout: 3000 }).then(() => true, () => false), "and the stage says so");
check(await until(() => admin.some((c) => c.identity === "dave" && c.permission.canPublish)), "the SFU was told first that dave may speak");
check(await hostPage.getByRole("button", { name: "Join the stage" }).isVisible() && (await lk(hostPage)).mic.length === 0, "the host's microphone stays off until the host chooses to join");
await hostPage.getByRole("button", { name: "Join the stage" }).click();
check(await until(async () => (await lk(hostPage)).mic.at(-1) === true), "joining, the host is live at once");
await emit(hostPage, RoomEvent.ActiveSpeakersChanged, [{ identity: "dave" }]);
check(await until(() => hostPage.locator(".speakers .av.speaking").count().then((n) => n === 1)), "whoever the room hears lights up for everyone else");
await emit(hostPage, RoomEvent.ActiveSpeakersChanged, []);
check(await until(() => hostPage.locator(".speakers .av.speaking").count().then((n) => n === 0)), "and goes dark when they stop");
await dave.getByRole("button", { name: "Mute" }).click();
check(await until(async () => (await lk(dave)).mic.at(-1) === false), "Mute turns the microphone off");
await dave.getByRole("button", { name: "Unmute" }).click();
check(await until(async () => (await lk(dave)).mic.at(-1) === true), "Unmute turns it back on");
await emit(dave, RoomEvent.Reconnecting);
check(await dave.getByText("Reconnecting to the stage…").waitFor({ timeout: 2000 }).then(() => true, () => false), "a network drop says it is reconnecting");
await emit(dave, RoomEvent.Reconnected);
check(await dave.getByText("You’re on stage · mic live").waitFor({ timeout: 2000 }).then(() => true, () => false), "and recovers");
await dave.getByRole("button", { name: "Step down" }).click();
check(await until(async () => (await lk(dave)).mic.at(-1) === false), "stepping down turns the microphone off");
await dave.getByRole("button", { name: "Leave audio" }).click();
check(await until(async () => (await lk(dave)).disconnect >= 1), "leaving the audio leaves the voice room");
check(hostPage.errors.length === 0 && dave.errors.length === 0, "no script errors");

// ------------------------------------------------------------------ a browser that blocks sound, a blocked microphone
{
  const page = await open("erin", { autoplay: false });
  await page.getByRole("button", { name: "Listen in" }).click();
  const tap = page.getByRole("button", { name: "Tap to hear the stage" });
  check(await tap.waitFor({ timeout: 3000 }).then(() => true, () => false), "when the browser blocks sound, a button asks for the tap it needs");
  await tap.click();
  check(await until(async () => (await lk(page)).startAudio === 1 && !(await tap.isVisible())), "one tap and the sound plays; the button goes");
  await page.context().close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.addInitScript(fakeLiveKit, { RoomEvent: JSON.parse(JSON.stringify(RoomEvent)), autoplay: true });
  // The microphone refused, as a browser does when the person says no.
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("Permission denied", "NotAllowedError"); }; });
  await page.goto(appUrl("finn"));
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: "Listen in" }).click();
  await page.getByRole("button", { name: "Raise hand to pitch" }).click();
  await hostPage.getByRole("button", { name: "Bring up" }).click();
  check(await page.getByText("Your browser blocked the microphone").first().waitFor({ timeout: 4000 }).then(() => true, () => false), "a blocked microphone is explained, with what to do");
  await ctx.close();
}

await browser.close();
await server.close();
files.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
