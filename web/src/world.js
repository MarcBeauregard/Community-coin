// Reads everything the interface shows from the hub, and keeps the activity feed and price history.

import { ZeroAddress } from "ethers";
import * as f from "./format.js";

export const VIRTUAL_TOKENS = 1_000_000_000n * 10n ** 18n;
const WAD = 10n ** 18n;

function ceilDiv(a, b) {
  return (a + b - 1n) / b;
}

/** Tokens the opening batch buys, from the curve, before it is settled. */
function batchOut(m) {
  return m.vToken - ceilDiv(m.vQuote * m.vToken, m.vQuote + m.batchQuote);
}

/** Average price the opening batch will pay, while the batch is still open. */
function batchPrice(m) {
  if (m.batchQuote === 0n) return (m.vQuote * WAD) / m.vToken;
  return (m.batchQuote * WAD) / batchOut(m);
}

export async function loadWorld(hub, chain, account, params) {
  const now = chain.now();
  const count = Number(await hub.read("memeCount"));
  const addresses = [];
  for (let i = 0; i < count; i++) addresses.push(await hub.read("allMemes", [i]));

  const memes = new Map();
  for (const address of addresses) {
    const s = await hub.read("memes", [address]);
    const m = {
      address,
      parent: s.parent === ZeroAddress ? null : s.parent,
      creator: s.creator,
      openUntil: Number(s.openUntil),
      settled: s.settled,
      vQuote: s.vQuote,
      vToken: s.vToken,
      floor: s.floor,
      batchQuote: s.batchQuote,
      batchTokens: s.batchTokens,
      name: await hub.token(address, "name"),
      symbol: await hub.token(address, "symbol"),
      supply: await hub.token(address, "totalSupply"),
      circulating: await hub.read("circulatingSupply", [address]),
      reserve: await hub.read("realReserve", [address]),
      children: [...(await hub.read("childrenOf", [address]))],
      balance: await hub.token(address, "balanceOf", [account]),
      committed: await hub.read("committed", [address, account]),
      claimed: await hub.read("claimed", [address, account]),
      claimable: await hub.read("claimable", [address, account]),
    };
    m.opening = !m.settled && now < m.openUntil;
    m.outstanding = VIRTUAL_TOKENS - m.vToken; // includes the batch once settled
    if (m.opening) {
      m.price = batchPrice(m);
      m.ref = m.price;
    } else {
      m.price = await hub.read("priceOf", [address]);
      m.ref = await hub.read("referencePrice", [address]);
    }
    m.vestedShare = params.vestWindow === 0 ? 1 : Math.min(1, Math.max(0, (now - m.openUntil) / params.vestWindow));
    m.vesting = !m.opening && m.vestedShare < 1;
    memes.set(address, m);
  }

  // Lineage, depth and prices in ETH, parents first.
  const priceEth = (m) => {
    if (m.priceEth !== undefined) return m.priceEth;
    m.priceEth = m.parent ? f.mulWad(priceEth(memes.get(m.parent)), m.price) : m.price;
    m.refEth = m.parent ? f.mulWad(priceEth(memes.get(m.parent)), m.ref) : m.ref;
    return m.priceEth;
  };
  for (const m of memes.values()) {
    priceEth(m);
    const lineage = [m.address];
    for (let p = m.parent; p; p = memes.get(p).parent) lineage.unshift(p);
    m.lineage = lineage;
    m.root = lineage[0];
    m.depth = lineage.length - 1;
    m.quoteSymbol = m.parent ? memes.get(m.parent).symbol : "ETH";
    m.capEth = m.opening ? f.mulWad(m.batchQuote, m.parent ? memes.get(m.parent).priceEth : WAD) : f.mulWad(m.priceEth, m.outstanding);
    m.premium = m.ref > 0n ? Number(m.price - m.ref) / Number(m.ref) : 0;
    m.allocation = m.committed > 0n ? ((m.settled ? m.batchTokens : batchOut(m)) * m.committed) / m.batchQuote : 0n;
  }

  const unions = [];
  const unionCount = Number(await hub.read("unionCount"));
  for (let id = 0; id < unionCount; id++) {
    const u = await hub.read("unions", [id]);
    const meme = memes.get(u.meme);
    unions.push({
      id,
      meme: u.meme,
      target: u.target,
      deadline: Number(u.deadline),
      executed: u.executed,
      locked: u.locked,
      mine: await hub.read("lockedOf", [id, account]),
      circulating: meme.circulating,
      stale: !u.executed && meme.parent !== null, // the meme already joined a family through another vote
    });
  }

  const fees = [];
  for (const asset of [ZeroAddress, ...addresses]) {
    const amount = await hub.read("feesOf", [account, asset]);
    if (amount > 0n) fees.push({ asset, symbol: asset === ZeroAddress ? "ETH" : memes.get(asset).symbol, amount });
  }

  return { now, memes, unions, fees, ethBalance: await chain.balance(account), loadedAt: Date.now() };
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
 * Turns the hub events of one transaction into activity rows: one row per thing that happened, in columns
 * (who, what, which meme, amount in, amount out) rather than sentences. Routed trades collapse into the one
 * trade the person made: "1 ETH → 5,5 M PNUTWIFHAT", not three hops.
 */
export function activityFrom(events, { fn, actor, timestamp, cache, unionMeme }) {
  const isRoot = (token) => cache.get(token)?.parent === ZeroAddress;
  const sym = (token) => cache.get(token)?.symbol ?? "?";
  const quoteSym = (token) => (isRoot(token) ? "ETH" : sym(cache.get(token)?.parent));
  const trades = events.filter((e) => e.name === "Trade").map((e) => e.args);
  const rows = [];
  const row = (kind, token, extra = {}) => rows.push({ t: timestamp, actor, kind, token, ...extra });

  // ETH that moved through a root curve in this transaction: the market's volume.
  let eth = 0n;
  for (const e of events) {
    if (e.name === "Trade" && isRoot(e.args.token)) eth += e.args.quoteAmount;
    if (e.name === "Settled" && isRoot(e.args.token)) eth += e.args.quote;
  }

  if (trades.length && ["buyEth", "buy", "sellToEth", "sell"].includes(fn)) {
    const first = trades[0], last = trades.at(-1);
    const spikeTrade = trades.find((t) => t.spikeShare > 0n);
    const spike = spikeTrade ? { wei: spikeTrade.spikeShare, unit: quoteSym(spikeTrade.token) } : null;
    if (fn === "buyEth") row("buy", last.token, { in: { wei: first.quoteAmount, unit: "ETH" }, out: { wei: last.tokenAmount, unit: sym(last.token) } });
    if (fn === "buy") row("buy", first.token, { in: { wei: first.quoteAmount, unit: quoteSym(first.token) }, out: { wei: first.tokenAmount, unit: sym(first.token) } });
    if (fn === "sellToEth")
      row("sell", first.token, { in: { wei: first.tokenAmount, unit: sym(first.token) }, out: { wei: last.quoteAmount - last.fee - last.spikeShare, unit: "ETH" }, spike });
    if (fn === "sell")
      row("sell", first.token, { in: { wei: first.tokenAmount, unit: sym(first.token) }, out: { wei: first.quoteAmount - first.fee - first.spikeShare, unit: quoteSym(first.token) }, spike });
  }
  for (const e of events) {
    const a = e.args;
    switch (e.name) {
      case "Launched":
        row("launch", a.token, { parent: a.parent === ZeroAddress ? null : a.parent });
        break;
      case "Committed": {
        const paidEth = trades.length && (fn === "commitEth" || fn === "launch") ? trades[0].quoteAmount : null;
        row("commit", a.token, { in: paidEth !== null ? { wei: paidEth, unit: "ETH" } : { wei: a.quote, unit: quoteSym(a.token) } });
        break;
      }
      case "Settled":
        row("settle", a.token, { out: { wei: a.tokens, unit: sym(a.token) } });
        break;
      case "Claimed":
        row("claim", a.token, { out: { wei: a.amount, unit: sym(a.token) } });
        break;
      case "FeesClaimed":
        row("fees", a.asset === ZeroAddress ? null : a.asset, { out: { wei: a.amount, unit: a.asset === ZeroAddress ? "ETH" : sym(a.asset) } });
        break;
      case "UnionProposed":
        row("propose", a.meme, { target: a.target });
        break;
      case "UnionLocked":
        row("vote", unionMeme(a.id), { in: { wei: a.amount, unit: sym(unionMeme(a.id)) } });
        break;
      case "UnionUnlocked":
        row("unvote", unionMeme(a.id), { out: { wei: a.amount, unit: sym(unionMeme(a.id)) } });
        break;
      case "UnionExecuted":
        row("union", a.meme, { target: a.target, in: { wei: a.ethIn, unit: "ETH" } });
        break;
    }
  }
  if (rows.length) rows[0].eth = eth;
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
