// Every word of the trade the interface uses, defined once. Each info button and the glossary on the How it works
// page read from here, so a term means the same thing everywhere. One sentence each, plain words, no other jargon.
// {open}, {vest}, {spike}, {vote}, {creator} and {protocol} stand for the hub's own parameters, filled in by term().

import { spoken, percent } from "./format.js";

export const GLOSSARY = {
  meme: ["Meme", "A token with a name and a ticker, launched here and traded on its own price curve."],
  root: ["Root", "A meme priced in SOL: the original of its family."],
  variant: ["Variant", "A copy launched inside the family of the meme it copies, priced in that meme instead of SOL."],
  family: ["Family", "A root and every variant built on it. They share one pool of SOL."],
  lineage: ["Lineage", "The chain from SOL to a meme through its parents. A buy of a variant goes down that chain, root first."],
  price1m: ["Price · 1M", "What one million tokens cost right now, in SOL. Memes have tiny unit prices, so a million reads better."],
  ref: ["1h reference", "A slow price that catches up with the real one over an hour. Sales above it pay a spike share."],
  reserve: ["Reserve", "What the curve holds to buy tokens back: SOL for a root, the parent's tokens for a variant."],
  marketCap: ["Market cap", "Every token in circulation valued at the current price."],
  opening: ["Opening", "The first {open} of a launch. Everyone who commits buys together, at one price, when the timer ends."],
  commit: ["Commit", "Putting money into an opening. You get your share of the tokens the whole batch buys."],
  vesting: ["Vesting", "Opening tokens unlock gradually over {vest} after the opening, so the cheapest seats cannot be dumped at once."],
  claim: ["Claim", "Moving the opening tokens that have unlocked into your balance."],
  spike: ["Spike", "How far the price sits above its 1h reference. A big spike usually means a wave of buyers just arrived."],
  spikeShare: ["Spike share", "{spike} of what a sale gets above the 1h reference stays in the reserve, which lifts the price for everyone still holding."],
  creatorFee: ["Creator fee", "{creator} of every trade on a meme's curve goes to the person who launched it."],
  protocolFee: ["Protocol fee", "{protocol} of every trade goes to Community Coin. It comes out of the 1% fee, never on top of it, and the program caps it at 0.5% for good."],
  slippage: ["Slippage", "How far the price may move before your trade goes through. Beyond 1%, it is refused and nothing happens."],
  priceImpact: ["Price impact", "How much your own trade moves the price against you, fees left out. Bigger trades move it more."],
  union: ["Union", "A vote by which a rival root joins another family: its SOL buys the target, and its holders keep their tokens."],
  quorum: ["Majority", "A union passes only if more than half of the meme's tokens in circulation are locked in favour when the vote closes, {vote} after it opens."],
  lock: ["Lock", "Voting for a union by depositing your tokens. You can take them back at any time."],
  settle: ["Settle", "The moment an opening closes and the whole batch buys on the curve. It happens on the first action after the timer."],
  ticker: ["Ticker", "The short name of a meme. Case, punctuation and look-alike digits are folded, so PNUT, $pnut and PNU7 are one ticker."],
  demo: ["Demo", "Everything runs in this page with play SOL: the program's exact rules, example accounts and a clock you can skip ahead."],
};

const DEFAULTS = { openWindow: 300, vestWindow: 3600, spikeShareBps: 5000, unionWindow: 259200, protocolFeeBps: 20 };

export const term = (key, params = DEFAULTS) => {
  const entry = GLOSSARY[key];
  if (!entry) throw new Error(`No glossary entry for ${key}`);
  const fill = {
    open: spoken(params.openWindow),
    vest: spoken(params.vestWindow),
    spike: percent(params.spikeShareBps / 10000, 0),
    vote: spoken(params.unionWindow),
    creator: percent((100 - (params.protocolFeeBps ?? 0)) / 10000, 1),
    protocol: percent((params.protocolFeeBps ?? 0) / 10000, 1),
  };
  const text = entry[1].replace(/\{(\w+)\}/g, (_, k) => fill[k]);
  return { key, name: entry[0], text };
};
