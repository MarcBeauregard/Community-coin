// Derived view data: everything the screens show that is computed from the store's state rather than stored.

import { PHASES, PROPOSALS_CLOSE, LOCK_AT, FOUNDER_SUPPLY, phaseAt, pledgedOn } from "./store.js";
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
    backersShown: d.backers + (s.pledge && s.pledge.id === d.id ? 1 : 0),
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
    proposeHint: s.elapsed < PROPOSALS_CLOSE ? `Closes in ${clock(PROPOSALS_CLOSE - s.elapsed)}` : "Proposals closed at 00:30",
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
  return [...FOUNDERS, [ME, fresh ? s.launched.myAmount : 1, fresh ? s.launched.backers : 212]].map(([who, amount, rank], i) => ({
    who, amount, rank, online: i < 4 || who === ME,
  }));
}

export function myFounderRank(s, clan) {
  return clan.fresh && s.launched ? s.launched.backers : 212;
}

export function allocation(l) {
  return l && l.founder ? Math.round((l.myAmount / l.sol) * FOUNDER_SUPPLY) : 0;
}
