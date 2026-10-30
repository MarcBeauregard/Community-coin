// One lobby's live room: who is inside and listening, the chat, the race and the phase, all on the server's clock.
// Pure logic: the server (server.mjs) wires sockets to it, the tests drive it directly. The voice stage's rules are
// in voice.mjs; the room relays them. Updates are batched: the
// race and presence go out at most every `batchMs`, only what changed.

import { createStage } from "./voice.mjs";

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

export function createRoom({ id, opensAt, source, host = null, onStage = null, crank = null, now = () => Date.now(), chatSlowMs = 3000, chatMax = 200, historySize = 200, rate = { burst: 20, perSec: 2 } }) {
  const conns = new Map(); // connId -> { session, send, listening, lastChat, tokens, at }
  const history = [];
  let sent = { phase: null, race: new Map(), inside: -1, listening: -1, clockAt: 0 };
  let outcome = { locked: null, launch: null }; // what the crank announced, for late joiners
  const settled = new Map(); // user -> their settled message, for when they come back
  let seq = 0;
  // The stage: the lobby's host speaks first; `onStage(user, canPublish)` tells the SFU when someone's right changes.
  const stage = createStage({ host: host ?? (() => source.host?.() ?? null) });
  const stageChanged = (user, before) => {
    broadcast({ t: "stage", ...stage.view() });
    if (user && before !== stage.isSpeaker(user)) onStage?.(user, stage.isSpeaker(user));
  };

  const elapsed = () => Math.floor((now() - opensAt) / 1000);
  // What every joiner gets in its hello counts as sent: the first tick only sends what changed after it.
  queueMicrotask(() => { for (const r of raceRows()) sent.race.set(r.index, r); });
  const broadcast = (msg) => { const s = JSON.stringify(msg); for (const c of conns.values()) c.send(s); };
  const raceRows = () => source.ideas().map((d) => ({ index: d.index, symbol: d.symbol, name: d.name, pledged: String(d.pledged), backers: d.backers }));
  function presence() {
    const users = new Set();
    const listening = new Set();
    for (const c of conns.values()) {
      users.add(c.session.sub);
      if (c.listening) listening.add(c.session.sub);
    }
    return { inside: users.size, listening: listening.size };
  }

  return {
    id,
    size: () => conns.size,
    join(connId, session, send) {
      conns.set(connId, { session, send, listening: false, lastChat: -Infinity, tokens: rate.burst, at: now() });
      if (settled.has(session.sub)) queueMicrotask(() => send(settled.get(session.sub))); // after the hello
      return { t: "hello", lobby: id, now: now(), opensAt, phase: phaseAt(elapsed()), race: raceRows(), ...presence(), chat: history.slice(-50), you: session.sub, guest: !!session.guest, stage: stage.view(), ...outcome };
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
      // Token bucket: a burst, then a steady rate. Flooding closes the socket.
      const t = now();
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
          outcome.launch = { mint: e.mint, idea: e.idea, pot: String(e.pot), founders: e.founders, symbol: names[e.mint]?.symbol, name: names[e.mint]?.name };
          broadcast({ t: "launch", ...outcome.launch });
        } else if (e.event === "PledgeRefunded" || e.event === "FounderJoined") {
          const msg = JSON.stringify(e.event === "PledgeRefunded"
            ? { t: "settled", kind: "refund", amount: String(e.amount) }
            : { t: "settled", kind: "founder", amount: String(e.amount), rank: clans?.rankOf(e.mint, e.user) ?? null, mint: e.mint });
          settled.set(e.user, msg);
          for (const c of conns.values()) if (c.session.sub === e.user) c.send(msg);
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
        for (const r of changed) sent.race.set(r.index, r);
        broadcast({ t: "race", ideas: changed });
      }
      const p = presence();
      if (p.inside !== sent.inside || p.listening !== sent.listening) {
        broadcast({ t: "presence", ...p });
        sent.inside = p.inside;
        sent.listening = p.listening;
      }
      if (t - sent.clockAt >= 5000) {
        broadcast({ t: "clock", now: t });
        sent.clockAt = t;
      }
    },
  };
}
