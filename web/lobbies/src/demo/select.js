// Derived view data: everything the screens show that is computed from the store's state rather than stored.

import { PHASES, PROPOSALS_CLOSE, LOCK_AT, phaseAt, pledgedOn } from "./store.js";
import { FEATURED, LOBBIES, CHANNELS, FOUNDERS, ME } from "./data.js";
import { HOUR, clock, sol } from "../format.js";

export const PHASE_LABEL = { gather: "Gathering", floor: "Proposing & pledging", pledge: "Pledging", lock: "Locked", done: "Launched" };

export function timeline(elapsed) {
  return PHASES.map((p) => ({
    ...p,
    weight: (p.end - p.start) / 60,
    fill: Math.max(0, Math.min(100, ((elapsed - p.start) / (p.end - p.start)) * 100)),
    current: elapsed >= p.start && elapsed < p.end,
  }));
}

export function race(s) {
  const ranked = s.ideas.map((d) => ({ ...d, total: pledgedOn(s, d) })).sort((a, b) => b.total - a.total);
  const max = ranked[0].total || 1;
  return ranked.map((d, i) => ({
    ...d,
    rank: i + 1,
    share: Math.max(3, (d.total / max) * 100),
    mine: !!(s.pledge && s.pledge.id === d.id),
    yours: d.by === ME,
    backersShown: d.backers,
  }));
}

export function lobbyClock(s) {
  const phase = phaseAt(s.elapsed);
  return {
    phase,
    label: PHASE_LABEL[phase],
    launchIn: clock(HOUR - s.elapsed),
    lockIn: clock(LOCK_AT - s.elapsed),
    canPropose: s.elapsed < PROPOSALS_CLOSE && !s.launched,
    canPledge: s.elapsed < LOCK_AT && !s.launched,
    proposeHint: s.elapsed < PROPOSALS_CLOSE ? `Proposals close in ${clock(PROPOSALS_CLOSE - s.elapsed)}` : "Proposals closed at 00:30",
  };
}

// What the pledge dock shows for the selected idea.
export function dock(s, ideas) {
  const sel = ideas.find((d) => d.id === s.selected) || ideas[0];
  const { canPledge } = lobbyClock(s);
  const mine = s.pledge ? s.pledge.amount : 0;
  const shareIfWins = (s.amount / (sel.total + s.amount)) * 100;
  let mode = "closed";
  if (canPledge) mode = !s.pledge ? "pick" : s.pledge.id === sel.id ? "backed" : "move";
  const sub = {
    pick: `${shareIfWins.toFixed(2)}% of the pot if it wins · refunded if it loses`,
    backed: `${((mine / sel.total) * 100).toFixed(2)}% of the pot right now`,
    move: `Your ${sol(mine)} is on another idea`,
    closed: `${sol(sel.total)} pledged`,
  }[mode];
  return { sel, mode, sub, mine, shareIfWins };
}

export function lobbyCards(s) {
  const q = s.query.trim().toLowerCase();
  return [...s.hosted, ...LOBBIES]
    .filter((l) => s.filter === "all" || (s.filter === "live" ? !l.opens : !!l.opens))
    .filter((l) => !q || `${l.name} ${l.theme} ${l.host}`.toLowerCase().includes(q))
    .map((l) => {
      if (l.opens) {
        const on = !!s.reminders[l.id];
        return { ...l, live: false, tone: l.mine ? "sky" : "neutral", phase: l.mine ? "Hosted by you" : `Opens ${l.opens}`, when: l.opens, progress: 0,
          meta: `${l.waiting + (on ? 1 : 0)} waiting`, meta2: l.mine ? "you host" : `@${l.host}`, reminder: on };
      }
      const e = (((s.elapsed + l.offset) % HOUR) + HOUR) % HOUR;
      const phase = phaseAt(e);
      const tone = { gather: "neutral", floor: "sky", pledge: "lime", lock: "amber" }[phase];
      return { ...l, live: true, tone, phase: { gather: "Gathering", floor: "Proposing", pledge: "Pledging", lock: "Locking" }[phase],
        when: `${clock(HOUR - e)} left`, progress: e / 36, meta: `${l.inside.toLocaleString("en-US")} inside`, meta2: l.pledged ? sol(l.pledged) : "No pledges yet" };
    });
}

export function featured() { return FEATURED; }

export function channels(s) {
  return CHANNELS.map((c) => {
    const unread = s.read[c.id] ? 0 : c.unread;
    return { ...c, unread: c.id === s.channel ? 0 : unread, current: c.id === s.channel };
  });
}

export function currentClan(s) {
  return s.clans.find((c) => c.id === s.clan) || s.clans[0];
}

export function founders(s, clan) {
  const fresh = clan.fresh && s.launched && s.launched.founder;
  return [...FOUNDERS, [ME, fresh ? s.launched.myAmount : 1, fresh ? s.launched.rank : 212]].map(([who, amount, rank], i) => ({
    who, amount, rank, online: i < 4 || who === ME,
  }));
}

export function myFounderRank(s, clan) {
  return clan.fresh && s.launched ? s.launched.rank : 212;
}

// A founder's tokens: their share of the opening batch, as the program's claim computes it (demo/lobby.js).
export function allocation(l) {
  return l && l.founder ? Math.floor(l.allocation) : 0;
}

/** Who is in the featured lobby: the realtime server's count when connected, the demo's otherwise. */
export function presence(s) {
  if (s.live && s.live.connected) return { inside: s.live.inside, listening: s.live.listening };
  return { inside: FEATURED.inside, listening: FEATURED.listeners + (s.voice.listening ? 1 : 0) };
}

/**
 * The voice, in one line, the same in the stage panel and the voice pill: what is happening, its tone, and the
 * flags the controls need. Live, the voice room's real state wins (sound blocked, microphone blocked).
 */
export function voiceStatus(s) {
  const v = s.voice;
  const au = s.audio;
  const live = !!s.live;
  const micLive = live ? au.micOn : v.mic;
  const micBlocked = live && ["mic-denied", "no-mic", "mic-failed"].includes(au.error);
  // The voice room's connection, said on its own line so the person's place on the stage never disappears.
  const link = !live || !v.listening ? null
    : au.status === "connecting" ? { text: "Connecting to the stage…", tone: "sky" }
    : au.status === "reconnecting" ? { text: "Reconnecting to the stage…", tone: "amber" }
    : au.error === "connect-failed" ? { text: "Voice couldn’t connect", tone: "amber" }
    : null;
  const base = { micLive, micBlocked, invited: !!v.invited, needsTap: live && au.needsTap, link };
  if (!v.listening) return { ...base, text: v.onStage ? "You’re on stage. Join when you’re ready to speak." : "Not listening", tone: "sky" };
  // Live, nobody is told "Listening" before the voice room is there.
  const joining = live && au.status !== "live" && au.status !== "reconnecting" && !au.error;
  if (base.needsTap) return { ...base, text: "Sound is blocked by your browser", tone: "amber" };
  if (v.onStage && v.invited) return { ...base, text: "The host invited you to speak", tone: "lime" };
  if (v.onStage && micBlocked) return { ...base, text: "On stage · microphone blocked", tone: "amber" };
  if (v.onStage && live && v.mic && !micLive) return { ...base, text: "Starting your microphone…", tone: "sky" };
  if (v.onStage) return { ...base, text: micLive ? "You’re on stage · mic live" : "You’re on stage · muted", tone: micLive ? "lime" : "sky" };
  if (v.hand) return { ...base, text: "Hand raised · the host will bring you up", tone: "sky" };
  if (joining) return { ...base, link: null, text: "Joining the stage…", tone: "sky" };
  return { ...base, text: "Listening · you can raise your hand", tone: "sky" };
}
