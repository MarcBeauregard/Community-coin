// Derived view data: everything the screens show that is computed from the store's state rather than stored.

import { PHASES, PROPOSALS_CLOSE, LOCK_AT, FINALE_AT, phaseAt, pledgedOn } from "./store.js";
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

const ORDINAL = ["1st", "2nd", "3rd"];
const ordinal = (n) => ORDINAL[n - 1] ?? `${n}th`;

/**
 * The last five minutes before the lock (00:50 to 00:55): who leads, by how much, and how long is left. `urgent` in
 * the last minute. `nudge`: when the person's pick is out of the top two, the offer to move it to the leader in one
 * gesture (unless they set it aside for this pledge). Null outside the finale.
 */
export function finale(s, ideas) {
  if (s.launched || s.elapsed < FINALE_AT || s.elapsed >= LOCK_AT || ideas.length < 2) return null;
  const [lead, next] = ideas;
  const gap = lead.total - next.total;
  const left = LOCK_AT - s.elapsed;
  const tied = Math.round(gap * 10) === 0;
  const text = tied ? `$${lead.ticker} and $${next.ticker} are tied` : `$${lead.ticker} leads $${next.ticker} by ${sol(gap)}`;
  const mine = s.pledge && ideas.find((d) => d.ticker === s.pledge.symbol);
  const nudge = mine && mine.rank > 2 && s.nudgeOff !== s.pledge.symbol
    ? { from: mine, to: lead, amount: s.pledge.amount, text: `$${mine.ticker} is ${ordinal(mine.rank)}. Move your ${sol(s.pledge.amount)} to $${lead.ticker}?` }
    : null;
  return { lead, next, gap, tied, text, left, lockIn: clock(left), urgent: left <= 60, leadShare: (lead.total / (lead.total + next.total || 1)) * 100, nudge };
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
    pick: `About ${shareIfWins.toFixed(2)}% of its opening batch if it wins`,
    backed: `About ${((mine / sel.total) * 100).toFixed(2)}% of its opening batch right now`,
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
  const live = s.live && s.clan === "new";
  return CHANNELS.map((c) => {
    const unread = live || s.read[c.id] ? 0 : c.unread; // live counts come from the clan, not the demo
    return { ...c, unread: c.id === s.channel ? 0 : unread, current: c.id === s.channel };
  });
}

export function currentClan(s) {
  if (s.live) return s.clans.find((c) => c.id === "new") ?? null;
  return s.clans.find((c) => c.id === s.clan) || s.clans[0];
}

export function founders(s, clan) {
  // Live, the clan's founders as the chain ranked them; the person is "you" at their own number.
  if (s.live && clan.id === "new" && s.liveClan) {
    return (s.liveClan.founders ?? []).map((f) => ({ who: f.user, me: f.user === s.liveClan.you, amount: Number(f.amount) / 1e9, rank: f.rank, online: f.user === s.liveClan.you }));
  }
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
  if (v.onStage && live && v.mic && !micLive) return { ...base, starting: true, text: "Starting your microphone…", tone: "sky" };
  if (v.onStage) return { ...base, text: micLive ? "You’re on stage · mic live" : "You’re on stage · muted", tone: micLive ? "lime" : "sky" };
  if (v.hand) return { ...base, text: "Hand raised · the host will bring you up", tone: "sky" };
  if (joining) return { ...base, link: null, text: "Joining the stage…", tone: "sky" };
  return { ...base, text: "Listening · you can raise your hand", tone: "sky" };
}
