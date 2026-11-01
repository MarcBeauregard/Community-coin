// The lobby: the stage (voice), the race of ideas with the pledge dock, and the chat. Three columns on a desktop,
// one at a time behind a segmented control on a phone.

import { useEffect, useRef } from "preact/hooks";
import { html, Button, IconButton, Segmented, Chip, Coin, Avatar, Bar, GestationTimeline, Equalizer, Composer } from "../ui.js";
import * as I from "../icons.js";
import { person, coin, FEATURED, SPEAKERS, MUTED_SPEAKERS, CROWD, PEOPLE, ME } from "../demo/data.js";
import { race, timeline, lobbyClock, dock, presence, voiceStatus } from "../demo/select.js";
import { sol, int, ticker } from "../format.js";
import { WalletPill } from "./discover.js";
import { AUDIO_ERRORS } from "../voice/audio.js";

const AMOUNTS = [0.5, 1, 2, 5];
const TABS = [{ id: "ideas", label: "Ideas" }, { id: "stage", label: "Stage" }, { id: "chat", label: "Chat" }];

function speakers(s) {
  // Live, the stage is the server's: who speaks is its list (the talking light needs the SFU's audio levels).
  const st = s.live?.stage;
  if (st) return st.speakers.map((who) => ({ who, me: who === s.live.you, speaking: s.audio.speaking.includes(who), muted: who === s.live.you && !s.audio.micOn }));
  const spk = s.beat % 4 === 3 ? 2 : s.beat % 4 === 2 ? 0 : 1;
  const list = SPEAKERS.map((who, i) => ({ who, speaking: i === spk, muted: MUTED_SPEAKERS.includes(who) }));
  if (s.voice.onStage) list.push({ who: ME, me: true, speaking: s.voice.mic && s.beat % 5 === 0, muted: !s.voice.mic });
  return list;
}

// The host and their co-hosts run the stage: they see the raised hands and bring people up.
const manages = (s) => !!s.live?.stage && (s.live.stage.host === s.live.you || s.live.stage.cohosts.includes(s.live.you));

const TONE_COLOR = { lime: "var(--lime)", sky: "var(--sky)", amber: "#ffb340" };

// The stage's controls for the voice's state: one primary action (marked so focus can land on it when the state
// changes), the others beside it. Leaving the audio is a labelled button, never a bare ✕.
function StageControls({ s, a, vs, phone }) {
  const v = s.voice;
  const lg = phone ? "lg" : undefined;
  // Always the same shape: the one thing to do now on top, full width; ways out underneath, same place every time.
  const below = (...items) => html`<div class="row stage-exits">${items}</div>`;
  const leave = html`<${Button} variant="ghost" size="sm" class="leave" onClick=${a.toggleListen}><${I.Close} size=${14} />Leave audio</${Button}>`;
  const back = html`<${Button} size="sm" onClick=${a.stepDown}>Back to audience</${Button}>`;
  if (!v.listening) {
    return html`<${Button} variant="white" size=${lg} block data-primary onClick=${a.toggleListen}><${I.Headphones} size=${17} />${v.onStage ? "Join the stage" : "Listen in"}</${Button}>`;
  }
  if (s.live && s.audio.error === "connect-failed") return html`<${Button} variant="white" size=${lg} block data-primary onClick=${a.retryVoice}>Try again</${Button}>${below(leave)}`;
  if (vs.needsTap) return html`<${Button} variant="white" size=${lg} block data-primary onClick=${a.startAudio}><${I.Speaker} size=${16} />Turn on sound</${Button}>${below(leave)}`;
  if (v.onStage && v.invited) {
    return html`<${Button} variant="prim" size=${lg} block data-primary onClick=${a.acceptInvite}><${I.Mic} size=${16} />Speak now</${Button}>
      ${below(html`<${Button} size="sm" onClick=${a.declineInvite}>Not now</${Button}>`)}`;
  }
  if (v.onStage) {
    return html`${vs.micBlocked
        ? html`<${Button} variant="white" size=${lg} block data-primary onClick=${a.retryMic}><${I.Mic} size=${16} />Try again</${Button}>`
        : html`<${Button} size=${lg} block data-primary onClick=${a.toggleMic}>${vs.micLive ? html`<${I.Mic} size=${16} />Mute` : html`<${I.MicOff} size=${16} />Unmute`}</${Button}>`}
      ${below(back, leave)}`;
  }
  return html`<${Button} size=${lg} block data-primary aria-pressed=${String(v.hand)} onClick=${a.toggleHand}><${I.Hand} size=${16} />${v.hand ? "Hand raised" : "Raise hand to pitch"}</${Button}>
    ${below(leave)}`;
}

function Stage({ s, a, phone }) {
  const v = s.voice;
  const pres = presence(s);
  const listeners = int(pres.listening);
  const vs = voiceStatus(s);
  const size = phone ? 76 : 58;
  // When the voice changes state, its new main control takes the focus if the focus was in this panel or lost (the
  // pressed button just went away): keyboard and screen-reader users keep their place.
  const panel = useRef(null);
  const key = `${v.listening}|${v.onStage}|${v.invited}|${vs.needsTap}|${vs.micBlocked}|${v.hand}`;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const el = panel.current;
    const at = document.activeElement;
    if (el && (!at || at === document.body || el.contains(at))) el.querySelector("[data-primary]")?.focus();
  }, [key]);
  const help = s.live && s.audio.error && AUDIO_ERRORS[s.audio.error];
  return html`<section class=${phone ? "scroll" : "stage scroll"} style=${phone ? "padding:8px 16px 24px;display:flex;flex-direction:column;gap:20px" : ""} aria-label="Voice stage">
    ${!phone && html`<div class="row" style="justify-content:space-between">
      <h2 style="font-size:15px;font-weight:600">Stage</h2>
      <span style="font-size:12px;font-weight:600;color:var(--sky);display:inline-flex;align-items:center;gap:6px"><${Equalizer} height=${10} />${listeners} listening</span>
    </div>`}
    <ul class="speakers" role="list" aria-label="On stage">${speakers(s).map((p) => html`<li key=${p.who}>
      <${Avatar} person=${person(p.who)} size=${size} speaking=${p.speaking} muted=${p.muted} />
      <span class="ellipsis" style=${{ fontSize: phone ? "13px" : "12px", fontWeight: 500, color: "rgba(235,235,245,.82)", maxWidth: "100%" }}>${p.me ? "you" : person(p.who).name}</span>
    </li>`)}</ul>
    <div class="panel" ref=${panel} style="padding:14px;display:flex;flex-direction:column;gap:12px">
      ${!v.listening && !v.onStage && html`<span class="t2" style="font-size:13px;line-height:1.45">Pitches happen out loud. Listen in, or raise your hand to pitch your idea on stage.</span>`}
      <span role="status" style="display:flex;flex-direction:column;gap:4px">
        ${(v.listening || v.onStage) && html`<span style=${{ fontSize: "13px", fontWeight: 600, color: TONE_COLOR[vs.tone] }}>${vs.text}</span>`}
        ${!v.listening && !v.onStage && html`<span class="sr">${vs.text}</span>`}
        ${vs.link && html`<span style=${{ fontSize: "12px", fontWeight: 600, color: TONE_COLOR[vs.link.tone] }}>${vs.link.text}</span>`}
        ${v.onStage && v.invited && html`<span class="t2" style="font-size:13px;line-height:1.45;font-weight:400">Your microphone stays off until you choose Speak now.</span>`}
        ${help && html`<span class="wallet-error" style="font-size:13px;font-weight:400">${help}</span>`}
      </span>
      <${StageControls} s=${s} a=${a} vs=${vs} phone=${phone} />
    </div>
    ${manages(s) && s.live.stage.speakers.length > 1 && html`<div class="panel" style="padding:14px;display:flex;flex-direction:column;gap:10px" role="region" aria-label="Speakers">
      <span class="t2 num" style="font-size:13px;font-weight:600">On stage · ${s.live.stage.speakers.length - 1} besides you</span>
      ${s.live.stage.speakers.filter((who) => who !== s.live.you && who !== s.live.stage.host).map((who) => html`<span key=${who} class="row" style="flex-wrap:nowrap;gap:10px">
        <${Avatar} person=${person(who)} size=${32} speaking=${s.audio.speaking.includes(who)} /><span class="ellipsis" style="flex:1;font-size:14px">${person(who).name}</span>
        <${Button} size="sm" variant="ghost" aria-label=${`Move ${person(who).name} to the audience`} onClick=${() => a.moveDown(who)}>To audience</${Button}>
      </span>`)}
    </div>`}
    ${manages(s) && html`<div class="panel" style="padding:14px;display:flex;flex-direction:column;gap:10px" role="region" aria-label="Raised hands">
      <span class="t2 num" style="font-size:13px;font-weight:600">Raised hands · ${s.live.stage.hands.length}</span>
      ${s.live.stage.hands.length === 0 && html`<span class="t2" style="font-size:13px">Nobody is waiting. Hands show up here in the order raised.</span>`}
      ${s.live.stage.hands.map((who) => html`<span key=${who} class="row" style="flex-wrap:nowrap;gap:10px">
        <${Avatar} person=${person(who)} size=${32} /><span class="ellipsis" style="flex:1;font-size:14px">${person(who).name}</span>
        <${Button} size="sm" aria-label=${`Bring ${person(who).name} up`} onClick=${() => a.bringUp(who)}>Bring up</${Button}>
      </span>`)}
    </div>`}
    <div style="display:flex;flex-direction:column;gap:10px">
      <span class="t2 num" style="font-size:13px;font-weight:600">${phone && !s.live ? `In the room · ${listeners} listening` : "In the room"}</span>
      ${s.live
        ? html`<span class="t2 num" style="font-size:13px">${int(pres.inside)} ${pres.inside === 1 ? "person" : "people"} inside</span>`
        : html`<div class="row" style="gap:6px">
            ${Object.keys(PEOPLE).slice(0, 15).map((who) => html`<${Avatar} key=${who} person=${person(who)} size=${phone ? 34 : 28} />`)}
            <span class="num" style="height:28px;padding:0 10px;border-radius:14px;background:var(--fill);font-size:12px;font-weight:600;display:inline-flex;align-items:center">+${int(Math.max(0, pres.inside - 15))}</span>
          </div>`}
    </div>
    ${phone && !s.live && html`<${Button} variant="ghost" size="sm" style="align-self:center;min-height:44px;flex:none" disabled=${s.elapsed >= 3594} onClick=${a.skipToLock}>Demo · skip to lock</${Button}>`}
  </section>`;
}

/**
 * The voice, wherever the stage is not in view: a pill like a phone's call bar, with the one thing to do now (speak
 * when invited, mute when live, tap to hear) and a way back to the stage.
 */
export function VoicePill({ s, a, onOpen }) {
  const v = s.voice;
  if (!v.listening) return null;
  const vs = voiceStatus(s);
  const action = v.onStage && v.invited ? html`<${Button} variant="prim" size="sm" onClick=${a.acceptInvite}>Speak now</${Button}>`
    : vs.needsTap ? html`<${Button} variant="white" size="sm" onClick=${a.startAudio}>Turn on sound</${Button}>`
    : v.onStage && !vs.micBlocked ? html`<${Button} size="sm" onClick=${a.toggleMic}>${vs.micLive ? "Mute" : "Unmute"}</${Button}>`
    : null;
  return html`<div class="voice-pill glass" role="region" aria-label="Voice">
    <button type="button" class="open" onClick=${onOpen}>
      <span class=${`dot ${vs.micLive && v.onStage ? "onair" : ""}`} style=${{ background: TONE_COLOR[vs.tone] }} aria-hidden="true" />
      <span role="status" class="ellipsis" style="font-size:14px;font-weight:600">${vs.link && vs.link.tone === "amber" ? vs.link.text : vs.text}</span>
    </button>
    ${action}
  </div>`;
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
        <span class="t2 num ellipsis" style="font-size:12px">${ticker(d.ticker)} · ${d.backersShown} backers${d.yours ? " · you" : d.by ? ` · @${person(d.by).name}` : ""}${d.mine ? " · your pledge" : ""}</span>
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
      <span class="t2 num" style="font-size:12px">${d.backersShown} backers${d.yours ? " · you" : d.by ? ` · @${person(d.by).name}` : ""}</span>
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
      : `No winner · every pledge refunded`;
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
      <span style="font-size:13px;font-weight:600">${m.mine ? "you" : p.name} <span class="t2" style="font-weight:500;font-size:12px">${m.badge || ""}</span></span>
      <span style="font-size:14px;line-height:1.45;overflow-wrap:anywhere">${m.text}</span>
      ${idea && html`<span class="art" role="img" aria-label=${`Shared art for ${ticker(idea.ticker)}`} style=${{ background: `radial-gradient(circle at 50% 40%, hsla(${idea.hue},80%,45%,.45), #141416 75%)` }}><${Coin} coin=${coin(idea)} size=${70} /></span>`}
    </div>
  </li>`;
}

function Chat({ s, a, phone }) {
  const byId = Object.fromEntries(s.ideas.map((d) => [d.id, d]));
  // The field's name holds what it shows (WCAG 2.5.3).
  const hint = phone ? "Message" : presence(s).inside > 1 ? `Message ${int(presence(s).inside)} people` : "Message the lobby";
  return html`<aside class="chat" aria-label="Lobby chat">
    ${!phone && html`<div class="chat-head"><h2 style="font-size:15px;font-weight:600">Chat</h2><span class="t2" style="font-size:12px">Slow mode · 3 s</span></div>`}
    <ol class="feed scroll" aria-live="off">${s.chat.slice().reverse().map((m, i) => html`<${ChatLine} key=${s.chat.length - i} m=${m} ideas=${byId} />`)}
      ${s.chat.length === 0 && html`<li class="t2 chat-empty">No messages yet. Say gm: everyone in the lobby reads this chat.</li>`}</ol>
    <${Composer} label=${hint === "Message" ? "Message the lobby" : hint} value=${s.draft} placeholder=${hint} maxLength=${200}
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
      ${!phone && !s.live && html`<${Button} variant="ghost" size="sm" disabled=${s.elapsed >= 3594} title="Prototype only: jump to the last seconds before launch" onClick=${a.skipToLock}>Demo · skip to lock</${Button}>`}
      <div class="clock">
        <span class="t2" style="font-size:12px;font-weight:600">${t.phase === "lock" ? "Locked · launching in" : "Launch in"}</span>
        <span class="value display num" style=${{ color: t.phase === "lock" ? "#ffb340" : "var(--text)" }} role="timer" aria-label=${`Launch in ${t.launchIn}`}>${t.launchIn}</span>
      </div>
      <${WalletPill} s=${s} a=${a} compact=${phone} />
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
      ${s.lobbyTab !== "stage" && html`<${VoicePill} s=${s} a=${a} onOpen=${() => a.setLobbyTab("stage")} />`}
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
