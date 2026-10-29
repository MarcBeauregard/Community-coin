// The screens. Each answers one question at first glance, after the dashboard-design skill:
//
//   Market       What is this, what is live, and where is the money going?
//                welcome band on a first visit · spotlight (the live opening, or the top family) beside ETH locked,
//                volume, memes, live openings · families with a price trend per row · to-do · movers · activity
//   Meme         Is it rising, and what happens if I trade now?
//                price per million, gap to the 1h reference, market cap, reserve · chart with periods and events, or
//                the opening explained while it runs · trade with its breakdown · position · family tree and votes
//   Launch       Is the ticker free, and what will the launch do?
//   Unions       Which mergers are being voted, what would they change, and can I take part?
//   Portfolio    What do I hold, and what can I collect?
//   How it works The one page of sentences (learn.js).
//
// Attention rules, each flagged where it shows and with its action beside it: a live opening (Commit), a union
// whose vote passed (Execute), vested tokens to claim (Claim), creator fees (Withdraw), tokens locked in a
// finished vote (Unlock), a price far above its 1h reference (warm chip: selling now pays the holders).
// Wordless screens: explanations live in tooltips, glossary buttons and the few .explain lines beside a decision.

import { ZeroAddress } from "ethers";
import { useState, useEffect } from "preact/hooks";
import * as f from "./format.js";
import * as I from "./icons.js";
import { html, Avatar, Ring, Sparkline, Flash, celebrate, Coin, Delta, Kpi, Card, ShareBar, Segmented, StepChart, compact } from "./ui.js";
import { families, pointAt } from "./world.js";
import {
  useApp, go, memeHref, HOUR, n, countdown, amount, hueOf, MemeAvatar, EthCoin, MemeName, lockedOf, Phase, hourAgo, pathFor, familyOf,
  nameOf, Term, SPIKE_FLAG,
} from "./common.js";
import { TradePanel, OpeningPanel, OpeningStory, PositionCard } from "./trade.js";
import { FamilyTree, UnionBlock, ProposeUnion } from "./family.js";
import { Welcome, welcomeDismissed } from "./learn.js";

export { App, useApp, memeHref, go } from "./common.js";

// ------------------------------------------------------------------ shared panels

const KIND = {
  buy: ["Buy", "up"], sell: ["Sell", "down"], commit: ["Commit", "accent"], claim: ["Claim", ""],
  launch: ["Launch", "accent"], settle: ["Settle", ""], union: ["Union", "money"], propose: ["Proposal", ""],
  vote: ["Vote", ""], unvote: ["Unlock", ""], fees: ["Fees", "money"],
};

function ActivityTable({ token, limit = 10 }) {
  const { session, world } = useApp();
  const [more, setMore] = useState(false);
  const rows = session.activity.filter((r) => !token || r.token === token || r.target === token);
  const shown = rows.slice(0, more ? 60 : limit);
  const one = Boolean(token); // on a meme's own page the meme column says nothing new, except for unions
  if (!rows.length) return html`<p class="empty">Nothing yet. Buys, sales, commits and votes show up here as they happen.</p>`;
  return html`<div class=${`activity ${one ? "one-meme" : ""}`} role="table" aria-label="Activity">
    <div class="activity-row head" role="row">
      <span role="columnheader">When</span><span role="columnheader">Account</span><span role="columnheader">Action</span>
      <span role="columnheader">${one ? "" : "Meme"}</span><span role="columnheader" class="num">Amount</span>
      <span role="columnheader" class="num"><${Term} k="spikeShare">Spike share</${Term}></span>
    </div>
    ${shown.map((r, i) => {
      const m = r.token && world.memes.get(r.token);
      const target = r.target && world.memes.get(r.target);
      const [label, tone] = KIND[r.kind] ?? [r.kind, ""];
      const who = nameOf(session, r.actor);
      return html`<div class="activity-row" role="row" key=${i}>
        <span class="muted tnum" role="cell" data-tip=${f.fullDate(r.t)}>${f.ago(world.now - r.t)}</span>
        <span role="cell" class="who"><${Avatar} symbol=${who} size="sm" />${who}</span>
        <span role="cell" class="activity-kind"><span class=${`chip ${tone ? `chip-${tone}` : ""}`}>${label}</span></span>
        <span role="cell" class="activity-meme">${one && !target ? "" : m ? html`<${MemeName} m=${m} name=${false} />` : "—"}${target && html`<${I.Arrow} size=${14} /><${MemeName} m=${target} name=${false} />`}</span>
        <span role="cell" class="num tnum">${r.in && r.out ? html`${amount(r.in)} <span class="muted">→</span> ${amount(r.out)}` : amount(r.in ?? r.out)}</span>
        <span role="cell" class="num tnum">${r.spike ? html`<span class="hot-text" data-tip=${"Spike share\nLeft in the reserve for holders"}>${amount(r.spike)}</span>` : html`<span class="muted">—</span>`}</span>
      </div>`;
    })}
    ${rows.length > limit && html`<button type="button" class="link-btn" onClick=${() => setMore(!more)}>${more ? "Less" : `Show all · ${rows.length}`}</button>`}
  </div>`;
}

/** Everything that waits on the viewer, most urgent first, each with its action. */
function todoItems({ world }) {
  const items = [];
  for (const m of world.memes.values())
    if (m.opening) items.push({ key: `open-${m.address}`, m, label: "Opening", chip: countdown(m.openUntil - world.now), warm: true, href: memeHref(m.address), action: "Commit", sort: m.openUntil - world.now });
  for (const u of world.unions) {
    const meme = world.memes.get(u.meme), target = world.memes.get(u.target);
    const passed = world.now > u.deadline, majority = u.locked * 2n > u.circulating;
    if (!u.executed && !u.stale && passed && majority)
      items.push({ key: `exec-${u.id}`, m: meme, to: target, label: "Union", chip: "Majority", run: ["Union executed", "executeUnion", [u.id, 0n]], action: "Execute", sort: 1e6,
        party: { symbol: target.symbol, hue: hueOf(world, target) } });
    if (u.mine > 0n && (u.executed || u.stale || passed))
      items.push({ key: `lock-${u.id}`, m: meme, label: "Vote over", chip: f.tokens(u.mine), run: ["Tokens unlocked", "unlockUnion", [u.id]], action: "Unlock", sort: 3e6 });
    if (!u.executed && !u.stale && !passed && meme.balance > 0n)
      items.push({ key: `vote-${u.id}`, m: meme, to: target, label: "Vote", chip: f.percent(Number(u.locked) / Math.max(1, Number(u.circulating)), 0), href: memeHref(u.meme), action: "Vote", sort: 4e6 + u.deadline });
  }
  for (const m of world.memes.values())
    if (m.claimable > 0n) items.push({ key: `claim-${m.address}`, m, label: "Claimable", chip: f.tokens(m.claimable), run: ["Claimed", "claim", [m.address]], action: "Claim", sort: 2e6 });
  for (const x of world.fees)
    items.push({ key: `fees-${x.asset}`, m: x.asset === ZeroAddress ? null : world.memes.get(x.asset), label: "Fees", chip: x.symbol === "ETH" ? `${compact(n(x.amount))} ETH` : f.tokens(x.amount, x.symbol), run: ["Fees withdrawn", "claimFees", [x.asset]], action: "Withdraw", sort: 2.5e6 });
  return items.sort((a, b) => a.sort - b.sort);
}

function TodoList() {
  const { world, act, busy } = useApp();
  const items = todoItems({ world });
  if (!items.length) return html`<p class="empty">Nothing waits on you. Live openings, tokens to claim, votes and fees will show up here.</p>`;
  return html`<ul class="todo">
    ${items.slice(0, 7).map((it) => html`<li key=${it.key}>
      <span class="todo-what">
        ${it.m ? html`<${MemeName} m=${it.m} name=${false} />` : html`<span class="meme-id"><${EthCoin} /><span class="meme-sym">ETH</span></span>`}
        ${it.to && html`<${I.Arrow} size=${14} /><${MemeName} m=${it.to} name=${false} />`}
      </span>
      <span class="todo-label muted">${it.label}</span>
      <span class=${`chip ${it.warm ? "chip-hot" : ""} tnum`}>${it.chip}</span>
      ${it.href
        ? html`<a class="btn btn-sm" href=${it.href}>${it.action}</a>`
        : html`<button type="button" class="btn btn-sm" disabled=${busy} onClick=${async () => (await act(...it.run)) && it.party && celebrate(it.party)}>${it.action}</button>`}
    </li>`)}
  </ul>`;
}

/** Biggest price moves over the last hour, up or down. */
function Movers() {
  const { session, world } = useApp();
  const moves = [...world.memes.values()]
    .filter((m) => !m.opening)
    .map((m) => ({ m, cur: n(m.priceEth) * 1e6, prev: hourAgo(session, world, m) }))
    .filter((x) => x.prev)
    .sort((a, b) => Math.abs(b.cur / b.prev - 1) - Math.abs(a.cur / a.prev - 1))
    .slice(0, 5);
  if (!moves.length) return html`<p class="empty">Price moves over the last hour appear once memes have traded for a while.</p>`;
  return html`<div class="ranked compact movers">
    ${moves.map(({ m, cur, prev }) => html`<a class="ranked-row" key=${m.address} href=${memeHref(m.address)}>
      <span class="ranked-name"><${MemeAvatar} m=${m} /><span class="meme-sym">${m.symbol}</span></span>
      <${Delta} cur=${cur} prev=${prev} vs="" tip=${`${compact(prev)} → ${compact(cur)} ETH · 1M`} />
    </a>`)}
  </div>`;
}

function FamilyList({ rows, total, showShare = true }) {
  const { session, world } = useApp();
  return html`<div class="ranked families" role="table" aria-label="Families">
    <div class="ranked-row head" role="row">
      <span role="columnheader">Meme</span><span role="columnheader" class="num"><${Term} k="price1m">Price · 1M</${Term}></span>
      <span role="columnheader" class="num">1h</span><span role="columnheader" class="col-trend">Trend</span>
      <span role="columnheader" class="num col-res"><${Term} k="reserve">Reserve</${Term}></span>
      ${showShare && html`<span role="columnheader" class="num col-share">Share</span>`}
    </div>
    ${rows.map((m) => {
      const prev = hourAgo(session, world, m);
      const share = !m.parent && total > 0n ? (Number(lockedOf(m)) / Number(total)) * 100 : null;
      return html`<a class=${`ranked-row ${m.depth ? "variant" : ""}`} role="row" key=${m.address} href=${memeHref(m.address)} style=${`--depth:${m.depth}`}>
        ${share !== null && html`<${ShareBar} pct=${share} tone="money" />`}
        <span role="cell" class="ranked-name">
          ${m.depth > 0 && html`<span class="branch" aria-hidden="true"></span>`}
          <${MemeAvatar} m=${m} /><span class="meme-sym">${m.symbol}</span><span class="meme-name">${m.name}</span>
          <${Phase} m=${m} />
        </span>
        <span role="cell" class="num tnum" data-tip=${`${f.perMillion(m.priceEth)}\nPrice of one million ${m.symbol}`}><${Flash} value=${n(m.priceEth)}>${compact(n(m.priceEth) * 1e6)}</${Flash}></span>
        <span role="cell" class="num">${m.opening ? html`<span class="muted">—</span>` : html`<${Delta} cur=${n(m.priceEth) * 1e6} prev=${prev} vs="" tip=${prev !== null ? `1h ago: ${compact(prev)} ETH` : undefined} />`}</span>
        <span role="cell" class="col-trend">${m.opening ? null : html`<${Sparkline} points=${pathFor(session, m)} />`}</span>
        <span role="cell" class="num tnum col-res" data-tip=${m.parent ? `Reserve in ${m.quoteSymbol}` : "Reserve in ETH"}>${m.parent ? f.tokens(lockedOf(m), m.quoteSymbol) : `${compact(n(lockedOf(m)))} ETH`}</span>
        ${showShare && html`<span role="cell" class="num tnum muted col-share">${share === null ? "" : share < 0.1 ? "<0.1%" : `${f.percent(share / 100, share < 1 ? 1 : 0)}`}</span>`}
      </a>`;
    })}
  </div>`;
}

// ------------------------------------------------------------------ Market

/**
 * The hero of the market page: the live opening if there is one (the moment everyone pays the same price), else
 * the family holding the most ETH. Its coin sits inside the opening's countdown ring.
 */
function Spotlight({ rows }) {
  const { world, session } = useApp();
  const live = rows.filter((m) => m.opening).sort((a, b) => a.openUntil - b.openUntil)[0];
  const top = rows.filter((m) => !m.parent).sort((a, b) => (lockedOf(b) > lockedOf(a) ? 1 : lockedOf(b) < lockedOf(a) ? -1 : 0))[0];
  const m = live ?? top;
  if (!m) return null;
  const parent = m.parent && world.memes.get(m.parent);
  const left = m.openUntil - world.now;
  const prev = hourAgo(session, world, m);
  const pts = pathFor(session, m);
  const quote = (wei) => (m.parent ? f.tokens(wei, m.quoteSymbol) : `${compact(n(wei))} ETH`);
  const variants = familyOf(world, m).length - 1;
  return html`<section class="card spotlight" aria-labelledby="spotlight-title" data-spotlight=${live ? "opening" : "top"}>
    <div class="spot-stage">
      ${live
        ? html`<${Ring} fraction=${left / session.params.openWindow} size=${184} stroke=${3} label=${`Opening closes in ${countdown(left)}`}><${MemeAvatar} m=${m} size="xl" /></${Ring}>`
        : html`<div class="spot-halo"><${MemeAvatar} m=${m} size="xl" /></div>`}
    </div>
    <div class="spot-body">
      ${live
        ? html`<span class="chip chip-hot spot-eyebrow" data-tip=${"Live opening\nEvery commit buys at the same price when the timer ends"}><i class="dot dot-hot"></i>Live opening</span>`
        : html`<span class="chip chip-accent spot-eyebrow" data-tip=${"Top family\nThe root holding the most ETH"}>Top family</span>`}
      <h2 id="spotlight-title" class="spot-sym"><a href=${memeHref(m.address)}>${m.symbol}</a></h2>
      <p class="spot-name">${m.name}${parent ? html` <span class="muted">· variant of</span> <a href=${memeHref(parent.address)}>${parent.symbol}</a>` : ""}</p>
      <dl class="spot-stats">
        ${live
          ? html`<div><dt>Closes in</dt><dd class="tnum hot-text">${countdown(left)}</dd></div>
              <div><dt>Committed</dt><dd class="tnum">${quote(m.batchQuote)}</dd></div>
              <div><dt><${Term} k="price1m">Price · 1M</${Term}></dt><dd class="tnum">${compact(n(m.priceEth) * 1e6)} ETH</dd></div>`
          : html`<div><dt><${Term} k="price1m">Price · 1M</${Term}></dt><dd class="tnum"><${Flash} value=${n(m.priceEth)}>${compact(n(m.priceEth) * 1e6)} ETH</${Flash}></dd>
                <${Delta} cur=${n(m.priceEth) * 1e6} prev=${prev} vs="1h" /></div>
              <div><dt><${Term} k="reserve">Reserve</${Term}></dt><dd class="tnum">${compact(n(lockedOf(m)))} ETH</dd></div>
              <div><dt><${Term} k="family">Family</${Term}></dt><dd class="tnum">${f.count(variants, "variant")}</dd></div>`}
      </dl>
      <div class="spot-actions">
        <a class="btn btn-lg" href=${memeHref(m.address)}>${live ? `Commit to ${m.symbol}` : `Trade ${m.symbol}`}</a>
        ${!live && pts.length > 1 && html`<span class="spot-spark"><${Sparkline} points=${pts} width=${180} height=${44} /></span>`}
      </div>
    </div>
  </section>`;
}

export function Market({ onTour }) {
  const { world, session } = useApp();
  const [welcome, setWelcome] = useState(() => !welcomeDismissed());
  const rows = families(world);
  const roots = rows.filter((m) => !m.parent);
  const locked = roots.reduce((s, m) => s + lockedOf(m), 0n);
  const lockedAgo = pointAt(session.pulse, world.now - HOUR)?.locked ?? null;
  const vol = (from, to) => session.activity.reduce((s, r) => (r.eth && r.t > from && r.t <= to ? s + r.eth : s), 0n);
  const volume = vol(world.now - HOUR, world.now);
  const volumePrev = session.activity.some((r) => r.t <= world.now - HOUR) ? vol(world.now - 2 * HOUR, world.now - HOUR) : null;
  const launchedBefore = session.activity.some((r) => r.t <= world.now - HOUR)
    ? world.memes.size - session.activity.filter((r) => r.kind === "launch" && r.t > world.now - HOUR).length
    : null;
  const openings = rows.filter((m) => m.opening).length;
  const local = session.chain.kind === "local";

  return html`<div class="page">
    ${welcome && html`<${Welcome} onTour=${onTour} onClose=${() => setWelcome(false)} />`}
    <header class="page-head"><h1>Market</h1><span class="tagline">Copies feed the original</span>
      ${!welcome && html`<a class="link-btn" href="#how">How it works</a>`}</header>
    <div class=${`hero ${rows.length ? "" : "no-spot"}`}>
      <${Spotlight} rows=${rows} />
      <div class="kpis kpis-grid">
        <${Kpi} id="locked" label=${html`<${Term} k="reserve">ETH locked</${Term}>`} icon=${html`<${I.Lock} />`} value=${html`<${Flash} value=${n(locked)}>${compact(n(locked))}</${Flash}>`} unit="ETH"
          tip=${`${f.eth(locked)}\nReserves of the root memes, live openings included`}
          delta=${html`<${Delta} cur=${n(locked)} prev=${lockedAgo === null ? null : n(lockedAgo)} vs="vs 1h" />`} />
        <${Kpi} id="volume" label="Volume · 1h" icon=${html`<${I.Pulse} />`} value=${compact(n(volume))} unit="ETH"
          tip=${`${f.eth(volume)}\nETH traded on the root curves${local ? "" : " since this page opened"}`}
          delta=${html`<${Delta} cur=${n(volume)} prev=${volumePrev === null ? null : n(volumePrev)} vs="vs prev. hour" neutral=${true} />`} />
        <${Kpi} id="memes" label=${html`<${Term} k="meme">Memes</${Term}>`} icon=${html`<${I.Market} />`} value=${String(world.memes.size)}
          tip=${`${roots.length} ${roots.length === 1 ? "family" : "families"}\n${f.count(world.memes.size - roots.length, "variant")}`}
          delta=${html`<${Delta} cur=${world.memes.size} prev=${launchedBefore} vs="vs 1h" min=${5} format=${String} />`} />
        <${Kpi} id="openings" label=${html`<${Term} k="opening">Openings</${Term}>`} icon=${html`<${I.Timer} />`} value=${String(openings)} tone=${openings ? "hot" : null}
          tip=${"Live batch auctions\nOne price for every participant"} sub=${openings ? "live now" : "none live"} />
      </div>
    </div>
    <div class="grid-12">
      <${Card} id="families" title=${html`<${Term} k="family">Families</${Term}>`} value=${`${f.count(roots.length, "root")} · ${f.count(world.memes.size - roots.length, "variant")}`} class="span-8"
        actions=${html`<a class="btn btn-quiet btn-sm" href="#launch"><${I.Launch} size=${16} />Launch</a>`}>
        ${rows.length ? html`<${FamilyList} rows=${rows} total=${locked} />` : html`<div class="empty-state"><p>No memes yet. The first launch opens with a 5-minute batch auction.</p><a class="btn" href="#launch">Launch the first one</a></div>`}
      </${Card}>
      <div class="span-4 stack-col">
        <${Card} id="todo" title="To do"><${TodoList} /></${Card}>
        <${Card} id="movers" title="Movers · 1h"><${Movers} /></${Card}>
      </div>
    </div>
    <${Card} id="activity" title="Activity"><${ActivityTable} /></${Card}>
  </div>`;
}

// ------------------------------------------------------------------ Meme

const RANGES = [[HOUR, "1h"], [6 * HOUR, "6h"], [24 * HOUR, "24h"], [0, "All"]];

/** Events worth a mark on the price chart: launch, opening close, unions and the bigger trades. */
function chartMarkers(session, m) {
  const out = [];
  for (const r of session.activity) {
    if (r.token !== m.address && r.target !== m.address) continue;
    const who = nameOf(session, r.actor);
    if (r.kind === "launch") out.push({ t: r.t, tone: "accent", label: `Launch\nby ${who}` });
    else if (r.kind === "settle") out.push({ t: r.t, tone: "accent", label: `Opening closed\nThe batch bought ${amount(r.out)}` });
    else if (r.kind === "union") out.push({ t: r.t, tone: "money", label: `Union\n${amount(r.in)} joined the family` });
    else if ((r.kind === "buy" || r.kind === "sell") && r.eth && n(r.eth) >= 0.5)
      out.push({ t: r.t, tone: r.kind === "buy" ? "up" : "down", label: `Big ${r.kind === "buy" ? "buy" : "sale"}\n${who} · ${amount(r.in)} → ${amount(r.out)}` });
  }
  return out;
}

function PriceCard({ m }) {
  const { world, session } = useApp();
  const [range, setRange] = useState(0);
  const pts = session.history.get(m.address) ?? [];
  const from = range ? world.now - range : undefined;
  return html`<${Card} id="chart" title=${html`<${Term} k="price1m">Price · 1M</${Term}>`} value=${`${compact(n(m.priceEth) * 1e6)} ETH`} class="span-8"
    actions=${pts.length > 1 && html`<${Segmented} label="Period" value=${range} onChange=${setRange} options=${RANGES} size="sm" />`}>
    ${pts.length > 1
      ? html`<${StepChart} points=${pts.map((p) => ({ t: p.t, v: p.p }))} compare=${pts.map((p) => ({ t: p.t, v: p.r }))} from=${from}
          markers=${chartMarkers(session, m)} label="Price" compareLabel="1h reference" unit="ETH" timeOf=${f.hourMinute} />`
      : html`<div class="empty-state"><p>The chart starts with the first trade after the opening.</p></div>`}
  </${Card}>`;
}

/** On phones the trade panel sits below the chart: a bar at the bottom brings it back with one tap. */
function StickyAction({ m }) {
  const [hidden, setHidden] = useState(true);
  const target = m.opening ? "opening" : "trade";
  useEffect(() => {
    const el = document.getElementById(target);
    if (!el || !globalThis.IntersectionObserver) return;
    const io = new IntersectionObserver(([e]) => setHidden(e.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, [target, m.address]);
  const jump = () => {
    document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "center" });
    document.getElementById(m.opening ? "commit-amount" : "trade-amount")?.focus({ preventScroll: true });
  };
  return html`<div class=${`sticky-action ${hidden ? "is-hidden" : ""}`}>
    <button type="button" class="btn btn-lg wide" onClick=${jump} tabindex=${hidden ? -1 : 0}>${m.opening ? `Commit to ${m.symbol}` : `Trade ${m.symbol}`}</button>
  </div>`;
}

export function MemePage({ address }) {
  const { world, session } = useApp();
  const m = world.memes.get(address);
  if (!m) return html`<div class="page"><div class="card panel empty-state"><p>This meme does not exist on this hub. It may be from another network.</p><a class="btn" href="#market">Back to the market</a></div></div>`;
  const parent = m.parent && world.memes.get(m.parent);
  const creator = nameOf(session, m.creator);
  const unions = world.unions.filter((u) => u.meme === m.address || u.target === m.address);
  const family = familyOf(world, m);
  const familyEth = lockedOf(world.memes.get(m.root));
  const showUnion = unions.length > 0 || (!m.parent && !m.opening);

  return html`<div class="page">
    <nav class="crumbs" aria-label="Lineage">
      <span>ETH</span>
      ${m.lineage.map((a) => html`<${I.Chevron} size=${14} class="crumb-sep" /><a key=${a} href=${memeHref(a)} aria-current=${a === m.address ? "page" : null}>${world.memes.get(a).symbol}</a>`)}
    </nav>
    <header class="page-head meme-head">
      <${MemeAvatar} m=${m} size="lg" />
      <div>
        <h1>${m.symbol} <span class="meme-name">${m.name}</span></h1>
        <p class="muted fine">by ${creator} · ${parent ? html`<${Term} k="variant">variant</${Term}> of <a href=${memeHref(parent.address)}>${parent.symbol}</a>` : html`<${Term} k="root">root</${Term}>, priced in ETH`}</p>
      </div>
      <${Phase} m=${m} />
    </header>
    <div class="kpis">
      <${Kpi} id="price" label=${html`<${Term} k="price1m">Price · 1M</${Term}>`} icon=${html`<${I.Pulse} />`} value=${html`<${Flash} value=${n(m.priceEth)}>${compact(n(m.priceEth) * 1e6)}</${Flash}>`} unit="ETH"
        tip=${`${f.perMillion(m.priceEth)}\n${m.parent ? `${f.perMillion(m.price, m.quoteSymbol)} in ${m.quoteSymbol}` : "Price of one million tokens"}`}
        delta=${m.opening ? null : html`<${Delta} cur=${n(m.priceEth) * 1e6} prev=${hourAgo(session, world, m)} vs="vs 1h" />`}
        sub=${m.opening ? "indicative, set at the close" : null} />
      <${Kpi} id="premium" label=${html`<${Term} k="ref">vs 1h reference</${Term}>`} icon=${html`<${I.Spark} />`} tone=${m.premium > SPIKE_FLAG ? "hot" : null}
        value=${m.opening ? "—" : f.signedPercent(m.premium)} sub=${m.opening ? "starts after the opening" : m.premium > SPIKE_FLAG ? "selling now pays holders" : "no spike"}
        tip=${`Reference: ${compact(n(m.refEth) * 1e6)} ETH · 1M\nA slow price that follows the real one over an hour. Above it, part of a sale stays with holders`} />
      <${Kpi} id="cap" label=${html`<${Term} k="marketCap">Market cap</${Term}>`} icon=${html`<${I.Coins} />`} value=${compact(n(m.capEth))} unit="ETH"
        tip=${`${f.eth(m.capEth)}\n${m.opening ? "What the batch has committed so far" : `${f.tokens(m.circulating)} circulating`}`} sub=${m.opening ? "committed so far" : `${f.tokens(m.circulating)} circulating`} />
      <${Kpi} id="reserve" label=${html`<${Term} k="reserve">Reserve</${Term}>`} icon=${html`<${I.Lock} />`}
        value=${m.parent ? f.tokens(lockedOf(m)) : compact(n(lockedOf(m)))} unit=${m.parent ? m.quoteSymbol : "ETH"}
        tip=${`Curve reserve, in ${m.quoteSymbol}\nBuys back every circulating token, at any time`}
        delta=${m.opening ? null : html`<${Delta} cur=${n(lockedOf(m))} prev=${hourAgo(session, world, m, "res")} vs="vs 1h" />`} />
    </div>
    <div class="grid-12 meme-main">
      ${m.opening ? html`<${OpeningStory} m=${m} />` : html`<${PriceCard} m=${m} />`}
      <div class="span-4 stack-col">
        ${m.opening ? html`<${OpeningPanel} key=${m.address} m=${m} />` : html`<${TradePanel} key=${m.address} m=${m} />`}
        <${PositionCard} m=${m} />
      </div>
    </div>
    <${Card} id="family" title=${html`<${Term} k="family">Family</${Term}>`}
      value=${`${f.count(family.length, "meme")} · ${compact(n(familyEth))} ETH behind ${world.memes.get(m.root).symbol}`}
      actions=${m.depth < 6 && html`<a class="btn btn-quiet btn-sm" href=${`#launch-${m.address}`}><${I.Launch} size=${16} />Variant of ${m.symbol}</a>`}>
      <div class=${`family-grid ${showUnion ? "with-union" : ""}`}>
        <div class="stack">
          <${FamilyTree} m=${m} />
          <p class="explain">Every variant is priced in its parent, so the whole family shares one pool of ETH: ${world.memes.get(m.root).symbol}'s reserve.</p>
        </div>
        ${showUnion && html`<div class="family-union" id="unions">
          <h3 class="sub"><${Term} k="union">Union</${Term}></h3>
          ${unions.map((u) => html`<${UnionBlock} key=${u.id} u=${u} here=${u.meme === m.address} />`)}
          ${!unions.some((u) => u.meme === m.address && !u.executed && !u.stale) && !m.parent && !m.opening && html`<${ProposeUnion} m=${m} />`}
        </div>`}
      </div>
    </${Card}>
    <${Card} id="meme-activity" title="Activity"><${ActivityTable} token=${m.address} /></${Card}>
    <${StickyAction} m=${m} />
  </div>`;
}

// ------------------------------------------------------------------ Launch

export function Launch({ parentHint }) {
  const { world, act, session, busy } = useApp();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [parent, setParent] = useState(parentHint && world.memes.has(parentHint) ? parentHint : "");
  const [value, setValue] = useState("0.1");
  useEffect(() => setParent(parentHint && world.memes.has(parentHint) ? parentHint : ""), [parentHint]);
  const key = f.canonicalTicker(symbol);
  const existing = key && [...world.memes.values()].find((m) => f.canonicalTicker(m.symbol) === key);
  const tooLong = key.length > 16;
  const p = parent && world.memes.get(parent);
  const wei = value.trim() === "" ? 0n : f.parseAmount(value);
  const valid = name.trim() && key && !existing && !tooLong && wei !== null;
  const status = !symbol ? null : !key ? ["Invalid", "hot"] : tooLong ? ["16 max", "hot"] : existing ? ["Taken", "hot"] : ["Available", "money"];
  const hue = p ? hueOf(world, p) : [...world.memes.values()].filter((m) => !m.parent).length;
  const submit = async (e) => {
    e.preventDefault();
    if (!valid) return;
    if (await act("Meme launched", "launch", [name.trim(), symbol.trim(), parent || ZeroAddress], wei)) {
      celebrate({ symbol: key, hue });
      const token = await session.hub.read("tokenOfKey", [await session.hub.read("symbolKey", [symbol.trim()])]);
      go(memeHref(token));
    }
  };
  const eligible = [...world.memes.values()].filter((m) => m.depth < 6);
  const lineage = p ? [...p.lineage.map((a) => world.memes.get(a).symbol), key || "…"] : [key || "…"];
  const quote = p ? p.symbol : "ETH";
  return html`<div class="page narrow-page">
    <header class="page-head"><h1>Launch</h1></header>
    <div class="grid-12">
      <form class="card panel span-7 form" onSubmit=${submit}>
        <div class="field">
          <label for="launch-name">Name</label>
          <input id="launch-name" type="text" maxlength="40" placeholder="Peanut the Squirrel" value=${name} onInput=${(e) => setName(e.currentTarget.value)} />
        </div>
        <div class="field">
          <label for="launch-symbol"><${Term} k="ticker">Ticker</${Term}> ${status && html`<span class=${`chip chip-${status[1]}`} data-testid="ticker-status"
            data-tip=${existing ? `${existing.symbol} exists\nSame ticker once normalized (case, punctuation, leetspeak)` : key ? `Canonical: ${key}` : undefined}>${status[0]}</span>`}</label>
          <input id="launch-symbol" type="text" maxlength="32" placeholder="PNUT" value=${symbol} onInput=${(e) => setSymbol(e.currentTarget.value)}
            aria-describedby=${existing ? "ticker-help" : null} />
          ${existing && html`<p class="explain field-help" id="ticker-help">${symbol.trim()} reads as ${existing.symbol} once case, punctuation and look-alike digits are folded, and every meme has one ticker. Copies are welcome as variants: they are priced in ${existing.symbol} and feed it.</p>
            <div class="inline-actions"><a class="btn btn-quiet btn-sm" href=${memeHref(existing.address)}>View ${existing.symbol}</a>
            <a class="btn btn-sm" href=${`#launch-${existing.address}`}>Variant of ${existing.symbol}</a></div>`}
        </div>
        <div class="field">
          <label for="launch-parent"><${Term} k="family">Family</${Term}></label>
          <select id="launch-parent" value=${parent} onChange=${(e) => setParent(e.currentTarget.value)}>
            <option value="">Root · ETH</option>
            ${eligible.map((m) => html`<option key=${m.address} value=${m.address}>Variant of ${m.symbol}</option>`)}
          </select>
        </div>
        <div class="field">
          <label for="launch-amount"><${Term} k="commit">Your commit</${Term}> <span class="muted fine">optional</span></label>
          <div class="amount"><input id="launch-amount" type="text" inputmode="decimal" autocomplete="off" placeholder="0" value=${value} onInput=${(e) => setValue(e.currentTarget.value)} /><span class="unit">ETH</span></div>
        </div>
        <button class="btn wide btn-lg" disabled=${!valid || busy}>${existing ? `${existing.symbol} is taken` : `Launch ${key || ""}`}</button>
      </form>
      <${Card} id="preview" title="Preview" class="span-5 preview-card">
        <div class=${`preview ${existing ? "is-taken" : ""}`}>
          <div class="spot-halo">${existing
            ? html`<${MemeAvatar} m=${existing} size="xl" />`
            : html`<${Coin} symbol=${key || "?"} hue=${hue} depth=${p ? p.depth + 1 : 0} size="xl" />`}</div>
          <div class="preview-id"><p class="preview-sym">${existing ? existing.symbol : key || "—"}</p><p class="muted">${existing ? `Taken by ${existing.name}` : name || "—"}</p></div>
        </div>
        <div class="route" aria-label="Route">${["ETH", ...lineage].map((s, i) => html`${i > 0 && html`<${I.Arrow} size=${13} />`}<span class="route-step">${s}</span>`)}</div>
        <ol class="timeline" aria-label="After launch">
          <li data-tip=${"Opening\nBatch auction: the whole batch buys at once, at one price for everyone"}><span><${Term} k="opening">Opening</${Term}></span><b>${f.duration(session.params.openWindow)}</b></li>
          <li data-tip=${"Vesting\nOpening tokens unlock gradually"}><span><${Term} k="vesting">Vesting</${Term}></span><b>${f.duration(session.params.vestWindow)}</b></li>
          <li data-tip=${"Trading\nBuy and sell freely on the curve"}><span>Trading</span><b>∞</b></li>
        </ol>
        <dl class="facts">
          <div><dt><${Term} k="creatorFee">You earn</${Term}></dt><dd>1% of every trade · in ${quote}</dd></div>
          <div><dt><${Term} k="spikeShare">Spike share</${Term}></dt><dd>${f.percent(session.params.spikeShareBps / 10000, 0)}</dd></div>
        </dl>
        <p class="explain">${p
          ? `Every buy of your variant buys ${p.symbol} first, and you earn 1% of each trade on your curve, paid in ${p.symbol}.`
          : "Your meme opens with a batch auction at one price for everyone, you included, and you earn 1% of every trade on its curve, paid in ETH."}</p>
      </${Card}>
    </div>
  </div>`;
}

// ------------------------------------------------------------------ Unions

export function Unions() {
  const { world } = useApp();
  const open = world.unions.filter((u) => !u.executed && !u.stale);
  return html`<div class="page narrow-page">
    <header class="page-head"><h1>Unions</h1></header>
    <p class="explain page-explain">A union lets a rival root join another family instead of fighting it: its holders vote by locking their tokens, and if more than half of the circulating supply is locked when the vote closes, its ETH buys the target and it becomes a variant of it. <a href="#how-union">How unions work</a></p>
    <div class="kpis three">
      <${Kpi} id="u-open" label="Voting" icon=${html`<${I.Merge} />`} value=${String(open.filter((u) => world.now <= u.deadline).length)} />
      <${Kpi} id="u-ready" label="Ready" icon=${html`<${I.Check} />`} value=${String(open.filter((u) => world.now > u.deadline && u.locked * 2n > u.circulating).length)} />
      <${Kpi} id="u-done" label="Executed" icon=${html`<${I.Coins} />`} value=${String(world.unions.filter((u) => u.executed).length)} />
    </div>
    <${Card} id="union-list" title="Votes">
      ${world.unions.length
        ? world.unions.slice().reverse().map((u) => html`<${UnionBlock} key=${u.id} u=${u} />`)
        : html`<p class="empty">No votes yet. A union is proposed from the page of a root meme, in its Family card.</p>`}
    </${Card}>
  </div>`;
}

// ------------------------------------------------------------------ Portfolio

export function Portfolio({ onTour }) {
  const { world, session } = useApp();
  const held = [...world.memes.values()].filter((m) => m.balance > 0n || m.claimable > 0n);
  const values = held.map((m) => f.mulWad(m.priceEth, m.balance));
  const total = values.reduce((s, v) => s + v, 0n);
  const claimables = held.filter((m) => m.claimable > 0n);
  const claimValue = claimables.reduce((s, m) => s + f.mulWad(m.priceEth, m.claimable), 0n);
  const feeValue = world.fees.reduce((s, x) => s + (x.symbol === "ETH" ? x.amount : f.mulWad(world.memes.get(x.asset).priceEth, x.amount)), 0n);
  const opening = [...world.memes.values()].find((m) => m.opening);
  const local = session.chain.kind === "local";
  return html`<div class="page">
    <header class="page-head"><h1>Portfolio</h1></header>
    <div class="kpis">
      <${Kpi} id="p-memes" label="Holdings" icon=${html`<${I.Coins} />`} value=${compact(n(total))} unit="ETH" tip=${`${f.eth(total)}\nYour memes at the current price`}
        sub=${f.count(held.filter((m) => m.balance > 0n).length, "meme")} />
      <${Kpi} id="p-eth" label="ETH balance" icon=${html`<${I.Wallet} />`} value=${compact(n(world.ethBalance), 4)} unit="ETH" tip=${f.eth(world.ethBalance)} sub=${local ? "play money" : null} />
      <${Kpi} id="p-claim" label=${html`<${Term} k="claim">Claimable</${Term}>`} icon=${html`<${I.Lock} />`} value=${compact(n(claimValue))} unit="ETH"
        tip=${"Unlocked opening tokens\nValued at the current price"} sub=${f.count(claimables.length, "meme")} />
      <${Kpi} id="p-fees" label=${html`<${Term} k="creatorFee">Creator fees</${Term}>`} icon=${html`<${I.Coins} />`} value=${compact(n(feeValue))} unit="ETH"
        tip=${"Fees earned on the memes you launched\nValued at the current price"} sub=${f.count(world.fees.length, "asset")} />
    </div>
    <div class="grid-12">
      <${Card} id="holdings" title="Memes" class="span-8">
        ${held.length
          ? html`<div class="ranked">
              <div class="ranked-row head"><span>Meme</span><span class="num">Balance</span><span class="num">Value</span><span class="num">Share</span></div>
              ${held.map((m, i) => html`<a class="ranked-row" key=${m.address} href=${memeHref(m.address)}>
                <${ShareBar} pct=${total > 0n ? (Number(values[i]) / Number(total)) * 100 : 0} tone="money" />
                <span class="ranked-name"><${MemeAvatar} m=${m} /><span class="meme-sym">${m.symbol}</span><span class="meme-name">${m.name}</span></span>
                <span class="num tnum">${f.tokens(m.balance)}</span>
                <span class="num tnum">${compact(n(values[i]))} ETH</span>
                <span class="num tnum muted">${total > 0n ? f.percent(Number(values[i]) / Number(total), 0) : "—"}</span>
              </a>`)}
            </div>`
          : html`<div class="empty-state"><p>You hold no memes yet. ${opening ? `${opening.symbol} is in its opening: commit to get a share of the batch at the same price as everyone.` : "Buy one on the market to start."}</p>
              <div class="inline-actions">${opening ? html`<a class="btn" href=${memeHref(opening.address)}>Commit to ${opening.symbol}</a>` : html`<a class="btn" href="#market">Go to the market</a>`}
              ${local && html`<button type="button" class="btn btn-quiet" onClick=${onTour}>Take the tour</button>`}</div></div>`}
      </${Card}>
      <${Card} id="p-todo" title="To do" class="span-4"><${TodoList} /></${Card}>
    </div>
  </div>`;
}
