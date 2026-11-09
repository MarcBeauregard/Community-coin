// Lobbies app: Discover, Lobby, Launch and Clan on one demo store, with the phone layout below 900 px.
// URL: #/discover, #/lobby, #/launch, #/clan. `?scene=<name>` seeds a state and `?freeze` stops the clock
// (screenshots and tests); see demo/store.js for the scenes. `?live=<server>` plays the lobby on the realtime server.

import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { html, IconButton, Avatar, Toast } from "./ui.js";
import { netState, lobbyInfo } from "./demo/select.js";
import { NetBanner } from "./screens/net.js";
import * as I from "./icons.js";
import { phoneBreakpoint } from "./tokens.js";
import { createStore } from "./demo/store.js";
import { guestSession, devSession } from "./realtime/client.js";
import { person, SPEAKERS } from "./demo/data.js";
import { Discover } from "./screens/discover.js";
import { Lobby, VoicePill } from "./screens/lobby.js";
import { Launch } from "./screens/launch.js";
import { Clan } from "./screens/clan.js";
import { Sheets } from "./screens/sheets.js";

const params = new URLSearchParams(location.search);
// A server that serves the app itself says so (`<meta name="lobby-server" content="same-origin">`): the app plays live there.
const served = document.querySelector('meta[name="lobby-server"]')?.content === "same-origin" ? location.origin : null;
// A served page belongs to its server. Its address may name a lobby (`?lobby=`) and, for tests, a wallet (`&as=`,
// refused by a server without --dev-sessions); nothing in it can point the page at another server or cluster, or
// dress it up as a scene of the demo: a link to the real address always opens the real thing.
const param = (k) => (served && k !== "lobby" && k !== "as" ? null : params.get(k));
const liveBase = served ?? params.get("live");
const store = createStore({ scene: param("scene"), freeze: !served && params.has("freeze"), live: !!liveBase });
// A link to a screen opens on it (#/lobby, #/clan); #/launch only once there is a launch to show.
{
  const screen = location.hash.replace("#/", "");
  if (screen === "lobby" || (screen === "launch" && store.get().launched)) store.actions.go({ screen });
  else if (screen === "launch" && liveBase) { store.actions.go({ screen: "lobby" }); store.actions.wantScreen("launch"); }
  // Live, the clan is known only once the server has answered: it opens then (store.js), never the demo's first.
  else if (screen === "clan" && liveBase) store.actions.wantScreen("clan");
  else if (screen === "clan") store.actions.openClan(store.get().clan);
}
// ?live=<server> joins the realtime server as a guest; connecting a wallet signs in with it (Sign-In With Solana).
// `?rpc=<url>` reads the connected wallet's real balance from that cluster.
if (param("rpc")) store.actions.setRpc(param("rpc"));
// The lobby: `&lobby=<id>`, else the one the server says is on now.
async function pickLobby(base) {
  if (param("lobby")) return param("lobby");
  const { current } = await (await fetch(`${base}/lobbies`)).json();
  if (current === null || current === undefined) throw new Error("No lobby on this server yet");
  return current;
}
if (liveBase) {
  const base = liveBase;
  // `&as=<name>` signs in as that wallet on a server started with --dev-sessions (tests, local development).
  const as = param("as");
  // Getting in takes a session and the lobby that is on. A server that is waking up, busy or out of reach is asked
  // again, a little later each time; until it answers the page says so, and shows no lobby at all (see Opening).
  (async () => {
    for (let wait = 1000; ; wait = Math.min(wait * 2, 15000)) {
      try {
        const token = await (as ? devSession(base, as) : guestSession(base));
        store.actions.goLive({ base, lobby: await pickLobby(base), token });
        if (!as) store.actions.restoreWallet();
        return;
      } catch (e) {
        console.error(e.message);
        store.actions.entering(false);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  })();
} else {
  store.actions.restoreWallet();
}
const SCREENS = ["discover", "lobby", "launch", "clan"];

function usePhone() {
  const query = `(max-width: ${phoneBreakpoint - 1}px)`;
  const [phone, setPhone] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setPhone(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}

function MiniPlayer({ s, a }) {
  const spk = SPEAKERS[s.beat % 4 === 3 ? 2 : s.beat % 4 === 2 ? 0 : 1];
  return html`<div class="miniplayer glass" role="region" aria-label="Now listening">
    <button type="button" class="open" onClick=${() => a.go({ screen: s.launched ? "launch" : "lobby" })}>
      <${Avatar} person=${person(spk)} size=${40} speaking />
      <span style="flex:1;min-width:0;display:flex;flex-direction:column">
        <span class="ellipsis" style="font-size:14px;font-weight:600">${spk} is speaking</span>
        <span style="font-size:12px;color:var(--sky)">${lobbyInfo(s).name} · stage · tap to open</span>
      </span>
    </button>
    <${IconButton} label="Stop listening" tone="danger" size="sm" onClick=${a.toggleListen}><${I.Close} size=${14} /></${IconButton}>
  </div>`;
}

function TabBar({ s, a }) {
  const tab = (id, label, icon, onClick, current) => html`<button type="button" class="tab" aria-current=${current ? "page" : undefined} onClick=${onClick}>${icon}${label}</button>`;
  return html`<nav class="tabbar glass" aria-label="Tabs">
    ${tab("discover", "Lobbies", html`<${I.Logo} size=${24} />`, () => a.go({ screen: "discover" }), s.route.screen === "discover")}
    ${tab("clan", "Clans", html`<${I.Chat} size=${24} />`, () => a.openClan(s.clan), s.route.screen === "clan")}
    ${tab("wallet", s.wallet.status === "connected" ? "Wallet" : "Connect", html`<${I.Wallet} size=${24} />`, () => (s.wallet.status === "connected" ? a.openSheet("wallet") : a.openConnect()), false)}
  </nav>`;
}

// Live, until the lobby's server has answered: its name and nothing else. Never the demo's lobby, which would read
// as a real one at a real address.
function Opening({ net }) {
  const k = netState(net);
  const text = k === "offline" ? "You’re offline. The lobby opens when you’re back."
    : k === "gone" ? "This lobby isn’t open on this server. Reload the page to join the one that is."
    : k === "down" ? "Can’t reach the lobby server. Still trying."
    : "Opening the lobby…";
  return html`<main class="opening">
    <${I.Logo} size=${40} />
    <h1 class="display" style="font-size:24px">Social Launch</h1>
    <p role="status" class="t2" style="font-size:15px;line-height:1.5;text-align:center;max-width:320px">${text}</p>
  </main>`;
}

function App() {
  const [s, setS] = useState(store.get());
  const phone = usePhone();
  const a = store.actions;
  useEffect(() => {
    const off = store.subscribe(setS);
    store.start();
    return () => { off(); store.stop(); };
  }, []);
  // A new screen takes the focus on its heading, so keyboard and screen-reader users start there (not on the page).
  const firstScreen = useRef(true);
  useEffect(() => {
    if (firstScreen.current) { firstScreen.current = false; return; }
    const h = document.querySelector(".screen h1, h1");
    if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
  }, [s.route.screen, s.clanView]);
  // The tab's title says where the person is.
  useEffect(() => {
    const clan = s.clans.find((c) => c.id === s.clan);
    if (liveBase && !s.live) { document.title = "Social Launch"; return; }
    const where = { discover: "Lobbies", lobby: lobbyInfo(s).name, launch: s.launched ? `$${s.launched.id.toUpperCase()} launched` : "Launch", clan: clan ? `$${clan.ticker} clan` : "Clans" }[s.route.screen];
    document.title = `${where} · Social Launch`;
  }, [s.route.screen, s.clan, !!s.launched, !!s.live]);
  // The address follows the screen, and the back button walks it.
  useEffect(() => {
    const want = `#/${s.route.screen}`;
    if (location.hash !== want) history.pushState(null, "", `${location.search}${want}`);
  }, [s.route.screen]);
  useEffect(() => {
    const onPop = () => {
      const screen = location.hash.replace("#/", "");
      if (!SCREENS.includes(screen)) return;
      if (screen === "launch" && !store.get().launched) return;
      if (screen === "clan") a.openClan(store.get().clan); else a.go({ screen });
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  if (liveBase && !s.live) return html`<div class="app"><${Opening} net=${s.net} /></div>`;
  const screen = s.route.screen === "launch" && !s.launched ? "discover" : s.route.screen;
  const showTabs = phone && (screen === "discover" || (screen === "clan" && s.clanView === "list"));
  return html`<div class=${`${phone ? "app phone" : "app"}${netState(s.net) ? " net-on" : ""}`} data-balance=${s.balance}>
    ${screen === "discover" && html`<${Discover} s=${s} a=${a} phone=${phone} />`}
    ${screen === "lobby" && html`<${Lobby} s=${s} a=${a} phone=${phone} />`}
    ${screen === "launch" && html`<${Launch} s=${s} a=${a} phone=${phone} />`}
    ${screen === "clan" && html`<${Clan} s=${s} a=${a} phone=${phone} />`}
    ${s.voice.listening && screen === "discover" && !s.live && html`<${MiniPlayer} s=${s} a=${a} />`}
    ${s.voice.listening && screen !== "lobby" && s.live && html`<${VoicePill} s=${s} a=${a} onOpen=${() => { a.go({ screen: "lobby" }); a.setLobbyTab("stage"); }} />`}
    ${showTabs && html`<${TabBar} s=${s} a=${a} />`}
    <${Sheets} s=${s} a=${a} />
    ${screen !== "lobby" && html`<${NetBanner} net=${s.net} pledged=${!!s.pledge} />`}
    <${Toast} toast=${s.toast} />
  </div>`;
}

render(html`<${App} />`, document.getElementById("app"));
