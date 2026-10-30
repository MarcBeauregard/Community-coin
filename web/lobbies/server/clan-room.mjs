// One clan's rooms: its text channels, forever. Only members read and write: the founders (the chain says who, via
// the clan registry) and the creator of the winning idea, who is the clan's first moderator and may name others.
//
// Members post text (cleaned, capped) with up to 4 media they uploaded to this clan, react, delete their own
// messages, and report others'. Moderators delete anything, mute a member for a while, set a channel's slow mode,
// and restore a message the reports hid. The Campfire is the clan's voice room: every member may talk unless muted. A message reported by 3 members is hidden until a moderator looks at it.
// Every action is appended to a log (`store`), replayed at start, and compacted so deleted text is not kept.

import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { cleanText } from "./room.mjs";

export const CHANNELS = ["general", "memes", "alpha", "art-lab", "next-lobby"];
export const REACTIONS = ["heart", "fire", "laugh", "rocket", "eyes"];
export const LIMITS = { text: 2000, media: 4, history: 500, page: 50, reportsToHide: 3, maxSlowSec: 300, maxMuteMin: 7 * 24 * 60 };

/** An append-only log in memory (tests). */
export function memoryStore() {
  let records = [];
  return { load: () => records, append: (r) => records.push(r), rewrite: (rs) => { records = rs; } };
}

/** The same log on disk, one JSON record per line; rewritten through a temporary file so a crash never loses it. */
export function fileStore(path) {
  return {
    // A line torn by a crash mid-write is skipped, not fatal.
    load: () => (existsSync(path) ? readFileSync(path, "utf8").split("\n").flatMap((l) => { try { return l ? [JSON.parse(l)] : []; } catch { return []; } }) : []),
    append: (r) => appendFileSync(path, `${JSON.stringify(r)}\n`),
    rewrite(rs) {
      writeFileSync(`${path}.tmp`, rs.map((r) => `${JSON.stringify(r)}\n`).join(""));
      renameSync(`${path}.tmp`, path);
    },
  };
}

export function createClanRoom({ mint, clans, media, store = memoryStore(), onVoice = null, now = () => Date.now(), rate = { burst: 20, perSec: 2 }, minGapMs = 700 }) {
  const conns = new Map(); // connId -> { user, send, tokens, at, lastPost }
  const channels = new Map(CHANNELS.map((c) => [c, { lines: [], slowSec: 0 }]));
  const byId = new Map(); // message id -> line
  const mods = new Set();
  const muted = new Map(); // user -> until (ms)
  const campfire = new Set(); // members in the voice room right now (the SFU carries the audio; voice.mjs)
  let seq = 0;

  const clan = () => clans.get(mint);
  const creator = () => clan()?.creator ?? null;
  const isMember = (user) => clans.isFounder(mint, user) || user === creator();
  const isMod = (user) => user === creator() || mods.has(user);
  const roleOf = (user) => (user === creator() ? "creator" : mods.has(user) ? "mod" : "founder");
  const rankOf = (user) => clans.rankOf(mint, user);

  // The public form of a message: hidden ones lose their content for everyone but moderators and the author.
  const view = (l, user) => {
    const hide = l.deleted || (l.hidden && !isMod(user) && l.from !== user);
    const reactions = Object.fromEntries(REACTIONS.map((r) => [r, l.reactions[r]?.size ?? 0]));
    const mine = REACTIONS.filter((r) => l.reactions[r]?.has(user));
    return { id: l.id, ch: l.ch, from: l.from, role: roleOf(l.from), rank: rankOf(l.from), at: l.at, reply: l.reply,
      text: hide ? "" : l.text, media: hide ? [] : l.media, reactions, mine, deleted: !!l.deleted, hidden: !!l.hidden,
      reported: isMod(user) ? l.reports.size : undefined };
  };
  const sendTo = (pred, make) => { for (const c of conns.values()) if (pred(c)) c.send(JSON.stringify(make(c.user))); };
  const everyone = (make) => sendTo(() => true, make);

  // ---------------------------------------------------------------- the state machine (live and on replay)
  function apply(r) {
    const l = r.id ? byId.get(r.id) : null;
    switch (r.k) {
      case "post": {
        const line = { id: r.id, ch: r.ch, from: r.from, text: r.text, media: r.media, reply: r.reply ?? null, at: r.at, reactions: {}, reports: new Set(), hidden: false, deleted: false };
        const chan = channels.get(r.ch);
        chan.lines.push(line);
        byId.set(line.id, line);
        seq = Math.max(seq, line.id);
        if (chan.lines.length > LIMITS.history) byId.delete(chan.lines.shift().id);
        return line;
      }
      case "react": {
        if (!l) return null;
        const set = (l.reactions[r.emoji] ??= new Set());
        if (r.on) set.add(r.by); else set.delete(r.by);
        return l;
      }
      case "delete": if (l) { l.deleted = true; l.text = ""; l.media = []; } return l;
      case "report": if (l) { l.reports.add(r.by); if (l.reports.size >= LIMITS.reportsToHide) l.hidden = true; } return l;
      case "restore": if (l) { l.hidden = false; l.reports.clear(); } return l;
      case "mute": if (r.until > 0) muted.set(r.user, r.until); else muted.delete(r.user); return null;
      case "slow": channels.get(r.ch).slowSec = r.sec; return null;
      case "mod": if (r.on) mods.add(r.user); else mods.delete(r.user); return null;
      default: return null;
    }
  }
  const record = (r) => { store.append(r); return apply(r); };

  // Replay, then compact: deleted messages keep only their tombstone, and lines past the history are dropped.
  {
    for (const r of store.load()) apply(r);
    const keep = [];
    for (const [ch, c] of channels) {
      if (c.slowSec) keep.push({ k: "slow", ch, sec: c.slowSec });
      for (const l of c.lines) {
        keep.push({ k: "post", id: l.id, ch, from: l.from, text: l.text, media: l.media, reply: l.reply, at: l.at });
        if (l.deleted) keep.push({ k: "delete", id: l.id });
        for (const [emoji, users] of Object.entries(l.reactions)) for (const by of users) keep.push({ k: "react", id: l.id, emoji, by, on: true });
        for (const by of l.reports) keep.push({ k: "report", id: l.id, by });
      }
    }
    for (const u of mods) keep.push({ k: "mod", user: u, on: true });
    for (const [user, until] of muted) if (until > now()) keep.push({ k: "mute", user, until });
    store.rewrite(keep);
  }

  const err = (code, extra = {}) => ({ t: "error", code, ...extra });
  const page = (ch, user, before = Infinity) => channels.get(ch).lines.filter((l) => l.id < before).slice(-LIMITS.page).map((l) => view(l, user));

  return {
    mint,
    size: () => conns.size,
    isMember,
    /** A member joins; returns the hello, or null if they are not a member. */
    join(connId, session, send) {
      if (session.guest || !isMember(session.sub)) return null;
      conns.set(connId, { user: session.sub, send, tokens: rate.burst, at: now(), lastPost: -Infinity });
      const c = clan();
      return { t: "hello", mint, name: c.name, symbol: c.symbol, you: session.sub, role: roleOf(session.sub), rank: rankOf(session.sub),
        founders: c.founders.size, mods: [...mods], mutedUntil: muted.get(session.sub) ?? 0, campfire: [...campfire],
        channels: CHANNELS.map((ch) => ({ id: ch, slowSec: channels.get(ch).slowSec, lines: page(ch, session.sub) })) };
    },
    leave(connId) {
      const c = conns.get(connId);
      conns.delete(connId);
      if (c && campfire.has(c.user) && ![...conns.values()].some((x) => x.user === c.user)) {
        campfire.delete(c.user);
        everyone(() => ({ t: "campfire", people: [...campfire] }));
      }
    },
    /** May this member talk in the Campfire now (their SFU token's `canPublish`)? */
    canSpeak: (user) => isMember(user) && !((muted.get(user) ?? 0) > now()),

    receive(connId, raw) {
      const c = conns.get(connId);
      if (!c) return null;
      const t = now();
      c.tokens = Math.min(rate.burst, c.tokens + ((t - c.at) / 1000) * rate.perSec);
      c.at = t;
      if (c.tokens < 1) return "close";
      c.tokens -= 1;
      let m;
      try { m = JSON.parse(raw); } catch { return err("BadMessage"); }
      const me = c.user;
      // Membership is the chain's: re-checked on every message (a registry rebuilt from events never loses one,
      // but a moderator's clan may change).
      if (!isMember(me)) return "close";
      const target = typeof m?.id === "number" ? byId.get(m.id) : null;
      switch (m?.t) {
        case "history":
          if (!channels.has(m.ch)) return err("UnknownChannel");
          return { t: "history", ch: m.ch, lines: page(m.ch, me, Number(m.before) || Infinity) };
        case "post": {
          if (!channels.has(m.ch)) return err("UnknownChannel");
          const until = muted.get(me) ?? 0;
          if (until > t) return err("Muted", { until });
          const slow = channels.get(m.ch).slowSec * 1000;
          const gap = Math.max(minGapMs, slow);
          if (t - c.lastPost < gap) return err(slow ? "SlowMode" : "TooFast", { retryIn: gap - (t - c.lastPost) });
          const text = cleanText(m.text, LIMITS.text);
          const ids = Array.isArray(m.media) ? [...new Set(m.media)] : [];
          if (ids.length > LIMITS.media) return err("TooManyMedia");
          const files = ids.map((id) => ({ id, info: media.info(String(id)) }));
          if (files.some((f) => !f.info || f.info.clan !== mint)) return err("UnknownMedia");
          if (!text && !files.length) return err("EmptyMessage");
          const reply = typeof m.reply === "number" && byId.has(m.reply) ? m.reply : null;
          c.lastPost = t;
          const line = record({ k: "post", id: ++seq, ch: m.ch, from: me, text, media: files.map((f) => ({ id: f.id, type: f.info.type })), reply, at: t });
          everyone((u) => ({ t: "post", line: view(line, u) }));
          return null;
        }
        case "react": {
          if (!target || target.deleted) return err("UnknownMessage");
          if (!REACTIONS.includes(m.emoji)) return err("UnknownReaction");
          record({ k: "react", id: target.id, emoji: m.emoji, by: me, on: !!m.on });
          everyone((u) => ({ t: "update", line: view(target, u) }));
          return null;
        }
        case "delete": {
          if (!target || target.deleted) return err("UnknownMessage");
          if (target.from !== me && !isMod(me)) return err("NotAllowed");
          record({ k: "delete", id: target.id });
          everyone((u) => ({ t: "update", line: view(target, u) }));
          return null;
        }
        case "report": {
          if (!target || target.deleted) return err("UnknownMessage");
          if (target.from === me) return err("NotAllowed");
          if (target.reports.has(me)) return { t: "reported", id: target.id };
          const was = target.hidden;
          record({ k: "report", id: target.id, by: me });
          if (target.hidden && !was) everyone((u) => ({ t: "update", line: view(target, u) }));
          else sendTo((x) => isMod(x.user), (u) => ({ t: "update", line: view(target, u) }));
          return { t: "reported", id: target.id };
        }
        case "restore": {
          if (!isMod(me)) return err("NotAllowed");
          if (!target || target.deleted) return err("UnknownMessage");
          record({ k: "restore", id: target.id });
          everyone((u) => ({ t: "update", line: view(target, u) }));
          return null;
        }
        case "mute": {
          if (!isMod(me)) return err("NotAllowed");
          if (!isMember(m.user) || m.user === me) return err("NotAllowed");
          if (isMod(m.user) && me !== creator()) return err("NotAllowed"); // only the creator mutes a moderator
          if (m.user === creator()) return err("NotAllowed");
          const minutes = Math.max(0, Math.min(LIMITS.maxMuteMin, Math.floor(Number(m.minutes) || 0)));
          const until = minutes ? t + minutes * 60_000 : 0;
          record({ k: "mute", user: m.user, until });
          everyone(() => ({ t: "muted", user: m.user, until }));
          onVoice?.(m.user, !until); // a muted member is silenced in the Campfire at once
          return null;
        }
        case "slow": {
          if (!isMod(me)) return err("NotAllowed");
          if (!channels.has(m.ch)) return err("UnknownChannel");
          const sec = Math.max(0, Math.min(LIMITS.maxSlowSec, Math.floor(Number(m.sec) || 0)));
          record({ k: "slow", ch: m.ch, sec });
          everyone(() => ({ t: "slow", ch: m.ch, sec }));
          return null;
        }
        case "mod": {
          if (me !== creator()) return err("NotAllowed");
          if (!clans.isFounder(mint, m.user)) return err("NotAllowed");
          record({ k: "mod", user: m.user, on: !!m.on });
          everyone(() => ({ t: "mods", mods: [...mods] }));
          return null;
        }
        case "campfire": {
          const was = campfire.has(me);
          if (m.on) campfire.add(me); else campfire.delete(me);
          if (was !== campfire.has(me)) everyone(() => ({ t: "campfire", people: [...campfire] }));
          return null;
        }
        case "ping":
          return { t: "pong", now: t };
        default:
          return err("UnknownMessage");
      }
    },
  };
}
