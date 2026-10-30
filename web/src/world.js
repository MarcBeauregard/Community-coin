// Reads everything the interface shows from the hub's engine, and turns transactions into activity rows.
//
// Display units: every amount on screen is a bigint with 18 decimals, whatever it measures, so the formatting
// helpers need no unit. Lamports (9 decimals) are multiplied by 1e9, token units (6 decimals) by 1e12; a price is
// display quote per display token, 1e18-scaled. toBase() converts amounts back for a transaction, displayEvents()
// converts what a transaction did.

import { SOL, VIRTUAL_TOKENS as VIRTUAL_TOKEN_UNITS, spot, buyOut } from "./protocol.js";
import * as f from "./format.js";

const WAD = 10n ** 18n;
export const SOL_SCALE = 10n ** 9n; // lamports → display units
export const TOKEN_SCALE = 10n ** 12n; // token units → display units
export const VIRTUAL_TOKENS = VIRTUAL_TOKEN_UNITS * TOKEN_SCALE;

/** Display units per base unit of a meme's quote asset: SOL for a root, its parent's tokens for a variant. */
export const quoteScale = (m) => (m.parent === SOL ? SOL_SCALE : TOKEN_SCALE);
/** A price in quote base units per token base unit (the program's, 1e18-scaled), in display units. */
export const displayPrice = (m, price) => (price * quoteScale(m)) / TOKEN_SCALE;
/** A price in lamports per token unit (1e18-scaled), in display units. */
export const displaySolPrice = (price) => (price * SOL_SCALE) / TOKEN_SCALE;

/** Tokens the opening batch buys, from the curve, before it is settled (token units). */
function batchOut(m) {
  return buyOut(m.vQuote, m.vToken, m.batchQuote)[0];
}

/** Average price the opening batch will pay, while it is still open (base units, 1e18-scaled). */
function batchPrice(m) {
  if (m.batchQuote === 0n) return spot(m.vQuote, m.vToken);
  return (m.batchQuote * WAD) / batchOut(m);
}

/** Amounts of an operation, typed on screen, in base units for the hub. */
export function toBase(engine, op, a) {
  const lamports = (x) => (x ?? 0n) / SOL_SCALE;
  const units = (x) => (x ?? 0n) / TOKEN_SCALE;
  const quote = (mint) => (engine.meme(mint).parent === SOL ? lamports : units);
  switch (op) {
    case "launch": return { ...a, solIn: lamports(a.solIn) };
    case "commitSol": return { ...a, solIn: lamports(a.solIn) };
    case "commit": return { ...a, amount: quote(a.mint)(a.amount) };
    case "buySol": return { ...a, solIn: lamports(a.solIn), minOut: units(a.minOut) };
    case "buy": return { ...a, amount: quote(a.mint)(a.amount), minOut: units(a.minOut) };
    case "sell": return { ...a, amount: units(a.amount), minOut: quote(a.mint)(a.minOut) };
    case "sellToSol": return { ...a, amount: units(a.amount), minOut: lamports(a.minOut) };
    case "lockUnion": return { ...a, amount: units(a.amount) };
    default: return a;
  }
}

/** The events of a transaction, their amounts in display units. Read against the state just after it. */
export function displayEvents(engine, events) {
  const q = (mint) => (engine.state.memes.get(mint)?.parent === SOL ? SOL_SCALE : TOKEN_SCALE);
  return events.map(({ name, args: a }) => {
    const x = { ...a };
    if (name === "Committed") x.quote = a.quote * q(a.mint);
    if (name === "Settled") Object.assign(x, { quote: a.quote * q(a.mint), tokens: a.tokens * TOKEN_SCALE });
    if (name === "Claimed" || name === "UnionLocked" || name === "UnionUnlocked") x.amount = a.amount * TOKEN_SCALE;
    if (name === "FeesClaimed") x.amount = a.amount * (a.asset === SOL ? SOL_SCALE : TOKEN_SCALE);
    if (name === "UnionExecuted") Object.assign(x, { solIn: a.solIn * SOL_SCALE, targetIn: a.targetIn * TOKEN_SCALE });
    if (name === "Trade") {
      const s = q(a.mint);
      Object.assign(x, { quoteAmount: a.quoteAmount * s, fee: a.fee * s, protocolFee: a.protocolFee * s, spikeShare: a.spikeShare * s, tokenAmount: a.tokenAmount * TOKEN_SCALE });
    }
    return { name, args: x };
  });
}

export async function loadWorld(hub, account) {
  const e = hub.engine, st = e.state, now = hub.now(), params = hub.params;
  const children = new Map(st.order.map((mint) => [mint, []]));
  for (const mint of st.order) {
    const p = st.memes.get(mint).parent;
    if (p !== SOL) children.get(p)?.push(mint);
  }

  const memes = new Map();
  for (const mint of st.order) {
    const x = st.memes.get(mint);
    const q = quoteScale(x), T = TOKEN_SCALE;
    const c = e.commitment(mint, account);
    const m = {
      address: mint,
      parent: x.parent === SOL ? null : x.parent,
      creator: x.creator,
      openUntil: x.openUntil,
      settled: x.settled,
      vQuote: x.vQuote * q,
      vToken: x.vToken * T,
      floor: x.floor * q,
      batchQuote: x.batchQuote * q,
      batchTokens: x.batchTokens * T,
      name: x.name,
      symbol: x.symbol,
      supply: (st.supply.get(mint) ?? 0n) * T,
      circulating: e.circulating(mint) * T,
      reserve: (x.vQuote - x.floor) * q,
      children: children.get(mint),
      balance: e.balance(mint, account) * T,
      committed: c.committed * q,
      claimed: c.claimed * T,
      claimable: e.claimable(mint, account, now) * T,
      creatorFees: x.creatorFees * q,
      protocolFees: x.protocolFees * q,
    };
    m.opening = !x.settled && now < x.openUntil;
    m.outstanding = VIRTUAL_TOKENS - m.vToken; // includes the batch once settled
    if (m.opening) {
      m.price = displayPrice(x, batchPrice(x));
      m.ref = m.price;
    } else {
      m.price = displayPrice(x, e.price(mint, now));
      m.ref = displayPrice(x, e.referencePrice(mint, now));
    }
    m.vestedShare = params.vestWindow === 0 ? 1 : Math.min(1, Math.max(0, (now - x.openUntil) / params.vestWindow));
    m.vesting = !m.opening && m.vestedShare < 1;
    const batch = x.settled ? x.batchTokens : batchOut(x);
    m.allocation = c.committed > 0n ? ((batch * c.committed) / x.batchQuote) * T : 0n;
    memes.set(mint, m);
  }

  // Lineage, depth and prices in SOL, parents first.
  const priceSol = (m) => {
    if (m.priceSol !== undefined) return m.priceSol;
    m.priceSol = m.parent ? f.mulWad(priceSol(memes.get(m.parent)), m.price) : m.price;
    m.refSol = m.parent ? f.mulWad(priceSol(memes.get(m.parent)), m.ref) : m.ref;
    return m.priceSol;
  };
  for (const m of memes.values()) {
    priceSol(m);
    const lineage = [m.address];
    for (let p = m.parent; p; p = memes.get(p).parent) lineage.unshift(p);
    m.lineage = lineage;
    m.root = lineage[0];
    m.depth = lineage.length - 1;
    m.quoteSymbol = m.parent ? memes.get(m.parent).symbol : "SOL";
    m.capSol = m.opening ? f.mulWad(m.batchQuote, m.parent ? memes.get(m.parent).priceSol : WAD) : f.mulWad(m.priceSol, m.outstanding);
    m.premium = m.ref > 0n ? Number(m.price - m.ref) / Number(m.ref) : 0;
  }

  const unions = st.unions.map((u) => {
    const meme = memes.get(u.meme);
    return {
      id: u.id,
      meme: u.meme,
      target: u.target,
      deadline: u.deadline,
      executed: u.executed,
      locked: u.locked * TOKEN_SCALE,
      mine: e.lock(u.id, account) * TOKEN_SCALE,
      circulating: meme.circulating,
      stale: !u.executed && meme.parent !== null, // the meme already joined a family through another vote
    };
  });

  // Fees waiting for this account: on the memes it launched, and the protocol's cut when it is the treasury.
  const fees = [];
  for (const m of memes.values()) {
    if (m.creator === account && m.creatorFees > 0n) fees.push({ mint: m.address, protocol: false, unit: m.quoteSymbol, asset: m.parent, amount: m.creatorFees });
    if (params.feeRecipient === account && m.protocolFees > 0n) fees.push({ mint: m.address, protocol: true, unit: m.quoteSymbol, asset: m.parent, amount: m.protocolFees });
  }

  return { now, memes, unions, fees, solBalance: hub.solBalance(account) * SOL_SCALE, loadedAt: Date.now() };
}

/** Families: every root followed by its descendants, depth first. */
export function families(world) {
  const out = [];
  const visit = (address) => {
    const m = world.memes.get(address);
    out.push(m);
    for (const c of m.children) visit(c);
  };
  for (const m of world.memes.values()) if (!m.parent) visit(m.address);
  return out;
}

/** A meme's family: every root followed by its descendants, depth first. */
export function familyOf(world, root) {
  const out = [];
  const visit = (address) => {
    const m = world.memes.get(address);
    out.push(m);
    for (const c of m.children) visit(c);
  };
  visit(root);
  return out;
}

/**
 * Turns the events of one transaction (display units) into activity rows: one row per thing that happened, in
 * columns (who, what, which meme, amount in, amount out) rather than sentences. Routed trades collapse into the one
 * trade the person made: "30 SOL → 5.5M PNUTWIFHAT", not three hops. `memeOf(mint)` reads the meme as it is now.
 */
export function activityFrom(events, { op, actor, timestamp, memeOf, unionMeme }) {
  const isRoot = (mint) => memeOf(mint)?.parent === SOL;
  const sym = (mint) => memeOf(mint)?.symbol ?? "?";
  const quoteSym = (mint) => (isRoot(mint) ? "SOL" : sym(memeOf(mint)?.parent));
  const trades = events.filter((e) => e.name === "Trade").map((e) => e.args);
  const rows = [];
  const row = (kind, token, extra = {}) => rows.push({ t: timestamp, actor, kind, token, ...extra });

  // SOL that moved through a root curve in this transaction: the market's volume.
  let sol = 0n;
  for (const e of events) {
    if (e.name === "Trade" && isRoot(e.args.mint)) sol += e.args.quoteAmount;
    if (e.name === "Settled" && isRoot(e.args.mint)) sol += e.args.quote;
  }

  if (trades.length && ["buySol", "buy", "sellToSol", "sell"].includes(op)) {
    const first = trades[0], last = trades.at(-1);
    const spikeTrade = trades.find((t) => t.spikeShare > 0n);
    const spike = spikeTrade ? { value: spikeTrade.spikeShare, unit: quoteSym(spikeTrade.mint) } : null;
    if (op === "buySol") row("buy", last.mint, { in: { value: first.quoteAmount, unit: "SOL" }, out: { value: last.tokenAmount, unit: sym(last.mint) } });
    if (op === "buy") row("buy", first.mint, { in: { value: first.quoteAmount, unit: quoteSym(first.mint) }, out: { value: first.tokenAmount, unit: sym(first.mint) } });
    if (op === "sellToSol")
      row("sell", first.mint, { in: { value: first.tokenAmount, unit: sym(first.mint) }, out: { value: last.quoteAmount - last.fee - last.spikeShare, unit: "SOL" }, spike });
    if (op === "sell")
      row("sell", first.mint, { in: { value: first.tokenAmount, unit: sym(first.mint) }, out: { value: first.quoteAmount - first.fee - first.spikeShare, unit: quoteSym(first.mint) }, spike });
  }
  for (const e of events) {
    const a = e.args;
    switch (e.name) {
      case "Launched":
        row("launch", a.mint, { parent: a.parent === SOL ? null : a.parent });
        break;
      case "Committed": {
        const paidSol = trades.length && (op === "commitSol" || op === "launch") ? trades[0].quoteAmount : null;
        row("commit", a.mint, { in: paidSol !== null ? { value: paidSol, unit: "SOL" } : { value: a.quote, unit: quoteSym(a.mint) } });
        break;
      }
      case "Settled":
        row("settle", a.mint, { out: { value: a.tokens, unit: sym(a.mint) } });
        break;
      case "Claimed":
        row("claim", a.mint, { out: { value: a.amount, unit: sym(a.mint) } });
        break;
      case "FeesClaimed":
        row("fees", a.meme, { out: { value: a.amount, unit: a.asset === SOL ? "SOL" : sym(a.asset) } });
        break;
      case "UnionProposed":
        row("propose", a.meme, { target: a.target });
        break;
      case "UnionLocked":
        row("vote", unionMeme(a.id), { in: { value: a.amount, unit: sym(unionMeme(a.id)) } });
        break;
      case "UnionUnlocked":
        row("unvote", unionMeme(a.id), { out: { value: a.amount, unit: sym(unionMeme(a.id)) } });
        break;
      case "UnionExecuted":
        row("union", a.meme, { target: a.target, in: { value: a.solIn, unit: "SOL" } });
        break;
    }
  }
  if (rows.length) rows[0].sol = sol;
  return rows;
}

/** The last point at or before `t`, or null when the history starts later. */
export function pointAt(points, t) {
  let found = null;
  for (const p of points ?? []) {
    if (p.t <= t) found = p;
    else break;
  }
  return found;
}
