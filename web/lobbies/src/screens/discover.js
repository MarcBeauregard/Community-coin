// Discover: the lobby of the hour up front, how a lobby works, the other lobbies of the hour and your clans.

import { html, Button, IconButton, Segmented, Chip, Coin, Avatar, Bar, GestationTimeline, Orbit } from "../ui.js";
import * as I from "../icons.js";
import { ambient } from "../tokens.js";
import { person, coin, PEOPLE, FEATURED } from "../demo/data.js";
import { race, timeline, lobbyClock, lobbyCards, presence } from "../demo/select.js";
import { sol, int, signedPct, ticker } from "../format.js";

const STEPS = [
  { t: "00:00", color: "var(--text)", title: "Gather", body: "The lobby opens on the hour. Everyone drops into voice and chat." },
  { t: "00:05", color: "var(--sky)", title: "Propose", body: "Anyone pitches a coin on stage: name, ticker, art, one line." },
  { t: "00:05 – 00:55", color: "var(--lime)", title: "Pledge", body: "Back the idea you want with SOL. Your pledge is your vote." },
  { t: "01:00", color: "var(--amber)", title: "Launch", body: "The winner mints at one price for all its backers, who become a clan for good." },
];
const FILTERS = [{ id: "all", label: "All" }, { id: "live", label: "Live" }, { id: "soon", label: "Soon" }];
const ROOM = Object.keys(PEOPLE).slice(0, 12).map(person);

export function WalletPill({ s, a }) {
  return html`<${Button} variant="fill" class="wallet-pill" onClick=${() => a.openSheet("wallet")}>
    <${Avatar} person=${person("you")} size=${26} /><span class="num">${sol(s.balance)}</span>
  </${Button}>`;
}

export function heroGlow(hue) {
  return `radial-gradient(70% 90% at 82% 45%, hsla(${hue},90%,58%,.30), transparent 62%), radial-gradient(50% 70% at 0% 100%, hsla(${(hue + 140) % 360},80%,55%,.12), transparent 60%), #0b0b0d`;
}

function Hero({ s, a, phone }) {
  const ideas = race(s);
  const lead = ideas[0];
  const t = lobbyClock(s);
  const pres = presence(s);
  return html`<section class="hero" aria-labelledby="hero-title" style=${{ background: heroGlow(lead.hue) }}>
    <div class="hero-copy">
      <div class="row">
        <${Chip} tone="lime" live>Live</${Chip}>
        <${Chip} tone="neutral">${t.label}</${Chip}>
        ${!phone && html`<span class="t2" style="font-size:13px">Hosted by ${FEATURED.host}</span>`}
      </div>
      <div class="row" style="gap:14px;flex-wrap:nowrap">
        ${phone && html`<${Coin} coin=${coin(lead)} size=${68} class="glow" />`}
        <div style="display:flex;flex-direction:column;gap:12px;min-width:0">
          <h1 id="hero-title" class="display">Friday Night${phone ? " " : html`<br />`}Degens</h1>
          ${phone
            ? html`<span class="t2" style="font-size:13px;margin-top:-8px">${FEATURED.host} · ${FEATURED.theme}</span>`
            : html`<p class="lede t2">Theme tonight: ${FEATURED.theme}. ${s.ideas.length} ideas are fighting for one launch.</p>`}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;max-width:520px">
        <div class="countdown"><span class="t2" style="font-size:13px;font-weight:600">Launch in</span><span class="value display num">${t.launchIn}</span></div>
        <${GestationTimeline} phases=${timeline(s.elapsed)} labels=${false} height=${phone ? 5 : 6} mono="var(--lime)" />
      </div>
      ${phone
        ? html`<ol style="display:flex;flex-direction:column;gap:8px" aria-label="Leading ideas">
            ${ideas.slice(0, 3).map((d) => html`<li key=${d.id} class="row" style="flex-wrap:nowrap">
              <span class="num t2" style="width:14px;font-size:12px;font-weight:600">${d.rank}</span>
              <${Coin} coin=${coin(d)} size=${28} />
              <span style="font-size:14px;font-weight:600;flex:1">${ticker(d.ticker)}</span>
              <span class="num t2" style="font-size:13px">${sol(d.total)}</span></li>`)}
          </ol>`
        : html`<div class="row">${ideas.slice(0, 3).map((d) => html`<span key=${d.id} class="pill-coin">
            <${Coin} coin=${coin(d)} size=${32} /><strong style="font-weight:600">${ticker(d.ticker)}</strong><span class="num t2">${sol(d.total)}</span></span>`)}</div>`}
      <div class="row" style=${phone ? "flex-wrap:nowrap" : ""}>
        <${Button} variant="white" size="lg" style=${phone ? "flex:1" : ""} onClick=${() => a.go({ screen: s.launched ? "launch" : "lobby" })}>Join the lobby</${Button}>
        ${phone
          ? html`<${IconButton} label="Listen to the stage" tone="sky" pressed=${s.voice.listening} style="width:54px;height:54px" onClick=${a.toggleListen}><${I.Headphones} size=${20} /></${IconButton}>`
          : html`<${Button} variant="fill" size="lg" aria-pressed=${String(s.voice.listening)} onClick=${a.toggleListen}>
              ${s.voice.listening ? html`<span class="eq" style="color:var(--sky)" aria-hidden="true"><i /><i /><i /></span>Listening` : html`<${I.Headphones} />Listen in`}
            </${Button}>`}
        ${!phone && html`<span class="t2 num" style="font-size:14px;margin-left:4px">${int(pres.inside)} inside · ${int(pres.listening)} listening</span>`}
      </div>
      ${phone && html`<span class="t2 num" style="font-size:12px;text-align:center;margin-top:-6px">${int(pres.inside)} inside · ${int(pres.listening)} listening</span>`}
    </div>
    <div class="hero-art">
      <div class="ring"><${Orbit} people=${ROOM} base=${40} /></div>
      <${Coin} coin=${coin(lead)} size=${196} big class="glow" />
      <span class="leading glass">Leading · ${ticker(lead.ticker)} <span class="num t2">${sol(lead.total)}</span></span>
    </div>
  </section>`;
}

function HowItWorks() {
  return html`<section class="section" aria-labelledby="how-title">
    <h2 id="how-title" class="display" style="font-size:40px;line-height:1.05;max-width:640px">One hour. One coin.<br /><span class="t2">Friends for good.</span></h2>
    <ol class="steps">${STEPS.map((st) => html`<li key=${st.title} class="panel">
      <span class="num" style=${{ fontSize: "13px", fontWeight: 600, color: st.color }}>${st.t}</span>
      <span style="font-size:17px;font-weight:600">${st.title}</span>
      <span class="t2" style="font-size:14px;line-height:1.5">${st.body}</span>
    </li>`)}</ol>
  </section>`;
}

const pal = Object.keys(PEOPLE);
function LobbyAction({ l, s, a, compact }) {
  if (l.live) return html`<${Button} variant="white" size="sm" onClick=${() => a.go({ screen: s.launched ? "launch" : "lobby" })}>Join</${Button}>`;
  if (compact) return html`<${IconButton} label=${l.reminder ? "Reminder on" : "Remind me when it opens"} tone="sky" size="sm" pressed=${l.reminder} onClick=${() => a.toggleReminder(l)}><${I.Bell} size=${15} /></${IconButton}>`;
  return html`<${Button} variant="fill" size="sm" aria-pressed=${String(l.reminder)} onClick=${() => a.toggleReminder(l)}><${I.Bell} size=${13} />${l.reminder ? "On" : "Remind"}</${Button}>`;
}

function ThisHour({ s, a, phone }) {
  const cards = lobbyCards(s);
  const search = html`<label class="search" style=${phone ? "" : "width:240px;max-width:100%"}>
    <${I.Search} size=${15} /><span class="sr">Search lobbies</span>
    <input type="search" value=${s.query} placeholder="Search" onInput=${(e) => a.setQuery(e.currentTarget.value)} />
  </label>`;
  const empty = html`<div class="panel empty">
    <span style="font-size:17px;font-weight:600">Nothing matches “${s.query}”</span>
    <span class="t2" style="font-size:14px">Try another name, or start the lobby you were looking for.</span>
    <div class="row"><${Button} size="sm" onClick=${() => { a.setQuery(""); a.setFilter("all"); }}>Clear search</${Button}><${Button} variant="white" size="sm" onClick=${() => a.openSheet("host")}>Host a lobby</${Button}></div>
  </div>`;
  if (phone) {
    return html`<section class="section" style="gap:14px" aria-labelledby="hour-title">
      <div class="row" style="justify-content:space-between;padding:0 4px">
        <h2 id="hour-title" class="display" style="font-size:22px">This hour</h2>
        <${Button} variant="ghost" size="sm" style="color:var(--lime)" onClick=${() => a.openSheet("host")}>Host</${Button}>
      </div>
      ${search}
      <${Segmented} label="Filter lobbies" full options=${FILTERS} value=${s.filter} onChange=${a.setFilter} />
      ${cards.length ? html`<div class="panel m-list">${cards.map((l) => html`<div key=${l.id}>
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px">
          <div class="row" style="gap:8px"><${Chip} tone=${l.tone}>${l.phase}</${Chip}><span class="num t2" style="font-size:12px">${l.when}</span></div>
          <span class="ellipsis" style="font-size:16px;font-weight:600">${l.name}</span>
          <span class="t2 num ellipsis" style="font-size:12px">${l.meta} · ${l.meta2}</span>
        </div>
        <${LobbyAction} l=${l} s=${s} a=${a} compact />
      </div>`)}</div>` : empty}
    </section>`;
  }
  return html`<section class="section" aria-labelledby="hour-title">
    <div class="section-head">
      <h2 id="hour-title" class="display">This hour</h2>
      ${search}
      <${Segmented} label="Filter lobbies" options=${FILTERS} value=${s.filter} onChange=${a.setFilter} />
      <${Button} size="sm" style="height:38px" onClick=${() => a.openSheet("host")}><${I.Plus} size=${14} />Host a lobby</${Button}>
    </div>
    ${cards.length ? html`<div class="lobby-grid">${cards.map((l, i) => html`<article key=${l.id} class="card lobby-card">
      <div class="row" style="justify-content:space-between"><${Chip} tone=${l.tone} dot>${l.phase}</${Chip}><span class="num t2" style="font-size:13px;font-weight:500">${l.when}</span></div>
      <div style="display:flex;flex-direction:column;gap:6px;min-height:64px"><h3>${l.name}</h3><p class="t2 clamp2" style="font-size:14px;line-height:1.45">${l.theme}</p></div>
      <${Bar} value=${l.progress} color=${`var(--${l.tone === "neutral" ? "text" : l.tone})`} />
      <div class="foot">
        <span class="stack">${[0, 4, 9].map((k) => html`<${Avatar} key=${k} person=${person(pal[(i + k) % pal.length])} size=${24} />`)}</span>
        <span class="meta"><span class="num ellipsis" style="font-size:13px;font-weight:600">${l.meta}</span><span class="num t2 ellipsis" style="font-size:12px">${l.meta2}</span></span>
        <${LobbyAction} l=${l} s=${s} a=${a} />
      </div>
    </article>`)}</div>` : empty}
  </section>`;
}

function ClanCard({ k, a, phone }) {
  const up = k.change === null ? null : k.change >= 0;
  const change = html`<span class="num" style=${{ fontSize: "13px", fontWeight: 600, color: up === null ? "var(--sky)" : up ? "var(--lime)" : "var(--amber)" }}>${k.change === null ? "New" : signedPct(k.change)}</span>`;
  const voice = k.voice > 0 && html`<span style="font-size:12px;font-weight:600;color:var(--sky);display:inline-flex;align-items:center;gap:5px"><span class="eq" style="height:10px" aria-hidden="true"><i /><i /><i /></span>${k.voice} in voice</span>`;
  if (phone) {
    return html`<button type="button" class="card" onClick=${() => a.openClan(k.id)} style="flex:none;width:236px;padding:16px;display:flex;flex-direction:column;gap:12px;text-align:left;scroll-snap-align:start">
      <span class="row" style="flex-wrap:nowrap;width:100%"><${Coin} coin=${coin(k)} size=${44} />
        <span style="flex:1;display:flex;flex-direction:column"><strong style="font-weight:600">${ticker(k.ticker)}</strong>${change}</span>
        ${k.unread > 0 && html`<span class="badge">${k.unread}</span>`}</span>
      <span class="t2 clamp2" style="font-size:12px;line-height:1.4">${k.story}</span>${voice}
    </button>`;
  }
  return html`<button type="button" class="card clan-card" onClick=${() => a.openClan(k.id)}>
    <${Coin} coin=${coin(k)} size=${52} />
    <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px">
      <span class="row" style="gap:8px"><strong style="font-weight:600;font-size:16px">${ticker(k.ticker)}</strong>${change}</span>
      <span class="t2 num" style="font-size:13px">${int(k.members)} founders · ${k.name}</span>
      <span class="t2 clamp2" style="font-size:12px;line-height:1.4">${k.story}</span>
    </span>
    <span style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">${k.unread > 0 && html`<span class="badge">${k.unread}</span>`}${voice}</span>
  </button>`;
}

function YourClans({ s, a, phone }) {
  return html`<section class=${phone ? "section hscroll-wrap" : "section"} style=${phone ? "gap:14px" : ""} aria-labelledby="clans-title">
    <div class="section-head" style=${phone ? "padding:0 20px" : ""}>
      <h2 id="clans-title" class="display" style=${phone ? "font-size:22px" : ""}>Your clans</h2>
      ${!phone && html`<span class="t2" style="font-size:14px">Everyone you launched a coin with. The room never closes.</span>`}
    </div>
    ${phone
      ? html`<div class="hscroll" style="gap:10px;padding:0 16px 4px">${s.clans.map((k) => html`<${ClanCard} key=${k.id} k=${k} a=${a} phone />`)}</div>`
      : html`<div class="clan-grid">${s.clans.map((k) => html`<${ClanCard} key=${k.id} k=${k} a=${a} />`)}</div>`}
  </section>`;
}

export function Discover({ s, a, phone }) {
  const lead = race(s)[0];
  return html`<div class="screen">
    <div class="ambient" style=${{ background: ambient(lead.hue) }} />
    ${phone
      ? html`<header class="row" style="position:relative;justify-content:space-between;padding:16px 16px 4px 20px;flex-wrap:nowrap">
          <span role="img" aria-label="Community Coin"><${I.Logo} size=${28} /></span><${WalletPill} s=${s} a=${a} /></header>`
      : html`<header class="topbar glass">
          <button type="button" class="brand" onClick=${() => a.go({ screen: "discover" })}><${I.Logo} /><span>Community Coin</span></button>
          <nav aria-label="Sections" style="margin:0 auto"><${Segmented} label="Sections" options=${[{ id: "discover", label: "Lobbies" }, { id: "clan", label: "Clans" }]} value="discover" onChange=${(id) => (id === "clan" ? a.openClan(s.clan) : null)} /></nav>
          <${WalletPill} s=${s} a=${a} />
        </header>`}
    <main class="discover">
      ${phone && html`<h1 class="display large-title" style="position:relative">Lobbies</h1>`}
      <${Hero} s=${s} a=${a} phone=${phone} />
      ${!phone && html`<${HowItWorks} />`}
      <${ThisHour} s=${s} a=${a} phone=${phone} />
      <${YourClans} s=${s} a=${a} phone=${phone} />
      <footer class="t2" style="position:relative;font-size:12px;line-height:1.5;padding:8px 4px 32px;display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center">
        <span>Memecoins are speculative and can lose all their value. Not investment advice.</span>
        <button type="button" class="link" onClick=${() => a.openSheet("terms")}>Risks and terms</button>
      </footer>
    </main>
  </div>`;
}
