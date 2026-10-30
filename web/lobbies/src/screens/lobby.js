// The lobby: the stage (voice), the race of ideas with the pledge dock, and the chat. Three columns on a desktop,
// one at a time behind a segmented control on a phone.

import { html, Button, IconButton, Segmented, Chip, Coin, Avatar, Bar, GestationTimeline, Equalizer, Composer } from "../ui.js";
import * as I from "../icons.js";
import { person, coin, FEATURED, SPEAKERS, MUTED_SPEAKERS, CROWD, PEOPLE, ME } from "../demo/data.js";
import { race, timeline, lobbyClock, dock, presence } from "../demo/select.js";
import { sol, int, ticker } from "../format.js";

const AMOUNTS = [0.5, 1, 2, 5];
const TABS = [{ id: "ideas", label: "Ideas" }, { id: "stage", label: "Stage" }, { id: "chat", label: "Chat" }];

function speakers(s) {
  const spk = s.beat % 4 === 3 ? 2 : s.beat % 4 === 2 ? 0 : 1;
  const list = SPEAKERS.map((who, i) => ({ who, speaking: i === spk, muted: MUTED_SPEAKERS.includes(who) }));
  if (s.voice.onStage) list.push({ who: ME, speaking: s.voice.mic && s.beat % 5 === 0, muted: !s.voice.mic });
  return list;
}

function Stage({ s, a, phone }) {
  const v = s.voice;
  const pres = presence(s);
  const listeners = int(pres.listening);
  const status = v.onStage ? (v.mic ? "You’re on stage · mic live" : "You’re on stage · muted") : v.hand ? "Hand raised · the host will bring you up" : "Listening · you can raise your hand";
  const size = phone ? 76 : 58;
  return html`<section class=${phone ? "scroll" : "stage scroll"} style=${phone ? "padding:8px 16px 24px;display:flex;flex-direction:column;gap:20px" : ""} aria-label="Voice stage">
    ${!phone && html`<div class="row" style="justify-content:space-between">
      <h2 style="font-size:15px;font-weight:600">Stage</h2>
      <span style="font-size:12px;font-weight:600;color:var(--sky);display:inline-flex;align-items:center;gap:6px"><${Equalizer} height=${10} />${listeners} listening</span>
    </div>`}
    <div class="speakers">${speakers(s).map((p) => html`<div key=${p.who}>
      <${Avatar} person=${person(p.who)} size=${size} speaking=${p.speaking} muted=${p.muted} />
      <span class="ellipsis" style=${{ fontSize: phone ? "13px" : "12px", fontWeight: 500, color: "rgba(235,235,245,.82)", maxWidth: "100%" }}>${p.who === ME ? "you" : p.who}</span>
    </div>`)}</div>
    <div class="panel" style="padding:14px;display:flex;flex-direction:column;gap:12px">
      ${!v.listening
        ? html`<span class="t2" style="font-size:13px;line-height:1.45">Pitches happen out loud. Listen in, or raise your hand to pitch your idea on stage.</span>
            <${Button} variant="white" size=${phone ? "lg" : undefined} onClick=${a.toggleListen}><${I.Headphones} size=${17} />Listen in</${Button}>`
        : html`<span style=${{ fontSize: "13px", fontWeight: 600, color: v.onStage ? "var(--lime)" : "var(--sky)" }} aria-live="polite">${status}</span>
            <div class="row" style="flex-wrap:nowrap;gap:8px">
              ${!v.onStage
                ? html`<${Button} style="flex:1" size=${phone ? "lg" : undefined} aria-pressed=${String(v.hand)} onClick=${a.toggleHand}><${I.Hand} size=${16} />${v.hand ? "Hand raised" : "Raise hand to pitch"}</${Button}>`
                : html`<${Button} style="flex:1" size=${phone ? "lg" : undefined} aria-pressed=${String(!v.mic)} onClick=${a.toggleMic}>${v.mic ? html`<${I.Mic} size=${16} />Mute` : html`<${I.MicOff} size=${16} />Unmute`}</${Button}>
                    <${Button} variant="ghost" size="sm" onClick=${a.stepDown}>Step down</${Button}>`}
              <${IconButton} label="Leave audio" tone="danger" onClick=${a.toggleListen} style=${phone ? "width:54px;height:54px" : ""}><${I.Close} size=${15} /></${IconButton}>
            </div>`}
    </div>
    <div style="display:flex;flex-direction:column;gap:10px">
      <span class="t2 num" style="font-size:13px;font-weight:600">${phone ? `In the room · ${listeners} listening` : "In the room"}</span>
      <div class="row" style="gap:6px">
        ${Object.keys(PEOPLE).slice(0, 15).map((who) => html`<${Avatar} key=${who} person=${person(who)} size=${phone ? 34 : 28} />`)}
        <span class="num" style="height:28px;padding:0 10px;border-radius:14px;background:var(--fill);font-size:12px;font-weight:600;display:inline-flex;align-items:center">+${int(Math.max(0, pres.inside - 15))}</span>
      </div>
    </div>
    ${phone && html`<${Button} variant="ghost" size="sm" style="align-self:center" disabled=${s.elapsed >= 3594} onClick=${a.skipToLock}>Demo · skip to lock</${Button}>`}
  </section>`;
}

function IdeaCard({ d, s, a, phone }) {
  const selected = s.selected === d.id;
  const badges = html`${d.mine && html`<${Chip} tone="lime" class="sm">Your pledge</${Chip}>`}${d.yours && html`<${Chip} tone="sky">Your idea</${Chip}>`}`;
  const barColor = selected ? "var(--lime)" : "rgba(235,235,245,.38)";
  if (phone) {
    return html`<button type="button" class="idea" aria-pressed=${String(selected)} onClick=${() => a.select(d.id)}>
      <${Coin} coin=${coin(d)} size=${48} />
      <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px">
        <span class="row" style="flex-wrap:nowrap;justify-content:space-between;gap:8px"><span class="ellipsis" style="font-size:15px;font-weight:600">${d.name}</span><span class="num" style="font-size:14px;font-weight:600;flex:none">${sol(d.total)}</span></span>
        <${Bar} value=${d.share} color=${barColor} />
        <span class="t2 num ellipsis" style="font-size:12px">${ticker(d.ticker)} · ${d.backersShown} backers · ${d.yours ? "you" : `@${d.by}`}${d.mine ? " · your pledge" : ""}</span>
      </span>
    </button>`;
  }
  return html`<button type="button" class="idea" aria-pressed=${String(selected)} onClick=${() => a.select(d.id)}>
    <span class="row" style="justify-content:space-between;align-items:flex-start;width:100%">
      <${Coin} coin=${coin(d)} size=${56} />
      <span style="display:flex;flex-direction:column;align-items:flex-end;gap:6px"><span class="num t2" style="font-size:13px;font-weight:600">#${d.rank}</span>${badges}</span>
    </span>
    <span style="display:flex;flex-direction:column;gap:4px">
      <span class="row" style="gap:8px;align-items:baseline"><span style="font-size:16px;font-weight:600">${d.name}</span><span class="t2" style="font-size:13px;font-weight:500">${ticker(d.ticker)}</span></span>
      <span class="t2 clamp2" style="font-size:13px;line-height:1.45;min-height:38px">${d.pitch}</span>
    </span>
    <span style="width:100%"><${Bar} value=${d.share} color=${barColor} /></span>
    <span class="row" style="justify-content:space-between;width:100%;align-items:baseline">
      <span class="num" style="font-size:15px;font-weight:600">${sol(d.total)}</span>
      <span class="t2 num" style="font-size:12px">${d.backersShown} backers · ${d.yours ? "you" : `@${d.by}`}</span>
    </span>
  </button>`;
}

function Dock({ s, a, ideas, phone }) {
  const d = dock(s, ideas);
  const t = lobbyClock(s);
  const amounts = AMOUNTS.map((v) => ({ id: v, label: String(v), disabled: v > s.balance }));
  let action;
  if (d.mode === "pick") {
    action = html`<div class="row" style="flex-wrap:nowrap;gap:8px">
      <div style=${phone ? "flex:1" : ""}><${Segmented} label="Pledge amount in SOL" full=${phone} options=${amounts} value=${s.amount} onChange=${a.setAmount} /></div>
      <${Button} variant="prim" disabled=${s.amount > s.balance} onClick=${() => a.openSheet("pledge")}>${phone ? "Pledge" : `Pledge ${sol(s.amount)}`}</${Button}>
    </div>`;
  } else if (d.mode === "backed") {
    action = html`<div class="row" style="flex-wrap:nowrap;gap:8px">
      <${Chip} tone="lime" class="dock-chip"><${I.Check} size=${14} />Backing with ${sol(d.mine)}</${Chip}>
      <${Button} size="sm" onClick=${a.withdraw}>Withdraw</${Button}>
    </div>`;
  } else if (d.mode === "move") {
    action = html`<${Button} variant="prim" onClick=${a.movePledge}>Move my ${sol(d.mine)} here</${Button}>`;
  } else {
    // After the lock, the dock says what the lock decided: who launches, or that everyone is refunded.
    const k = s.locked;
    const text = !k ? `Pledges locked · launch in ${t.launchIn}`
      : k.winner && !k.voided ? `${ticker(k.winner)} won · launch in ${t.launchIn}`
      : `No launch · refunds at 01:00`;
    action = html`<${Chip} tone="amber" class="dock-chip" role="status">${text}</${Chip}>`;
  }
  return html`<section class="dock glass" aria-label="Your pledge">
    <div class="row" style="flex-wrap:nowrap;gap:12px;flex:1 1 260px;min-width:0">
      <${Coin} coin=${coin(d.sel)} size=${phone ? 40 : 48} />
      <div class="who" style="min-width:0"><span style="font-size:16px;font-weight:600">${d.sel.name}</span><span class="t2 num ellipsis" style="font-size:13px">${d.sub}</span></div>
    </div>
    ${action}
  </section>`;
}

function Ideas({ s, a, phone }) {
  const ideas = race(s);
  const t = lobbyClock(s);
  return html`<main class="ideas-col">
    <div class="list scroll">
      ${phone
        ? html`<div class="row" style="justify-content:space-between;padding:0 4px 10px">
            <span class="t2 num" style="font-size:13px">${sol(ideas.reduce((x, d) => x + d.total, 0))} · ${t.proposeHint}</span>
            <${Button} variant="ghost" size="sm" style="color:var(--sky);padding:0 8px" disabled=${!t.canPropose || s.balance < 0.05} onClick=${() => a.openSheet("propose")}>Propose</${Button}>
          </div>`
        : html`<div class="ideas-head">
            <div style="display:flex;flex-direction:column;gap:4px">
              <h2 class="display" style="font-size:28px">${ideas.length} ideas</h2>
              <span class="t2 num" style="font-size:14px">${sol(ideas.reduce((x, d) => x + d.total, 0))} pledged · your pledge is your vote</span>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
              <${Button} disabled=${!t.canPropose || s.balance < 0.05} onClick=${() => a.openSheet("propose")}><${I.Plus} size=${15} />Propose an idea</${Button}>
              <span class="t2 num" style="font-size:12px">${t.proposeHint}</span>
            </div>
          </div>`}
      <div class="ideas">${ideas.map((d) => html`<${IdeaCard} key=${d.id} d=${d} s=${s} a=${a} phone=${phone} />`)}</div>
    </div>
    <${Dock} s=${s} a=${a} ideas=${ideas} phone=${phone} />
  </main>`;
}

function ChatLine({ m, ideas }) {
  if (m.sys) {
    const dot = m.kind === "pledge" ? "var(--lime)" : "var(--sky)";
    return html`<li><span class="sys"><span style=${{ width: "6px", height: "6px", borderRadius: "50%", background: dot, flex: "none" }} />${m.text}</span></li>`;
  }
  const p = person(m.who);
  const idea = m.art && ideas[m.art];
  return html`<li class="msg">
    <${Avatar} person=${p} size=${30} />
    <div class="body">
      <span style="font-size:13px;font-weight:600">${p.name} <span class="t2" style="font-weight:500;font-size:12px">${m.badge || ""}</span></span>
      <span style="font-size:14px;line-height:1.45;overflow-wrap:anywhere">${m.text}</span>
      ${idea && html`<span class="art" role="img" aria-label=${`Shared art for ${ticker(idea.ticker)}`} style=${{ background: `radial-gradient(circle at 50% 40%, hsla(${idea.hue},80%,45%,.45), #141416 75%)` }}><${Coin} coin=${coin(idea)} size=${70} /></span>`}
    </div>
  </li>`;
}

function Chat({ s, a, phone }) {
  const byId = Object.fromEntries(s.ideas.map((d) => [d.id, d]));
  return html`<aside class="chat" aria-label="Lobby chat">
    ${!phone && html`<div class="chat-head"><h2 style="font-size:15px;font-weight:600">Chat</h2><span class="t2" style="font-size:12px">Slow mode · 3 s</span></div>`}
    <ol class="feed scroll" aria-live="off">${s.chat.slice().reverse().map((m, i) => html`<${ChatLine} key=${s.chat.length - i} m=${m} ideas=${byId} />`)}</ol>
    <${Composer} label="Message the lobby" value=${s.draft} placeholder=${phone ? "Message" : `Message ${int(presence(s).inside)} people`} maxLength=${200}
      onInput=${a.setDraft} onSend=${a.send}
      leading=${html`<${IconButton} label="Share the selected idea's art" onClick=${a.shareArt}><${I.Image} size=${17} /></${IconButton}>`} />
  </aside>`;
}

export function Lobby({ s, a, phone }) {
  const t = lobbyClock(s);
  const sel = race(s).find((d) => d.id === s.selected) || race(s)[0];
  const head = html`<header class="lobby-head">
    <${IconButton} label="Back to lobbies" size=${phone ? "sm" : undefined} onClick=${() => a.go({ screen: "discover" })}><${I.Back} size=${15} /></${IconButton}>
    <div class="title" style=${phone ? "flex:1" : ""}>
      <h1 class="ellipsis">${FEATURED.name}</h1>
      <span class="t2 num" style="font-size:13px">${phone ? t.label : `Hosted by ${FEATURED.host} · ${int(presence(s).inside)} inside`}</span>
    </div>
    ${!phone && html`<div class="tl"><${GestationTimeline} phases=${timeline(s.elapsed)} /></div>`}
    <div class="row" style="flex-wrap:nowrap;gap:14px">
      ${!phone && html`<${Button} variant="ghost" size="sm" disabled=${s.elapsed >= 3594} title="Prototype only: jump to the last seconds before launch" onClick=${a.skipToLock}>Demo · skip to lock</${Button}>`}
      <div class="clock">
        <span class="t2" style="font-size:12px;font-weight:600">${t.phase === "lock" ? "Locked · launching in" : "Launch in"}</span>
        <span class="value display num" style=${{ color: t.phase === "lock" ? "#ffb340" : "var(--text)" }} role="timer" aria-label=${`Launch in ${t.launchIn}`}>${t.launchIn}</span>
      </div>
    </div>
  </header>`;
  const glow = `radial-gradient(50% 40% at 50% 0%, hsla(${sel.hue},90%,55%,.13), transparent 70%)`;
  if (phone) {
    return html`<div class="lobby screen">
      <div class="ambient" style=${{ background: glow, height: "100%" }} />
      ${head}
      <div class="lobby-sub">
        <${GestationTimeline} phases=${timeline(s.elapsed)} labels=${false} height=${4} />
        <${Segmented} label="Lobby sections" full options=${TABS} value=${s.lobbyTab} onChange=${a.setLobbyTab} />
      </div>
      <div class="lobby-body">
        ${s.lobbyTab === "ideas" && html`<${Ideas} s=${s} a=${a} phone />`}
        ${s.lobbyTab === "stage" && html`<${Stage} s=${s} a=${a} phone />`}
        ${s.lobbyTab === "chat" && html`<${Chat} s=${s} a=${a} phone />`}
      </div>
    </div>`;
  }
  return html`<div class="lobby screen">
    <div class="ambient" style=${{ background: glow, height: "100%" }} />
    ${head}
    <div class="lobby-body">
      <${Stage} s=${s} a=${a} />
      <${Ideas} s=${s} a=${a} />
      <${Chat} s=${s} a=${a} />
    </div>
  </div>`;
}
