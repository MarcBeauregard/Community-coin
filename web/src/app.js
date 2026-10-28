import { h, render, createContext } from "preact";
import { useState, useEffect, useContext, useRef, useCallback } from "preact/hooks";
import htm from "htm";
import { ZeroAddress } from "ethers";
import { LocalChain, WalletChain } from "./chain.js";
import { Hub, explain } from "./hub.js";
import { loadWorld, families, describe } from "./world.js";
import { seed, DEMO_ACCOUNTS, SEED_SPAN } from "./seed.js";
import { DEPLOYMENTS } from "./deployments.js";
import * as f from "./format.js";

const html = htm.bind(h);
const App = createContext(null);
const useApp = () => useContext(App);

const DEMO_PARAMS = [300, 3600, 5000, 3 * 24 * 3600]; // opening, vesting, spike share (bps), union vote
const WARPS = [
  [300, "+5 min"],
  [3600, "+1 h"],
  [86400, "+1 j"],
  [3 * 86400, "+3 j"],
];
const TOLERANCE = 99n; // minimum output at 99 % of the quote

// ------------------------------------------------------------------ sessions

async function readParams(hub) {
  return {
    openWindow: Number(await hub.read("openWindow")),
    vestWindow: Number(await hub.read("vestWindow")),
    spikeShareBps: Number(await hub.read("spikeShareBps")),
    unionWindow: Number(await hub.read("unionWindow")),
  };
}

/** Everything that is not React state: the chain, the hub, a symbol cache, the feed and price history. */
function newSession(chain, hub, label) {
  return { chain, hub, label, cache: new Map(), feed: [], history: new Map() };
}

async function transact(session, from, fn, args = [], value = 0n) {
  const { hub, cache, chain } = session;
  const res = await hub.write(from, fn, args, value);
  for (const e of res.events) {
    if (e.name === "Launched") cache.set(e.args.token, { symbol: e.args.symbol, parent: e.args.parent });
    if (e.name === "UnionExecuted") cache.get(e.args.meme).parent = e.args.target;
  }
  const symbolOf = (token, quote) => {
    const c = cache.get(token);
    if (!quote) return c?.symbol ?? "?";
    return !c || c.parent === ZeroAddress ? "ETH" : cache.get(c.parent)?.symbol ?? "?";
  };
  const actorName = chain.accounts.find((a) => a.address === from)?.name ?? f.shortAddress(from);
  session.feed.unshift(...describe(res.events, { fn, actorName, symbolOf, timestamp: res.timestamp }).reverse());
  session.feed.length = Math.min(session.feed.length, 300);
  await recordPrices(session, res.timestamp);
  return res;
}

async function recordPrices(session, t) {
  const { hub, cache, history } = session;
  for (const token of cache.keys()) {
    let p;
    try {
      p = await hub.read("priceInEth", [token]);
    } catch {
      continue; // still in its opening
    }
    const points = history.get(token) ?? [];
    if (points.length && points.at(-1).t === t) points.pop();
    points.push({ t, p: f.toNumber(p) });
    history.set(token, points);
  }
}

async function bootDemo() {
  const chain = await LocalChain.create(DEMO_ACCOUNTS);
  chain.startChain -= SEED_SPAN + 40; // the example history ends about now
  const hub = await Hub.deploy(chain, chain.accounts[0].address, DEMO_PARAMS);
  const session = newSession(chain, hub, "Démo · chaîne locale dans ton navigateur");
  const accountOf = (name) => chain.accounts.find((a) => a.name === name).address;
  await seed({
    hub,
    accountOf,
    run: (actor, fn, args, value) => transact(session, accountOf(actor), fn, args, value),
    warp: (s) => chain.warp(s),
  });
  session.params = await readParams(hub);
  return session;
}

async function bootWallet() {
  const chain = await WalletChain.connect();
  const deployment = DEPLOYMENTS[String(chain.chainId)];
  if (!deployment) throw new Error("Community Coin n'est pas déployé sur le réseau de ton wallet.");
  const hub = new Hub(chain, deployment.hub);
  const session = newSession(chain, hub, deployment.name);
  session.params = await readParams(hub);
  const count = Number(await hub.read("memeCount"));
  for (let i = 0; i < count; i++) {
    const token = await hub.read("allMemes", [i]);
    const s = await hub.read("memes", [token]);
    session.cache.set(token, { symbol: await hub.token(token, "symbol"), parent: s.parent });
  }
  await recordPrices(session, chain.now());
  return session;
}

// ------------------------------------------------------------------ routing

function useRoute() {
  const read = () => (location.hash || "#explorer").slice(1);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => {
      setRoute(read());
      window.scrollTo({ top: 0 });
    };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return route;
}

const go = (hash) => {
  location.hash = hash;
};
const memeHref = (address) => `#meme-${address}`;

// ------------------------------------------------------------------ small pieces

function Ticker({ m, link = true }) {
  const t = html`<span class="ticker">${m.symbol}</span>`;
  return link ? html`<a class="ticker-link" href=${memeHref(m.address)}>${t}</a>` : t;
}

function Phase({ m }) {
  const { world, session } = useApp();
  if (m.opening) return html`<span class="chip chip-open">Ouverture · ${f.duration(m.openUntil - world.now)}</span>`;
  if (m.vesting && session.params.vestWindow)
    return html`<span class="chip chip-live">Échange · vesting ${f.percent(m.vestedShare, 0)}</span>`;
  return html`<span class="chip chip-live">Échange</span>`;
}

function Field({ id, label, hint, children }) {
  return html`<div class="field">
    <label for=${id}>${label}</label>
    ${children}
    ${hint && html`<p class="hint">${hint}</p>`}
  </div>`;
}

function AmountInput({ id, value, onInput, unit, onMax }) {
  return html`<div class="amount">
    <input id=${id} type="text" inputmode="decimal" autocomplete="off" placeholder="0" value=${value}
      onInput=${(e) => onInput(e.currentTarget.value)} />
    <span class="unit">${unit}</span>
    ${onMax && html`<button type="button" class="link-btn" onClick=${onMax}>Max</button>`}
  </div>`;
}

/** Re-runs an async quote whenever its inputs change; null while unknown or impossible. */
function useQuote(fn, deps) {
  const [quote, setQuote] = useState(null);
  useEffect(() => {
    let live = true;
    setQuote(null);
    Promise.resolve(fn())
      .then((q) => live && setQuote(q ?? null))
      .catch(() => live && setQuote(null));
    return () => {
      live = false;
    };
  }, deps);
  return quote;
}

function Feed({ token, limit = 12 }) {
  const { session, world } = useApp();
  const entries = session.feed.filter((e) => !token || e.token === token).slice(0, limit);
  if (!entries.length) return html`<p class="empty">Pas encore d'activité.</p>`;
  return html`<ol class="feed">
    ${entries.map(
      (e, i) => html`<li key=${i}>
        <time>${f.ago(world.now - e.t)}</time>
        <p><strong>${e.actor}</strong> ${e.text}</p>
      </li>`,
    )}
  </ol>`;
}

function PriceChart({ m }) {
  const { session } = useApp();
  const points = session.history.get(m.address) ?? [];
  if (points.length < 2)
    return html`<div class="chart-empty">Le graphique commence au premier échange après l'ouverture.</div>`;
  // A narrower drawing on phones keeps the labels readable.
  const narrow = globalThis.matchMedia?.("(max-width: 600px)").matches;
  const W = narrow ? 360 : 640, H = narrow ? 200 : 210, L = 4, R = narrow ? 84 : 92, T = 12, B = 26;
  const ts = points.map((p) => p.t), ps = points.map((p) => p.p * 1e6);
  const t0 = ts[0], t1 = Math.max(ts.at(-1), t0 + 1);
  let lo = Math.min(...ps), hi = Math.max(...ps);
  if (hi === lo) hi = lo * 1.1 || 1;
  const pad = (hi - lo) * 0.08;
  lo = Math.max(0, lo - pad);
  hi += pad;
  const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const y = (p) => T + (1 - (p - lo) / (hi - lo)) * (H - T - B);
  // Prices only move on trades: draw steps, not slopes.
  let line = `M${x(ts[0]).toFixed(1)},${y(ps[0]).toFixed(1)}`;
  for (let i = 1; i < ps.length; i++) line += ` H${x(ts[i]).toFixed(1)} V${y(ps[i]).toFixed(1)}`;
  const area = `${line} V${H - B} H${x(ts[0]).toFixed(1)} Z`;
  const label = (p) => `${new Intl.NumberFormat("fr-FR", { maximumSignificantDigits: 3 }).format(p)} ETH`;
  const time = (t) => new Date(t * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const ticks = [hi - pad, (hi + lo) / 2, lo + pad];
  return html`<figure class="chart">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label=${`Prix de ${m.symbol} en ETH pour un million de tokens`}>
      ${ticks.map(
        (p, i) => html`<g key=${i}>
          <line class="grid" x1=${L} x2=${W - R} y1=${y(p)} y2=${y(p)} />
          <text class="axis" x=${W - R + 8} y=${y(p) + 4}>${label(p)}</text>
        </g>`,
      )}
      <path class="area" d=${area} />
      <path class="line" d=${line} />
      <circle class="dot" cx=${x(ts.at(-1))} cy=${y(ps.at(-1))} r="4" />
      <text class="axis" x=${L} y=${H - 6}>${time(t0)}</text>
      <text class="axis" x=${W - R} y=${H - 6} text-anchor="end">${time(t1)}</text>
    </svg>
    <figcaption>Prix pour 1 million de ${m.symbol}, en ETH</figcaption>
  </figure>`;
}

// ------------------------------------------------------------------ pages

function Explorer() {
  const { world } = useApp();
  const rows = families(world);
  return html`<div class="page">
    <section class="intro">
      <h1>Un meme, une famille.</h1>
      <p>Ici, une copie se lance <em>dans la famille</em> du meme qu'elle copie : chaque achat de la copie achète d'abord
        l'original. Chaque lancement s'ouvre par une enchère de 5 minutes au même prix pour tous, et ces places se
        débloquent sur une heure. Les bots n'ont plus de premier bloc à sniper.</p>
      <div class="intro-actions">
        <a class="btn" href="#lancer">Lancer un meme</a>
        <a class="btn btn-quiet" href="#regles">Les cinq règles</a>
      </div>
    </section>
    <div class="split">
      <section class="panel" aria-labelledby="fam-title">
        <h2 id="fam-title">Familles</h2>
        <div class="table-wrap">
          <table class="memes">
            <thead><tr><th>Meme</th><th>Phase</th><th class="num">Prix · 1 M</th><th class="num opt">Capitalisation</th><th class="num opt">Réserve</th></tr></thead>
            <tbody>
              ${rows.map(
                (m) => html`<tr key=${m.address} class=${m.depth ? "variant" : "root"} onClick=${() => go(memeHref(m.address))}>
                  <td><div class="meme-cell" style=${`--depth:${m.depth}`}>
                    ${m.depth > 0 && html`<span class="branch" aria-hidden="true"></span>`}
                    <${Ticker} m=${m} /><span class="name">${m.name}</span>
                  </div></td>
                  <td><${Phase} m=${m} /></td>
                  <td class="num">${f.perMillion(m.priceEth)}</td>
                  <td class="num opt">${f.eth(m.capEth, 2)}</td>
                  <td class="num opt">${m.parent ? f.tokens(m.reserve, m.quoteSymbol) : f.eth(m.reserve, 3)}</td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section class="panel" aria-labelledby="feed-title">
        <h2 id="feed-title">Activité</h2>
        <${Feed} limit=${14} />
      </section>
    </div>
  </div>`;
}

function Rules() {
  const { session } = useApp();
  const p = session.params;
  const items = [
    ["Un meme, un ticker", "PNUT, $pnut, P.N.U.T et PNU7 sont le même meme. Un doublon ne peut pas être lancé : le contrat renvoie vers l'existant."],
    ["Lignée", "Une variante est cotée dans le token de son parent. Acheter la copie, c'est d'abord acheter l'original, et l'argent qui sort d'une copie retombe dans l'original au lieu de quitter le meme. Un seul pool d'ETH par famille."],
    ["Ouverture équitable", `Les ${f.duration(p.openWindow)} de chaque lancement sont une enchère : tout le monde paie le même prix, créateur compris. Ces places, les moins chères, se débloquent sur ${f.duration(p.vestWindow)}.`],
    ["Part de pic", `Quand une vente s'exécute au-dessus du prix moyen de la dernière heure, ${f.percent(p.spikeShareBps / 10000, 0)} de l'excédent reste dans la réserve et fait monter le prix pour ceux qui restent. Vendre patiemment ne coûte rien de plus.`],
    ["Union", `Deux memes rivaux peuvent fusionner. Les détenteurs votent en verrouillant leurs tokens pendant ${f.duration(p.unionWindow)} ; il faut plus de la moitié de l'offre en circulation. La réserve rejoint l'autre famille, les soldes ne bougent pas.`],
  ];
  return html`<div class="page narrow">
    <h1>Les cinq règles</h1>
    <ol class="rules">
      ${items.map(([t, d], i) => html`<li key=${i}><h2>${t}</h2><p>${d}</p></li>`)}
    </ol>
    <p class="note">Un marché de memes reste à somme nulle : ce que quelqu'un gagne, d'autres l'ont mis. Ces règles retirent les
      avantages réservés aux bots et aux copieurs ; elles ne font pas gagner tout le monde.</p>
    <a class="btn" href="#explorer">Retour aux familles</a>
  </div>`;
}

function OpeningPanel({ m }) {
  const { world, session, act, account } = useApp();
  const parent = m.parent && world.memes.get(m.parent);
  const [amount, setAmount] = useState("0.1");
  const [payWithParent, setPayWithParent] = useState(false);
  const wei = f.parseAmount(amount);
  const submit = async (e) => {
    e.preventDefault();
    if (!wei) return;
    if (payWithParent) await act("Engagé dans l'ouverture", "commit", [m.address, wei]);
    else await act("Engagé dans l'ouverture", "commitEth", [m.address, 0n], wei);
  };
  return html`<section class="panel action">
    <h2>Enchère d'ouverture</h2>
    <p class="countdown"><span>se termine dans</span> <strong>${f.duration(m.openUntil - world.now)}</strong></p>
    <dl class="kv">
      <div><dt>Déjà engagé</dt><dd>${m.parent ? f.tokens(m.batchQuote, m.quoteSymbol) : f.eth(m.batchQuote)}</dd></div>
      <div><dt>Prix indicatif · 1 M</dt><dd>${f.perMillion(m.priceEth)}</dd></div>
      <div><dt>Ton engagement</dt><dd>${m.parent ? f.tokens(m.committed, m.quoteSymbol) : f.eth(m.committed)}</dd></div>
    </dl>
    <form onSubmit=${submit}>
      ${parent && parent.balance > 0n && html`<div class="seg" role="group" aria-label="Payer en">
        <button type="button" aria-pressed=${!payWithParent} onClick=${() => setPayWithParent(false)}>ETH</button>
        <button type="button" aria-pressed=${payWithParent} onClick=${() => setPayWithParent(true)}>${parent.symbol}</button>
      </div>`}
      <${Field} id="commit-amount" label="Montant" hint=${payWithParent ? null : m.parent ? `Ton ETH achète d'abord du ${parent.symbol}, qui est engagé pour toi.` : null}>
        <${AmountInput} id="commit-amount" value=${amount} onInput=${setAmount} unit=${payWithParent ? parent.symbol : "ETH"}
          onMax=${payWithParent ? () => setAmount(f.exact(parent.balance)) : null} />
      </${Field}>
      <button class="btn wide" disabled=${!wei}>Engager</button>
      <p class="hint">Tout le monde paie le même prix moyen, calculé à la clôture. Ta part se débloque ensuite sur ${f.duration(session.params.vestWindow)}.</p>
    </form>
  </section>`;
}

function AllocationPanel({ m }) {
  const { act } = useApp();
  const vestedNow = m.claimed + m.claimable;
  return html`<section class="panel action">
    <h2>Ton allocation d'ouverture</h2>
    <div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round(m.vestedShare * 100)}>
      <span style=${`width:${(m.vestedShare * 100).toFixed(1)}%`}></span>
    </div>
    <dl class="kv">
      <div><dt>Allocation</dt><dd>${f.tokens(m.allocation, m.symbol)}</dd></div>
      <div><dt>Débloqué</dt><dd>${f.percent(m.vestedShare, 0)} · ${f.tokens(vestedNow, m.symbol)}</dd></div>
      <div><dt>Disponible</dt><dd>${f.tokens(m.claimable, m.symbol)}</dd></div>
    </dl>
    <button class="btn wide" disabled=${m.claimable === 0n} onClick=${() => act("Retiré", "claim", [m.address])}>Retirer</button>
  </section>`;
}

function TradePanel({ m }) {
  const { world, session, act } = useApp();
  const parent = m.parent && world.memes.get(m.parent);
  const [side, setSide] = useState("buy");
  const [viaParent, setViaParent] = useState(false);
  const [amount, setAmount] = useState("0.1");
  const wei = f.parseAmount(amount);
  const hub = session.hub;
  const routeNames = m.lineage.map((a) => world.memes.get(a).symbol);
  useEffect(() => setAmount(side === "buy" ? "0.1" : ""), [side]);

  const quote = useQuote(() => {
    if (!wei) return null;
    if (side === "buy") return viaParent ? hub.read("quoteBuy", [m.address, wei]) : hub.read("quoteBuyEth", [m.address, wei]);
    if (wei > m.balance) return null;
    return viaParent ? hub.read("quoteSell", [m.address, wei]) : hub.read("quoteSellToEth", [m.address, wei]);
  }, [side, viaParent, amount, world.loadedAt, m.address]);

  const payUnit = side === "buy" ? (viaParent ? parent.symbol : "ETH") : m.symbol;
  const getUnit = side === "buy" ? m.symbol : viaParent ? parent.symbol : "ETH";
  const minOut = quote ? (quote * TOLERANCE) / 100n : 0n;
  const submit = async (e) => {
    e.preventDefault();
    if (!wei || !quote) return;
    let ok;
    if (side === "buy") {
      ok = viaParent
        ? await act("Acheté", "buy", [m.address, wei, minOut])
        : await act("Acheté", "buyEth", [m.address, minOut], wei);
    } else {
      ok = viaParent
        ? await act("Vendu", "sell", [m.address, wei, minOut])
        : await act("Vendu", "sellToEth", [m.address, wei, minOut]);
    }
    if (ok) setAmount(side === "buy" ? amount : "");
  };
  const over = side === "sell" && wei && wei > m.balance;
  const spikeWarning = side === "sell" && m.premium > 0.02;

  return html`<section class="panel action">
    <div class="seg tabs" role="group" aria-label="Sens">
      <button type="button" aria-pressed=${side === "buy"} onClick=${() => setSide("buy")}>Acheter</button>
      <button type="button" aria-pressed=${side === "sell"} onClick=${() => setSide("sell")}>Vendre</button>
    </div>
    ${parent && html`<div class="seg small" role="group" aria-label=${side === "buy" ? "Payer en" : "Recevoir en"}>
      <span>${side === "buy" ? "Payer en" : "Recevoir en"}</span>
      <button type="button" aria-pressed=${!viaParent} onClick=${() => setViaParent(false)}>ETH</button>
      <button type="button" aria-pressed=${viaParent} onClick=${() => setViaParent(true)}>${parent.symbol}</button>
    </div>`}
    <form onSubmit=${submit}>
      <${Field} id="trade-amount" label=${side === "buy" ? "Tu paies" : "Tu vends"}>
        <${AmountInput} id="trade-amount" value=${amount} onInput=${setAmount} unit=${payUnit}
          onMax=${side === "sell" ? () => setAmount(f.exact(m.balance)) : viaParent ? () => setAmount(f.exact(parent.balance)) : null} />
      </${Field}>
      <p class="receive">
        <span>Tu reçois</span>
        <strong>${over ? "Solde insuffisant" : quote === null ? "—" : getUnit === "ETH" ? f.eth(quote) : f.tokens(quote, getUnit)}</strong>
      </p>
      ${side === "buy" && !viaParent && m.parent && html`<p class="hint">Route : ETH → ${routeNames.join(" → ")}. 1 % de frais à chaque étape, versé au créateur de chaque meme.</p>`}
      ${side === "sell" && viaParent && html`<p class="hint">Tu reçois du ${parent.symbol} : l'argent reste dans la famille.</p>`}
      ${spikeWarning && html`<p class="warn">Le prix est ${f.percent(m.premium, 0)} au-dessus de sa moyenne sur une heure. La moitié de ce que tu toucherais au-dessus de cette moyenne reste aux détenteurs.</p>`}
      <button class="btn wide" disabled=${!wei || !quote || over}>${side === "buy" ? `Acheter ${m.symbol}` : `Vendre ${m.symbol}`}</button>
      <p class="hint">Tolérance de prix : 1 %.</p>
    </form>
  </section>`;
}

function UnionCard({ u }) {
  const { world, act } = useApp();
  const meme = world.memes.get(u.meme), target = world.memes.get(u.target);
  const [amount, setAmount] = useState("");
  const wei = f.parseAmount(amount);
  const needed = u.circulating / 2n + 1n;
  const progress = needed > 0n ? Math.min(1, Number((u.locked * 10000n) / needed) / 10000) : 0;
  const open = !u.executed && world.now <= u.deadline;
  const ready = !u.executed && !u.stale && world.now > u.deadline && u.locked * 2n > u.circulating;
  const status = u.executed ? "Exécutée" : u.stale ? "Sans objet" : open ? `Vote ouvert · ${f.duration(u.deadline - world.now)}` : ready ? "Prête à exécuter" : "Majorité non atteinte";
  return html`<article class="union">
    <header>
      <p class="union-title"><${Ticker} m=${meme} /> <span aria-hidden="true">→</span> <${Ticker} m=${target} /></p>
      <span class=${`chip ${u.executed ? "chip-live" : open ? "chip-open" : ready ? "chip-ready" : "chip-off"}`}>${status}</span>
    </header>
    <p class="union-text">${meme.symbol} rejoindrait la famille de ${target.symbol} : sa réserve achète du ${target.symbol} et sa courbe est re-cotée en ${target.symbol}. Les soldes ne bougent pas.</p>
    ${!u.executed && html`<div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round(progress * 100)}><span style=${`width:${(progress * 100).toFixed(1)}%`}></span></div>
    <p class="hint">${f.tokens(u.locked, meme.symbol)} verrouillés sur ${f.tokens(needed, meme.symbol)} nécessaires (la moitié de l'offre en circulation, plus un).</p>`}
    ${u.mine > 0n && html`<p class="hint">Tu as verrouillé ${f.tokens(u.mine, meme.symbol)}.</p>`}
    <div class="union-actions">
      ${open && html`<form class="inline" onSubmit=${async (e) => { e.preventDefault(); if (wei && (await act("Verrouillé pour l'Union", "lockUnion", [u.id, wei]))) setAmount(""); }}>
        <${AmountInput} id=${`lock-${u.id}`} value=${amount} onInput=${setAmount} unit=${meme.symbol} onMax=${() => setAmount(f.exact(meme.balance))} />
        <button class="btn" disabled=${!wei || wei > meme.balance}>Voter pour</button>
      </form>`}
      ${u.mine > 0n && html`<button class="btn btn-quiet" onClick=${() => act("Tokens récupérés", "unlockUnion", [u.id])}>Récupérer mes ${meme.symbol}</button>`}
      ${ready && html`<button class="btn" onClick=${() => act("Union exécutée", "executeUnion", [u.id, 0n])}>Exécuter l'Union</button>`}
    </div>
  </article>`;
}

function ProposeUnion({ m }) {
  const { world, act } = useApp();
  const targets = [...world.memes.values()].filter((t) => t.root !== m.address && !t.opening);
  const [target, setTarget] = useState(targets[0]?.address ?? "");
  if (!targets.length) return null;
  return html`<form class="propose" onSubmit=${(e) => { e.preventDefault(); act("Union proposée", "proposeUnion", [m.address, target]); }}>
    <${Field} id="union-target" label=${`Proposer que ${m.symbol} rejoigne la famille de`}>
      <select id="union-target" value=${target} onChange=${(e) => setTarget(e.currentTarget.value)}>
        ${targets.map((t) => html`<option key=${t.address} value=${t.address}>${t.symbol} · ${t.name}</option>`)}
      </select>
    </${Field}>
    <button class="btn btn-quiet">Proposer l'Union</button>
  </form>`;
}

function MemePage({ address }) {
  const { world, session } = useApp();
  const m = world.memes.get(address);
  if (!m) return html`<div class="page narrow"><h1>Meme introuvable</h1><p><a href="#explorer">Retour aux familles</a></p></div>`;
  const parent = m.parent && world.memes.get(m.parent);
  const creator = session.chain.accounts.find((a) => a.address === m.creator)?.name ?? f.shortAddress(m.creator);
  const unions = world.unions.filter((u) => u.meme === m.address || u.target === m.address);
  const children = m.children.map((c) => world.memes.get(c));
  const value = f.mulWad(m.priceEth, m.balance);
  return html`<div class="page">
    <nav class="lineage" aria-label="Lignée">
      <span>ETH</span>
      ${m.lineage.map((a) => html`<span key=${a} class="sep" aria-hidden="true">›</span><a href=${memeHref(a)} aria-current=${a === m.address ? "page" : null}>${world.memes.get(a).symbol}</a>`)}
    </nav>
    <header class="meme-head">
      <h1><${Ticker} m=${m} link=${false} /> <span>${m.name}</span></h1>
      <div class="meta">
        <span>Lancé par ${creator}</span>
        <span>${parent ? html`variante de <a href=${memeHref(parent.address)}>${parent.symbol}</a>, cotée en ${parent.symbol}` : "racine cotée en ETH"}</span>
        <${Phase} m=${m} />
      </div>
    </header>
    <div class="meme-grid">
      <div class="col-main">
        <dl class="stats">
          <div><dt>Prix · 1 M tokens</dt><dd>${f.perMillion(m.priceEth)}</dd></div>
          <div><dt>Écart à la moyenne 1 h</dt><dd class=${m.premium > 0.02 ? "up" : m.premium < -0.02 ? "down" : ""}>${m.opening ? "—" : f.signedPercent(m.premium)}</dd></div>
          <div><dt>Capitalisation</dt><dd>${f.eth(m.capEth, 2)}</dd></div>
          <div><dt>Réserve</dt><dd>${m.parent ? f.tokens(m.reserve, m.quoteSymbol) : f.eth(m.reserve, 3)}</dd></div>
          <div><dt>En circulation</dt><dd>${f.tokens(m.circulating)}</dd></div>
        </dl>
        <section class="panel"><${PriceChart} m=${m} /></section>
        <section class="panel" aria-labelledby="family-title">
          <div class="panel-head">
            <h2 id="family-title">Variantes</h2>
            ${m.depth < 6 && html`<a class="btn btn-quiet" href=${`#lancer-${m.address}`}>Lancer une variante</a>`}
          </div>
          ${children.length
            ? html`<ul class="children">${children.map((c) => html`<li key=${c.address}><${Ticker} m=${c} /> <span>${c.name}</span> <span class="muted">${f.perMillion(c.priceEth)}</span></li>`)}</ul>`
            : html`<p class="empty">Aucune variante. Une variante de ${m.symbol} sera cotée en ${m.symbol} : chaque achat de la variante achète d'abord du ${m.symbol}.</p>`}
        </section>
        ${(unions.length > 0 || !m.parent) && html`<section class="panel" aria-labelledby="union-title">
          <h2 id="union-title">Union</h2>
          ${unions.map((u) => html`<${UnionCard} key=${u.id} u=${u} />`)}
          ${!m.parent && !m.opening && html`<${ProposeUnion} m=${m} />`}
        </section>`}
        <section class="panel" aria-labelledby="act-title">
          <h2 id="act-title">Activité</h2>
          <${Feed} token=${m.address} />
        </section>
      </div>
      <aside class="col-side">
        ${m.opening ? html`<${OpeningPanel} key=${m.address} m=${m} />` : html`<${TradePanel} key=${m.address} m=${m} />`}
        ${!m.opening && m.committed > 0n && html`<${AllocationPanel} key=${m.address} m=${m} />`}
        <section class="panel position">
          <h2>Ta position</h2>
          <p class="big">${f.tokens(m.balance, m.symbol)}</p>
          <p class="muted">≈ ${f.eth(value)}${m.balance > 0n ? " au prix actuel" : ""}</p>
        </section>
      </aside>
    </div>
  </div>`;
}

function Launch({ parentHint }) {
  const { world, act, session } = useApp();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [parent, setParent] = useState(parentHint && world.memes.has(parentHint) ? parentHint : "");
  const [amount, setAmount] = useState("0.1");
  useEffect(() => setParent(parentHint && world.memes.has(parentHint) ? parentHint : ""), [parentHint]);
  const key = f.canonicalTicker(symbol);
  const existing = key && [...world.memes.values()].find((m) => f.canonicalTicker(m.symbol) === key);
  const tooLong = key.length > 16;
  const p = parent && world.memes.get(parent);
  const wei = amount.trim() === "" ? 0n : f.parseAmount(amount);
  const valid = name.trim() && key && !existing && !tooLong && wei !== null;
  const submit = async (e) => {
    e.preventDefault();
    if (!valid) return;
    if (await act("Meme lancé", "launch", [name.trim(), symbol.trim(), parent || ZeroAddress], wei)) {
      const token = await session.hub.read("tokenOfKey", [await session.hub.read("symbolKey", [symbol.trim()])]);
      go(memeHref(token));
    }
  };
  const eligibleParents = [...world.memes.values()].filter((m) => m.depth < 6);
  return html`<div class="page">
    <div class="launch-grid">
      <form class="panel" onSubmit=${submit}>
        <h1>Lancer un meme</h1>
        <${Field} id="launch-name" label="Nom">
          <input id="launch-name" type="text" maxlength="40" placeholder="Peanut the Squirrel" value=${name} onInput=${(e) => setName(e.currentTarget.value)} />
        </${Field}>
        <${Field} id="launch-symbol" label="Ticker">
          <input id="launch-symbol" type="text" maxlength="32" placeholder="PNUT" value=${symbol} onInput=${(e) => setSymbol(e.currentTarget.value)} />
        </${Field}>
        ${symbol && html`<p class=${existing || tooLong || !key ? "warn" : "hint"}>
          ${!key ? "Il faut au moins une lettre ou un chiffre." : tooLong ? "16 caractères au maximum, une fois la ponctuation retirée."
            : existing ? html`${existing.symbol} existe déjà (même ticker une fois normalisé). <a href=${memeHref(existing.address)}>Voir ${existing.symbol}</a> ou <a href=${`#lancer-${existing.address}`}>lancer une variante</a>.`
            : html`Ticker canonique : <strong>${key}</strong>. Libre.`}
        </p>`}
        <${Field} id="launch-parent" label="Famille" hint=${p ? `Ta variante sera cotée en ${p.symbol} : chaque achat achètera d'abord du ${p.symbol}.` : "Un meme racine est coté directement en ETH."}>
          <select id="launch-parent" value=${parent} onChange=${(e) => setParent(e.currentTarget.value)}>
            <option value="">Aucune : nouvelle racine en ETH</option>
            ${eligibleParents.map((m) => html`<option key=${m.address} value=${m.address}>Variante de ${m.symbol} · ${m.name}</option>`)}
          </select>
        </${Field}>
        <${Field} id="launch-amount" label="Ton engagement dans l'ouverture" hint="Optionnel. Tu paies le même prix que tout le monde.">
          <${AmountInput} id="launch-amount" value=${amount} onInput=${setAmount} unit="ETH" />
        </${Field}>
        <button class="btn wide" disabled=${!valid}>Lancer ${key || ""}</button>
      </form>
      <aside class="panel explain">
        <h2>Ce qui se passe ensuite</h2>
        <ol class="steps">
          <li><strong>${f.duration(session.params.openWindow)} d'enchère.</strong> Tout le monde engage de l'ETH ; à la clôture, tout le lot achète d'un coup et chacun paie le même prix.</li>
          <li><strong>${f.duration(session.params.vestWindow)} de déblocage.</strong> Les tokens de l'enchère se débloquent progressivement : personne ne peut les revendre sur la première vague.</li>
          <li><strong>Échange libre</strong> sur la courbe. Tu touches 1 % de chaque échange de ton meme, payé en ${p ? p.symbol : "ETH"}.</li>
        </ol>
        <p class="muted">Pas de propriétaire, pas de clé admin : le contrat peut toujours racheter tous les tokens en circulation.</p>
      </aside>
    </div>
  </div>`;
}

function Unions() {
  const { world } = useApp();
  return html`<div class="page narrow">
    <h1>Unions</h1>
    <p class="lead">Quand deux memes se disputent la même idée, leurs détenteurs peuvent les fusionner au lieu de se battre. Une proposition se fait depuis la page d'un meme racine.</p>
    ${world.unions.length
      ? world.unions.slice().reverse().map((u) => html`<section class="panel" key=${u.id}><${UnionCard} u=${u} /></section>`)
      : html`<p class="empty">Aucune Union proposée pour l'instant.</p>`}
  </div>`;
}

function Portfolio() {
  const { world, act } = useApp();
  const held = [...world.memes.values()].filter((m) => m.balance > 0n || m.committed > m.claimed);
  const total = held.reduce((s, m) => s + f.mulWad(m.priceEth, m.balance), 0n);
  const locks = world.unions.filter((u) => u.mine > 0n);
  return html`<div class="page narrow">
    <h1>Portefeuille</h1>
    <dl class="stats">
      <div><dt>ETH</dt><dd>${f.eth(world.ethBalance)}</dd></div>
      <div><dt>Memes, au prix actuel</dt><dd>${f.eth(total)}</dd></div>
    </dl>
    <section class="panel">
      <h2>Tes memes</h2>
      ${held.length
        ? html`<div class="table-wrap"><table class="memes">
            <thead><tr><th>Meme</th><th class="num">Solde</th><th class="num">À retirer</th><th class="num">Valeur</th></tr></thead>
            <tbody>${held.map((m) => html`<tr key=${m.address} onClick=${() => go(memeHref(m.address))}>
              <td><div class="meme-cell"><${Ticker} m=${m} /><span class="name">${m.name}</span></div></td>
              <td class="num">${f.tokens(m.balance)}</td>
              <td class="num">${m.claimable > 0n ? f.tokens(m.claimable) : "—"}</td>
              <td class="num">${f.eth(f.mulWad(m.priceEth, m.balance))}</td>
            </tr>`)}</tbody>
          </table></div>`
        : html`<p class="empty">Rien pour l'instant. <a href="#explorer">Choisis un meme</a> ou <a href="#lancer">lance le tien</a>.</p>`}
    </section>
    <section class="panel">
      <h2>Frais de créateur</h2>
      ${world.fees.length
        ? html`<ul class="fees">${world.fees.map((x) => html`<li key=${x.asset}>
            <span>${x.symbol === "ETH" ? f.eth(x.amount) : f.tokens(x.amount, x.symbol)}</span>
            <button class="btn btn-quiet" onClick=${() => act("Frais retirés", "claimFees", [x.asset])}>Retirer</button>
          </li>`)}</ul>`
        : html`<p class="empty">Lance un meme : tu toucheras 1 % de chacun de ses échanges.</p>`}
    </section>
    ${locks.length > 0 && html`<section class="panel"><h2>Tes votes d'Union</h2>${locks.map((u) => html`<${UnionCard} key=${u.id} u=${u} />`)}</section>`}
  </div>`;
}

// ------------------------------------------------------------------ shell

function TopBar({ onWarp, onReset, onConnect, canConnect }) {
  const { world, session, account, setAccount, busy, route } = useApp();
  const section = route.startsWith("meme-") ? "explorer" : route.startsWith("lancer") ? "lancer" : route;
  const local = session.chain.kind === "local";
  return html`<header class="top">
    <div class="top-inner">
      <a class="brand" href="#explorer"><span class="brand-mark" aria-hidden="true">CC</span><span>Community Coin</span></a>
      <span class="mode">${session.label}</span>
      <div class="clock">
        <time>${f.clock(world.now)}</time>
        ${local && html`<div class="warp" role="group" aria-label="Avancer le temps">
          ${WARPS.map(([s, l]) => html`<button key=${s} type="button" disabled=${busy} onClick=${() => onWarp(s)}>${l}</button>`)}
        </div>`}
      </div>
      <div class="who">
        <label for="account" class="sr">Compte</label>
        <select id="account" value=${account} onChange=${(e) => setAccount(e.currentTarget.value)}>
          ${session.chain.accounts.map((a) => html`<option key=${a.address} value=${a.address}>${a.name}</option>`)}
        </select>
        <span class="balance">${f.eth(world.ethBalance, 3)}</span>
        ${local && html`<button type="button" class="link-btn" onClick=${onReset}>Recommencer</button>`}
        ${canConnect && html`<button type="button" class="btn btn-quiet" onClick=${onConnect}>Connecter un wallet</button>`}
      </div>
    </div>
    <nav class="tabs-nav" aria-label="Sections">
      ${[["explorer", "Familles"], ["lancer", "Lancer"], ["unions", "Unions"], ["portefeuille", "Portefeuille"], ["regles", "Règles"]].map(
        ([r, l]) => html`<a key=${r} href=${`#${r}`} aria-current=${section === r ? "page" : null}>${l}</a>`,
      )}
    </nav>
  </header>`;
}

function Toasts({ toasts }) {
  return html`<div class="toasts" role="status" aria-live="polite">
    ${toasts.map((t) => html`<p key=${t.id} class=${`toast ${t.kind}`}>${t.text}</p>`)}
  </div>`;
}

function Root() {
  const [session, setSession] = useState(null);
  const [bootError, setBootError] = useState(null);
  const [account, setAccount] = useState(null);
  const [world, setWorld] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [, setTick] = useState(0);
  const route = useRoute();
  const toastId = useRef(0);

  const toast = useCallback((text, kind = "ok") => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 6000 : 3000);
  }, []);

  const start = useCallback(async (boot) => {
    setWorld(null);
    try {
      const s = await boot();
      setSession(s);
      setAccount(s.chain.accounts[0].address);
    } catch (e) {
      setBootError(explain(e));
    }
  }, []);

  useEffect(() => {
    start(bootDemo);
  }, []);

  const refresh = useCallback(async () => {
    if (!session || !account) return;
    setWorld(await loadWorld(session.hub, session.chain, account, session.params));
  }, [session, account]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // The clock ticks every second; the chain is re-read every few seconds for countdowns, vesting and quotes.
  useEffect(() => {
    const clockTimer = setInterval(() => setTick((n) => n + 1), 1000);
    const dataTimer = setInterval(() => refresh(), 5000);
    return () => {
      clearInterval(clockTimer);
      clearInterval(dataTimer);
    };
  }, [refresh]);

  const act = useCallback(
    async (success, fn, args, value = 0n) => {
      setBusy(true);
      try {
        await transact(session, account, fn, args, value);
        toast(success);
        await refresh();
        return true;
      } catch (e) {
        toast(explain(e), "error");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [session, account, refresh],
  );

  const onWarp = async (seconds) => {
    session.chain.warp(seconds);
    await recordPrices(session, session.chain.now());
    await refresh();
    toast(`Le temps avance de ${f.duration(seconds)}.`);
  };

  if (bootError) return html`<div class="boot"><p>${bootError}</p><button class="btn" onClick=${() => { setBootError(null); start(bootDemo); }}>Revenir à la démo</button></div>`;
  if (!session || !world)
    return html`<div class="boot"><p class="boot-mark">CC</p><p>Démarrage de la chaîne et des contrats dans ton navigateur…</p></div>`;

  const world2 = { ...world, now: session.chain.now() };
  const ctx = { session, world: world2, account, setAccount, act, busy, refresh, route };
  const canConnect = Boolean(globalThis.ethereum) && Object.keys(DEPLOYMENTS).length > 0 && session.chain.kind === "local";
  let page;
  if (route.startsWith("meme-")) page = html`<${MemePage} address=${route.slice(5)} />`;
  else if (route.startsWith("lancer")) page = html`<${Launch} parentHint=${route.slice(7) || null} />`;
  else if (route === "unions") page = html`<${Unions} />`;
  else if (route === "portefeuille") page = html`<${Portfolio} />`;
  else if (route === "regles") page = html`<${Rules} />`;
  else page = html`<${Explorer} />`;

  return html`<${App.Provider} value=${ctx}>
    <${TopBar} onWarp=${onWarp} onReset=${() => start(bootDemo)} onConnect=${() => start(bootWallet)} canConnect=${canConnect} />
    ${session.chain.kind === "local" && html`<p class="demo-note">Démo : les contrats tournent dans ton navigateur, avec de l'ETH fictif. Les memes déjà présents sont des exemples.</p>`}
    <main>${page}</main>
    <footer class="foot">
      <p>Hub ${f.shortAddress(session.hub.address)} · ouverture ${f.duration(session.params.openWindow)} · vesting ${f.duration(session.params.vestWindow)} · part de pic ${f.percent(session.params.spikeShareBps / 10000, 0)} · code non audité, prototype de recherche.</p>
    </footer>
    <${Toasts} toasts=${toasts} />
  </${App.Provider}>`;
}

render(html`<${Root} />`, document.getElementById("app"));
