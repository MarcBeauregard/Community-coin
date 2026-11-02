// One lobby's live room: who is inside and listening, the chat, the race and the phase, all on the server's clock.
// Pure logic: the server (server.mjs) wires sockets to it, the tests drive it directly. The voice stage's rules are
// in voice.mjs; the room relays them. Updates are batched: the
// race and presence go out at most every `batchMs`, only what changed.

import { createStage } from "./voice.mjs";
import { addSample } from "../src/race/curve.js";

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
  return String(text ?? "").replace(CONTROL, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function createRoom({ id, opensAt, source, host = null, welcome = null, onStage = null, crank = null, now = () => Date.now(), chatSlowMs = 3000, chatMax = 200, historySize = 200, rate = { burst: 20, perSec: 2 } }) {
  const conns = new Map(); // connId -> { session, send, listening, lastChat, tokens, at }
  const history = [];
  let sent = { phase: null, race: new Map(), inside: -1, listening: -1, clockAt: 0 };
  let outcome = { locked: null, launch: null }; // what the crank announced, for late joiners
  const settled = new Map(); // user -> their settled message, for when they come back
  let seq = 0;
  const cheers = { fire: 0, skull: 0 }; // reactions since the last batch
  // Ideas reported to the host (who reported each), and the ones the host took out of the race.
  const reports = new Map();
  const removed = new Set();
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
    broadcast({ t: "stage", ...stage.view() });
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
  const raceRows = () => source.ideas().filter((d) => !removed.has(d.symbol)).map((d) => ({ index: d.index, symbol: d.symbol, name: d.name, proposer: d.proposer ?? "", pledged: String(d.pledged), backers: d.backers }));
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
  const welcomeLine = () => {
    const text = cleanText(welcome, 280);
    return text ? { text, from: host?.() ?? source.host?.() ?? null } : null;
  };

  return {
    id,
    size: () => conns.size,
    join(connId, session, send) {
      conns.set(connId, { session, send, listening: false, lastChat: -Infinity, tokens: rate.burst, at: now() });
      if (settled.has(session.sub)) queueMicrotask(() => send(settled.get(session.sub))); // after the hello
      return { t: "hello", lobby: id, now: now(), opensAt, phase: phaseAt(elapsed()), race: raceRows(), ...presence(), chat: history.slice(-50), curve, welcome: welcomeLine(), ...(manages(session.sub) ? { reports: reportCounts() } : {}), you: session.sub, guest: !!session.guest, stage: stage.view(), ...outcome,
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
      }
    },
    stage,
    setCrank(c) { crank = c; },
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
        if (t - (c.lastCheer ?? 0) < 250) return null;
        c.lastCheer = t;
        cheers[m.kind]++;
        c.cheers ??= { fire: 0, skull: 0 };
        c.cheers[m.kind]++;
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
          history.push(line);
          if (history.length > historySize) history.shift();
          broadcast({ t: "chat", line });
          return null;
        }
        case "report": {
          // Anyone signed in can tell the host an idea breaks the lobby's rules; once each.
          if (c.session.guest) return { t: "error", code: "SignInToReport" };
          const sym = typeof msg.symbol === "string" ? msg.symbol : "";
          if (!source.ideas().some((d) => d.symbol === sym) || removed.has(sym)) return { t: "error", code: "UnknownIdea" };
          if (!reports.has(sym)) reports.set(sym, new Set());
          reports.get(sym).add(c.session.sub);
          tellManagers();
          toOthers(connId, c.session.sub, { t: "reported", symbol: sym, quiet: true });
          return { t: "reported", symbol: sym };
        }
        case "remove": {
          // The host (or a co-host) takes an idea out of the race: every pledge on it comes back now, and its bond.
          // Practice lobbies only: the lobby program has no such instruction yet (PLAN.md).
          if (!manages(c.session.sub)) return { t: "error", code: "HostOnly" };
          if (!source.practice) return { t: "error", code: "NotPractice" };
          if (phaseAt(elapsed()) === "lock" || phaseAt(elapsed()) === "done") return { t: "error", code: "PledgesLocked" };
          const ch = source.chain;
          const idea = ch.ideas.find((d) => d.symbol === msg.symbol);
          if (!idea || removed.has(idea.symbol)) return { t: "error", code: "UnknownIdea" };
          const back = [];
          for (const [user, p] of ch.pledges) {
            if (p.idea !== idea.index || p.settled || p.amount === 0n) continue;
            const amount = p.amount;
            if (ch.apply("withdraw", { user, symbol: idea.symbol, amount }, elapsed()).ok) back.push([user, amount]);
          }
          idea.bond_returned = true; // the proposer's practice bond (src/chain/rules.js has no instruction for this)
          removed.add(idea.symbol);
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
          if (removed.has(args.symbol) || removed.has(args.to)) return { t: "practice", op: msg.t, ok: false, error: "IdeaRemoved", ...practiceOf(me) };
          if ((msg.t === "pledge" || msg.t === "propose") && practiceBalance(me) < (msg.t === "pledge" ? args.amount : source.chain.lobby.bond)) {
            return { t: "practice", op: msg.t, ok: false, error: "NotEnoughPractice", ...practiceOf(me) };
          }
          const op = { pledge: "pledge", withdraw: "withdraw", move: "move_pledge", propose: "propose_idea" }[msg.t];
          const r = source.chain.apply(op, args, elapsed());
          // The person's other tabs follow (their pledge and practice SOL), the asking one gets the answer.
          if (r.ok) toOthers(connId, me, { t: "mine", ...practiceOf(me) });
          return { t: "practice", op: msg.t, ok: r.ok, error: r.error ?? null, ...practiceOf(me) };
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
        // Each one hears everyone else's (their own already flew on their screen).
        for (const c of conns.values()) {
          const fire = cheers.fire - (c.cheers?.fire ?? 0);
          const skull = cheers.skull - (c.cheers?.skull ?? 0);
          c.cheers = null;
          if (fire || skull) c.send(JSON.stringify({ t: "cheers", fire, skull }));
        }
        cheers.fire = 0;
        cheers.skull = 0;
      }
      const p = presence();
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
