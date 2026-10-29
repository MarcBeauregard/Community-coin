// Everything about putting money in or taking it out of one meme: the swap panel with its exact breakdown before you
// confirm and its receipt after, the opening panel with your estimated share, the opening explained while it runs,
// and your position with its vesting. Every amount shown before a transaction is computed with web/src/curve.js and
// must equal the hub's own quote, or the breakdown is not shown at all.

import { useState, useEffect } from "preact/hooks";
import * as f from "./format.js";
import * as I from "./icons.js";
import { html, Avatar, Card, SegBar, Segmented, compact } from "./ui.js";
import { readCurves, simulateTrade, priceImpact, openingEstimate, hopsFromEvents } from "./curve.js";
import {
  useApp, MemeAvatar, EthCoin, UnitCoin, Term, countdown, n, TOLERANCE, SPIKE_FLAG, ethOrTokens, nameOf,
} from "./common.js";

// ------------------------------------------------------------------ where the money goes

/**
 * The hops of a trade, one row per curve it touches: what goes into or comes out of that curve's reserve, the fee
 * to its creator, the spike share it keeps, and what comes out. Built from a simulation or from the events of a
 * transaction that happened; both have the same shape.
 */
export function Flow({ hops, last = "You get" }) {
  const { world, session } = useApp();
  return html`<ol class="flow">
    ${hops.map((h, i) => {
      const m = world.memes.get(h.token);
      if (!m) return null;
      const quote = m.quoteSymbol, isLast = i === hops.length - 1;
      const creator = nameOf(session, m.creator);
      const reserveDelta = h.isBuy ? h.toReserve : -(h.gross - h.spike);
      return html`<li key=${i} class="flow-hop" data-hop=${i} data-fee=${String(h.fee)} data-spike=${String(h.spike)} data-out=${String(h.out)}
        data-reserve=${String(reserveDelta)}>
        <span class="flow-coin"><${MemeAvatar} m=${m} size="sm" /></span>
        <div class="flow-body">
          <div class="flow-head">
            <b>${m.symbol}</b><span class="muted">${h.isBuy ? "buy" : "sale"}</span>
            <span class=${`flow-reserve ${reserveDelta >= 0n ? "up-text" : "down-text"}`}
              data-tip=${`${m.symbol} reserve\n${reserveDelta >= 0n ? "Grows" : "Shrinks"} by ${ethOrTokens(reserveDelta >= 0n ? reserveDelta : -reserveDelta, quote)}`}>
              reserve ${reserveDelta >= 0n ? "+" : "−"}${ethOrTokens(reserveDelta >= 0n ? reserveDelta : -reserveDelta, quote)}</span>
          </div>
          <dl class="flow-facts">
            ${h.isBuy
              ? html`<div><dt>Pays</dt><dd>${ethOrTokens(h.quoteIn, quote)}</dd></div>`
              : html`<div><dt>Sells</dt><dd>${f.tokens(h.tokensIn, m.symbol)}</dd></div>`}
            <div><dt><${Term} k="creatorFee">Fee to ${creator}</${Term}></dt><dd>${ethOrTokens(h.fee, quote)}</dd></div>
            ${h.spike > 0n && html`<div class="hot-text"><dt><${Term} k="spikeShare">Kept for holders</${Term}></dt><dd>${ethOrTokens(h.spike, quote)}</dd></div>`}
            <div class=${isLast ? "flow-out" : ""}><dt>${isLast ? last : h.isBuy ? "Becomes the next reserve" : "Sold on to the parent"}</dt>
              <dd>${h.isBuy ? f.tokens(h.out, m.symbol) : ethOrTokens(h.out, quote)}</dd></div>
          </dl>
        </div>
      </li>`;
    })}
  </ol>`;
}

/** The sentence under a breakdown: why the money goes where it goes, for this trade. */
function why({ hops, side, m, world, params }) {
  const root = world.memes.get(m.root);
  if (side === "buy" && hops.length > 1)
    return `Every ${m.symbol} buy is a ${root.symbol} buy first: ${root.symbol}'s reserve grows by ${ethOrTokens(hops[0].toReserve, "ETH")}, and the copy's money stays in the original's family.`;
  if (side === "buy" && m.parent)
    return `You pay in ${m.quoteSymbol}, so the money stays inside the ${root.symbol} family.`;
  if (side === "buy") return `Your ETH goes into ${m.symbol}'s reserve, which can always buy every token in circulation back.`;
  if (hops.some((h) => h.spike > 0n))
    return `You sell above the 1h reference: ${f.percent(params.spikeShareBps / 10000, 0)} of what the sale gets above it stays in the reserve and lifts the price for everyone still holding.`;
  if (m.parent && hops.length === 1) return `You are paid in ${m.quoteSymbol}: the money stays in the family.`;
  return "The sale runs back up the lineage to ETH, each curve paying its creator's fee.";
}

/** What a trade would do, shown before you confirm: price impact, the worst you accept, and every hop. */
function Breakdown({ sim, side, m, getUnit }) {
  const { world, session } = useApp();
  const impact = priceImpact(sim.hops);
  const spike = sim.hops.reduce((s, h) => s + h.spike, 0n);
  const spikeHop = sim.hops.find((h) => h.spike > 0n);
  return html`<section class="breakdown" aria-label="What this trade does" data-testid="breakdown" data-out=${String(sim.out)}>
    <dl class="facts">
      <div><dt><${Term} k="priceImpact">Price impact</${Term}></dt><dd class=${impact > 0.05 ? "hot-text" : ""}>${f.percent(Math.max(0, impact), impact < 0.01 ? 2 : 1)}</dd></div>
      <div><dt><${Term} k="slippage">Minimum received</${Term}></dt><dd>${ethOrTokens((sim.out * TOLERANCE) / 100n, getUnit)}</dd></div>
      ${spike > 0n && html`<div class="hot-text"><dt><${Term} k="spikeShare">Spike share kept</${Term}></dt>
        <dd>${ethOrTokens(spikeHop.spike, world.memes.get(spikeHop.token).quoteSymbol)}</dd></div>`}
    </dl>
    <details class="flow-box" open>
      <summary>Where the money goes</summary>
      <${Flow} hops=${sim.hops} last="You get" />
    </details>
    <p class="explain">${why({ hops: sim.hops, side, m, world, params: session.params })}</p>
  </section>`;
}

/** What a trade did, from its events: the same rows as the breakdown, now final. */
function Receipt({ receipt, onClose }) {
  const { world } = useApp();
  const hops = hopsFromEvents(receipt.events);
  const first = hops[0], last = hops.at(-1);
  if (!first) return null;
  const paid = first.isBuy ? ethOrTokens(first.quoteIn, world.memes.get(first.token).quoteSymbol) : f.tokens(first.tokensIn, world.memes.get(first.token).symbol);
  const got = last.isBuy ? f.tokens(last.out, world.memes.get(last.token).symbol) : ethOrTokens(last.out, world.memes.get(last.token).quoteSymbol);
  return html`<section class="receipt" aria-label="Receipt" data-testid="receipt" data-out=${String(last.out)}>
    <div class="receipt-head"><span class="receipt-check"><${I.Check} size=${16} /></span><b>${receipt.title}</b>
      <button type="button" class="link-btn" onClick=${onClose}>New trade</button></div>
    <dl class="facts">
      <div><dt>You ${first.isBuy ? "paid" : "sold"}</dt><dd>${paid}</dd></div>
      <div><dt>You got</dt><dd>${got}</dd></div>
    </dl>
    <details class="flow-box" open>
      <summary>What happened</summary>
      <${Flow} hops=${hops} last="You got" />
    </details>
  </section>`;
}

// ------------------------------------------------------------------ trade

export function TradePanel({ m }) {
  const { world, session, act, busy } = useApp();
  const parent = m.parent && world.memes.get(m.parent);
  const [side, setSide] = useState("buy");
  const [via, setVia] = useState("ETH");
  const [value, setValue] = useState("0.1");
  const [quote, setQuote] = useState(null);
  const [sim, setSim] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const wei = f.parseAmount(value);
  const viaParent = via !== "ETH";
  const hub = session.hub;
  useEffect(() => setValue(side === "buy" ? "0.1" : ""), [side]);
  useEffect(() => {
    let live = true;
    setQuote(null);
    setSim(null);
    const run = async () => {
      if (!wei || (side === "sell" && wei > m.balance)) return;
      const now = session.chain.now();
      const q = side === "buy"
        ? await hub.read(viaParent ? "quoteBuy" : "quoteBuyEth", [m.address, wei])
        : await hub.read(viaParent ? "quoteSell" : "quoteSellToEth", [m.address, wei]);
      if (!live) return;
      setQuote(q);
      try {
        const curves = await readCurves(hub, m.lineage);
        const s = simulateTrade(curves, { side, viaParent, lineage: m.lineage, amount: wei, spikeBps: BigInt(session.params.spikeShareBps), now });
        if (live) setSim(s.out === q ? s : null); // never show a breakdown that disagrees with the contract
      } catch {
        if (live) setSim(null);
      }
    };
    const t = setTimeout(() => run().catch(() => live && setQuote(null)), 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [side, via, value, world.loadedAt, m.address]);

  const payUnit = side === "buy" ? (viaParent ? parent.symbol : "ETH") : m.symbol;
  const getUnit = side === "buy" ? m.symbol : viaParent ? parent.symbol : "ETH";
  const over = side === "sell" && wei && wei > m.balance;
  const minOut = quote ? (quote * TOLERANCE) / 100n : 0n;
  const route = [viaParent ? parent.symbol : "ETH", ...(viaParent ? [m.symbol] : m.lineage.map((a) => world.memes.get(a).symbol))];
  const shownRoute = side === "buy" ? route : [...route].reverse();
  const submit = async (e) => {
    e.preventDefault();
    if (!wei || !quote) return;
    const title = side === "buy" ? "Bought" : "Sold";
    const res = side === "buy"
      ? viaParent ? await act(title, "buy", [m.address, wei, minOut]) : await act(title, "buyEth", [m.address, minOut], wei)
      : viaParent ? await act(title, "sell", [m.address, wei, minOut]) : await act(title, "sellToEth", [m.address, wei, minOut]);
    if (res) {
      setReceipt({ title, events: res.events });
      if (side === "sell") setValue("");
    }
  };
  const edit = (v) => {
    setReceipt(null);
    setValue(v);
  };
  const flip = (s) => {
    setReceipt(null);
    setSide(s);
  };
  const spike = side === "sell" && m.premium > SPIKE_FLAG;
  const payBalance = side === "buy" ? (viaParent ? parent.balance : world.ethBalance) : m.balance;
  return html`<${Card} id="trade" class="action trade">
    <${Segmented} label="Side" value=${side} onChange=${flip} options=${[["buy", "Buy"], ["sell", "Sell"]]} size="side" />
    ${parent && html`<div class="row-between"><span class="muted fine">${side === "buy" ? "Pay with" : "Receive in"}</span>
      <${Segmented} label=${side === "buy" ? "Pay with" : "Receive in"} value=${via} onChange=${(v) => { setReceipt(null); setVia(v); }} options=${[["ETH", "ETH"], [parent.symbol, parent.symbol]]} size="sm" /></div>`}
    <form onSubmit=${submit}>
      <div class="swap">
        <div class="swap-box">
          <div class="swap-head">
            <label for="trade-amount">${side === "buy" ? "You pay" : "You sell"}</label>
            <span class="muted tnum">Balance ${payUnit === "ETH" ? compact(n(payBalance), 4) : f.tokens(payBalance)}</span>
          </div>
          <div class="swap-row">
            <input id="trade-amount" type="text" inputmode="decimal" autocomplete="off" placeholder="0" value=${value} onInput=${(e) => edit(e.currentTarget.value)} />
            ${(side === "sell" || viaParent) && html`<button type="button" class="link-btn" onClick=${() => edit(f.exact(side === "sell" ? m.balance : parent.balance))}>Max</button>`}
            <span class="token"><${UnitCoin} unit=${payUnit} />${payUnit}</span>
          </div>
        </div>
        <button type="button" class="swap-flip" aria-label=${side === "buy" ? "Switch to selling" : "Switch to buying"} onClick=${() => flip(side === "buy" ? "sell" : "buy")}><${I.Swap} size=${16} /></button>
        <div class="swap-box swap-out">
          <div class="swap-head"><span>You receive</span></div>
          <div class="swap-row">
            <strong class=${`tnum ${over ? "down-text" : ""}`} data-testid="receive">${over ? "Insufficient balance" : quote === null ? "—" : getUnit === "ETH" ? compact(n(quote), 4) : f.tokens(quote)}</strong>
            <span class="token"><${UnitCoin} unit=${getUnit} />${getUnit}</span>
          </div>
        </div>
      </div>
      <div class="route" aria-label="Route" data-tip=${`Route\n1% fee at each hop, paid to that meme's creator`}>
        ${shownRoute.map((s, i) => html`${i > 0 && html`<${I.Arrow} size=${13} />`}<span class="route-step">${s}</span>`)}
      </div>
      ${over && html`<p class="explain down-text">You hold ${f.tokens(m.balance, m.symbol)}. Lower the amount or press Max.</p>`}
      ${spike && !receipt && html`<p class="chip chip-hot spike" data-tip=${`${f.signedPercent(m.premium)} vs 1h reference\nPart of what you get above the reference stays with holders`}>Spike ${f.signedPercent(m.premium)}</p>`}
      ${receipt
        ? html`<${Receipt} receipt=${receipt} onClose=${() => setReceipt(null)} />`
        : sim && html`<${Breakdown} sim=${sim} side=${side} m=${m} getUnit=${getUnit} />`}
      <button class=${`btn wide btn-lg ${side === "sell" ? "btn-sell" : "btn-buy"}`} disabled=${!wei || !quote || over || busy}>${side === "buy" ? `Buy ${m.symbol}` : `Sell ${m.symbol}`}</button>
      <p class="fine muted"><${Term} k="slippage">Slippage 1%</${Term}></p>
    </form>
  </${Card}>`;
}

// ------------------------------------------------------------------ opening

/** The commit form, with your share estimated as if the opening closed now and nobody else committed. */
export function OpeningPanel({ m }) {
  const { world, session, act, busy } = useApp();
  const parent = m.parent && world.memes.get(m.parent);
  const [value, setValue] = useState("0.1");
  const [payWith, setPayWith] = useState("ETH");
  const [estimate, setEstimate] = useState(null);
  const wei = f.parseAmount(value);
  const viaParent = payWith !== "ETH";
  useEffect(() => {
    let live = true;
    setEstimate(null);
    (async () => {
      const add = !wei ? 0n : !parent || viaParent ? wei : await session.hub.read("quoteBuyEth", [parent.address, wei]);
      const e = openingEstimate(m, { committed: m.committed, add });
      if (live) setEstimate(e);
    })().catch(() => live && setEstimate(null));
    return () => {
      live = false;
    };
  }, [value, payWith, world.loadedAt, m.address]);
  const submit = (e) => {
    e.preventDefault();
    if (!wei) return;
    if (viaParent) act("Committed", "commit", [m.address, wei]);
    else act("Committed", "commitEth", [m.address, 0n], wei);
  };
  const quotePriceEth = parent ? parent.priceEth : 10n ** 18n;
  return html`<${Card} id="opening" title=${html`<${Term} k="opening">Opening</${Term}>`} class="action">
    <div class="countdown" data-tip=${`Closes at ${f.hourMinute(m.openUntil)}\nThe whole batch buys at once, at one price for everyone`}>
      <span class="countdown-time"><${I.Timer} size=${18} /><strong class="tnum">${countdown(m.openUntil - world.now)}</strong></span>
      <span class="muted fine">closes at ${f.hourMinute(m.openUntil)}</span>
    </div>
    <dl class="facts">
      <div><dt>Committed so far</dt><dd class="tnum">${m.parent ? f.tokens(m.batchQuote, m.quoteSymbol) : `${compact(n(m.batchQuote))} ETH`}</dd></div>
      <div><dt>You</dt><dd class="tnum">${m.committed > 0n ? (m.parent ? f.tokens(m.committed, m.quoteSymbol) : `${compact(n(m.committed))} ETH`) : "—"}</dd></div>
    </dl>
    <form onSubmit=${submit}>
      ${parent && parent.balance > 0n && html`<${Segmented} label="Pay with" value=${payWith} onChange=${setPayWith} options=${[["ETH", "ETH"], [parent.symbol, parent.symbol]]} size="sm" />`}
      <div class="amount">
        <input id="commit-amount" type="text" inputmode="decimal" autocomplete="off" aria-label="Amount" value=${value} onInput=${(e) => setValue(e.currentTarget.value)} />
        ${viaParent && html`<button type="button" class="link-btn" onClick=${() => setValue(f.exact(parent.balance))}>Max</button>`}
        <span class="token" data-tip=${!viaParent && parent ? `ETH buys ${parent.symbol} first` : undefined}>${viaParent ? html`<${MemeAvatar} m=${parent} size="sm" />` : html`<${EthCoin} size="sm" />`}${viaParent ? parent.symbol : "ETH"}</span>
      </div>
      ${estimate && wei && html`<div class="estimate" data-testid="estimate">
        <dl class="facts">
          <div><dt>Your share, if it closed now</dt><dd class="tnum">≈ ${f.tokens(estimate.yours, m.symbol)}</dd></div>
          <div><dt><${Term} k="price1m">Price · 1M for everyone</${Term}></dt><dd class="tnum">≈ ${compact(n(f.mulWad(estimate.price, quotePriceEth)) * 1e6)} ETH</dd></div>
        </dl>
        <p class="explain">More commits before the close mean a higher price for the whole batch, you included.</p>
      </div>`}
      <button class="btn wide btn-lg" disabled=${!wei || busy}>Commit</button>
      <p class="fine muted"><${Term} k="vesting">Unlocks over ${f.spoken(session.params.vestWindow)} after the close</${Term}></p>
    </form>
  </${Card}>`;
}

/** Three phases on one line: the opening running now, the vesting after it, then free trading. */
function Phases({ m }) {
  const { world, session } = useApp();
  const open = session.params.openWindow, vest = session.params.vestWindow;
  const start = m.openUntil - open, end = m.openUntil + vest;
  const pos = Math.max(0, Math.min(1, (world.now - start) / (end - start)));
  const w = (s) => `${((s / (open + vest)) * 100).toFixed(2)}%`;
  return html`<div class="phases" role="img" aria-label=${`Opening until ${f.hourMinute(m.openUntil)}, vesting until ${f.hourMinute(end)}, then free trading`}>
    <div class="phase-track">
      <span class="phase phase-open" style=${`width:${w(open)}`}></span>
      <span class="phase phase-vest" style=${`width:${w(vest)}`}></span>
      <span class="phase-now" style=${`left:${(pos * 100).toFixed(2)}%`}></span>
    </div>
    <div class="phase-legend">
      <span><i class="key key-open"></i><b><${Term} k="opening">Opening</${Term}></b><span class="muted tnum">${f.hourMinute(start)} → ${f.hourMinute(m.openUntil)}</span></span>
      <span><i class="key key-vest"></i><b><${Term} k="vesting">Vesting</${Term}></b><span class="muted tnum">${f.hourMinute(m.openUntil)} → ${f.hourMinute(end)}</span></span>
      <span><i class="key key-free"></i><b>Free trading</b><span class="muted tnum">from ${f.hourMinute(end)}</span></span>
    </div>
  </div>`;
}

/** Where the chart will be: while the opening runs, how it works, who is in the batch and when tokens unlock. */
export function OpeningStory({ m }) {
  const { world, session } = useApp();
  const commits = new Map();
  for (const r of session.activity) {
    if (r.kind !== "commit" || r.token !== m.address || !r.in) continue;
    const key = `${r.actor}:${r.in.unit}`;
    const prev = commits.get(key);
    commits.set(key, { actor: r.actor, unit: r.in.unit, wei: (prev?.wei ?? 0n) + r.in.wei });
  }
  const rows = [...commits.values()].sort((a, b) => (b.wei > a.wei ? 1 : -1));
  const oneUnit = new Set(rows.map((r) => r.unit)).size === 1;
  const total = rows.reduce((s, r) => s + r.wei, 0n);
  return html`<${Card} id="opening-story" title="How this opening works" class="span-8"
    value=${`${countdown(m.openUntil - world.now)} left · ${f.count(rows.length, "commit")}`}>
    <${Phases} m=${m} />
    <p class="explain">Every commit buys together when the timer ends, at one price set by the total committed. Being first gives no edge, so there is nothing for a bot to snipe. The batch's tokens then unlock over ${f.spoken(session.params.vestWindow)}, so nobody can dump the cheapest seats at once.</p>
    <div class="batch">
      <h3 class="sub">In the batch</h3>
      ${rows.length
        ? html`<ul class="batch-list">${rows.map((r) => html`<li key=${`${r.actor}${r.unit}`}>
            <span class="who"><${Avatar} symbol=${nameOf(session, r.actor)} size="sm" />${nameOf(session, r.actor)}</span>
            <span class="tnum">${ethOrTokens(r.wei, r.unit)}</span>
            ${oneUnit && total > 0n && html`<span class="batch-bar" aria-hidden="true"><span style=${`width:${((Number(r.wei) / Number(total)) * 100).toFixed(1)}%`}></span></span>`}
          </li>`)}</ul>`
        : html`<p class="empty">No commits yet. The first one sets the price for nobody: the total does, at the close.</p>`}
    </div>
  </${Card}>`;
}

// ------------------------------------------------------------------ position

export function PositionCard({ m }) {
  const { act, busy, session } = useApp();
  const value = f.mulWad(m.priceEth, m.balance);
  const locked = m.allocation > m.claimed + m.claimable ? m.allocation - m.claimed - m.claimable : 0n;
  const unlockAt = m.openUntil + session.params.vestWindow;
  return html`<${Card} id="position" title="Your position" value=${html`<span data-testid="position">${f.tokens(m.balance, m.symbol)}</span> <span class="muted">· ${compact(n(value))} ETH</span>`}>
    ${m.committed > 0n && !m.opening
      ? html`<div class="stack">
          <div class="row-between"><span class="muted fine">Opening allocation</span><span class="tnum fine">${f.tokens(m.allocation)}</span></div>
          <${SegBar} label="Allocation" parts=${[
            { label: "Claimed", value: n(m.claimed), tone: "ink", tip: `Claimed\n${f.tokens(m.claimed, m.symbol)}` },
            { label: "Claimable", value: n(m.claimable), tone: "accent", tip: `Claimable\n${f.tokens(m.claimable, m.symbol)}` },
            { label: "Locked", value: n(locked), tone: "line", tip: `Locked\n${f.tokens(locked, m.symbol)}, ${f.percent(m.vestedShare, 0)} vested` },
          ]} />
          <div class="legend"><span><i class="key key-ink"></i>Claimed</span><span><i class="key key-accent"></i>Claimable</span><span><i class="key key-line"></i>Locked</span></div>
          <p class="explain">${m.vestedShare < 1 ? `Unlocks evenly until ${f.hourMinute(unlockAt)}. Claim what has unlocked whenever you like.` : "Fully unlocked. Claim it to trade it."}</p>
          <button type="button" class="btn btn-quiet" disabled=${m.claimable === 0n || busy} onClick=${() => act("Claimed", "claim", [m.address])}>Claim ${m.claimable > 0n ? f.tokens(m.claimable) : ""}</button>
        </div>`
      : html`<p class="empty">${m.balance > 0n ? "Bought on the curve: no vesting." : m.opening ? "Commit to the opening to get a share of the batch." : "No tokens yet. Buy above to hold some."}</p>`}
  </${Card}>`;
}

