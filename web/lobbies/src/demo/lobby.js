// The demo's lobby on the program's rules (chain/rules.js): the crowd's pledges, ours, the lock, the launch and the
// settlement all go through the same checks, lamports and events as on chain, and the receipts are read from those
// events. Time is the lobby's own: 0 when it opens.

import { LobbyRules, LAMPORTS } from "../chain/rules.js";
import { receipt as receiptOf } from "../chain/indexer.js";
import { planCrank, stateOfRules } from "../chain/crank.js";
import { buyOut, mulDiv, ROOT_VIRTUAL_QUOTE, VIRTUAL_TOKENS, TOKEN } from "../../../src/protocol.js";
import { IDEAS, ME } from "./data.js";

export const WINDOWS = { proposeSecs: 1800, lockSecs: 3300, length: 3600 };
export const MAX_PLEDGE = 25n * LAMPORTS;
export const BOND = LAMPORTS / 20n;

export const toLamports = (sol) => BigInt(Math.round(sol * 1e9));
export const toSol = (lamports) => Number(lamports) / 1e9;

/** Tonight's lobby: the ideas, each with the crowd's pledges already in it (one wallet per backer). */
export function createDemoLobby() {
  const chain = new LobbyRules({ lobbyKey: "lobby-0412", mintOf: (key) => `mint-${key}`, isTaken: () => false });
  chain.apply("create_lobby", { host: "mira.sol", id: 412, opensAt: 0, ...WINDOWS, maxPledge: MAX_PLEDGE, bond: BOND }, 0);
  IDEAS.forEach((idea, n) => {
    chain.apply("propose_idea", { proposer: idea.by, symbol: idea.ticker, name: idea.name }, 300 + n);
    const total = toLamports(idea.sol);
    const each = total / BigInt(idea.backers);
    for (let b = 0; b < idea.backers; b++) {
      const amount = b === idea.backers - 1 ? total - each * BigInt(idea.backers - 1) : each;
      chain.apply("pledge", { user: `crowd-${idea.id}-${b}`, symbol: idea.ticker, amount }, 400 + n);
    }
  });
  return chain;
}

/** The race as the screens read it: each idea's look (hue, logo, pitch) with its SOL and backers from the chain. */
export function ideasFrom(chain, meta) {
  return chain.ideas.map((d) => {
    const m = meta[d.symbol] || {};
    return { id: m.id || d.symbol.toLowerCase(), name: d.name, ticker: d.symbol, hue: m.hue ?? 150, logo: m.logo, pitch: m.pitch || "", by: d.proposer,
      sol: toSol(d.pledged), backers: d.backers, index: d.index };
  });
}

export function ideaMeta() {
  return Object.fromEntries(IDEAS.map((i) => [i.ticker, { id: i.id, hue: i.hue, logo: i.logo, pitch: i.pitch }]));
}

/** Our open pledge, as the screens read it, or null. */
export function myPledge(chain) {
  const p = chain.pledges.get(ME);
  if (!p || p.amount === 0n || p.settled) return null;
  return { id: chain.ideas[p.idea].symbol.toLowerCase(), symbol: chain.ideas[p.idea].symbol, amount: toSol(p.amount), lamports: p.amount };
}

/** The receipt one event makes for us, if it concerns us. */
export function receiptFor(event, chain) {
  return receiptOf([event], ME, chain.ideas);
}

/** Runs an operation as us and returns `{ ok, error, events, receipt }`. */
export function act(chain, op, args, now) {
  const r = chain.apply(op, args, now);
  return { ...r, receipt: r.ok ? receiptOf(r.events, ME, chain.ideas) : null };
}

/**
 * What anyone may crank once its time has come: the lock at 00:55, then at 01:00 the launch, every refund, every
 * founder's commitment and every bond. Returns the events, and what they mean for us.
 */
export function crank(chain, now) {
  // Whatever is due by `now`, in as many rounds as it takes (the lock first, then what the lock makes due).
  const events = [];
  for (let round = 0; round < 4; round++) {
    const ops = planCrank(stateOfRules(chain), now);
    if (!ops.length) break;
    for (const { op, args } of ops) events.push(...chain.apply(op, args, now).events);
  }
  return events;
}

/** A founder's tokens: their share of the opening batch, which buys the whole pot at one price (rounded down as the program's claim does). */
export function founderAllocation(pot, mine) {
  const [batchTokens] = buyOut(ROOT_VIRTUAL_QUOTE, VIRTUAL_TOKENS, pot);
  return Number(mulDiv(batchTokens, mine, pot)) / Number(TOKEN);
}

/** What the lock decided, as the screens read it: the winning ticker (null: no winner, or voided) and its pot. */
export function lockedOf(chain) {
  const l = chain.lobby;
  if (!l.finalized) return null;
  const win = l.winner === 255 ? null : chain.ideas[l.winner];
  return { winner: win ? win.symbol : null, pot: win ? toSol(win.pledged) : 0, total: toSol(l.total), voided: false };
}

/** The launch the realtime server announced, before the crank tells this wallet what it got (`settled`). */
export function liveLaunch(m, total) {
  return { id: m.symbol.toLowerCase(), mint: m.mint, sol: toSol(BigInt(m.pot)), pot: BigInt(m.pot), total, backers: m.founders, founder: false, rank: null,
    refund: 0, bondBack: 0, myAmount: 0, myId: null, allocation: 0 };
}

/** The launch as the screens read it, from the chain after the crank. */
export function launchSummary(chain) {
  const l = chain.lobby;
  if (!l.launched) return null;
  const win = chain.ideas[l.winner];
  const me = chain.pledges.get(ME);
  const mine = me ? me.amount : 0n;
  const founder = !!me && me.idea === l.winner && mine > 0n;
  // Refunds and bonds went back at the lock; the chain remembers them.
  const refund = me && me.settled && !founder ? { amount: me.amount } : null;
  const bonds = chain.ideas.filter((d) => d.proposer === ME && d.bond_returned).length;
  const bond = bonds ? { amount: BigInt(bonds) * l.bond } : null;
  // The opening batch buys the whole pot at once; a founder's tokens are their share of it, rounded down as the
  // program's claim does.
  return {
    id: win.symbol.toLowerCase(), sol: toSol(win.pledged), total: toSol(l.total), backers: win.backers, founder,
    rank: founder ? [...chain.pledges.values()].filter((p) => p.idea === l.winner && p.amount > 0n && p.seq <= me.seq).length : null, refund: refund ? toSol(refund.amount) : 0, bondBack: bond ? toSol(bond.amount) : 0,
    myAmount: toSol(mine), myId: me && mine > 0n ? chain.ideas[me.idea].symbol.toLowerCase() : null,
    allocation: founder ? founderAllocation(win.pledged, mine) : 0,
  };
}

const ERROR_TEXT = {
  LobbyNotOpen: "The lobby is not open yet.", ProposalsClosed: "Proposals are closed.", PledgesLocked: "Pledges are locked.",
  OnAnotherIdea: "Your pledge is on another idea: move it instead.", PledgeCap: "That is above this lobby’s pledge limit.",
  MemeExists: "This ticker already exists on the launchpad.", AccountInUse: "This ticker is already in the race.", ZeroAmount: "Enter an amount above zero.",
  TooManyIdeas: "This lobby is full.", PledgeSettled: "Already refunded or committed.", TickerHeld: "Another lobby is racing this ticker right now.", PledgeTooSmall: "A pledge is at least 0.001 SOL, or withdrawn in full.",
};
/** What a person reads when the program refuses an operation. */
export const errorText = (name) => ERROR_TEXT[name] || `The program refused it (${name}).`;
