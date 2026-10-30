// Folds a lobby's program events into what the app shows: the race (each idea's pledged SOL and backers), each
// wallet's pledge, the winner, the founders in the order they first pledged, and receipts. The same fold runs on
// events decoded from the chain (indexer.mjs, wallet mode) and on the events the demo's rules emit.

const toNumber = (lamports) => Number(lamports) / 1e9;

export function emptyView() {
  return { lobby: null, ideas: [], pledges: new Map(), order: [], winner: null, finalized: false, launched: false, mint: null, refunded: new Set(), founders: [], bondsReturned: new Set() };
}

/** Applies one decoded event to a view (mutates it) and returns the view. */
export function apply(view, e) {
  switch (e.event) {
    case "LobbyCreated":
      view.lobby = { key: e.lobby, id: e.id, host: e.host, opensAt: Number(e.opens_at), proposalsClose: Number(e.proposals_close), lockAt: Number(e.lock_at),
        launchAt: Number(e.launch_at), maxPledge: e.max_pledge, bond: e.bond, total: 0n };
      break;
    case "IdeaProposed":
      view.ideas[e.index] = { index: e.index, name: e.name, symbol: e.symbol, proposer: e.proposer, pledged: 0n, backers: 0 };
      break;
    case "Pledged": {
      const prev = view.pledges.get(e.user);
      if (!prev) view.order.push(e.user);
      if (!prev || prev.amount === 0n) view.ideas[e.idea].backers += 1;
      view.pledges.set(e.user, { idea: e.idea, amount: e.user_total });
      view.ideas[e.idea].pledged = e.idea_total;
      view.lobby.total = e.lobby_total;
      break;
    }
    case "Withdrawn": {
      view.pledges.get(e.user).amount = e.user_total;
      if (e.user_total === 0n) view.ideas[e.idea].backers -= 1;
      view.ideas[e.idea].pledged = e.idea_total;
      view.lobby.total = e.lobby_total;
      break;
    }
    case "PledgeMoved":
      view.pledges.get(e.user).idea = e.to;
      view.ideas[e.from].pledged = e.from_total;
      view.ideas[e.from].backers -= 1;
      view.ideas[e.to].pledged = e.to_total;
      view.ideas[e.to].backers += 1;
      break;
    case "LobbyFinalized":
      view.finalized = true;
      view.winner = e.winner === 255 ? null : e.winner;
      break;
    case "WinnerVoided":
      view.winner = null;
      break;
    case "LobbyLaunched":
      view.launched = true;
      view.mint = e.mint;
      break;
    case "PledgeRefunded":
      view.refunded.add(e.user);
      break;
    case "FounderJoined":
      view.founders.push({ user: e.user, amount: e.amount, rank: e.seq + 1 });
      view.founders.sort((a, b) => a.rank - b.rank);
      break;
    case "BondReturned":
      view.bondsReturned.add(e.idea);
      break;
    default:
  }
  return view;
}

export function fold(events, view = emptyView()) {
  for (const e of events) apply(view, e);
  return view;
}

/** A wallet's founder rank: its place among everyone who pledged in the lobby, first pledge first. */
export function rankOf(view, user) {
  const i = view.order.indexOf(user);
  return i < 0 ? null : i + 1;
}

/**
 * What a transaction did for `user`, read from its events: the receipt the app shows after signing.
 * `ideas` names the ideas by index.
 */
export function receipt(events, user, ideas) {
  const ticker = (i) => (ideas[i] ? `$${ideas[i].symbol}` : `idea #${i + 1}`);
  for (const e of events) {
    if (e.user !== undefined && e.user !== user) continue;
    switch (e.event) {
      case "Pledged":
        return { kind: "pledge", title: `Pledged ${toNumber(e.amount)} SOL to ${ticker(e.idea)}`,
          lines: [["Your pledge", toNumber(e.user_total)], [`${ticker(e.idea)} now holds`, toNumber(e.idea_total)], ["Lobby total", toNumber(e.lobby_total)]] };
      case "Withdrawn":
        return { kind: "withdraw", title: `Withdrew ${toNumber(e.amount)} SOL from ${ticker(e.idea)}`,
          lines: [["Your pledge", toNumber(e.user_total)], [`${ticker(e.idea)} now holds`, toNumber(e.idea_total)], ["Lobby total", toNumber(e.lobby_total)]] };
      case "PledgeMoved":
        return { kind: "move", title: `Moved ${toNumber(e.amount)} SOL to ${ticker(e.to)}`,
          lines: [[`${ticker(e.from)} now holds`, toNumber(e.from_total)], [`${ticker(e.to)} now holds`, toNumber(e.to_total)]] };
      case "PledgeRefunded":
        return { kind: "refund", title: `Refunded ${toNumber(e.amount)} SOL`, lines: [["Back in your wallet", toNumber(e.amount)]] };
      case "FounderJoined":
        return { kind: "founder", title: `Founder #${e.seq + 1}`, lines: [["Committed to the opening", toNumber(e.amount)]] };
      case "BondReturned":
        if (e.proposer !== user) continue;
        return { kind: "bond", title: `Bond returned for ${ticker(e.idea)}`, lines: [["Back in your wallet", toNumber(e.amount)]] };
      default:
    }
  }
  return null;
}
