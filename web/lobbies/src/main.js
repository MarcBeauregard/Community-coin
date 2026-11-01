// Lobbies app: Discover, Lobby, Launch and Clan on one demo store, with the phone layout below 900 px.
// URL: #/discover, #/lobby, #/launch, #/clan. `?scene=<name>` seeds a state and `?freeze` stops the clock
// (screenshots and tests); see demo/store.js for the scenes. `?live=<server>` plays the lobby on the realtime server.

import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { html, IconButton, Avatar, Toast } from "./ui.js";
import * as I from "./icons.js";
import { phoneBreakpoint } from "./tokens.js";
import { createStore } from "./demo/store.js";
import { guestSession, devSession } from "./realtime/client.js";
import { person, SPEAKERS, FEATURED } from "./demo/data.js";
import { Discover } from "./screens/discover.js";
import { Lobby, VoicePill } from "./screens/lobby.js";
import { Launch } from "./screens/launch.js";
import { Clan } from "./screens/clan.js";
import { Sheets } from "./screens/sheets.js";

const params = new URLSearchParams(location.search);
const store = createStore({ scene: params.get("scene"), freeze: params.has("freeze") });
// A link to a screen opens on it (#/lobby, #/clan); #/launch only once there is a launch to show.
{
  const screen = location.hash.replace("#/", "");
  if (screen === "lobby" || (screen === "launch" && store.get().launched)) store.actions.go({ screen });
  else if (screen === "launch" && params.get("live")) { store.actions.go({ screen: "lobby" }); store.actions.wantScreen("launch"); }
  // Live, the clan is known only once the server has answered: it opens then (store.js), never the demo's first.
  else if (screen === "clan" && params.get("live")) store.actions.wantScreen("clan");
  else if (screen === "clan") store.actions.openClan(store.get().clan);
}
// ?live=<server> joins the realtime server as a guest; connecting a wallet signs in with it (Sign-In With Solana).
// `?rpc=<url>` reads the connected wallet's real balance from that cluster.
if (params.get("rpc")) store.actions.setRpc(params.get("rpc"));
if (params.get("live")) {
  const base = params.get("live");
  // `&as=<name>` signs in as that wallet on a server started with --dev-sessions (tests, local development).
  (params.get("as") ? devSession(base, params.get("as")) : guestSession(base))
    .then((token) => {
      store.actions.goLive({ base, lobby: FEATURED.id === "fnd" ? 412 : FEATURED.id, token });
      if (!params.get("as")) store.actions.restoreWallet();
    })
    .catch((e) => console.error(e.message));
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
        <span style="font-size:12px;color:var(--sky)">${FEATURED.name} · stage · tap to open</span>
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
    const where = { discover: "Lobbies", lobby: FEATURED.name, launch: s.launched ? `$${s.launched.id.toUpperCase()} launched` : "Launch", clan: clan ? `$${clan.ticker} clan` : "Clans" }[s.route.screen];
    document.title = `${where} · Community Coin`;
  }, [s.route.screen, s.clan, !!s.launched]);
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

  const screen = s.route.screen === "launch" && !s.launched ? "discover" : s.route.screen;
  const showTabs = phone && (screen === "discover" || (screen === "clan" && s.clanView === "list"));
  return html`<div class=${phone ? "app phone" : "app"} data-balance=${s.balance}>
    ${screen === "discover" && html`<${Discover} s=${s} a=${a} phone=${phone} />`}
    ${screen === "lobby" && html`<${Lobby} s=${s} a=${a} phone=${phone} />`}
    ${screen === "launch" && html`<${Launch} s=${s} a=${a} phone=${phone} />`}
    ${screen === "clan" && html`<${Clan} s=${s} a=${a} phone=${phone} />`}
    ${s.voice.listening && screen === "discover" && !s.live && html`<${MiniPlayer} s=${s} a=${a} />`}
    ${s.voice.listening && screen !== "lobby" && s.live && html`<${VoicePill} s=${s} a=${a} onOpen=${() => { a.go({ screen: "lobby" }); a.setLobbyTab("stage"); }} />`}
    ${showTabs && html`<${TabBar} s=${s} a=${a} />`}
    <${Sheets} s=${s} a=${a} />
    <${Toast} toast=${s.toast} />
  </div>`;
}

render(html`<${App} />`, document.getElementById("app"));
