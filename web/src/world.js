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

/** Turns the hub events of one transaction into feed entries. */
export function describe(events, { fn, actorName, symbolOf, timestamp }) {
  const trades = events.filter((e) => e.name === "Trade");
  // An amount of the quote asset of `token`: ETH for a root, the parent token for a variant.
  const quoted = (wei, token) => {
    const sym = symbolOf(token, true);
    return sym === "ETH" ? f.eth(wei) : f.tokens(wei, sym);
  };
  const entries = [];
  for (const e of events) {
    const a = e.args;
    const entry = (token, text) => entries.push({ t: timestamp, token, text, actor: actorName });
    switch (e.name) {
      case "Launched":
        entry(a.token, a.parent === ZeroAddress ? `lance ${a.symbol}, coté en ETH` : `lance ${a.symbol}, variante de ${symbolOf(a.parent)}`);
        break;
      case "Committed":
        entry(a.token, `engage ${quoted(a.quote, a.token)} dans l'ouverture de ${symbolOf(a.token)}`);
        break;
      case "Settled":
        entry(a.token, `clôture l'ouverture : ${f.tokens(a.tokens, symbolOf(a.token))} au même prix pour tous`);
        break;
      case "Claimed":
        entry(a.token, `retire ${f.tokens(a.amount, symbolOf(a.token))} de son allocation`);
        break;
      case "Trade": {
        const routed = fn === "buyEth" ? e !== trades.at(-1) : fn === "sellToEth" ? e !== trades[0] : false;
        const quote = quoted(a.quoteAmount, a.token);
        let text = a.isBuy
          ? `achète ${f.tokens(a.tokenAmount, symbolOf(a.token))} pour ${quote}`
          : `vend ${f.tokens(a.tokenAmount, symbolOf(a.token))} pour ${quote}`;
        if (a.spikeShare > 0n) text += ` · ${quoted(a.spikeShare, a.token)} laissés aux détenteurs`;
        if (fn === "executeUnion") text = `fait acheter à la réserve de l'Union ${text.replace("achète ", "")}`;
        else if (routed) text += " · routage";
        entry(a.token, text);
        break;
      }
      case "FeesClaimed":
        entry(a.asset === ZeroAddress ? null : a.asset, `retire ${a.asset === ZeroAddress ? f.eth(a.amount) : f.tokens(a.amount, symbolOf(a.asset))} de frais de créateur`);
        break;
      case "UnionProposed":
        entry(a.meme, `propose que ${symbolOf(a.meme)} rejoigne la famille de ${symbolOf(a.target)}`);
        break;
      case "UnionLocked":
        entry(null, `verrouille ${f.tokens(a.amount)} pour l'Union n° ${a.id}`);
        break;
      case "UnionUnlocked":
        entry(null, `récupère ${f.tokens(a.amount)} verrouillés pour l'Union n° ${a.id}`);
        break;
      case "UnionExecuted":
        entry(a.meme, `exécute l'Union : ${symbolOf(a.meme)} rejoint la famille de ${symbolOf(a.target)} avec ${f.eth(a.ethIn)} de réserve`);
        break;
    }
  }
  return entries;
}
