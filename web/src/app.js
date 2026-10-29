import { render } from "preact";
import { useState, useEffect, useRef, useCallback } from "preact/hooks";
import { ZeroAddress } from "ethers";
import { LocalChain, WalletChain } from "./chain.js";
import { Hub, explain } from "./hub.js";
import { loadWorld, activityFrom } from "./world.js";
import { seed, DEMO_ACCOUNTS, SEED_SPAN } from "./seed.js";
import { DEPLOYMENTS } from "./deployments.js";
import * as f from "./format.js";
import * as I from "./icons.js";
import { html, installTooltip, Avatar, Popover, Skeleton, compact } from "./ui.js";
import { App, Market, MemePage, Launch, Unions, Portfolio, Rules } from "./pages.js";

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
  ["rules", "Rules", I.Book],
];
// Links shared before the site went English keep working.
const OLD_ROUTES = { explorer: "market", lancer: "launch", portefeuille: "portfolio", regles: "rules" };

// ------------------------------------------------------------------ sessions

async function readParams(hub) {
  return {
    openWindow: Number(await hub.read("openWindow")),
    vestWindow: Number(await hub.read("vestWindow")),
    spikeShareBps: Number(await hub.read("spikeShareBps")),
    unionWindow: Number(await hub.read("unionWindow")),
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

async function transact(session, from, fn, args = [], value = 0n) {
  const { hub, cache } = session;
  const res = await hub.write(from, fn, args, value);
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
  const chain = await LocalChain.create(DEMO_ACCOUNTS);
  chain.startChain -= SEED_SPAN + 40; // the example history ends about now
  const hub = await Hub.deploy(chain, chain.accounts[0].address, DEMO_PARAMS);
  const session = newSession(chain, hub, "Demo");
  const accountOf = (name) => chain.accounts.find((a) => a.name === name).address;
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
  return session;
}

async function bootWallet() {
  const chain = await WalletChain.connect(DEPLOYMENTS);
  const deployment = DEPLOYMENTS[String(chain.chainId)];
  if (!deployment) throw new Error("Community Coin is not deployed on your wallet's network.");
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

// ------------------------------------------------------------------ shell

function Toolbar({ session, world, account, setAccount, onWarp, onReset, onConnect, canConnect, busy, route }) {
  const [menu, setMenu] = useState(false);
  const local = session.chain.kind === "local";
  const section = route.startsWith("meme-") ? "market" : route.startsWith("launch") ? "launch" : route;
  const me = session.chain.accounts.find((a) => a.address === account);
  useEffect(() => setMenu(false), [route]);
  useEffect(() => {
    if (!menu) return;
    const esc = (e) => e.key === "Escape" && setMenu(false);
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [menu]);
  const time = f.clock(world.now);

  return html`<header class="top">
    <div class="top-inner">
      <a class="brand" href="#market"><span class="brand-mark" aria-hidden="true">CC</span><span>Community Coin</span></a>
      <nav class="tabs" aria-label="Pages">
        ${PAGES.map(([r, label, Icon]) => html`<a key=${r} href=${`#${r}`} aria-current=${section === r ? "page" : null}><${Icon} size=${16} />${label}</a>`)}
      </nav>
      <div class="pills">
        <span class="pill pill-static" data-tip=${local ? "Demo\nThe contracts run in your browser, with play ETH" : `${session.label}\nHub ${session.hub.address}`}>
          <i class=${`dot ${local ? "dot-demo" : "dot-live"}`}></i>${session.label}
        </span>
        ${local
          ? html`<${Popover} label="Demo clock" class="clock" trigger=${html`<${I.Clock} size=${16} /><span class="tnum">${time}</span><${I.Chevron} size=${14} />`}>
              <p class="menu-title">Skip ahead</p>
              ${WARPS.map(([s, l]) => html`<button key=${s} type="button" role="menuitem" data-close disabled=${busy} onClick=${() => onWarp(s)}>${l}</button>`)}
              <hr />
              <button type="button" role="menuitem" data-close onClick=${onReset}>Restart demo</button>
            </${Popover}>`
          : html`<span class="pill pill-static"><${I.Clock} size=${16} /><span class="tnum">${time}</span></span>`}
        <${Popover} label="Account" class="account" trigger=${html`<${Avatar} symbol=${me?.name ?? "?"} hue=${5} size="sm" /><span class="account-name">${me?.name}</span><span class="tnum muted">${compact(f.toNumber(world.ethBalance), 4)} ETH</span><${I.Chevron} size=${14} />`}>
          ${session.chain.accounts.map((a) => html`<button key=${a.address} type="button" role="menuitemradio" aria-checked=${a.address === account} data-close onClick=${() => setAccount(a.address)}>
            <${Avatar} symbol=${a.name} hue=${5} size="sm" />${a.name}${a.address === account && html`<${I.Check} size=${16} class="menu-check" />`}
          </button>`)}
          ${canConnect && html`<hr /><button type="button" role="menuitem" data-close onClick=${onConnect}>Connect wallet</button>`}
        </${Popover}>
        <button type="button" class="pill menu-button" aria-expanded=${menu} aria-controls="phone-menu" onClick=${() => setMenu(!menu)}>
          ${menu ? html`<${I.Close} size=${16} />` : html`<${I.Menu} size=${16} />`}Menu
        </button>
      </div>
    </div>
    ${menu && html`<div class="phone-menu" id="phone-menu" onClick=${(e) => e.target === e.currentTarget && setMenu(false)}>
      <nav class="menu-grid" aria-label="Pages">
        ${PAGES.map(([r, label, Icon]) => html`<a key=${r} href=${`#${r}`} aria-current=${section === r ? "page" : null}><${Icon} size=${22} /><span>${label}</span></a>`)}
      </nav>
    </div>`}
  </header>`;
}

function Toasts({ toasts }) {
  return html`<div class="toasts" role="status" aria-live="polite">
    ${toasts.map((t) => html`<p key=${t.id} class=${`toast ${t.kind}`}>${t.kind === "ok" && html`<${I.Check} size=${16} />`}${t.text}</p>`)}
  </div>`;
}

/** Loading: blocks the size of the market page, so nothing jumps when the numbers land. */
function BootSkeleton() {
  return html`<div class="boot">
    <header class="top"><div class="top-inner"><span class="brand"><span class="brand-mark" aria-hidden="true">CC</span><span>Community Coin</span></span></div></header>
    <main><div class="page">
      <div class="page-head"><h1>Market</h1></div>
      <div class="kpis">${[0, 1, 2, 3].map((i) => html`<div class="card kpi" key=${i}><${Skeleton} lines=${2} /></div>`)}</div>
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
  const [, setTick] = useState(0);
  const route = useRoute();
  const toastId = useRef(0);
  const loadSeq = useRef(0);

  const toast = useCallback((text, kind = "ok") => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 6000 : 3000);
  }, []);

  const start = useCallback(async (boot) => {
    setWorld(null);
    setBootError(null);
    try {
      const s = await boot();
      setSession(s);
      setAccount(s.chain.accounts[0].address);
    } catch (e) {
      setBootError(explain(e));
    }
  }, []);

  useEffect(() => {
    installTooltip();
    start(bootDemo);
  }, []);

  // A newer load always wins: an answer for an account or state no longer shown is dropped.
  const refresh = useCallback(async () => {
    if (!session || !account) return;
    const seq = ++loadSeq.current;
    try {
      const w = await loadWorld(session.hub, session.chain, account, session.params);
      if (seq === loadSeq.current) {
        setWorld(w);
        setRefreshError(false);
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
    await snapshot(session, session.chain.now());
    await refresh();
    toast(`+${f.duration(seconds)}`);
  };

  if (bootError)
    return html`<div class="boot-error card panel"><p>${bootError}</p><button class="btn" onClick=${() => start(bootDemo)}>Back to the demo</button></div>`;
  if (!session || !world) return html`<${BootSkeleton} />`;

  const live = { ...world, now: session.chain.now() };
  const ctx = { session, world: live, account, setAccount, act, busy, refresh, route };
  const canConnect = Boolean(globalThis.ethereum) && Object.keys(DEPLOYMENTS).length > 0 && session.chain.kind === "local";
  let page;
  if (route.startsWith("meme-")) page = html`<${MemePage} address=${route.slice(5)} />`;
  else if (route.startsWith("launch")) page = html`<${Launch} parentHint=${route.slice(7) || null} />`;
  else if (route === "unions") page = html`<${Unions} />`;
  else if (route === "portfolio") page = html`<${Portfolio} />`;
  else if (route === "rules") page = html`<${Rules} />`;
  else page = html`<${Market} />`;

  return html`<${App.Provider} value=${ctx}>
    <${Toolbar} session=${session} world=${live} account=${account} setAccount=${setAccount} onWarp=${onWarp} busy=${busy} route=${route}
      onReset=${() => start(bootDemo)} onConnect=${() => start(bootWallet)} canConnect=${canConnect} />
    ${refreshError && html`<p class="page-note" role="alert">Showing the last data: reading the chain failed, retrying in 5s.</p>`}
    <main>${page}</main>
    <footer class="foot">
      <span>Hub ${session.explorer
        ? html`<a href=${`${session.explorer}/address/${session.hub.address}`} target="_blank" rel="noopener">${f.shortAddress(session.hub.address)}</a>`
        : f.shortAddress(session.hub.address)}</span>
      <span>Opening ${f.duration(session.params.openWindow)}</span>
      <span>Vesting ${f.duration(session.params.vestWindow)}</span>
      <span>Spike share ${f.percent(session.params.spikeShareBps / 10000, 0)}</span>
      <span>Unaudited</span>
    </footer>
    <${Toasts} toasts=${toasts} />
  </${App.Provider}>`;
}

render(html`<${Root} />`, document.getElementById("app"));
