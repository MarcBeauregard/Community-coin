// What a lobby needs done once its time has come, which the program lets anyone do (the crank). Pure: the demo
// runs it on the program's rules in the browser, the server on its rules or on a cluster (server/crank.mjs).

export const NO_WINNER = 255;

/**
 * The operations due now, in order. `state`: `{ lobby: { lockAt, launchAt, finalized, launched, winner },
 * ideas: [{ symbol, bondReturned }], pledges: [{ user, idea, amount, settled }] }`, times in seconds of lobby time.
 */
export function planCrank(state, now) {
  const { lobby: l, ideas, pledges } = state;
  const ops = [];
  if (!l.finalized) {
    if (now >= l.lockAt) ops.push({ op: "finalize", args: { symbols: ideas.map((d) => d.symbol) } });
    return ops;
  }
  if (now < l.launchAt) return ops;
  // The winner's ticker was launched elsewhere meanwhile: it cannot launch, so everyone is refunded.
  if (l.winner !== NO_WINNER && !l.launched && state.winnerTaken) return [{ op: "void_winner", args: { symbol: ideas[l.winner].symbol } }];
  const hasWinner = l.winner !== NO_WINNER;
  if (hasWinner && !l.launched) ops.push({ op: "launch_winner", args: { symbol: ideas[l.winner].symbol } });
  const launched = l.launched || hasWinner;
  for (const p of pledges) {
    if (p.settled || p.amount === 0n) continue;
    if (!hasWinner || p.idea !== l.winner) ops.push({ op: "refund", args: { user: p.user } });
    else if (launched) ops.push({ op: "claim_founder", args: { user: p.user } });
  }
  ideas.forEach((d) => { if (!d.bondReturned) ops.push({ op: "return_bond", args: { symbol: d.symbol } }); });
  return ops;
}

/** The crank's view of a lobby on the program's rules (the demo, the simulated server). */
export function stateOfRules(chain) {
  const l = chain.lobby;
  return {
    lobby: { lockAt: Number(l.lock_at), launchAt: Number(l.launch_at), finalized: l.finalized, launched: l.launched, winner: l.winner },
    ideas: chain.ideas.map((d) => ({ symbol: d.symbol, bondReturned: d.bond_returned })),
    pledges: [...chain.pledges.values()].map((p) => ({ user: p.user, idea: p.idea, amount: p.amount, settled: p.settled })),
    winnerTaken: l.finalized && l.winner !== NO_WINNER && !l.launched && chain.taken(chain.ideas[l.winner].key),
  };
}
