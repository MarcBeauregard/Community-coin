// One lobby's live room: who is inside and listening, the chat, the race and the phase, all on the server's clock.
// Pure logic: the server (server.mjs) wires sockets to it, the tests drive it directly. Updates are batched: the
// race and presence go out at most every `batchMs`, only what changed.

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

export function createRoom({ id, opensAt, source, now = () => Date.now(), chatSlowMs = 3000, chatMax = 200, historySize = 200, rate = { burst: 20, perSec: 2 } }) {
  const conns = new Map(); // connId -> { session, send, listening, lastChat, tokens, at }
  const history = [];
  let sent = { phase: null, race: new Map(), inside: -1, listening: -1, clockAt: 0 };
  let seq = 0;

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
      return { t: "hello", lobby: id, now: now(), opensAt, phase: phaseAt(elapsed()), race: raceRows(), ...presence(), chat: history.slice(-50), you: session.sub, guest: !!session.guest };
    },
    leave(connId) { conns.delete(connId); },
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
        default:
          return { t: "error", code: "UnknownMessage" };
      }
    },

    /** Runs every batch interval: phase changes, race deltas, presence, and the clock every 5 s. */
    tick() {
      const t = now();
      source.tick?.(elapsed());
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
