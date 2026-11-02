// One lobby's live room: who is inside and listening, the chat, the race and the phase, all on the server's clock.
// Pure logic: the server (server.mjs) wires sockets to it, the tests drive it directly. The voice stage's rules are
// in voice.mjs; the room relays them. Updates are batched: the
// race and presence go out at most every `batchMs`, only what changed.

import { createStage } from "./voice.mjs";
import { addSample } from "../src/race/curve.js";
import { symbolKey } from "../../src/protocol.js";

export const PHASES = [
  { id: "gather", end: 300 },
  { id: "floor", end: 1800 },
  { id: "pledge", end: 3300 },
  { id: "lock", end: 3600 },
];
export const phaseAt = (elapsed) => (elapsed < 0 ? "soon" : elapsed >= 3600 ? "done" : PHASES.find((p) => elapsed < p.end).id);

const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g;

/** Cleans a chat message: no control or bidi characters, trimmed, length-capped. Empty means refused. */
export function cleanText(text, max) {
  if (typeof text !== "string") return ""; // only text is text: an object here is someone poking at the server
  return text.toWellFormed().replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\u061C\u3164\uFEFF]/g, "").replace(CONTROL, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

// Tickers of coins everyone knows: a practice idea can't borrow them.
const RESERVED = new Set(["SOL", "WSOL", "MSOL", "USDC", "USDT", "PYUSD", "BTC", "WBTC", "ETH", "WETH", "XRP", "BNB", "JUP", "JTO", "PYTH", "RAY", "ORCA", "BONK", "PUMP", "TRUMP", "MELANIA", "PEPE", "DOGE", "SHIB", "PENGU", "FARTCO", "GOAT", "PNUT", "MOODEN"]);

export function createRoom({ id, opensAt, source, host = null, welcome = null, name = null, theme = null, hostName = null, onStage = null, crank = null, now = () => Date.now(), chatSlowMs = 3000, chatMax = 200, historySize = 200, rate = { burst: 20, perSec: 2 } }) {
  const conns = new Map(); // connId -> { session, send, listening, lastChat, tokens, at }
  const history = [];
  let sent = { phase: null, race: new Map(), inside: -1, listening: -1, clockAt: 0 };
  let outcome = { locked: null, launch: null }; // what the crank announced, for late joiners
  const settled = new Map(); // user -> their settled message, for when they come back
  let seq = 0;
  const cheers = { fire: 0, skull: 0 }; // reactions since the last batch
  const cheerTotal = { fire: 0, skull: 0 };
  // What the beta wants to know: who came, who signed in, who took part, who stayed to the lock.
  const stats = { visitors: new Set(), signedIn: new Set(), pledgers: new Set(), proposers: new Set(), chatters: new Set(), peakInside: 0, chats: 0, pledges: 0, atLock: null, launched: null }; // the lobby's, the same for everyone (late joiners get it in the hello)
  // Ideas reported to the host (who reported each), and the ones the host took out of the race.
  const reports = new Map();
  const removed = new Set(); // keys, as the program reads a ticker (case and look-alike digits folded)
  const keyOf = (sym) => { try { return typeof sym === "string" ? symbolKey(sym) : null; } catch { return null; } };
  // Beyond the program's own folding: other digits and letters that pass for one (RU6 for RUG, 8ONK for BONK).
  const LOOKS = { 6: "G", 9: "G", 8: "B", 2: "Z", V: "U" };
  const looks = (sym) => (typeof sym === "string" ? keyOf(sym.toUpperCase().replace(/[689V2]/g, (ch) => LOOKS[ch])) : null);
  const removedLooks = new Set();
  const isRemoved = (sym) => { const k = keyOf(sym); return (k !== null && removed.has(k)) || (looks(sym) !== null && removedLooks.has(looks(sym))); };
  const manages = (user) => { const v = stage.view(); return !!user && (user === v.host || v.cohosts.includes(user)); };
  // A settlement's transaction, when it is one on a cluster (a practice lobby's never is).
  const proof = (e) => (typeof e.signature === "string" && !source.practice ? { signature: e.signature, cluster: source.cluster ?? null } : {});
  const backedBy = (user) => { const ch = source.chain; const p = ch?.pledges.get(user); return p && ch.ideas[p.idea] ? ch.ideas[p.idea].symbol : null; };
  const reportCounts = () => Object.fromEntries([...reports].map(([sym, who]) => [sym, who.size]));
  const tellManagers = () => { const m = JSON.stringify({ t: "reports", reports: reportCounts() }); for (const c of conns.values()) if (manages(c.session.sub)) c.send(m); };
  // Practice SOL: what each signed-in wallet may play with in a practice lobby, minus what it has in play.
  const PRACTICE = 10_000_000_000n;
  function practiceBalance(user) {
    const ch = source.chain;
    if (!ch) return 0n;
    const p = ch.pledges.get(user);
    const held = p && !p.settled ? p.amount : 0n;
    const committed = p && p.settled && ch.lobby.launched && p.idea === ch.lobby.winner ? p.amount : 0n; // spent on the coin
    const bonds = ch.ideas.filter((d) => d.proposer === user && !d.bond_returned).length;
    return PRACTICE - held - committed - BigInt(bonds) * ch.lobby.bond;
  }
  const practiceOf = (user) => {
    if (!source.practice) return {};
    const p = source.chain.pledges.get(user);
    const mine = p && !p.settled && p.amount > 0n ? { symbol: source.chain.ideas[p.idea].symbol, amount: String(p.amount) } : null;
    return { mine, balance: String(practiceBalance(user)) };
  };

  // The stage: the lobby's host speaks first; `onStage(user, canPublish)` tells the SFU when someone's right changes.
  const stage = createStage({ host: host ?? (() => source.host?.() ?? null) });
  const stageChanged = (user, before) => {
    broadcast({ t: "stage", ...stageView() });
    if (user && before !== stage.isSpeaker(user)) onStage?.(user, stage.isSpeaker(user));
  };

  const elapsed = () => Math.floor((now() - opensAt) / 1000);
  // The race over the hour, for the per-idea curves and the replay: what the source already had, then each change.
  let curve = (source.chain?.seedCurve ?? []).filter((p) => p.t <= Math.max(0, elapsed()));
  const sample = () => {
    const totals = Object.fromEntries(source.ideas().map((d) => [d.symbol, Math.round(Number(d.pledged) / 1e6) / 1000]));
    curve = addSample(curve, Math.max(0, elapsed()), totals);
  };
  // What every joiner gets in its hello counts as sent: the first tick only sends what changed after it.
  queueMicrotask(() => { for (const r of raceRows()) sent.race.set(r.index, r); if (elapsed() < 3300) sample(); });
  const toOthers = (connId, user, msg) => { const m = JSON.stringify(msg); for (const [id, x] of conns) if (id !== connId && x.session.sub === user) x.send(m); };
  const broadcast = (msg) => { const s = JSON.stringify(msg); for (const c of conns.values()) c.send(s); };
  const raceRows = () => source.ideas().filter((d) => !isRemoved(d.symbol)).map((d) => ({ index: d.index, symbol: d.symbol, name: d.name, proposer: d.proposer ?? "", pledged: String(d.pledged), backers: d.backers }));
  // Who is in: everyone counted once (a person with two tabs is one), the guests among them, and the faces to show:
  // the last signed-in people to come in, newest first.
  const FACES = 12;
  function presence() {
    const users = new Set();
    const listening = new Set();
    const signed = [];
    let guests = 0;
    for (const c of conns.values()) {
      const sub = c.session.sub;
      if (!users.has(sub)) { if (c.session.guest) guests++; else signed.push(sub); }
      users.add(sub);
      if (c.listening) listening.add(sub);
    }
    const people = [];
    for (let i = signed.length - 1; i >= 0 && people.length < FACES; i--) people.push(signed[i]);
    return { inside: users.size, listening: listening.size, guests, people };
  }
  // The host's welcome, pinned for everyone who comes in.
  // The stage as everyone sees it: who is on it, and which of them isn't here right now (the host can be away).
  const stageView = () => {
    const v = stage.view();
    const here = new Set([...conns.values()].map((c) => c.session.sub));
    return { ...v, away: v.speakers.filter((u) => !here.has(u)) };
  };
  const welcomeLine = () => {
    const text = cleanText(welcome, 280);
    return text ? { text, from: host?.() ?? source.host?.() ?? null } : null;
  };

  return {
    id,
    size: () => conns.size,
    join(connId, session, send) {
      const first = ![...conns.values()].some((x) => x.session.sub === session.sub);
      stats.visitors.add(session.sub);
      if (!session.guest) stats.signedIn.add(session.sub);
      conns.set(connId, { session, send, listening: false, lastChat: -Infinity, tokens: rate.burst, at: now() });
      if (first && stage.isSpeaker(session.sub)) queueMicrotask(() => broadcast({ t: "stage", ...stageView() })); // back on stage
      if (settled.has(session.sub)) queueMicrotask(() => send(settled.get(session.sub))); // after the hello
      return { t: "hello", lobby: id, now: now(), opensAt, phase: phaseAt(elapsed()), race: raceRows(), ...presence(), chat: history.slice(-50), curve, welcome: welcomeLine(), ...(manages(session.sub) ? { reports: reportCounts() } : {}), you: session.sub, guest: !!session.guest, stage: stageView(), cheers: { ...cheerTotal }, info: { name, theme, host: host?.() ?? source.host?.() ?? null, hostName }, ...outcome,
        practice: !!source.practice, ...(source.practice && !session.guest ? practiceOf(session.sub) : {}) };
    },
    leave(connId) {
      const c = conns.get(connId);
      conns.delete(connId);
      // Their last tab gone: off the stage and out of the hand queue.
      if (c && ![...conns.values()].some((x) => x.session.sub === c.session.sub)) {
        const was = stage.isSpeaker(c.session.sub);
        const v = JSON.stringify(stage.view());
        stage.leave(c.session.sub);
        if (JSON.stringify(stage.view()) !== v) stageChanged(c.session.sub, was);
        else if (was) broadcast({ t: "stage", ...stageView() }); // the host stays on stage, away
      }
    },
    stage,
    setCrank(c) { crank = c; },
    /** The lobby's numbers for the beta: counts only, no names. `seen`: users already met in earlier lobbies. */
    stats(seen = new Set()) {
      const returning = [...stats.visitors].filter((u) => seen.has(u)).length;
      return { id, opensAt, name, phase: phaseAt(elapsed()), visitors: stats.visitors.size, signedIn: stats.signedIn.size, returning,
        proposers: stats.proposers.size, pledgers: stats.pledgers.size, pledges: stats.pledges, chatters: stats.chatters.size, chats: stats.chats,
        cheers: cheerTotal.fire + cheerTotal.skull, peakInside: stats.peakInside, insideAtLock: stats.atLock, launched: stats.launched,
        ideas: source.ideas().length };
    },
    visitors: () => stats.visitors,
    summary() { const p = presence(); return { id, opensAt, name, theme, phase: phaseAt(elapsed()), inside: p.inside, listening: p.listening }; },
    snapshot() { return { lobby: id, now: now(), opensAt, phase: phaseAt(elapsed()), race: raceRows(), ...presence(), chat: history.slice(-50) }; },

    /** Handles one message from a connection. Returns an error message to send back, `"close"` to drop it, or null. */
    receive(connId, raw) {
      const c = conns.get(connId);
      if (!c) return null;
      const t = now();
      // A reaction is light and dropped when it comes too fast: mashing 🔥 never costs the person their link.
      if (raw.length < 64 && /"t":"cheer"/.test(raw)) {
        let m;
        try { m = JSON.parse(raw); } catch { return null; }
        if (m.kind !== "fire" && m.kind !== "skull") return { t: "error", code: "BadMessage" };
        // Even dropped ones are frames: past 40 a second, it's a flood like any other.
        if (t - (c.cheerWindow ?? 0) >= 1000) { c.cheerWindow = t; c.cheerFrames = 0; }
        if (++c.cheerFrames > 40) return "close";
        if (t - (c.lastCheer ?? 0) < 250) return null;
        c.lastCheer = t;
        // Taps gathered by the app since its last send: up to 5 at once.
        const n = Number.isInteger(m.n) && m.n > 0 ? Math.min(5, m.n) : 1;
        cheers[m.kind] += n;
        c.cheers ??= { fire: 0, skull: 0 };
        c.cheers[m.kind] += n;
        return null;
      }
      // Token bucket: a burst, then a steady rate. Flooding closes the socket.
      c.tokens = Math.min(rate.burst, c.tokens + ((t - c.at) / 1000) * rate.perSec);
      c.at = t;
      if (c.tokens < 1) return "close";
      c.tokens -= 1;
      let msg;
      try { msg = JSON.parse(raw); } catch { return { t: "error", code: "BadMessage" }; }
      switch (msg?.t) {
        case "ping":
          return { t: "pong", now: t, echo: msg.echo };
        case "listen":
          c.listening = !!msg.on;
          return null;
        case "cheer": {
          // 🔥 or 💀 for whoever is pitching: anyone may, a few a second at most each; sent out in batches.
          if (msg.kind !== "fire" && msg.kind !== "skull") return { t: "error", code: "BadMessage" };
          if (t - (c.lastCheer ?? 0) < 250) return null;
          c.lastCheer = t;
          cheers[msg.kind]++;
          c.cheers ??= { fire: 0, skull: 0 };
          c.cheers[msg.kind]++;
          return null;
        }
        case "chat": {
          if (c.session.guest) return { t: "error", code: "SignInToChat" };
          if (phaseAt(elapsed()) === "soon") return { t: "error", code: "LobbyNotOpen" };
          if (t - c.lastChat < chatSlowMs) return { t: "error", code: "SlowMode", retryIn: chatSlowMs - (t - c.lastChat) };
          const text = cleanText(msg.text, chatMax);
          if (!text) return { t: "error", code: "EmptyMessage" };
          c.lastChat = t;
          const line = { id: ++seq, from: c.session.sub, text, at: t };
          stats.chats++;
          stats.chatters.add(c.session.sub);
          history.push(line);
          if (history.length > historySize) history.shift();
          broadcast({ t: "chat", line });
          return null;
        }
        case "report": {
          // Anyone signed in can tell the host an idea breaks the lobby's rules; once each.
          if (c.session.guest) return { t: "error", code: "SignInToReport" };
          const sym = typeof msg.symbol === "string" ? msg.symbol : "";
          if (!source.ideas().some((d) => keyOf(d.symbol) === keyOf(sym)) || isRemoved(sym)) return { t: "error", code: "UnknownIdea" };
          const canon = source.ideas().find((d) => keyOf(d.symbol) === keyOf(sym)).symbol;
          if (!reports.has(canon)) reports.set(canon, new Set());
          reports.get(canon).add(c.session.sub);
          tellManagers();
          toOthers(connId, c.session.sub, { t: "reported", symbol: canon, quiet: true });
          return { t: "reported", symbol: canon };
        }
        case "remove": {
          // The host (or a co-host) takes an idea out of the race: every pledge on it comes back now, and its bond, through
          // the program's own remove_idea and refund_removed. Practice lobbies only here (on a cluster the host signs it).
          if (!manages(c.session.sub)) return { t: "error", code: "HostOnly" };
          if (!source.practice) return { t: "error", code: "NotPractice" };
          if (phaseAt(elapsed()) === "lock" || phaseAt(elapsed()) === "done") return { t: "error", code: "PledgesLocked" };
          const ch = source.chain;
          const idea = ch.ideas.find((d) => keyOf(d.symbol) !== null && keyOf(d.symbol) === keyOf(msg.symbol));
          if (!idea || isRemoved(idea.symbol)) return { t: "error", code: "UnknownIdea" };
          // In the last five minutes nobody can swing the race: the program refuses any removal then.
          const done = ch.apply("remove_idea", { host: ch.lobby.host, symbol: idea.symbol }, elapsed());
          if (!done.ok) return { t: "error", code: done.error };
          const back = [];
          for (const [user, p] of ch.pledges) {
            if (p.idea !== idea.index || p.settled || p.closed || p.amount === 0n) continue;
            const amount = p.amount;
            if (ch.apply("refund_removed", { user, symbol: idea.symbol }, elapsed()).ok) back.push([user, amount]);
          }
          removed.add(keyOf(idea.symbol));
          removedLooks.add(looks(idea.symbol));
          // The race over the hour forgets it too: a replay never tells the story of a removed idea.
          curve = curve.map((p) => { const { [idea.symbol]: _, ...v } = p.v; return { ...p, v }; });
          reports.delete(idea.symbol);
          broadcast({ t: "removed", symbol: idea.symbol, by: c.session.sub, race: raceRows() });
          for (const r of raceRows()) sent.race.set(r.index, r);
          // Each person it concerned hears what came back.
          for (const x of conns.values()) {
            const u = x.session.sub;
            const mine = back.find(([who]) => who === u);
            if (mine || idea.proposer === u) x.send(JSON.stringify({ t: "refunded", symbol: idea.symbol, amount: String(mine?.[1] ?? 0n), bond: idea.proposer === u ? String(ch.lobby.bond) : "0", ...practiceOf(u) }));
          }
          tellManagers();
          return null;
        }
        case "pledge": case "withdraw": case "move": case "propose": {
          // The practice lobby's money, for signed-in people only, through the program's rules.
          if (!source.practice) return { t: "error", code: "NotPractice" };
          if (c.session.guest) return { t: "error", code: "SignInToPledge" };
          const me = c.session.sub;
          const text = (v, max) => (typeof v === "string" && v.length <= max ? v : null);
          const lamports = (v) => (typeof v === "string" && /^\d{1,20}$/.test(v) ? BigInt(v) : null);
          const args = msg.t === "pledge" ? { user: me, symbol: text(msg.symbol, 12), amount: lamports(msg.amount) }
            : msg.t === "withdraw" ? { user: me, symbol: text(msg.symbol, 12), amount: lamports(msg.amount) }
            : msg.t === "move" ? { user: me, from: text(msg.from, 12), to: text(msg.to, 12) }
            : { proposer: me, symbol: text(msg.symbol, 12), name: text(msg.name, 40) };
          if (Object.values(args).some((v) => v === null)) return { t: "error", code: "BadMessage" };
          // An idea as the app lets anyone write one: a ticker of 2 to 6 capitals or digits, a plain name, not a
          // coin everyone knows.
          if (msg.t === "propose") {
            args.name = cleanText(args.name, 24);
            if (!/^[A-Z0-9]{2,6}$/.test(args.symbol) || args.name.length < 2 || /[<>]/.test(args.name)) return { t: "practice", op: msg.t, ok: false, error: "BadIdea", ...practiceOf(me) };
            if (source.chain.ideas.filter((d) => d.proposer === me).length >= 2) return { t: "practice", op: msg.t, ok: false, error: "TwoIdeasEach", ...practiceOf(me) };
            if ([...RESERVED].some((r) => keyOf(r) === keyOf(args.symbol) || looks(r) === looks(args.symbol)) || isRemoved(args.symbol)) return { t: "practice", op: msg.t, ok: false, error: "MemeExists", ...practiceOf(me) };
          }
          if (isRemoved(args.symbol) || isRemoved(args.to)) return { t: "practice", op: msg.t, ok: false, error: "IdeaRemoved", ...practiceOf(me) };
          if ((msg.t === "pledge" || msg.t === "propose") && practiceBalance(me) < (msg.t === "pledge" ? args.amount : source.chain.lobby.bond)) {
            return { t: "practice", op: msg.t, ok: false, error: "NotEnoughPractice", ...practiceOf(me) };
          }
          const op = { pledge: "pledge", withdraw: "withdraw", move: "move_pledge", propose: "propose_idea" }[msg.t];
          const r = source.chain.apply(op, args, elapsed());
          // The person's other tabs follow (their pledge and practice SOL), the asking one gets the answer.
          if (r.ok) toOthers(connId, me, { t: "mine", ...practiceOf(me) });
          if (r.ok && msg.t === "pledge") { stats.pledges++; stats.pledgers.add(me); }
          if (r.ok && msg.t === "propose") stats.proposers.add(me);
          const sym = args.symbol ?? args.to;
          const held = source.chain.ideas.find((d) => d.symbol === sym)?.pledged;
          return { t: "practice", op: msg.t, ok: r.ok, error: r.error ?? null, ...practiceOf(me), ...(held !== undefined ? { holds: String(held) } : {}) };
        }
        case "hand": case "bring": case "down": case "cohost": {
          if (c.session.guest) return { t: "error", code: "SignInToSpeak" };
          const me = c.session.sub;
          const named = typeof msg.user === "string" ? msg.user : "";
          const target = msg.t === "hand" ? me : msg.t === "down" ? named || me : named;
          const was = stage.isSpeaker(target);
          const code = msg.t === "hand" ? stage.raise(me, !!msg.up)
            : msg.t === "bring" ? stage.bring(me, target)
            : msg.t === "down" ? stage.down(me, target)
            : stage.cohost(me, target, !!msg.on);
          if (code) return { t: "error", code };
          stageChanged(target, was);
          return null;
        }
        default:
          return { t: "error", code: "UnknownMessage" };
      }
    },

    /**
     * What the crank did, told to the room: the lock (who won), the launch (the ceremony), and to each wallet what
     * happened to its pledge (refunded, or founder with its rank in the clan, from the registry).
     */
    announce(events, clans = null) {
      const names = Object.fromEntries(events.filter((e) => e.event === "Launched").map((e) => [e.mint, e]));
      for (const e of events) {
        if (e.event === "LobbyFinalized") {
          outcome.locked = { winner: e.winner === 255 ? null : e.winner, pot: String(e.pot), total: String(e.total) };
          broadcast({ t: "locked", ...outcome.locked });
        } else if (e.event === "WinnerVoided") {
          // The winner's ticker was taken elsewhere before the launch: no coin, everyone is refunded.
          outcome.locked = { ...outcome.locked, voided: true };
          broadcast({ t: "voided", idea: e.idea });
        } else if (e.event === "LobbyLaunched") {
          stats.launched = names[e.mint]?.symbol ?? null;
          outcome.launch = { mint: e.mint, idea: e.idea, pot: String(e.pot), founders: e.founders, symbol: names[e.mint]?.symbol, name: names[e.mint]?.name, cluster: source.practice ? null : source.cluster ?? null };
          broadcast({ t: "launch", ...outcome.launch });
        } else if (e.event === "PledgeRefunded" || e.event === "FounderJoined") {
          const msg = JSON.stringify(e.event === "PledgeRefunded"
            ? { t: "settled", kind: "refund", amount: String(e.amount), symbol: backedBy(e.user), ...proof(e), ...practiceOf(e.user) }
            : { t: "settled", kind: "founder", amount: String(e.amount), rank: clans?.rankOf(e.mint, e.user) ?? null, mint: e.mint, ...proof(e) });
          settled.set(e.user, msg);
          for (const c of conns.values()) if (c.session.sub === e.user) c.send(msg);
        } else if (e.event === "BondReturned" && e.proposer) {
          // The proposer's bond, back at the lock: said to them, with their practice SOL now.
          const msg = JSON.stringify({ t: "settled", kind: "bond", amount: String(e.amount), symbol: source.chain?.ideas[e.idea]?.symbol ?? null, ...proof(e), ...practiceOf(e.proposer) });
          for (const c of conns.values()) if (c.session.sub === e.proposer) c.send(msg);
        }
      }
    },

    /** Runs every batch interval: phase changes, race deltas, presence, and the clock every 5 s. */
    tick() {
      const t = now();
      source.tick?.(elapsed());
      crank?.tick(elapsed())?.catch?.((e) => console.error(`crank: ${e.message}`));
      const phase = phaseAt(elapsed());
      if (phase !== sent.phase) {
        if (sent.phase !== null) broadcast({ t: "phase", phase, now: t });
        sent.phase = phase;
      }
      const changed = raceRows().filter((r) => {
        const prev = sent.race.get(r.index);
        return !prev || prev.pledged !== r.pledged || prev.backers !== r.backers;
      });
      if (changed.length) {
        if (elapsed() < 3300) sample(); // the race ends at the lock
        for (const r of changed) sent.race.set(r.index, r);
        broadcast({ t: "race", ideas: changed });
      }
      if (cheers.fire || cheers.skull) {
        cheerTotal.fire += cheers.fire;
        cheerTotal.skull += cheers.skull;
        // Each one sees everyone else's fly (their own already flew) and everyone gets the same totals.
        for (const c of conns.values()) {
          const fire = cheers.fire - (c.cheers?.fire ?? 0);
          const skull = cheers.skull - (c.cheers?.skull ?? 0);
          c.cheers = null;
          c.send(JSON.stringify({ t: "cheers", fire, skull, total: { ...cheerTotal } }));
        }
        cheers.fire = 0;
        cheers.skull = 0;
      }
      const p = presence();
      stats.peakInside = Math.max(stats.peakInside, p.inside);
      if (stats.atLock === null && elapsed() >= 3300) stats.atLock = p.inside;
      const faces = p.people.join();
      if (p.inside !== sent.inside || p.listening !== sent.listening || faces !== sent.faces) {
        broadcast({ t: "presence", ...p });
        sent.inside = p.inside;
        sent.listening = p.listening;
        sent.faces = faces;
      }
      if (t - sent.clockAt >= 5000) {
        broadcast({ t: "clock", now: t });
        sent.clockAt = t;
      }
    },
  };
}
