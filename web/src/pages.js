// The screens. Each answers one question at first glance, after the dashboard-design skill:
//
//   Marché       Where is the money going, and what is waiting for me?
//                ETH locked, volume, memes, live openings · families ranked by locked ETH · to-do list · activity
//   Meme         Is it rising, and what happens if I trade now?
//                price per million, gap to the 1 h reference, market cap, reserve, my position · chart · trade
//   Lancer       Is the ticker free, and what will the launch look like?
//   Unions       Which mergers are being voted, and is the majority reached?   (bullet graph against 50 %)
//   Portefeuille What do I hold, and what can I withdraw?
//
// Attention rules, each flagged where it shows and with its action beside it: a live opening (Engager), a union
// whose vote passed (Exécuter), vested tokens to claim (Retirer), creator fees (Retirer), tokens locked in a
// finished vote (Récupérer), a price far above its 1 h reference (warm chip: selling now pays the holders).
// Wordless: explanations live in tooltips (data-tip); the Règles page is the one page of sentences.

import { ZeroAddress } from "ethers";
import { useState, useEffect, useContext } from "preact/hooks";
import { createContext } from "preact";
import * as f from "./format.js";
import * as I from "./icons.js";
import { html, Avatar, Delta, Kpi, Card, ShareBar, Bullet, SegBar, Segmented, StepChart, compact } from "./ui.js";
import { families, pointAt } from "./world.js";

export const App = createContext(null);
export const useApp = () => useContext(App);
export const memeHref = (address) => `#meme-${address}`;
export const go = (hash) => {
  location.hash = hash;
};

const HOUR = 3600;
const TOLERANCE = 99n; // minimum output at 99 % of the quote
const SPIKE_FLAG = 0.05; // a price 5 % above its reference gets a warm chip
const n = (wei) => f.toNumber(wei);
const clockTime = (t) => new Date(t * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const countdown = (s) => {
  const v = Math.max(0, Math.round(s));
  return v >= 3600 ? f.duration(v) : `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
};
const amount = (a) => (!a ? "—" : a.unit === "ETH" ? `${compact(n(a.wei))} ETH` : `${f.tokens(a.wei)} ${a.unit}`);

/** Each family keeps one hue, given by the order its root was launched. */
function hueOf(world, m) {
  let i = 0;
  for (const r of world.memes.values()) {
    if (r.parent) continue;
    if (r.address === m.root) return i;
    i++;
  }
  return 0;
}

function MemeAvatar({ m, size }) {
  const { world } = useApp();
  return html`<${Avatar} symbol=${m.symbol} hue=${hueOf(world, m)} size=${size} />`;
}

function MemeName({ m, link = true, name = true }) {
  const inner = html`<${MemeAvatar} m=${m} /><span class="meme-sym">${m.symbol}</span>${name && html`<span class="meme-name">${m.name}</span>`}`;
  return link ? html`<a class="meme-id" href=${memeHref(m.address)}>${inner}</a>` : html`<span class="meme-id">${inner}</span>`;
}

/** The ETH a family holds: settled reserve of its root, or the batch while the root's opening runs. */
const lockedOf = (m) => (m.settled ? m.reserve : m.batchQuote);

function Phase({ m }) {
  const { world } = useApp();
  if (m.opening)
    return html`<span class="chip chip-warn" data-tip=${`Ouverture · ${f.duration(m.openUntil - world.now)}\nEnchère au même prix pour tous`}>
      <${I.Timer} size=${14} /> ${countdown(m.openUntil - world.now)}</span>`;
  if (m.premium > SPIKE_FLAG)
    return html`<span class="chip chip-warn" data-tip=${`${f.signedPercent(m.premium)} vs réf. 1 h\nUne vente maintenant laisse la moitié de l'excédent aux détenteurs`}>
      Pic ${f.signedPercent(m.premium)}</span>`;
  if (m.vesting)
    return html`<span class="chip" data-tip=${`Vesting ${f.percent(m.vestedShare, 0)}\nLes places de l'ouverture se débloquent sur 1 h`}>Vesting ${f.percent(m.vestedShare, 0)}</span>`;
  return null;
}

/** Price per million tokens, an hour ago, from the recorded history; null when there is no such point. */
function hourAgo(session, world, m, key = "p") {
  const pts = session.history.get(m.address);
  const p = pointAt(pts, world.now - HOUR);
  return p ? p[key] : null;
}

// ------------------------------------------------------------------ shared panels

function ActivityTable({ token, limit = 10 }) {
  const { session, world } = useApp();
  const [more, setMore] = useState(false);
  const rows = session.activity.filter((r) => !token || r.token === token || r.target === token);
  const shown = rows.slice(0, more ? 60 : limit);
  const KIND = {
    buy: ["Achat", "accent"], sell: ["Vente", ""], commit: ["Engagement", "accent"], claim: ["Retrait", ""],
    launch: ["Lancement", "accent"], settle: ["Clôture", ""], union: ["Union", "money"], propose: ["Proposition", ""],
    vote: ["Vote", ""], unvote: ["Retrait vote", ""], fees: ["Frais", "money"],
  };
  const nameOf = (address) => session.chain.accounts.find((a) => a.address === address)?.name ?? f.shortAddress(address);
  if (!rows.length) return html`<p class="empty">Les achats, ventes et ouvertures apparaissent ici.</p>`;
  return html`<div class="activity" role="table" aria-label="Activité">
    <div class="activity-row head" role="row">
      <span role="columnheader">Quand</span><span role="columnheader">Compte</span><span role="columnheader">Action</span>
      <span role="columnheader">Meme</span><span role="columnheader" class="num">Montant</span><span role="columnheader" class="num">Pic</span>
    </div>
    ${shown.map((r, i) => {
      const m = r.token && world.memes.get(r.token);
      const target = r.target && world.memes.get(r.target);
      const [label, tone] = KIND[r.kind] ?? [r.kind, ""];
      const who = nameOf(r.actor);
      return html`<div class="activity-row" role="row" key=${i}>
        <span class="muted tnum" role="cell" data-tip=${new Date(r.t * 1000).toLocaleString("fr-FR")}>${f.ago(world.now - r.t)}</span>
        <span role="cell" class="who"><${Avatar} symbol=${who} hue=${5} size="sm" />${who}</span>
        <span role="cell"><span class=${`chip ${tone ? `chip-${tone}` : ""}`}>${label}</span></span>
        <span role="cell" class="activity-meme">${m ? html`<${MemeName} m=${m} name=${false} />` : "—"}${target && html`<${I.Arrow} size=${14} /><${MemeName} m=${target} name=${false} />`}</span>
        <span role="cell" class="num tnum">${r.in && r.out ? html`${amount(r.in)} <span class="muted">→</span> ${amount(r.out)}` : amount(r.in ?? r.out)}</span>
        <span role="cell" class="num tnum">${r.spike ? html`<span class="warn-text" data-tip=${"Part de pic\nLaissée dans la réserve pour les détenteurs"}>${amount(r.spike)}</span>` : html`<span class="muted">—</span>`}</span>
      </div>`;
    })}
    ${rows.length > limit && html`<button type="button" class="link-btn" onClick=${() => setMore(!more)}>${more ? "Moins" : `Tout voir · ${rows.length}`}</button>`}
  </div>`;
}

/** Everything that waits on the viewer, most urgent first, each with its action. */
function todoItems({ world }) {
  const items = [];
  for (const m of world.memes.values())
    if (m.opening) items.push({ key: `open-${m.address}`, m, label: "Ouverture", chip: countdown(m.openUntil - world.now), warm: true, href: memeHref(m.address), action: "Engager", sort: m.openUntil - world.now });
  for (const u of world.unions) {
    const meme = world.memes.get(u.meme), target = world.memes.get(u.target);
    const passed = world.now > u.deadline, majority = u.locked * 2n > u.circulating;
    if (!u.executed && !u.stale && passed && majority)
      items.push({ key: `exec-${u.id}`, m: meme, to: target, label: "Union", chip: "Majorité", run: ["Union exécutée", "executeUnion", [u.id, 0n]], action: "Exécuter", sort: 1e6 });
    if (u.mine > 0n && (u.executed || u.stale || passed))
      items.push({ key: `lock-${u.id}`, m: meme, label: "Vote terminé", chip: f.tokens(u.mine), run: ["Tokens récupérés", "unlockUnion", [u.id]], action: "Récupérer", sort: 3e6 });
    if (!u.executed && !u.stale && !passed && meme.balance > 0n)
      items.push({ key: `vote-${u.id}`, m: meme, to: target, label: "Vote", chip: f.percent(Number(u.locked) / Math.max(1, Number(u.circulating)), 0), href: memeHref(u.meme), action: "Voter", sort: 4e6 + u.deadline });
  }
  for (const m of world.memes.values())
    if (m.claimable > 0n) items.push({ key: `claim-${m.address}`, m, label: "À retirer", chip: f.tokens(m.claimable), run: ["Retiré", "claim", [m.address]], action: "Retirer", sort: 2e6 });
  for (const x of world.fees)
    items.push({ key: `fees-${x.asset}`, m: x.asset === ZeroAddress ? null : world.memes.get(x.asset), label: "Frais", chip: x.symbol === "ETH" ? `${compact(n(x.amount))} ETH` : f.tokens(x.amount, x.symbol), run: ["Frais retirés", "claimFees", [x.asset]], action: "Retirer", sort: 2.5e6 });
  return items.sort((a, b) => a.sort - b.sort);
}

function TodoList() {
  const { world, act, busy } = useApp();
  const items = todoItems({ world });
  if (!items.length) return html`<p class="empty">Ouvertures, votes et retraits en attente apparaissent ici.</p>`;
  return html`<ul class="todo">
    ${items.slice(0, 7).map((it) => html`<li key=${it.key}>
      <span class="todo-what">
        ${it.m ? html`<${MemeName} m=${it.m} name=${false} />` : html`<span class="meme-id"><${Avatar} symbol="ETH" hue=${5} /><span class="meme-sym">ETH</span></span>`}
        ${it.to && html`<${I.Arrow} size=${14} /><${MemeName} m=${it.to} name=${false} />`}
      </span>
      <span class="todo-label muted">${it.label}</span>
      <span class=${`chip ${it.warm ? "chip-warn" : ""} tnum`}>${it.chip}</span>
      ${it.href
        ? html`<a class="btn btn-sm" href=${it.href}>${it.action}</a>`
        : html`<button type="button" class="btn btn-sm" disabled=${busy} onClick=${() => act(...it.run)}>${it.action}</button>`}
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
  if (!moves.length) return html`<p class="empty">—</p>`;
  return html`<div class="ranked compact movers">
    ${moves.map(({ m, cur, prev }) => html`<a class="ranked-row" key=${m.address} href=${memeHref(m.address)}>
      <span class="ranked-name"><${MemeAvatar} m=${m} /><span class="meme-sym">${m.symbol}</span></span>
      <${Delta} cur=${cur} prev=${prev} vs="" tip=${`${compact(prev)} → ${compact(cur)} ETH · 1 M`} />
    </a>`)}
  </div>`;
}

function FamilyList({ rows, total, showShare = true }) {
  const { session, world } = useApp();
  return html`<div class="ranked" role="table" aria-label="Familles">
    <div class="ranked-row head" role="row">
      <span role="columnheader">Meme</span><span role="columnheader" class="num">Prix · 1 M</span>
      <span role="columnheader" class="num">1 h</span><span role="columnheader" class="num col-res">Réserve</span>
      ${showShare && html`<span role="columnheader" class="num col-share">Part</span>`}
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
        <span role="cell" class="num tnum" data-tip=${`${f.perMillion(m.priceEth)}\nPrix d'un million de ${m.symbol}`}>${compact(n(m.priceEth) * 1e6)}</span>
        <span role="cell" class="num">${m.opening ? html`<span class="muted">—</span>` : html`<${Delta} cur=${n(m.priceEth) * 1e6} prev=${prev} vs="" tip=${prev !== null ? `Il y a 1 h : ${compact(prev)} ETH` : undefined} />`}</span>
        <span role="cell" class="num tnum col-res" data-tip=${m.parent ? `Réserve en ${m.quoteSymbol}` : "Réserve en ETH"}>${m.parent ? f.tokens(lockedOf(m), m.quoteSymbol) : `${compact(n(lockedOf(m)))} ETH`}</span>
        ${showShare && html`<span role="cell" class="num tnum muted col-share">${share === null ? "" : share < 0.1 ? "<0,1 %" : `${f.percent(share / 100, share < 1 ? 1 : 0)}`}</span>`}
      </a>`;
    })}
  </div>`;
}

// ------------------------------------------------------------------ Marché

export function Market() {
  const { world, session } = useApp();
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
    <header class="page-head"><h1>Marché</h1></header>
    <div class="kpis">
      <${Kpi} id="locked" label="ETH verrouillé" icon=${html`<${I.Lock} />`} value=${compact(n(locked))} unit="ETH"
        tip=${`${f.eth(locked)}\nRéserves des memes racines, ouvertures comprises`}
        delta=${html`<${Delta} cur=${n(locked)} prev=${lockedAgo === null ? null : n(lockedAgo)} vs="vs 1 h" />`} />
      <${Kpi} id="volume" label="Volume · 1 h" icon=${html`<${I.Pulse} />`} value=${compact(n(volume))} unit="ETH"
        tip=${`${f.eth(volume)}\nETH échangés sur les courbes racines${local ? "" : " depuis l'ouverture de la page"}`}
        delta=${html`<${Delta} cur=${n(volume)} prev=${volumePrev === null ? null : n(volumePrev)} vs="vs h. préc." neutral=${true} />`} />
      <${Kpi} id="memes" label="Memes" icon=${html`<${I.Market} />`} value=${String(world.memes.size)}
        tip=${`${roots.length} familles\n${world.memes.size - roots.length} variantes`}
        delta=${html`<${Delta} cur=${world.memes.size} prev=${launchedBefore} vs="vs 1 h" min=${5} format=${String} />`} />
      <${Kpi} id="openings" label="Ouvertures" icon=${html`<${I.Timer} />`} value=${String(openings)}
        tip=${"Enchères en cours\nMême prix pour tous les participants"} />
    </div>
    <div class="grid-12">
      <${Card} id="families" title="Familles" value=${`${roots.length} racines · ${world.memes.size - roots.length} variantes`} class="span-8"
        actions=${html`<a class="btn btn-quiet btn-sm" href="#lancer"><${I.Launch} size=${16} />Lancer</a>`}>
        ${rows.length ? html`<${FamilyList} rows=${rows} total=${locked} />` : html`<div class="empty-state"><p>Aucun meme pour l'instant.</p><a class="btn" href="#lancer">Lancer le premier</a></div>`}
      </${Card}>
      <div class="span-4 stack-col">
        <${Card} id="todo" title="À faire"><${TodoList} /></${Card}>
        <${Card} id="movers" title="Variations · 1 h"><${Movers} /></${Card}>
      </div>
    </div>
    <${Card} id="activity" title="Activité"><${ActivityTable} /></${Card}>
  </div>`;
}

// ------------------------------------------------------------------ Meme

function OpeningPanel({ m }) {
  const { world, session, act, busy } = useApp();
  const parent = m.parent && world.memes.get(m.parent);
  const [value, setValue] = useState("0.1");
  const [payWith, setPayWith] = useState("ETH");
  const wei = f.parseAmount(value);
  const viaParent = payWith !== "ETH";
  const submit = (e) => {
    e.preventDefault();
    if (!wei) return;
    if (viaParent) act("Engagé", "commit", [m.address, wei]);
    else act("Engagé", "commitEth", [m.address, 0n], wei);
  };
  return html`<${Card} id="opening" title="Ouverture" class="action">
    <div class="countdown" data-tip=${`Clôture à ${clockTime(m.openUntil)}\nTout le lot achète d'un coup, au même prix pour tous`}>
      <${I.Timer} /><strong class="tnum">${countdown(m.openUntil - world.now)}</strong>
    </div>
    <dl class="facts">
      <div><dt>Engagé</dt><dd class="tnum">${m.parent ? f.tokens(m.batchQuote, m.quoteSymbol) : `${compact(n(m.batchQuote))} ETH`}</dd></div>
      <div><dt>Prix indicatif · 1 M</dt><dd class="tnum">${compact(n(m.priceEth) * 1e6)} ETH</dd></div>
      <div><dt>Toi</dt><dd class="tnum">${m.committed > 0n ? (m.parent ? f.tokens(m.committed, m.quoteSymbol) : `${compact(n(m.committed))} ETH`) : "—"}</dd></div>
    </dl>
    <form onSubmit=${submit}>
      ${parent && parent.balance > 0n && html`<${Segmented} label="Payer en" value=${payWith} onChange=${setPayWith} options=${[["ETH", "ETH"], [parent.symbol, parent.symbol]]} size="sm" />`}
      <div class="amount">
        <input id="commit-amount" type="text" inputmode="decimal" autocomplete="off" aria-label="Montant" value=${value} onInput=${(e) => setValue(e.currentTarget.value)} />
        <span class="unit" data-tip=${!viaParent && parent ? `L'ETH achète d'abord du ${parent.symbol}` : undefined}>${viaParent ? parent.symbol : "ETH"}</span>
        ${viaParent && html`<button type="button" class="link-btn" onClick=${() => setValue(f.exact(parent.balance))}>Max</button>`}
      </div>
      <button class="btn wide" disabled=${!wei || busy}>Engager</button>
      <p class="fine muted" data-tip=${"Vesting\nLes tokens de l'ouverture se débloquent progressivement"}>Vesting ${f.duration(session.params.vestWindow)}</p>
    </form>
  </${Card}>`;
}

function TradePanel({ m }) {
  const { world, session, act, busy } = useApp();
  const parent = m.parent && world.memes.get(m.parent);
  const [side, setSide] = useState("buy");
  const [via, setVia] = useState("ETH");
  const [value, setValue] = useState("0.1");
  const [quote, setQuote] = useState(null);
  const wei = f.parseAmount(value);
  const viaParent = via !== "ETH";
  const hub = session.hub;
  useEffect(() => setValue(side === "buy" ? "0.1" : ""), [side]);
  useEffect(() => {
    let live = true;
    setQuote(null);
    const run = async () => {
      if (!wei || (side === "sell" && wei > m.balance)) return null;
      if (side === "buy") return hub.read(viaParent ? "quoteBuy" : "quoteBuyEth", [m.address, wei]);
      return hub.read(viaParent ? "quoteSell" : "quoteSellToEth", [m.address, wei]);
    };
    run().then((q) => live && setQuote(q ?? null)).catch(() => live && setQuote(null));
    return () => {
      live = false;
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
    const ok = side === "buy"
      ? viaParent ? await act("Acheté", "buy", [m.address, wei, minOut]) : await act("Acheté", "buyEth", [m.address, minOut], wei)
      : viaParent ? await act("Vendu", "sell", [m.address, wei, minOut]) : await act("Vendu", "sellToEth", [m.address, wei, minOut]);
    if (ok && side === "sell") setValue("");
  };
  const spike = side === "sell" && m.premium > SPIKE_FLAG;
  return html`<${Card} id="trade" class="action">
    <${Segmented} label="Sens" value=${side} onChange=${setSide} options=${[["buy", "Acheter"], ["sell", "Vendre"]]} />
    ${parent && html`<div class="row-between"><span class="muted fine">${side === "buy" ? "Payer en" : "Recevoir en"}</span>
      <${Segmented} label=${side === "buy" ? "Payer en" : "Recevoir en"} value=${via} onChange=${setVia} options=${[["ETH", "ETH"], [parent.symbol, parent.symbol]]} size="sm" /></div>`}
    <form onSubmit=${submit}>
      <label class="field-label" for="trade-amount">${side === "buy" ? "Tu paies" : "Tu vends"}</label>
      <div class="amount">
        <input id="trade-amount" type="text" inputmode="decimal" autocomplete="off" placeholder="0" value=${value} onInput=${(e) => setValue(e.currentTarget.value)} />
        <span class="unit">${payUnit}</span>
        ${(side === "sell" || viaParent) && html`<button type="button" class="link-btn" onClick=${() => setValue(f.exact(side === "sell" ? m.balance : parent.balance))}>Max</button>`}
      </div>
      <div class="receive">
        <span class="muted">Tu reçois</span>
        <strong class="tnum" data-testid="receive">${over ? "Solde insuffisant" : quote === null ? "—" : getUnit === "ETH" ? `${compact(n(quote), 4)} ETH` : f.tokens(quote, getUnit)}</strong>
      </div>
      <div class="route" data-tip=${`Route\n1 % de frais à chaque étape, versé au créateur de chaque meme`}>
        ${shownRoute.map((s, i) => html`${i > 0 && html`<${I.Arrow} size=${13} />`}<span class="route-step">${s}</span>`)}
      </div>
      ${spike && html`<p class="chip chip-warn spike" data-tip=${`${f.signedPercent(m.premium)} vs réf. 1 h\nLa moitié de ce que tu touches au-dessus de la référence reste aux détenteurs`}>Pic ${f.signedPercent(m.premium)}</p>`}
      <button class="btn wide" disabled=${!wei || !quote || over || busy}>${side === "buy" ? `Acheter ${m.symbol}` : `Vendre ${m.symbol}`}</button>
      <p class="fine muted">Tolérance 1 %</p>
    </form>
  </${Card}>`;
}

function PositionCard({ m }) {
  const { act, busy } = useApp();
  const value = f.mulWad(m.priceEth, m.balance);
  const locked = m.allocation > m.claimed + m.claimable ? m.allocation - m.claimed - m.claimable : 0n;
  return html`<${Card} id="position" title="Ta position" value=${html`<span data-testid="position">${f.tokens(m.balance, m.symbol)}</span> <span class="muted">· ${compact(n(value))} ETH</span>`}>
    ${m.committed > 0n && !m.opening
      ? html`<div class="stack">
          <div class="row-between"><span class="muted fine">Allocation d'ouverture</span><span class="tnum fine">${f.tokens(m.allocation)}</span></div>
          <${SegBar} label="Allocation" parts=${[
            { label: "Retiré", value: n(m.claimed), tone: "ink", tip: `Retiré\n${f.tokens(m.claimed, m.symbol)}` },
            { label: "Disponible", value: n(m.claimable), tone: "accent", tip: `Disponible\n${f.tokens(m.claimable, m.symbol)}` },
            { label: "Bloqué", value: n(locked), tone: "line", tip: `Bloqué\n${f.tokens(locked, m.symbol)}, débloqué à ${f.percent(m.vestedShare, 0)}` },
          ]} />
          <div class="legend"><span><i class="key key-ink"></i>Retiré</span><span><i class="key key-accent"></i>Disponible</span><span><i class="key key-line"></i>Bloqué</span></div>
          <button type="button" class="btn btn-quiet" disabled=${m.claimable === 0n || busy} onClick=${() => act("Retiré", "claim", [m.address])}>Retirer ${m.claimable > 0n ? f.tokens(m.claimable) : ""}</button>
        </div>`
      : html`<p class="empty">${m.balance > 0n ? "—" : "Aucun token"}</p>`}
  </${Card}>`;
}

function UnionBlock({ u }) {
  const { world, act, busy } = useApp();
  const meme = world.memes.get(u.meme), target = world.memes.get(u.target);
  const [value, setValue] = useState("");
  const wei = f.parseAmount(value);
  const share = Number(u.locked) / Math.max(1, Number(u.circulating));
  const open = !u.executed && !u.stale && world.now <= u.deadline;
  const ready = !u.executed && !u.stale && world.now > u.deadline && u.locked * 2n > u.circulating;
  const status = u.executed ? ["Exécutée", "money"] : u.stale ? ["Sans objet", ""] : open ? [countdown(u.deadline - world.now), "warn"] : ready ? ["Majorité", "accent"] : ["Rejetée", ""];
  return html`<div class="union" data-union=${u.id}>
    <div class="row-between">
      <span class="union-pair"><${MemeName} m=${meme} name=${false} /><${I.Arrow} size=${14} /><${MemeName} m=${target} name=${false} /></span>
      <span class=${`chip ${status[1] ? `chip-${status[1]}` : ""} tnum`} data-tip=${open ? `Vote ouvert\nClôture ${new Date(u.deadline * 1000).toLocaleString("fr-FR")}` : undefined}>${status[0]}</span>
    </div>
    ${!u.executed && html`<${Bullet} value=${share} target=${0.5} max=${1} label=${`${f.percent(share, 0)} verrouillés, majorité à 50 %`} />
      <div class="row-between fine"><span class="muted">Verrouillé</span><span class="tnum">${f.percent(share, 0)} <span class="muted">/ 50 %</span></span></div>`}
    ${u.mine > 0n && html`<div class="row-between fine"><span class="muted">Toi</span><span class="tnum">${f.tokens(u.mine, meme.symbol)}</span></div>`}
    <div class="union-actions">
      ${open && meme.balance > 0n && html`<form class="inline" onSubmit=${async (e) => { e.preventDefault(); if (wei && (await act("Vote enregistré", "lockUnion", [u.id, wei]))) setValue(""); }}>
        <div class="amount sm">
          <input id=${`lock-${u.id}`} type="text" inputmode="decimal" autocomplete="off" aria-label="Tokens à verrouiller" placeholder="0" value=${value} onInput=${(e) => setValue(e.currentTarget.value)} />
          <span class="unit">${meme.symbol}</span>
          <button type="button" class="link-btn" onClick=${() => setValue(f.exact(meme.balance))}>Max</button>
        </div>
        <button class="btn btn-sm" disabled=${!wei || wei > meme.balance || busy}>Voter pour</button>
      </form>`}
      ${ready && html`<button type="button" class="btn btn-sm" disabled=${busy} onClick=${() => act("Union exécutée", "executeUnion", [u.id, 0n])}>Exécuter</button>`}
      ${u.mine > 0n && html`<button type="button" class="btn btn-quiet btn-sm" disabled=${busy} onClick=${() => act("Tokens récupérés", "unlockUnion", [u.id])}>Récupérer</button>`}
    </div>
  </div>`;
}

function ProposeUnion({ m }) {
  const { world, act, busy } = useApp();
  const targets = [...world.memes.values()].filter((t) => t.root !== m.address && !t.opening);
  const [target, setTarget] = useState(targets[0]?.address ?? "");
  if (!targets.length) return null;
  return html`<form class="inline propose" onSubmit=${(e) => { e.preventDefault(); act("Union proposée", "proposeUnion", [m.address, target]); }}>
    <select id="union-target" aria-label="Famille cible" value=${target} onChange=${(e) => setTarget(e.currentTarget.value)}>
      ${targets.map((t) => html`<option key=${t.address} value=${t.address}>${t.symbol}</option>`)}
    </select>
    <button class="btn btn-quiet btn-sm" disabled=${busy} data-tip=${`Union\nLa réserve de ${m.symbol} achète la cible ; les soldes ne bougent pas`}>Proposer</button>
  </form>`;
}

export function MemePage({ address }) {
  const { world, session } = useApp();
  const m = world.memes.get(address);
  if (!m) return html`<div class="page"><div class="card panel empty-state"><p>Meme introuvable.</p><a class="btn" href="#explorer">Marché</a></div></div>`;
  const parent = m.parent && world.memes.get(m.parent);
  const creator = session.chain.accounts.find((a) => a.address === m.creator)?.name ?? f.shortAddress(m.creator);
  const unions = world.unions.filter((u) => u.meme === m.address || u.target === m.address);
  const children = m.children.map((c) => world.memes.get(c));
  const childTotal = children.reduce((s, c) => s + lockedOf(c), 0n);
  const pts = session.history.get(m.address) ?? [];
  const showUnion = unions.length > 0 || (!m.parent && !m.opening);

  return html`<div class="page">
    <nav class="crumbs" aria-label="Lignée">
      <span>ETH</span>
      ${m.lineage.map((a) => html`<${I.Chevron} size=${14} class="crumb-sep" /><a key=${a} href=${memeHref(a)} aria-current=${a === m.address ? "page" : null}>${world.memes.get(a).symbol}</a>`)}
    </nav>
    <header class="page-head meme-head">
      <${MemeAvatar} m=${m} size="lg" />
      <div>
        <h1>${m.symbol} <span class="meme-name">${m.name}</span></h1>
        <p class="muted fine">${creator} · ${parent ? html`variante de <a href=${memeHref(parent.address)}>${parent.symbol}</a>` : "racine · ETH"}</p>
      </div>
      <${Phase} m=${m} />
    </header>
    <div class="kpis">
      <${Kpi} id="price" label="Prix · 1 M" icon=${html`<${I.Pulse} />`} value=${compact(n(m.priceEth) * 1e6)} unit="ETH"
        tip=${`${f.perMillion(m.priceEth)}\n${m.parent ? `${f.perMillion(m.price, m.quoteSymbol)} en ${m.quoteSymbol}` : "Prix d'un million de tokens"}`}
        delta=${m.opening ? null : html`<${Delta} cur=${n(m.priceEth) * 1e6} prev=${hourAgo(session, world, m)} vs="vs 1 h" />`} />
      <${Kpi} id="premium" label="Écart réf. 1 h" icon=${html`<${I.Spark} />`} tone=${m.premium > SPIKE_FLAG ? "warn" : null}
        value=${m.opening ? "—" : f.signedPercent(m.premium)}
        tip=${`Référence : ${compact(n(m.refEth) * 1e6)} ETH · 1 M\nMoyenne mobile d'une heure. Au-dessus, la moitié de l'excédent d'une vente reste aux détenteurs`} />
      <${Kpi} id="cap" label="Capitalisation" icon=${html`<${I.Coins} />`} value=${compact(n(m.capEth))} unit="ETH"
        tip=${`${f.eth(m.capEth)}\n${f.tokens(m.circulating)} en circulation`} />
      <${Kpi} id="reserve" label="Réserve" icon=${html`<${I.Lock} />`}
        value=${m.parent ? f.tokens(lockedOf(m)) : compact(n(lockedOf(m)))} unit=${m.parent ? m.quoteSymbol : "ETH"}
        tip=${`Réserve de la courbe, en ${m.quoteSymbol}\nRachète à tout moment tous les tokens en circulation`}
        delta=${m.opening ? null : html`<${Delta} cur=${n(lockedOf(m))} prev=${hourAgo(session, world, m, "res")} vs="vs 1 h" />`} />
    </div>
    <div class="grid-12">
      <${Card} id="chart" title="Prix · 1 M" value=${`${compact(n(m.priceEth) * 1e6)} ETH`} class="span-8">
        ${pts.length > 1
          ? html`<${StepChart} points=${pts.map((p) => ({ t: p.t, v: p.p }))} compare=${pts.map((p) => ({ t: p.t, v: p.r }))}
              label="Prix" compareLabel="Réf. 1 h" unit="ETH" timeOf=${clockTime} />`
          : html`<div class="empty-state"><p>Le graphique commence au premier échange.</p></div>`}
      </${Card}>
      <div class="span-4 stack-col">
        ${m.opening ? html`<${OpeningPanel} key=${m.address} m=${m} />` : html`<${TradePanel} key=${m.address} m=${m} />`}
        <${PositionCard} m=${m} />
      </div>
    </div>
    <${Card} id="family" title="Famille" value=${`${children.length} variante${children.length > 1 ? "s" : ""}`}
      actions=${m.depth < 6 && html`<a class="btn btn-quiet btn-sm" href=${`#lancer-${m.address}`}><${I.Launch} size=${16} />Variante</a>`}>
      <div class=${`family-grid ${showUnion ? "with-union" : ""}`}>
        <div>
          ${children.length
            ? html`<div class="ranked compact">${children.map((c) => html`<a class="ranked-row" key=${c.address} href=${memeHref(c.address)}>
                <${ShareBar} pct=${childTotal > 0n ? (Number(lockedOf(c)) / Number(childTotal)) * 100 : 0} />
                <span class="ranked-name"><${MemeAvatar} m=${c} /><span class="meme-sym">${c.symbol}</span><${Phase} m=${c} /></span>
                <span class="num tnum" data-tip=${`Réserve en ${m.symbol}`}>${f.tokens(lockedOf(c))}</span>
              </a>`)}</div>`
            : html`<p class="empty" data-tip=${`Une variante de ${m.symbol} est cotée en ${m.symbol} : chaque achat achète d'abord du ${m.symbol}`}>Aucune variante.</p>`}
        </div>
        ${showUnion && html`<div class="family-union" id="unions">
          <h3 class="sub">Union</h3>
          ${unions.map((u) => html`<${UnionBlock} key=${u.id} u=${u} />`)}
          ${!m.parent && !m.opening && html`<${ProposeUnion} m=${m} />`}
        </div>`}
      </div>
    </${Card}>
    <${Card} id="meme-activity" title="Activité"><${ActivityTable} token=${m.address} /></${Card}>
  </div>`;
}

// ------------------------------------------------------------------ Lancer

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
  const status = !symbol ? null : !key ? ["Invalide", "warn"] : tooLong ? ["16 max", "warn"] : existing ? ["Existe", "warn"] : ["Libre", "money"];
  const submit = async (e) => {
    e.preventDefault();
    if (!valid) return;
    if (await act("Meme lancé", "launch", [name.trim(), symbol.trim(), parent || ZeroAddress], wei)) {
      const token = await session.hub.read("tokenOfKey", [await session.hub.read("symbolKey", [symbol.trim()])]);
      go(memeHref(token));
    }
  };
  const eligible = [...world.memes.values()].filter((m) => m.depth < 6);
  const lineage = p ? [...p.lineage.map((a) => world.memes.get(a).symbol), key || "…"] : [key || "…"];
  return html`<div class="page narrow-page">
    <header class="page-head"><h1>Lancer</h1></header>
    <div class="grid-12">
      <form class="card panel span-7 form" onSubmit=${submit}>
        <div class="field">
          <label for="launch-name">Nom</label>
          <input id="launch-name" type="text" maxlength="40" placeholder="Peanut the Squirrel" value=${name} onInput=${(e) => setName(e.currentTarget.value)} />
        </div>
        <div class="field">
          <label for="launch-symbol">Ticker ${status && html`<span class=${`chip chip-${status[1]}`} data-testid="ticker-status"
            data-tip=${existing ? `${existing.symbol} existe\nMême ticker une fois normalisé (casse, ponctuation, leetspeak)` : key ? `Canonique : ${key}` : undefined}>${status[0]}</span>`}</label>
          <input id="launch-symbol" type="text" maxlength="32" placeholder="PNUT" value=${symbol} onInput=${(e) => setSymbol(e.currentTarget.value)} />
          ${existing && html`<div class="inline-actions"><a class="btn btn-quiet btn-sm" href=${memeHref(existing.address)}>Voir ${existing.symbol}</a>
            <a class="btn btn-quiet btn-sm" href=${`#lancer-${existing.address}`}>Variante de ${existing.symbol}</a></div>`}
        </div>
        <div class="field">
          <label for="launch-parent">Famille <span class="info" data-tip=${"Famille\nUne variante est cotée dans le token de son parent : chaque achat achète d'abord le parent"}><${I.Info} size=${14} /></span></label>
          <select id="launch-parent" value=${parent} onChange=${(e) => setParent(e.currentTarget.value)}>
            <option value="">Racine · ETH</option>
            ${eligible.map((m) => html`<option key=${m.address} value=${m.address}>Variante de ${m.symbol}</option>`)}
          </select>
        </div>
        <div class="field">
          <label for="launch-amount">Engagement <span class="info" data-tip=${"Engagement\nOptionnel. Même prix que tous les participants de l'ouverture"}><${I.Info} size=${14} /></span></label>
          <div class="amount"><input id="launch-amount" type="text" inputmode="decimal" autocomplete="off" placeholder="0" value=${value} onInput=${(e) => setValue(e.currentTarget.value)} /><span class="unit">ETH</span></div>
        </div>
        <button class="btn wide" disabled=${!valid || busy}>Lancer ${key || ""}</button>
      </form>
      <${Card} id="preview" title="Aperçu" class="span-5">
        <div class="preview">
          <${Avatar} symbol=${key || "?"} hue=${p ? hueOf(world, p) : world.memes.size % 6} size="lg" />
          <div><p class="preview-sym">${key || "—"}</p><p class="muted fine">${name || "—"}</p></div>
        </div>
        <div class="route">${["ETH", ...lineage].map((s, i) => html`${i > 0 && html`<${I.Arrow} size=${13} />`}<span class="route-step">${s}</span>`)}</div>
        <ol class="timeline" aria-label="Après le lancement">
          <li data-tip=${"Ouverture\nEnchère : tout le lot achète d'un coup, au même prix pour tous"}><span>Ouverture</span><b>${f.duration(session.params.openWindow)}</b></li>
          <li data-tip=${"Vesting\nLes tokens de l'ouverture se débloquent progressivement"}><span>Vesting</span><b>${f.duration(session.params.vestWindow)}</b></li>
          <li data-tip=${"Échange\nAchat et vente libres sur la courbe"}><span>Échange</span><b>∞</b></li>
        </ol>
        <dl class="facts">
          <div><dt>Frais créateur</dt><dd>1 % · ${p ? p.symbol : "ETH"}</dd></div>
          <div><dt>Part de pic</dt><dd>${f.percent(session.params.spikeShareBps / 10000, 0)}</dd></div>
        </dl>
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
    <div class="kpis three">
      <${Kpi} id="u-open" label="En cours" icon=${html`<${I.Merge} />`} value=${String(open.filter((u) => world.now <= u.deadline).length)} />
      <${Kpi} id="u-ready" label="Prêtes" icon=${html`<${I.Check} />`} value=${String(open.filter((u) => world.now > u.deadline && u.locked * 2n > u.circulating).length)} />
      <${Kpi} id="u-done" label="Exécutées" icon=${html`<${I.Coins} />`} value=${String(world.unions.filter((u) => u.executed).length)} />
    </div>
    <${Card} id="union-list" title="Votes">
      ${world.unions.length
        ? world.unions.slice().reverse().map((u) => html`<${UnionBlock} key=${u.id} u=${u} />`)
        : html`<p class="empty" data-tip=${"Union\nDeux memes rivaux fusionnent par vote des détenteurs"}>Une Union se propose depuis la page d'un meme racine.</p>`}
    </${Card}>
  </div>`;
}

// ------------------------------------------------------------------ Portefeuille

export function Portfolio() {
  const { world, act, busy } = useApp();
  const held = [...world.memes.values()].filter((m) => m.balance > 0n || m.claimable > 0n);
  const values = held.map((m) => f.mulWad(m.priceEth, m.balance));
  const total = values.reduce((s, v) => s + v, 0n);
  const claimables = held.filter((m) => m.claimable > 0n);
  return html`<div class="page">
    <header class="page-head"><h1>Portefeuille</h1></header>
    <div class="kpis">
      <${Kpi} id="p-eth" label="ETH" icon=${html`<${I.Wallet} />`} value=${compact(n(world.ethBalance), 4)} unit="ETH" tip=${f.eth(world.ethBalance)} />
      <${Kpi} id="p-memes" label="Memes" icon=${html`<${I.Coins} />`} value=${compact(n(total))} unit="ETH" tip=${`${f.eth(total)}\nAu prix actuel`} />
      <${Kpi} id="p-claim" label="À retirer" icon=${html`<${I.Lock} />`} value=${String(claimables.length)} tip=${"Allocations d'ouverture débloquées"} />
      <${Kpi} id="p-fees" label="Frais créateur" icon=${html`<${I.Coins} />`} value=${String(world.fees.length)} tip=${"Actifs avec des frais à retirer"} />
    </div>
    <div class="grid-12">
      <${Card} id="holdings" title="Memes" class="span-8">
        ${held.length
          ? html`<div class="ranked">
              <div class="ranked-row head"><span>Meme</span><span class="num">Solde</span><span class="num">Valeur</span><span class="num">Part</span></div>
              ${held.map((m, i) => html`<a class="ranked-row" key=${m.address} href=${memeHref(m.address)}>
                <${ShareBar} pct=${total > 0n ? (Number(values[i]) / Number(total)) * 100 : 0} tone="money" />
                <span class="ranked-name"><${MemeAvatar} m=${m} /><span class="meme-sym">${m.symbol}</span><span class="meme-name">${m.name}</span></span>
                <span class="num tnum">${f.tokens(m.balance)}</span>
                <span class="num tnum">${compact(n(values[i]))} ETH</span>
                <span class="num tnum muted">${total > 0n ? f.percent(Number(values[i]) / Number(total), 0) : "—"}</span>
              </a>`)}
            </div>`
          : html`<div class="empty-state"><p>Aucun meme.</p><a class="btn" href="#explorer">Marché</a></div>`}
      </${Card}>
      <${Card} id="p-todo" title="À faire" class="span-4"><${TodoList} /></${Card}>
    </div>
  </div>`;
}

// ------------------------------------------------------------------ Règles

export function Rules() {
  const { session } = useApp();
  const p = session.params;
  const items = [
    ["Un meme, un ticker", "PNUT, $pnut, P.N.U.T et PNU7 sont le même meme. Un doublon ne peut pas être lancé : le contrat renvoie vers l'existant."],
    ["Lignée", "Une variante est cotée dans le token de son parent. Acheter la copie, c'est d'abord acheter l'original, et l'argent qui sort d'une copie retombe dans l'original. Un seul pool d'ETH par famille."],
    ["Ouverture équitable", `Les ${f.duration(p.openWindow)} de chaque lancement sont une enchère : tout le monde paie le même prix, créateur compris. Ces places, les moins chères, se débloquent sur ${f.duration(p.vestWindow)}.`],
    ["Part de pic", `Quand une vente s'exécute au-dessus du prix moyen de la dernière heure, ${f.percent(p.spikeShareBps / 10000, 0)} de l'excédent reste dans la réserve et fait monter le prix pour ceux qui restent.`],
    ["Union", `Deux memes rivaux peuvent fusionner : les détenteurs votent en verrouillant leurs tokens pendant ${f.duration(p.unionWindow)}, et il faut plus de la moitié de l'offre en circulation.`],
  ];
  return html`<div class="page narrow-page">
    <header class="page-head"><h1>Règles</h1></header>
    <article class="card panel prose">
      <ol class="rules">${items.map(([t, d], i) => html`<li key=${i}><h2>${t}</h2><p>${d}</p></li>`)}</ol>
      <p class="muted">Un marché de memes reste à somme nulle : ces règles retirent les avantages réservés aux bots et aux copieurs, elles ne font pas gagner tout le monde. Code non audité.</p>
    </article>
  </div>`;
}
