// The understanding layer: the welcome band a first visit opens on, and the How it works page. Everything here is
// allowed to speak in sentences; the trading screens stay wordless. Numbers come from the live chain (the follow-the-
// money calculator, the examples) or from scripts/simulate.js (web/src/simulation.json), never typed in by hand.

import { useState, useEffect } from "preact/hooks";
import * as f from "./format.js";
import * as I from "./icons.js";
import { html, Coin, Avatar, Segmented, compact } from "./ui.js";
import { readCurves, simulateTrade } from "./curve.js";
import { GLOSSARY, term } from "./glossary.js";
import { useApp, MemeAvatar, memeHref, amount, nameOf, n, ethOrTokens } from "./common.js";
import { Flow } from "./trade.js";
import simulation from "./simulation.json";

const WELCOME_KEY = "community-coin-welcome";
export function welcomeDismissed() {
  try {
    return localStorage.getItem(WELCOME_KEY) === "hidden";
  } catch {
    return false;
  }
}
function dismissWelcome() {
  try {
    localStorage.setItem(WELCOME_KEY, "hidden");
  } catch {}
}

// ------------------------------------------------------------------ diagrams

/** ETH → original → copy, with value travelling down the line: a buy of the copy is a buy of the original first. */
export function LineageDiagram({ copy = "WIF", original = "PNUT" }) {
  return html`<div class="dia dia-lineage" aria-hidden="true">
    <span class="dia-node"><${Coin} symbol="ETH" glyph="Ξ" hue=${5} size="lg" /><small>ETH</small></span>
    <span class="dia-wire"><i></i></span>
    <span class="dia-node"><${Coin} symbol=${original} hue=${0} size="lg" /><small>Original</small></span>
    <span class="dia-wire"><i></i></span>
    <span class="dia-node"><${Coin} symbol=${copy} hue=${0} depth=${1} size="lg" /><small>Copy</small></span>
  </div>`;
}

/** Several commits pouring into one batch that buys at one price. */
export function OpeningDiagram() {
  return html`<div class="dia dia-opening" aria-hidden="true">
    <span class="dia-people">${["Al", "Bo", "Ch", "Sn"].map((s, i) => html`<span key=${s} class="avatar avatar-md" style=${`--i:${i}`}>${s}</span>`)}</span>
    <span class="dia-funnel"><i></i><i></i><i></i><i></i></span>
    <span class="dia-price"><b>1 price</b><small>for all</small></span>
  </div>`;
}

/** A price above its slow reference: the part of a sale above the dashed line is shared with holders. */
export function SpikeDiagram() {
  return html`<svg class="dia dia-spike" viewBox="0 0 220 110" aria-hidden="true">
    <path class="dia-area" d="M70,78 L100,30 L130,24 L160,40 L160,70 L130,72 L100,75 Z" />
    <path class="dia-kept" d="M70,78 L100,30 L130,24 L160,40 L160,55 L130,48 L100,52 Z" />
    <path class="dia-ref" d="M10,82 L70,80 L100,75 L130,72 L160,70 L210,66" />
    <path class="dia-price-line" d="M10,84 L40,82 L70,78 L100,30 L130,24 L160,40 L190,62 L210,64" />
    <text x="138" y="16" class="dia-label" text-anchor="middle">price</text>
    <text x="210" y="84" class="dia-label" text-anchor="end">1h reference</text>
    <text x="126" y="44" class="dia-label dia-label-kept" text-anchor="middle">kept</text>
  </svg>`;
}

/** A rival root sliding into another family. */
export function UnionDiagram() {
  return html`<div class="dia dia-union" aria-hidden="true">
    <span class="dia-node dia-rival"><${Coin} symbol="PE" hue=${2} size="lg" /><small>Rival</small></span>
    <span class="dia-merge"><${I.Merge} size=${20} /></span>
    <span class="dia-node"><${Coin} symbol="PN" hue=${0} size="lg" /><small>Family</small></span>
  </div>`;
}

const PILLARS = [
  ["lineage", "Copies feed the original", "A copy is priced in the meme it copies, so buying the copy buys the original first.", LineageDiagram],
  ["opening", "One price at the opening", "The first minutes are a batch auction: bots gain nothing by being first.", OpeningDiagram],
  ["spike", "Spikes pay the holders", "Selling into a sudden wave leaves part of the profit in the reserve for everyone else.", SpikeDiagram],
  ["union", "Rivals can merge", "Two memes fighting over one idea can vote to become one family.", UnionDiagram],
];

// ------------------------------------------------------------------ welcome

export function Welcome({ onTour, onClose }) {
  const { session } = useApp();
  const local = session.chain.kind === "local";
  const close = () => {
    dismissWelcome();
    onClose();
  };
  return html`<section class="card welcome" aria-labelledby="welcome-title">
    <button type="button" class="welcome-close" aria-label="Hide the introduction" onClick=${close}><${I.Close} size=${16} /></button>
    <div class="welcome-lede">
      <p class="eyebrow">A memecoin launchpad</p>
      <h2 id="welcome-title">Copies feed the original.</h2>
      <p>On other launchpads, every copy of a meme is a rival pool of money and the first block goes to bots. Here a copy is priced in the original, the opening is one price for everyone, and selling into a spike pays the people still holding.</p>
      <div class="welcome-actions">
        ${local && html`<button type="button" class="btn btn-lg" onClick=${onTour}><${I.Spark} size=${16} />Take the 2-minute tour</button>`}
        <a class="btn btn-quiet btn-lg" href="#how">How it works</a>
      </div>
    </div>
    <ul class="pillars">
      ${PILLARS.map(([key, title, text, Dia]) => html`<li key=${key}>
        <a class="pillar" href=${`#how-${key}`}>
          <${Dia} />
          <h3>${title}</h3>
          <p>${text}</p>
        </a>
      </li>`)}
    </ul>
  </section>`;
}

/** One line under the toolbar while the demo runs: what it is and how to move time. */
export function DemoNote({ onTour }) {
  return html`<div class="demo-note" role="note">
    <div class="demo-note-inner">
      <span class="dot dot-demo"></span>
      <span><b>Demo.</b> Play ETH, real contracts, all running in this page. Use the clock to skip ahead.</span>
      <button type="button" class="link-btn" onClick=${onTour}>Take the tour</button>
    </div>
  </div>`;
}

// ------------------------------------------------------------------ follow the money

/** Pick a meme and an amount: the exact path of the ETH, computed on the live curves. */
function FollowTheMoney() {
  const { world, session } = useApp();
  const choices = [...world.memes.values()].filter((m) => !m.opening).sort((a, b) => b.depth - a.depth);
  const [token, setToken] = useState(choices[0]?.address ?? "");
  const [value, setValue] = useState("1");
  const [sim, setSim] = useState(null);
  const m = world.memes.get(token);
  const wei = f.parseAmount(value);
  useEffect(() => {
    let live = true;
    setSim(null);
    if (!m || !wei) return;
    readCurves(session.hub, m.lineage)
      .then((c) => live && setSim(simulateTrade(c, { side: "buy", viaParent: false, lineage: m.lineage, amount: wei, spikeBps: BigInt(session.params.spikeShareBps), now: session.chain.now() })))
      .catch(() => live && setSim(null));
    return () => {
      live = false;
    };
  }, [token, value, world.loadedAt]);
  if (!m) return null;
  const root = world.memes.get(m.root);
  return html`<div class="follow">
    <div class="follow-form">
      <label class="field"><span>Buy</span>
        <select id="follow-meme" value=${token} onChange=${(e) => setToken(e.currentTarget.value)}>
          ${choices.map((c) => html`<option key=${c.address} value=${c.address}>${c.symbol}${c.parent ? ` · variant of ${world.memes.get(c.parent).symbol}` : " · root"}</option>`)}
        </select>
      </label>
      <label class="field"><span>with</span>
        <span class="amount"><input id="follow-amount" type="text" inputmode="decimal" autocomplete="off" value=${value} onInput=${(e) => setValue(e.currentTarget.value)} /><span class="unit">ETH</span></span>
      </label>
    </div>
    ${sim && html`<${Flow} hops=${sim.hops} last="You would get" />`}
    ${sim && html`<p class="explain">${sim.hops.length > 1
      ? `Of your ${compact(n(wei))} ETH, ${ethOrTokens(sim.hops[0].toReserve, "ETH")} lands in ${root.symbol}'s reserve before any ${m.symbol} is bought. The copy cannot grow without the original growing first.`
      : `${m.symbol} is a root: your ETH goes straight into its reserve. Launch a variant of it and every buy of the variant will come here first.`}</p>`}
    <a class="link-btn" href=${memeHref(m.address)}>Open ${m.symbol}</a>
  </div>`;
}

// ------------------------------------------------------------------ results

/** The simulator's means for one scenario, as a table whose cells carry bars drawn to one scale around zero. */
function Results() {
  const [which, setWhich] = useState("random");
  const report = simulation.reports.find((r) => (which === "first" ? r.botLeavesFirst : !r.botLeavesFirst));
  const rows = [...report.groups, { key: "retail", label: "All retail buyers", ...report.retail }];
  const max = Math.max(...rows.flatMap((r) => [Math.abs(r.pvp), Math.abs(r.cc)]));
  const bar = (v, tone) => html`<span class="rbar-track"><span class=${`rbar ${v < 0 ? "neg" : "pos"} ${tone}`} style=${`width:${((Math.abs(v) / max) * 50).toFixed(2)}%`}></span></span>`;
  const money = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)} ETH`;
  const orig = report.groups.find((g) => g.key === "originalBuyers");
  const devs = report.groups.find((g) => g.key === "copycatDevs");
  const sniper = report.groups.find((g) => g.key === "sniper");
  return html`<div class="results">
    <${Segmented} label="Scenario" value=${which} onChange=${setWhich} options=${[["random", "Bot exits at random"], ["first", "Bot sees the top"]]} size="sm" />
    <div class="scroll-x">
      <table class="results-table">
        <caption class="sr">Mean result per group in ETH over ${simulation.seeds} scenarios, today versus Community Coin</caption>
        <thead><tr><th scope="col">Who</th><th scope="col">Today</th><th scope="col">Community Coin</th></tr></thead>
        <tbody>
          ${rows.map((r) => html`<tr key=${r.key} class=${r.key === "retail" ? "total" : ""}>
            <th scope="row">${r.label}</th>
            <td><span class="rcell">${bar(r.pvp, "today")}<span class="rval tnum">${money(r.pvp)}</span></span></td>
            <td><span class="rcell">${bar(r.cc, "cc")}<span class="rval tnum">${money(r.cc)}</span></span></td>
          </tr>`)}
        </tbody>
      </table>
    </div>
    <ul class="result-facts">
      <li><b class="tnum">${simulation.pools.pvp} → ${simulation.pools.cc}</b><span>ETH pools for one meme and its ${simulation.buyers.copycats} copies</span></li>
      <li><b class="tnum">${f.percent(1 - orig.cc / orig.pvp, 0)}</b><span>less lost by the original's buyers</span></li>
      <li><b class="tnum">${money(devs.pvp)} → ${money(devs.cc)}</b><span>for the people launching copies: vamping stops paying</span></li>
      <li><b class="tnum">${money(sniper.cc)}</b><span>still made by the sniper bot: a meme market stays zero-sum</span></li>
    </ul>
    <p class="explain">Mean of ${simulation.seeds} runs of the same viral scenario on the real contracts: one original with ${simulation.buyers.original} buyers, then ${simulation.buyers.copycats} copies with ${simulation.buyers.perCopycat} buyers each, about ${Math.round(simulation.retailInEth)} ETH of retail money. Everyone ends in ETH, so the rows add up to zero: the question is only who pays whom. Source: <code>${simulation.source}</code>.</p>
  </div>`;
}

// ------------------------------------------------------------------ live examples

function SpikeExample() {
  const { world, session } = useApp();
  const row = session.activity.filter((r) => r.spike).sort((a, b) => (b.spike.wei > a.spike.wei ? 1 : -1))[0];
  if (!row) return null;
  const m = world.memes.get(row.token);
  return html`<p class="example"><${Avatar} symbol=${nameOf(session, row.actor)} size="sm" />
    In this demo, ${nameOf(session, row.actor)} sold ${amount(row.in)} above the reference for ${amount(row.out)}: ${amount(row.spike)} stayed in ${m ? m.symbol : "the"} reserve for the holders.
    ${m && html`<a class="link-btn" href=${memeHref(m.address)}>See ${m.symbol}</a>`}</p>`;
}

function OpeningExample() {
  const { world } = useApp();
  const m = [...world.memes.values()].find((x) => x.opening);
  if (!m) return null;
  return html`<p class="example"><${MemeAvatar} m=${m} />
    ${m.symbol} is in its opening right now, with ${m.parent ? f.tokens(m.batchQuote, m.quoteSymbol) : `${compact(n(m.batchQuote))} ETH`} committed.
    <a class="link-btn" href=${memeHref(m.address)}>Join it</a></p>`;
}

function UnionExample() {
  const { world } = useApp();
  const u = world.unions.find((x) => !x.executed && !x.stale) ?? world.unions.find((x) => x.executed);
  if (!u) return null;
  const meme = world.memes.get(u.meme), target = world.memes.get(u.target);
  return html`<p class="example"><${MemeAvatar} m=${meme} /><${I.Merge} size=${14} /><${MemeAvatar} m=${target} />
    ${u.executed ? `${meme.symbol} joined ${target.symbol} by vote.` : `${meme.symbol} holders are voting to join ${target.symbol}: ${f.percent(Number(u.locked) / Math.max(1, Number(u.circulating)), 0)} locked so far, 50% needed.`}
    <a class="link-btn" href=${memeHref(u.meme)}>See the vote</a></p>`;
}

// ------------------------------------------------------------------ page

export function HowItWorks({ section }) {
  const { session } = useApp();
  const p = session.params;
  useEffect(() => {
    const el = section && document.getElementById(`how-${section}`);
    if (el) el.scrollIntoView({ block: "start" });
  }, [section]);
  const share = f.percent(p.spikeShareBps / 10000, 0);
  return html`<div class="page how">
    <header class="page-head how-head">
      <h1>How it works</h1>
      <p class="lede">Memecoins have two diseases. Copies drain the original (the vamp), and the first block goes to bots who sell into everyone after them (the PvP). Community Coin changes the rules of the launch so that both stop paying.</p>
    </header>

    <section class="card how-section" id="how-problem" aria-labelledby="how-problem-title">
      <h2 id="how-problem-title">The problem</h2>
      <div class="how-two">
        <div><h3>The vamp</h3><p>A meme takes off and dozens of copies launch within the hour. Each copy is its own pool of ETH, so every buyer of a copy is money the original never sees, and the copies fight each other to zero.</p></div>
        <div><h3>The PvP</h3><p>Bots and insiders buy in the very first block, then sell into the wave of buyers who arrive minutes later. The late wave pays for the early exit.</p></div>
      </div>
    </section>

    <section class="card how-section" id="how-lineage" aria-labelledby="how-lineage-title">
      <div class="how-split">
        <div class="how-text">
          <p class="eyebrow">Lineage</p>
          <h2 id="how-lineage-title">Copies feed the original</h2>
          <p>A ticker can launch once. PNUT, $pnut, P.N.U.T and PNU7 are one ticker, so a duplicate is refused. A copy can still launch, as a <b>variant</b>: it is priced in the original's token instead of ETH. Buying the copy with ETH buys the original first, and money leaving a copy lands back in the original. One family, one pool of ETH.</p>
        </div>
        <${LineageDiagram} />
      </div>
      <h3 class="sub">Follow your ETH</h3>
      <${FollowTheMoney} />
    </section>

    <section class="card how-section" id="how-opening" aria-labelledby="how-opening-title">
      <div class="how-split">
        <div class="how-text">
          <p class="eyebrow">Fair opening</p>
          <h2 id="how-opening-title">One price at the opening</h2>
          <p>The first ${f.spoken(p.openWindow)} of every launch are a batch auction. Everyone who commits, the creator included, buys together when the timer ends, at one price set by the total committed. Being first is worth nothing, so there is nothing to snipe. The batch got the cheapest tokens, so they unlock gradually over ${f.spoken(p.vestWindow)}: nobody can dump them at once.</p>
        </div>
        <${OpeningDiagram} />
      </div>
      <${OpeningExample} />
    </section>

    <section class="card how-section" id="how-spike" aria-labelledby="how-spike-title">
      <div class="how-split">
        <div class="how-text">
          <p class="eyebrow">Spike share</p>
          <h2 id="how-spike-title">Spikes pay the holders</h2>
          <p>Each meme has a slow <b>1h reference</b> price that catches up with the real price over an hour. When a sale goes through above it, ${share} of what the sale gets above the reference stays in the reserve. That lifts the price for everyone still holding: the people who sell into a sudden wave pay the people the wave would have left behind. Selling patiently, or into a falling price, costs nothing extra.</p>
        </div>
        <${SpikeDiagram} />
      </div>
      <${SpikeExample} />
    </section>

    <section class="card how-section" id="how-union" aria-labelledby="how-union-title">
      <div class="how-split">
        <div class="how-text">
          <p class="eyebrow">Union</p>
          <h2 id="how-union-title">Rivals can merge</h2>
          <p>Two roots can fight over the same idea, like PNUT and PEANUT. Holders of one can vote to join the other's family: they lock their tokens for ${f.spoken(p.unionWindow)}, and if more than half of the circulating supply is locked when the vote closes, its whole ETH reserve buys the target without fees and it becomes a variant of it. Nobody's balance changes, and anyone against can sell during the vote.</p>
        </div>
        <${UnionDiagram} />
      </div>
      <${UnionExample} />
    </section>

    <section class="card how-section" id="how-results" aria-labelledby="how-results-title">
      <p class="eyebrow">Does it work?</p>
      <h2 id="how-results-title">What changes, in numbers</h2>
      <${Results} />
    </section>

    <section class="card how-section" id="how-glossary" aria-labelledby="how-glossary-title">
      <h2 id="how-glossary-title">Glossary</h2>
      <dl class="glossary">
        ${Object.keys(GLOSSARY).map((k) => {
          const t = term(k, p);
          return html`<div key=${k} id=${`term-${k}`} data-glossary=${k}><dt>${t.name}</dt><dd>${t.text}</dd></div>`;
        })}
      </dl>
    </section>

    <section class="card how-section" id="how-limits" aria-labelledby="how-limits-title">
      <h2 id="how-limits-title">What it does not do</h2>
      <p>A meme market is still zero-sum: every ETH someone takes out, someone else put in. These rules remove the edges reserved for bots and copycats; they do not make everyone a winner. The contracts are not audited, and this site runs them on demo money only.</p>
    </section>
  </div>`;
}
