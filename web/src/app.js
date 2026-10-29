import { render } from "preact";
import { useState, useEffect, useRef, useCallback } from "preact/hooks";
import { ZeroAddress } from "ethers";
import { LocalChain, WalletChain } from "./chain.js";
import { Hub, explain } from "./hub.js";
import { loadWorld, activityFrom } from "./world.js";
import { seed, DEMO_ACCOUNTS, DEMO_PROTOCOL_FEE_BPS, SEED_SPAN } from "./seed.js";
import { DEPLOYMENTS } from "./deployments.js";
import * as f from "./format.js";
import * as I from "./icons.js";
import { html, installTooltip, Avatar, Coin, Defs, Popover, Skeleton, compact } from "./ui.js";
import { App, Market, MemePage, Launch, Unions, Portfolio, memeHref } from "./pages.js";
import { HowItWorks, DemoNote } from "./learn.js";
import { Tour, planTour } from "./tour.js";

const DEMO_PARAMS = [300, 3600, 5000, 3 * 24 * 3600]; // opening, vesting, spike share (bps), union vote
const WARPS = [
  [300, "5 min"],
  [3600, "1 hour"],
  [86400, "1 day"],
  [3 * 86400, "3 days"],
];
const PAGES = [
  ["market", "Market", I.Market],
  ["launch", "Launch", I.Launch],
  ["unions", "Unions", I.Merge],
  ["portfolio", "Portfolio", I.Wallet],
  ["how", "How it works", I.Book],
];
// Links shared before the site went English, or before Rules became How it works, keep working.
const OLD_ROUTES = { explorer: "market", lancer: "launch", portefeuille: "portfolio", regles: "how", rules: "how" };

// ------------------------------------------------------------------ sessions

async function readParams(hub) {
  return {
    openWindow: Number(await hub.read("openWindow")),
    vestWindow: Number(await hub.read("vestWindow")),
    spikeShareBps: Number(await hub.read("spikeShareBps")),
    unionWindow: Number(await hub.read("unionWindow")),
    protocolFeeBps: Number(await hub.read("protocolFeeBps")),
    feeRecipient: await hub.read("feeRecipient"),
  };
}

/** Everything that is not React state: chain, hub, caches, activity and the recorded history. */
function newSession(chain, hub, label) {
  return { chain, hub, label, cache: new Map(), unionMemes: new Map(), activity: [], history: new Map(), pulse: [] };
}

/**
 * Records, at time `t`, each meme's price and reference (ETH per million tokens) and reserve, and the ETH locked
 * across all roots. These points give every headline number its "compared to an hour ago".
 */
async function snapshot(session, t) {
  const { hub, cache, history, pulse } = session;
  let locked = 0n;
  for (const [token, c] of cache) {
    const s = await hub.read("memes", [token]);
    const reserve = s.vQuote - s.floor;
    if (c.parent === ZeroAddress) locked += s.settled ? reserve : s.batchQuote;
    let p, price, ref;
    try {
      p = await hub.read("priceInEth", [token]);
      price = await hub.read("priceOf", [token]);
      ref = await hub.read("referencePrice", [token]);
    } catch {
      continue; // still in its opening: no market price yet
    }
    const refEth = price > 0n ? (ref * p) / price : 0n;
    const points = history.get(token) ?? [];
    if (points.length && points.at(-1).t === t) points.pop();
    points.push({ t, p: f.toNumber(p) * 1e6, r: f.toNumber(refEth) * 1e6, res: f.toNumber(reserve) });
    history.set(token, points);
  }
  if (pulse.length && pulse.at(-1).t === t) pulse.pop();
  pulse.push({ t, locked });
}

const MOVES_PRICES = new Set(["Trade", "Settled", "UnionExecuted"]);

async function transact(session, from, fn, args = [], value = 0n, hooks) {
  const { hub, cache } = session;
  const res = await hub.write(from, fn, args, value, hooks);
  for (const e of res.events) {
    if (e.name === "Launched") cache.set(e.args.token, { symbol: e.args.symbol, parent: e.args.parent });
    if (e.name === "UnionExecuted") cache.get(e.args.meme).parent = e.args.target;
    if (e.name === "UnionProposed") session.unionMemes.set(Number(e.args.id), e.args.meme);
  }
  const rows = activityFrom(res.events, {
    fn,
    actor: from,
    timestamp: res.timestamp,
    cache,
    unionMeme: (id) => session.unionMemes.get(Number(id)),
  });
  session.activity.unshift(...rows.reverse());
  session.activity.length = Math.min(session.activity.length, 400);
  if (res.events.some((e) => MOVES_PRICES.has(e.name))) await snapshot(session, res.timestamp);
  return res;
}

async function bootDemo() {
  performance.mark("cc:boot");
  const chain = await LocalChain.create(DEMO_ACCOUNTS);
  chain.startChain -= SEED_SPAN + 40; // the example history ends about now
  const accountOf = (name) => chain.accounts.find((a) => a.name === name).address;
  const hub = await Hub.deploy(chain, chain.accounts[0].address, [...DEMO_PARAMS, DEMO_PROTOCOL_FEE_BPS, accountOf("Treasury")]);
  const session = newSession(chain, hub, "Demo");
  await seed({
    hub,
    accountOf,
    run: (actor, fn, args, value) => transact(session, accountOf(actor), fn, args, value),
    warp: async (s) => {
      chain.warp(s);
      await snapshot(session, chain.now());
    },
  });
  session.params = await readParams(hub);
  performance.mark("cc:seeded");
  return session;
}

async function bootWallet() {
  const chain = await WalletChain.connect(DEPLOYMENTS);
  const deployment = DEPLOYMENTS[String(chain.chainId)];
  if (!deployment) {
    const names = Object.values(DEPLOYMENTS).map((d) => d.name).join(" or ");
    throw new Error(`Community Coin is not deployed on your wallet's network. Switch your wallet to ${names} and connect again.`);
  }
  const hub = new Hub(chain, deployment.hub);
  const session = newSession(chain, hub, deployment.name);
  session.explorer = deployment.explorer;
  session.params = await readParams(hub);
  const count = Number(await hub.read("memeCount"));
  for (let i = 0; i < count; i++) {
    const token = await hub.read("allMemes", [i]);
    const s = await hub.read("memes", [token]);
    session.cache.set(token, { symbol: await hub.token(token, "symbol"), parent: s.parent });
  }
  const unions = Number(await hub.read("unionCount"));
  for (let id = 0; id < unions; id++) session.unionMemes.set(id, (await hub.read("unions", [id])).meme);
  await snapshot(session, chain.now());
  return session;
}

// ------------------------------------------------------------------ routing

function useRoute() {
  const read = () => {
    const [head, ...rest] = (location.hash.slice(1) || "market").split("-");
    return [OLD_ROUTES[head] ?? head, ...rest].join("-");
  };
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

// ------------------------------------------------------------------ theme

// Dark is the house look; a viewer who picks light keeps it. A theme set by the page's host (data-theme) wins.
const THEME_KEY = "community-coin-theme";
function initialTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch {}
  return saved === "light" || saved === "dark" ? saved : document.documentElement.dataset.theme || "dark";
}
function useTheme() {
  const [theme, setTheme] = useState(initialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const toggle = () =>
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {}
      return next;
    });
  return [theme, toggle];
}

// ------------------------------------------------------------------ shell

const TICK_KINDS = { buy: ["Buy", "up"], sell: ["Sell", "down"], commit: ["Commit", "accent"], launch: ["Launch", "accent"], union: ["Union", "accent"] };

/** The tape: the latest trades scrolling under the toolbar, paused on hover, still for viewers who ask for less motion. */
function Ticker({ session, world }) {
  const rows = session.activity.filter((r) => TICK_KINDS[r.kind] && world.memes.get(r.token)).slice(0, 14);
  if (rows.length < 4) return null;
  const roots = [...world.memes.values()].filter((m) => !m.parent).map((m) => m.address);
  const nameOf = (a) => session.chain.accounts.find((x) => x.address === a)?.name ?? f.shortAddress(a);
  const amount = (a) => (!a ? "" : a.unit === "ETH" ? `${compact(f.toNumber(a.wei))} ETH` : `${f.tokens(a.wei)} ${a.unit}`);
  const items = (copy) =>
    rows.map((r, i) => {
      const m = world.memes.get(r.token);
      const [label, tone] = TICK_KINDS[r.kind];
      return html`<a key=${`${copy}-${i}`} class="tick" href=${memeHref(m.address)} tabindex="-1">
        <${Coin} symbol=${m.symbol} hue=${Math.max(0, roots.indexOf(m.root))} depth=${m.depth} size="sm" />
        <b>${m.symbol}</b><span class=${`tick-kind ${tone}`}>${label}</span><span class="tnum">${amount(r.in ?? r.out)}</span>
        <span class="muted">${nameOf(r.actor)}</span>
      </a>`;
    });
  // Decoration for the eye: the same trades are in the Activity table, so the tape stays out of the tab order and
  // out of screen readers.
  return html`<div class="ticker" aria-hidden="true">
    <div class="ticker-track">
      <div class="ticker-group">${items(0)}</div>
      <div class="ticker-group">${items(1)}</div>
    </div>
  </div>`;
}

function Toolbar({ session, world, account, setAccount, onWarp, onReset, onConnect, onTour, canConnect, busy, section, theme, onTheme }) {
  const local = session.chain.kind === "local";
  const me = session.chain.accounts.find((a) => a.address === account);
  const time = f.clock(world.now);
  return html`<header class="top">
    <a class="skip" href="#main">Skip to content</a>
    <div class="top-inner">
      <a class="brand" href="#market"><${Coin} symbol="CC" hue=${0} size="md" /><span>Community Coin</span></a>
      <nav class="tabs" aria-label="Pages">
        ${PAGES.map(([r, label, Icon]) => html`<a key=${r} href=${`#${r}`} aria-current=${section === r ? "page" : null}><${Icon} size=${16} />${label}</a>`)}
      </nav>
      <div class="pills">
        <span class="pill pill-static" tabindex="0" data-tip=${local ? "Demo\nThe real contracts run in your browser, with play ETH" : `${session.label}\nHub ${session.hub.address}`}>
          <i class=${`dot ${local ? "dot-demo" : "dot-live"}`}></i>${session.label}
        </span>
        ${local
          ? html`<${Popover} label="Demo clock" class="clock" trigger=${html`<${I.Clock} size=${16} /><span class="tnum">${time}</span><${I.Chevron} size=${14} />`}>
              <p class="menu-title">Skip ahead</p>
              ${WARPS.map(([s, l]) => html`<button key=${s} type="button" role="menuitem" data-close disabled=${busy} onClick=${() => onWarp(s)}>${l}</button>`)}
              <hr />
              <button type="button" role="menuitem" data-close onClick=${onTour}>Start the tour</button>
              <button type="button" role="menuitem" data-close onClick=${onReset}>Restart demo</button>
            </${Popover}>`
          : html`<span class="pill pill-static"><${I.Clock} size=${16} /><span class="tnum">${time}</span></span>`}
        <button type="button" class="pill theme-toggle" aria-label=${theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} onClick=${onTheme}>
          ${theme === "dark" ? html`<${I.Sun} size=${16} />` : html`<${I.Moon} size=${16} />`}
        </button>
        <${Popover} label="Account" class="account" trigger=${html`<${Avatar} symbol=${me?.name ?? "?"} size="sm" /><span class="account-name">${me?.name}</span><span class="tnum muted">${compact(f.toNumber(world.ethBalance), 4)} ETH</span><${I.Chevron} size=${14} />`}>
          ${local && html`<p class="menu-title">Play as</p>`}
          ${session.chain.accounts.map((a) => html`<button key=${a.address} type="button" role="menuitemradio" aria-checked=${a.address === account} data-close onClick=${() => setAccount(a.address)}>
            <${Avatar} symbol=${a.name} size="sm" />${a.name}${a.address === account && html`<${I.Check} size=${16} class="menu-check" />`}
          </button>`)}
          ${canConnect && html`<hr /><button type="button" role="menuitem" data-close onClick=${onConnect}>Connect wallet</button>`}
        </${Popover}>
      </div>
    </div>
  </header>`;
}

/** On phones and tablets the pages sit in a bar at the bottom, within reach of the thumb. */
function BottomTabs({ section }) {
  return html`<nav class="bottom-tabs" aria-label="Pages">
    ${PAGES.map(([r, label, Icon]) => html`<a key=${r} href=${`#${r}`} aria-current=${section === r ? "page" : null}><${Icon} size=${20} /><span>${r === "how" ? "Learn" : label}</span></a>`)}
  </nav>`;
}

function Toasts({ toasts }) {
  return html`<div class="toasts" role="status" aria-live="polite">
    ${toasts.map((t) => html`<p key=${t.id} class=${`toast ${t.kind}`}>
      ${t.kind === "ok" && html`<${I.Check} size=${16} />`}${t.kind === "pending" && html`<span class="spinner" aria-hidden="true"></span>`}
      <span>${t.text}</span>${t.href && html`<a href=${t.href} target="_blank" rel="noopener">View on explorer</a>`}
    </p>`)}
  </div>`;
}

/** Loading: blocks the size of the market page, so nothing jumps when the numbers land. */
function BootSkeleton() {
  return html`<div class="boot">
    <header class="top"><div class="top-inner"><span class="brand"><${Coin} symbol="CC" hue=${0} size="md" /><span>Community Coin</span></span></div></header>
    <main><div class="page">
      <div class="page-head"><h1>Market</h1><span class="tagline">Starting the demo chain</span></div>
      <div class="hero">
        <div class="card spotlight"><div class="spot-stage"><span class="skeleton-coin"></span></div><div class="spot-body"><${Skeleton} lines=${4} /></div></div>
        <div class="kpis kpis-grid">${[0, 1, 2, 3].map((i) => html`<div class="card kpi" key=${i}><${Skeleton} lines=${2} /></div>`)}</div>
      </div>
      <div class="grid-12"><div class="card panel span-8"><${Skeleton} lines=${6} /></div><div class="card panel span-4"><${Skeleton} lines=${4} /></div></div>
    </div></main>
  </div>`;
}

function Root() {
  const [session, setSession] = useState(null);
  const [bootError, setBootError] = useState(null);
  const [refreshError, setRefreshError] = useState(false);
  const [account, setAccount] = useState(null);
  const [world, setWorld] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [tour, setTour] = useState(null);
  const [, setTick] = useState(0);
  const route = useRoute();
  const [theme, toggleTheme] = useTheme();
  const toastId = useRef(0);
  const loadSeq = useRef(0);

  /** Shows a toast, or replaces the one with the same id (a wallet transaction moving from pending to done). */
  const toast = useCallback((text, kind = "ok", { id, href, stay } = {}) => {
    const key = id ?? ++toastId.current;
    setToasts((t) => [...t.filter((x) => x.id !== key).slice(-2), { id: key, text, kind, href }]);
    if (!stay) setTimeout(() => setToasts((t) => t.filter((x) => x.id !== key || x.text !== text)), kind === "error" ? 7000 : href ? 6000 : 3000);
    return key;
  }, []);

  const start = useCallback(async (boot) => {
    setWorld(null);
    setBootError(null);
    setTour(null);
    try {
      const s = await boot();
      setSession(s);
      setAccount(s.chain.accounts[0].address);
    } catch (e) {
      setBootError({ text: explain(e), wallet: boot === bootWallet });
    }
  }, []);

  useEffect(() => {
    installTooltip();
    start(bootDemo);
  }, []);

  // End-to-end tests read the chain directly to check what the page shows; only with ?e2e in the address.
  useEffect(() => {
    if (session && new URLSearchParams(location.search).has("e2e")) globalThis.__cc = { session };
  }, [session]);

  // A newer load always wins: an answer for an account or state no longer shown is dropped.
  const refresh = useCallback(async () => {
    if (!session || !account) return;
    const seq = ++loadSeq.current;
    try {
      const w = await loadWorld(session.hub, session.chain, account, session.params);
      if (seq === loadSeq.current) {
        setWorld(w);
        setRefreshError(false);
        if (!performance.getEntriesByName("cc:ready").length) performance.mark("cc:ready");
      }
    } catch {
      if (seq === loadSeq.current) setRefreshError(true);
    }
  }, [session, account]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const clock = setInterval(() => setTick((n) => n + 1), 1000);
    const data = setInterval(() => refresh(), 5000);
    return () => {
      clearInterval(clock);
      clearInterval(data);
    };
  }, [refresh]);

  const tourEvent = (ev) => setTour((t) => (t && t.steps[t.i].done?.(ev) ? { ...t, i: t.i + 1 } : t));

  /** Sends a transaction. Returns its result (events, hash) or null when it failed; the toast says which. */
  const act = useCallback(
    async (success, fn, args, value = 0n) => {
      setBusy(true);
      const wallet = session.chain.kind === "wallet";
      const id = wallet ? toast("Confirm in your wallet", "pending", { stay: true }) : undefined;
      const link = (hash) => (session.explorer && hash ? `${session.explorer}/tx/${hash}` : undefined);
      try {
        const res = await transact(session, account, fn, args, value, {
          onSent: (hash) => toast("Waiting for the network", "pending", { id, href: link(hash), stay: true }),
        });
        toast(success, "ok", { id, href: link(res.hash) });
        await refresh();
        tourEvent({ type: "act", fn });
        return res;
      } catch (e) {
        toast(explain(e), "error", { id });
        return null;
      } finally {
        setBusy(false);
      }
    },
    [session, account, refresh],
  );

  const onWarp = async (seconds) => {
    session.chain.warp(seconds);
    await snapshot(session, session.chain.now());
    await refresh();
    toast(`+${f.duration(seconds)}`);
    tourEvent({ type: "warp", seconds });
  };

  if (bootError)
    return html`<${Defs} /><div class="boot-error card panel">
      <p>${bootError.text}</p>
      <div class="inline-actions">
        ${bootError.wallet && html`<button class="btn" onClick=${() => start(bootWallet)}>Try again</button>`}
        <button class=${`btn ${bootError.wallet ? "btn-quiet" : ""}`} onClick=${() => start(bootDemo)}>Back to the demo</button>
      </div>
    </div>`;
  if (!session || !world) return html`<${Defs} /><${BootSkeleton} />`;

  const live = { ...world, now: session.chain.now() };
  const local = session.chain.kind === "local";
  const startTour = () => local && setTour({ steps: planTour(live), i: 0 });
  const ctx = { session, world: live, account, setAccount, act, busy, refresh, route, startTour };
  const canConnect = Boolean(globalThis.ethereum) && Object.keys(DEPLOYMENTS).length > 0 && local;
  const section = route.startsWith("meme-") ? "market" : route.startsWith("launch") ? "launch" : route.startsWith("how") ? "how" : route;
  let page;
  if (route.startsWith("meme-")) page = html`<${MemePage} address=${route.slice(5)} />`;
  else if (route.startsWith("launch")) page = html`<${Launch} parentHint=${route.slice(7) || null} />`;
  else if (route === "unions") page = html`<${Unions} />`;
  else if (route === "portfolio") page = html`<${Portfolio} onTour=${startTour} />`;
  else if (route.startsWith("how")) page = html`<${HowItWorks} section=${route.slice(4) || null} />`;
  else page = html`<${Market} onTour=${startTour} />`;

  return html`<${App.Provider} value=${ctx}>
    <${Defs} />
    <${Toolbar} session=${session} world=${live} account=${account} setAccount=${setAccount} onWarp=${onWarp} busy=${busy} section=${section}
      onReset=${() => start(bootDemo)} onConnect=${() => start(bootWallet)} onTour=${startTour} canConnect=${canConnect} theme=${theme} onTheme=${toggleTheme} />
    <${Ticker} session=${session} world=${live} />
    ${local && html`<${DemoNote} onTour=${startTour} />`}
    ${refreshError && html`<p class="page-note" role="alert">Showing the last data: reading the chain failed, retrying in 5s.</p>`}
    <main id="main" tabindex="-1">${page}</main>
    <footer class="foot">
      <span>Hub ${session.explorer
        ? html`<a href=${`${session.explorer}/address/${session.hub.address}`} target="_blank" rel="noopener">${f.shortAddress(session.hub.address)}</a>`
        : f.shortAddress(session.hub.address)}</span>
      <a href="#how-opening">Opening ${f.duration(session.params.openWindow)}</a>
      <a href="#how-opening">Vesting ${f.duration(session.params.vestWindow)}</a>
      <a href="#how-spike">Spike share ${f.percent(session.params.spikeShareBps / 10000, 0)}</a>
      <a href="#how-limits">Unaudited</a>
    </footer>
    <${BottomTabs} section=${section} />
    ${tour && html`<${Tour} tour=${tour} onNext=${() => setTour((t) => ({ ...t, i: Math.min(t.i + 1, t.steps.length - 1) }))} onClose=${() => setTour(null)} />`}
    <${Toasts} toasts=${toasts} />
  </${App.Provider}>`;
}

render(html`<${Root} />`, document.getElementById("app"));
