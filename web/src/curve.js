// The hub's arithmetic, replayed in the page: the same virtual constant-product curves, fees, reference price,
// spike share and rescaling as CommunityCoin.sol, in the same integer steps and with the same rounding. It lets the
// interface say exactly where every unit of a trade, a commit or a union would go before anything is signed; the
// final amount is always checked against the contract's own quote before it is shown.

export const WAD = 10n ** 18n;
export const BPS = 10_000n;
export const FEE_BPS = 100n;
export const VIRTUAL_TOKENS = 1_000_000_000n * WAD;
const DUST_TOKENS = 1_000_000_000n;
const REF_WINDOW = 3600n;

export class CurveError extends Error {}

/** OpenZeppelin Math.mulDiv, floor or ceiling. */
export function mulDiv(a, b, c, ceil = false) {
  const p = a * b;
  return ceil ? (p + c - 1n) / c : p / c;
}

/** OpenZeppelin Math.sqrt: the floor of the square root. */
export function sqrt(n) {
  if (n < 2n) return n;
  let x = n, y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

export function buyOut(vQuote, vToken, quoteIn) {
  const newVQuote = vQuote + quoteIn;
  const newVToken = mulDiv(vQuote, vToken, newVQuote, true);
  return [vToken - newVToken, newVQuote, newVToken];
}

export function sellOut(vQuote, vToken, tokensIn) {
  const newVToken = vToken + tokensIn;
  const newVQuote = mulDiv(vQuote, vToken, newVToken, true);
  return [vQuote - newVQuote, newVQuote, newVToken];
}

/** A curve as the hub stores it, copied so that a simulation never touches what the page displays. */
export function curveOf(s) {
  return {
    parent: s.parent,
    creator: s.creator,
    openUntil: BigInt(s.openUntil),
    settled: s.settled,
    refTime: BigInt(s.refTime),
    ref: s.ref,
    vQuote: s.vQuote,
    vToken: s.vToken,
    floor: s.floor,
    batchQuote: s.batchQuote,
    batchTokens: s.batchTokens,
  };
}

/** Reads the curves of `tokens` from the hub. */
export async function readCurves(hub, tokens) {
  const curves = new Map();
  for (const t of tokens) curves.set(t, curveOf(await hub.read("memes", [t])));
  return curves;
}

const clone = (curves) => new Map([...curves].map(([k, v]) => [k, { ...v }]));

function refNow(m, vQuote, vToken, now) {
  const spot = mulDiv(vQuote, WAD, vToken);
  if (!m.settled) return spot;
  const elapsed = now - m.refTime;
  if (elapsed >= REF_WINDOW) return spot;
  const ref = m.ref;
  return spot > ref ? ref + mulDiv(spot - ref, elapsed, REF_WINDOW) : ref - mulDiv(ref - spot, elapsed, REF_WINDOW);
}

function settle(m, now) {
  if (now < m.openUntil) throw new CurveError("StillOpening");
  m.settled = true;
  if (m.batchQuote > 0n) {
    const [out, vQuote, vToken] = buyOut(m.vQuote, m.vToken, m.batchQuote);
    m.batchTokens = out;
    m.vQuote = vQuote;
    m.vToken = vToken;
  }
  m.ref = mulDiv(m.vQuote, WAD, m.vToken);
  m.refTime = now;
}

function tradable(m, now) {
  if (!m.settled) settle(m, now);
}

function updateRef(m, now) {
  m.ref = refNow(m, m.vQuote, m.vToken, now);
  m.refTime = now;
}

function rescale(m, newReserve) {
  const reserve = m.vQuote - m.floor;
  const newFloor = mulDiv(m.floor, newReserve, reserve);
  m.ref = mulDiv(m.ref, newReserve, reserve);
  m.floor = newFloor;
  m.vQuote = newFloor + newReserve;
}

const nobodyLeft = (reserveAfter, vTokenAfter) => reserveAfter === 0n || VIRTUAL_TOKENS - vTokenAfter <= DUST_TOKENS;

function spikeShare(vQuote, vToken, ref, tokensIn, gross, spikeBps) {
  const spot = mulDiv(vQuote, WAD, vToken);
  if (ref === 0n || spot <= ref) return 0n;
  const aboveRef = mulDiv(vToken, sqrt(mulDiv(spot, 10n ** 36n, ref)), WAD) - vToken;
  if (tokensIn > aboveRef) {
    tokensIn = aboveRef;
    [gross] = sellOut(vQuote, vToken, aboveRef);
  }
  const atRef = mulDiv(tokensIn, ref, WAD);
  return gross > atRef ? ((gross - atRef) * spikeBps) / BPS : 0n;
}

/** One buy on one curve. `spot` is the curve's price just before it, quote per whole token (1e18-scaled). */
function buyHop(token, m, quoteIn, takeFee, now) {
  tradable(m, now);
  updateRef(m, now);
  const spot = mulDiv(m.vQuote, WAD, m.vToken);
  const fee = takeFee ? (quoteIn * FEE_BPS) / BPS : 0n;
  const reserveBefore = m.vQuote - m.floor;
  const [out, vQuote, vToken] = buyOut(m.vQuote, m.vToken, quoteIn - fee);
  m.vQuote = vQuote;
  m.vToken = vToken;
  return { token, isBuy: true, quoteIn, fee, toReserve: quoteIn - fee, spike: 0n, out, spot, reserveBefore, reserveAfter: m.vQuote - m.floor };
}

/** One sale on one curve: `gross` comes off the curve, the fee goes to the creator, the spike share stays in. */
function sellHop(token, m, tokensIn, spikeBps, now) {
  tradable(m, now);
  updateRef(m, now);
  const [vQuote0, vToken0] = [m.vQuote, m.vToken];
  const spot = mulDiv(vQuote0, WAD, vToken0);
  const reserveBefore = vQuote0 - m.floor;
  const [gross, vQuote, vToken] = sellOut(vQuote0, vToken0, tokensIn);
  if (vQuote < m.floor) throw new CurveError("ReserveInvariant");
  m.vQuote = vQuote;
  m.vToken = vToken;
  const fee = (gross * FEE_BPS) / BPS;
  const reserve = m.vQuote - m.floor;
  const spike = nobodyLeft(reserve, m.vToken) ? 0n : spikeShare(vQuote0, vToken0, m.ref, tokensIn, gross, spikeBps);
  if (spike > 0n) rescale(m, reserve + spike);
  return { token, isBuy: false, tokensIn, gross, fee, spike, out: gross - fee - spike, spot, reserveBefore, reserveAfter: m.vQuote - m.floor };
}

/**
 * What a trade would do, hop by hop. `side` is "buy" or "sell"; `viaParent` trades against the parent token only
 * (one hop) instead of routing through the whole lineage to ETH. `lineage` is root first, ending with the meme.
 */
export function simulateTrade(curves, { side, viaParent, lineage, amount, spikeBps, now }) {
  const c = clone(curves);
  const t = BigInt(now);
  const hops = [];
  if (side === "buy") {
    const path = viaParent ? lineage.slice(-1) : lineage;
    let x = amount;
    for (const token of path) {
      const h = buyHop(token, c.get(token), x, true, t);
      hops.push(h);
      x = h.out;
    }
    return { hops, out: x };
  }
  const path = viaParent ? lineage.slice(-1) : [...lineage].reverse();
  let x = amount;
  for (const token of path) {
    const h = sellHop(token, c.get(token), x, spikeBps, t);
    hops.push(h);
    x = h.out;
  }
  return { hops, out: x };
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
 * The opening batch with `add` more quote committed by the viewer: the tokens the whole batch would buy if it
 * closed now, the viewer's share of them and the price everyone pays. Nobody else committing is the assumption.
 */
export function openingEstimate(curve, { committed, add }) {
  const total = curve.batchQuote + add;
  if (total === 0n) return null;
  const [tokens] = buyOut(curve.vQuote, curve.vToken, total);
  return { tokens, yours: mulDiv(tokens, committed + add, total), price: mulDiv(total, WAD, tokens), total };
}

/**
 * What executing a union would do now: the meme's ETH reserve buys the target through its lineage, fee-free, and the
 * meme's curve is re-priced in the target at the rate obtained. Returns the hops, what the target family receives,
 * and the meme's price before and after, in its quote and in ETH.
 */
export function simulateUnion(curves, { meme, targetLineage, now }) {
  const c = clone(curves);
  const t = BigInt(now);
  const m = c.get(meme);
  const ethIn = m.vQuote - m.floor;
  const priceBefore = mulDiv(m.vQuote, WAD, m.vToken);
  const hops = [];
  let x = ethIn;
  for (const token of targetLineage) {
    const h = buyHop(token, c.get(token), x, false, t);
    hops.push(h);
    x = h.out;
  }
  const targetIn = x;
  rescale(m, targetIn);
  const priceAfter = mulDiv(m.vQuote, WAD, m.vToken); // in target tokens per whole meme token
  let targetEth = WAD;
  for (const token of targetLineage) {
    const k = c.get(token);
    targetEth = mulDiv(targetEth, k.vQuote, k.vToken);
  }
  return { ethIn, targetIn, hops, priceBefore, priceAfter, priceAfterEth: mulDiv(priceAfter, targetEth, WAD) };
}

/** Rebuilds the hops of a transaction that already happened from its Trade events, in the same shape as above. */
export function hopsFromEvents(events) {
  return events
    .filter((e) => e.name === "Trade")
    .map(({ args: a }) =>
      a.isBuy
        ? { token: a.token, isBuy: true, quoteIn: a.quoteAmount, fee: a.fee, toReserve: a.quoteAmount - a.fee, spike: 0n, out: a.tokenAmount }
        : { token: a.token, isBuy: false, tokensIn: a.tokenAmount, gross: a.quoteAmount, fee: a.fee, spike: a.spikeShare, out: a.quoteAmount - a.fee - a.spikeShare },
    );
}
