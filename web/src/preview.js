// What a transaction would do, before anything is signed. The engine (web/src/protocol.js, the program's rules)
// runs it on a copy of the hub's state, and its events become the rows of the breakdown, in display units (see
// world.js). In the demo the engine is the hub itself; in wallet mode it holds the accounts just read from the
// chain, so a breakdown is exact unless someone else trades first, which the 1% slippage limit covers.

import { Engine, SOL, buyOut } from "./protocol.js";
import { toBase, displayEvents, displayPrice, displaySolPrice, quoteScale, SOL_SCALE, TOKEN_SCALE } from "./world.js";

const WAD = 10n ** 18n;

/** The hops of a transaction from its Trade events (display units): one per curve it touched, in order. */
export function hopsFromEvents(events) {
  return events
    .filter((e) => e.name === "Trade")
    .map(({ args: a }) => {
      const split = { fee: a.fee, protocolFee: a.protocolFee, creatorFee: a.fee - a.protocolFee };
      return a.isBuy
        ? { token: a.mint, isBuy: true, quoteIn: a.quoteAmount, ...split, toReserve: a.quoteAmount - a.fee, spike: 0n, out: a.tokenAmount }
        : { token: a.mint, isBuy: false, tokensIn: a.tokenAmount, gross: a.quoteAmount, ...split, spike: a.spikeShare, out: a.quoteAmount - a.fee - a.spikeShare };
    });
}

/**
 * A trade, hop by hop. `side` is "buy" or "sell"; `viaParent` trades against the parent token only (one hop)
 * instead of routing through the whole lineage to SOL; `amount` is in display units of what is paid or sold.
 * Returns { hops, out } (each hop with `spot`, its curve's price just before), or { error }.
 */
export function previewTrade(hub, account, m, { side, viaParent, amount }) {
  const e = hub.engine, now = hub.now();
  const op = side === "buy" ? (viaParent ? "buy" : "buySol") : viaParent ? "sell" : "sellToSol";
  const args = op === "buySol" ? { mint: m.address, solIn: amount } : { mint: m.address, amount };
  const spots = new Map(m.lineage.map((mint) => [mint, displayPrice(e.meme(mint), e.price(mint, now))]));
  const r = e.dryRun("exec", op, account, toBase(e, op, args), now);
  if (r.error) return { error: r.error };
  const hops = hopsFromEvents(displayEvents(e, r.events)).map((h) => ({ ...h, spot: spots.get(h.token) }));
  return { hops, out: hops.at(-1).out };
}

/**
 * Price impact of the hops: how much worse than the price on screen the curve itself fills you, fees left out.
 * Positive means you pay more per token (buy) or get less per token (sell).
 */
export function priceImpact(hops) {
  let factor = 1;
  for (const h of hops) {
    const spot = Number(h.spot) / 1e18;
    if (h.isBuy) factor *= Number(h.toReserve) / Number(h.out) / spot;
    else factor *= Number(h.gross) / Number(h.tokensIn) / spot;
  }
  return hops[0]?.isBuy ? factor - 1 : 1 - factor;
}

/**
 * The opening batch with the viewer's commit added: the tokens the whole batch would buy if it closed now, the
 * viewer's share and the price everyone pays (display units, the price in the meme's quote). `amount` is what the
 * viewer pays: SOL, or with `viaParent` the parent's tokens (a root's quote is SOL either way). Nobody else
 * committing is the assumption. Null when nothing can be estimated.
 */
export function openingEstimate(hub, account, m, { amount, viaParent }) {
  const e = hub.engine, x = e.meme(m.address);
  let add = 0n;
  if (amount && (viaParent || x.parent === SOL)) add = amount / quoteScale(x);
  else if (amount) {
    // SOL buys the parent's tokens first, through the parent's lineage.
    const r = e.dryRun("exec", "commitSol", account, { mint: m.address, solIn: amount / SOL_SCALE }, hub.now());
    if (r.error) return null;
    add = r.events.find((ev) => ev.name === "Committed").args.quote;
  }
  const total = x.batchQuote + add;
  if (total === 0n) return null;
  const [tokens] = buyOut(x.vQuote, x.vToken, total);
  const mine = e.commitment(m.address, account).committed + add;
  return {
    tokens: tokens * TOKEN_SCALE,
    yours: ((tokens * mine) / total) * TOKEN_SCALE,
    price: displayPrice(x, (total * WAD) / tokens),
    total: total * quoteScale(x),
  };
}

/**
 * What executing a union would do now, as if its vote had just passed: the meme's SOL reserve buys the target
 * through its lineage, fee-free, and the meme's curve is re-priced in the target at the rate obtained. Returns what
 * the target family receives and the meme's price after, in SOL (display units); null when it could not execute.
 */
export function previewUnion(hub, id) {
  const e = hub.engine, now = hub.now();
  const copy = new Engine(e.config, { mintOf: e.mintOf, state: structuredClone(e.state), external: true });
  const u = copy.state.unions[id];
  u.deadline = Math.min(u.deadline, now - 1);
  u.locked = copy.circulating(u.meme) + 1n;
  try {
    const done = copy.executeUnion(SOL, id, 0n, now).find((ev) => ev.name === "UnionExecuted").args;
    return { solIn: done.solIn * SOL_SCALE, targetIn: done.targetIn * TOKEN_SCALE, priceAfterSol: displaySolPrice(copy.priceInSol(u.meme, now)) };
  } catch {
    return null;
  }
}
