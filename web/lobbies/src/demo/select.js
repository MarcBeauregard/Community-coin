// Derived view data: everything the screens show that is computed from the store's state rather than stored.

import { PHASES, PROPOSALS_CLOSE, LOCK_AT, FINALE_AT, phaseAt, pledgedOn } from "./store.js";
import { FEATURED, LOBBIES, CHANNELS, FOUNDERS, ME } from "./data.js";
import { HOUR, clock, sol } from "../format.js";
import { seriesOf, standingsAt } from "../race/curve.js";
import { nextOpening, dayOf } from "../remind/remind.js";

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
    yours: d.by === (s.live?.you ?? ME),
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
        return { ...l, live: false, tone: l.mine ? "sky" : "neutral", phase: l.mine ? "Hosted by you" : `Opens ${l.opens}`, when: dayOf(nextOpening(l.opens)) === "today" ? "Today" : "Tomorrow", progress: 0,
          meta: `${l.waiting + (on ? 1 : 0)} waiting`, meta2: l.clan ? `$${s.clans.find((c) => c.id === l.clan)?.ticker ?? ""} clan · you host` : l.mine ? "you host" : `@${l.host}`, reminder: on };
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
  return { inside: FEATURED.inside + (s.joined ?? 0), listening: FEATURED.listeners + (s.voice.listening ? 1 : 0) };
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

/**
 * One idea's SOL over the hour so far, for its small curve, and what it gained in the last ten minutes, in words.
 * From the race's samples (src/race/curve.js); null before there are two.
 */
export function trend(s, ticker) {
  if (!s.curve || s.curve.length < 2) return null;
  const points = seriesOf(s.curve, ticker);
  const now = s.curve[s.curve.length - 1].t;
  const then = standingsAt(s.curve, now - 600).find((x) => x.ticker === ticker)?.sol ?? 0;
  const gained = points[points.length - 1][1] - then;
  // Words only when a sample sits within two minutes of ten minutes ago: a gap (the server joined late) is not a
  // gain, and is never filled with a guess.
  const known = s.curve.some((p) => Math.abs(p.t - (now - 600)) <= 120);
  if (!known) return { points, gained: null, text: null };
  return { points, gained, text: gained >= 0.05 ? `up ${sol(gained)} in the last 10 minutes` : "no new SOL in the last 10 minutes" };
}

/**
 * The founder profile: the person's clans and their number in each, the ideas they proposed and what came of them,
 * the lobbies they were in, and their streak (lobbies in a row with a pledge, the open one included).
 */
export function profile(s) {
  const you = s.live ? s.live.you : ME;
  const open = !s.launched && s.pledge ? s.ideas.find((d) => d.id === s.pledge.id) : null;
  const clans = (s.live ? s.clans.filter((k) => k.id === "new") : s.clans).map((k) => {
    const live = s.live && s.liveClan ? (s.liveClan.founders ?? []).find((f) => f.user === s.liveClan.you) : null;
    return { ...k, rank: live ? live.rank : s.live ? s.launched?.rank ?? null : myFounderRank(s, k) };
  });
  // This lobby's ideas, while it runs (after the launch they are in the history), then the past ones.
  const now = s.launched ? [] : race(s).filter((d) => d.by === you).map((d) => ({ ticker: d.ticker, name: d.name, hue: d.hue, status: `Racing · #${d.rank}`, tone: "sky" }));
  const past = s.history.flatMap((h) => (h.proposed ?? []).map((p) => ({ ticker: p.ticker, name: p.name, hue: s.ideas.find((d) => d.ticker === p.ticker)?.hue ?? 200,
    status: p.won ? "Won · launched" : "Didn’t win · bond returned", tone: p.won ? "lime" : "neutral" })));
  const lobbies = [
    ...(open ? [{ key: "open", name: FEATURED.name, when: "Now", text: `${sol(s.pledge.amount)} on $${open.ticker} · racing`, tone: "sky" }] : []),
    ...s.history.map((h) => ({ key: h.key, name: h.name, when: new Date(h.at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      text: h.founder ? `Founder #${h.rank} of $${h.ticker}` : h.pledged ? `Backed $${h.pledged} · refunded · $${h.ticker} won` : `Watched · $${h.ticker} won`,
      tone: h.founder ? "lime" : "neutral" })),
  ];
  let streak = open ? 1 : 0;
  for (const h of s.history) { if (!h.pledged) break; streak++; }
  return { you, clans, ideas: [...now, ...past], lobbies, streak, proposed: now.length + past.length };
}

/** What the network banner says, the most pressing first; null when all is well. */
export function netState(n) {
  if (n.offline) return "offline";
  if (n.server === "down") return "down";
  if (n.server === "reconnecting") return "reconnecting";
  if (n.solana === "down") return "solanaDown";
  if (n.slow) return "slow";
  if (n.solana === "slow") return "solanaSlow";
  return n.back ? "back" : null;
}
