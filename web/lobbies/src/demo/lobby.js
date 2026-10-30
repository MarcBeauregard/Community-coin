// The demo's lobby on the program's rules (chain/rules.js): the crowd's pledges, ours, the lock, the launch and the
// settlement all go through the same checks, lamports and events as on chain, and the receipts are read from those
// events. Time is the lobby's own: 0 when it opens.

import { LobbyRules, LAMPORTS } from "../chain/rules.js";
import { receipt as receiptOf } from "../chain/indexer.js";
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
  const events = [];
  const l = chain.lobby;
  const symbols = chain.ideas.map((d) => d.symbol);
  if (!l.finalized && BigInt(now) >= l.lock_at) events.push(...chain.apply("finalize", { symbols }, now).events);
  if (l.finalized && !l.launched && BigInt(now) >= l.launch_at && l.winner !== 255) {
    events.push(...chain.apply("launch_winner", { symbol: chain.ideas[l.winner].symbol }, now).events);
    for (const user of chain.pledges.keys()) {
      events.push(...chain.apply("refund", { user }, now).events);
      events.push(...chain.apply("claim_founder", { user }, now).events);
    }
    for (const s of symbols) events.push(...chain.apply("return_bond", { symbol: s }, now).events);
  }
  return events;
}

/** The launch as the screens read it, from the chain after the crank. */
export function launchSummary(chain, events) {
  const l = chain.lobby;
  if (!l.launched) return null;
  const win = chain.ideas[l.winner];
  const me = chain.pledges.get(ME);
  const mine = me ? me.amount : 0n;
  const founder = !!me && me.idea === l.winner && mine > 0n;
  const refund = events.find((e) => e.event === "PledgeRefunded" && e.user === ME);
  const bond = events.find((e) => e.event === "BondReturned" && e.proposer === ME);
  // The opening batch buys the whole pot at once; a founder's tokens are their share of it, rounded down as the
  // program's claim does.
  const [batchTokens] = buyOut(ROOT_VIRTUAL_QUOTE, VIRTUAL_TOKENS, win.pledged);
  return {
    id: win.symbol.toLowerCase(), sol: toSol(win.pledged), total: toSol(l.total), backers: win.backers, founder,
    rank: founder ? me.seq + 1 : null, refund: refund ? toSol(refund.amount) : 0, bondBack: bond ? toSol(bond.amount) : 0,
    myAmount: toSol(mine), myId: me && mine > 0n ? chain.ideas[me.idea].symbol.toLowerCase() : null,
    allocation: founder ? Number(mulDiv(batchTokens, mine, win.pledged)) / Number(TOKEN) : 0,
  };
}

const ERROR_TEXT = {
  LobbyNotOpen: "The lobby is not open yet.", ProposalsClosed: "Proposals are closed.", PledgesLocked: "Pledges are locked.",
  OnAnotherIdea: "Your pledge is on another idea: move it instead.", PledgeCap: "That is above this lobby’s pledge limit.",
  MemeExists: "This ticker already exists on the launchpad.", AccountInUse: "This ticker is already in the race.", ZeroAmount: "Enter an amount above zero.",
  TooManyIdeas: "This lobby is full.", PledgeSettled: "Already refunded or committed.",
};
/** What a person reads when the program refuses an operation. */
export const errorText = (name) => ERROR_TEXT[name] || `The program refused it (${name}).`;
