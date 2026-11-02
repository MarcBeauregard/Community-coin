// The lobby: the stage (voice), the race of ideas with the pledge dock, and the chat. Three columns on a desktop,
// one at a time behind a segmented control on a phone.

import { useEffect, useRef, useState } from "preact/hooks";
import { html, Button, IconButton, Segmented, Chip, Coin, Avatar, Bar, Spark, GestationTimeline, Equalizer, Composer } from "../ui.js";
import * as I from "../icons.js";
import { person, coin, FEATURED, SPEAKERS, MUTED_SPEAKERS, CROWD, PEOPLE, ME } from "../demo/data.js";
import { race, timeline, lobbyClock, dock, presence, voiceStatus, finale, trend } from "../demo/select.js";
import { sol, int, ticker } from "../format.js";
import { WalletPill } from "./discover.js";
import { NetBanner } from "./net.js";
import { AUDIO_ERRORS } from "../voice/audio.js";

const AMOUNTS = [0.5, 1, 2, 5];
const TABS = [{ id: "ideas", label: "Ideas" }, { id: "stage", label: "Stage" }, { id: "chat", label: "Chat" }];

function speakers(s) {
  // Live, the stage is the server's: who speaks is its list (the talking light needs the SFU's audio levels).
  const st = s.live?.stage;
  if (st) return st.speakers.map((who) => ({ who, me: who === s.live.you, away: (st.away ?? []).includes(who), speaking: s.audio.speaking.includes(who), muted: who === s.live.you && !s.audio.micOn }));
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
  const leave = html`<${Button} key="leave" variant="ghost" size="sm" class="leave" onClick=${a.toggleListen}><${I.Close} size=${14} />Leave audio</${Button}>`;
  const back = html`<${Button} key="back" size="sm" onClick=${a.stepDown}>Back to audience</${Button}>`;
  if (!v.listening) {
    return html`<${Button} key="listen" variant="white" size=${lg} block data-primary onClick=${a.toggleListen}><${I.Headphones} size=${17} />${v.onStage ? "Join the stage" : "Listen in"}</${Button}>`;
  }
  if (s.live && s.audio.error === "connect-failed") return html`<${Button} key="retry" variant="white" size=${lg} block data-primary onClick=${a.retryVoice}>Try again</${Button}>${below(leave)}`;
  if (vs.needsTap) return html`<${Button} key="sound" variant="white" size=${lg} block data-primary onClick=${a.startAudio}><${I.Speaker} size=${16} />Turn on sound</${Button}>${below(leave)}`;
  if (v.onStage && v.invited) {
    return html`<${Button} key="speak" variant="prim" size=${lg} block data-primary onClick=${a.acceptInvite}><${I.Mic} size=${16} />Speak now</${Button}>
      ${below(html`<${Button} key="notnow" size="sm" onClick=${a.declineInvite}>Not now</${Button}>`, leave)}`;
  }
  if (v.onStage) {
    return html`${vs.micBlocked
        ? html`<${Button} key="trymic" variant="white" size=${lg} block data-primary onClick=${a.retryMic}><${I.Mic} size=${16} />Try again</${Button}>`
        : html`<${Button} key="mute" size=${lg} block data-primary onClick=${a.toggleMic}>${vs.micLive || vs.starting ? html`<${I.Mic} size=${16} />Mute` : html`<${I.MicOff} size=${16} />Unmute`}</${Button}>`}
      ${below(back, leave)}`;
  }
  return html`<${Button} key="hand" size=${lg} block data-primary onClick=${a.toggleHand}><${I.Hand} size=${16} />${v.hand ? "Hand raised" : "Raise hand to pitch"}</${Button}>
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
  // The voice room is still answering (asking for a token, connecting): focus waits for its answer.
  const settling = s.live && v.listening && !["live", "reconnecting"].includes(s.audio.status) && !s.audio.error;
  const key = `${v.listening}|${v.onStage}|${v.invited}|${vs.needsTap}|${vs.micBlocked}|${v.hand}|${settling}`;
  const first = useRef(true);
  const inPanel = useRef(false);
  const [mounted, setMounted] = useState(false); // the status region is in the page empty first, so its words are read
  // "Not listening" is news only after listening (not each time the Stage tab is opened).
  const wasActive = useRef(false);
  if (v.listening || v.onStage) wasActive.current = true;
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (settling) return; // move once, when the voice's state is known (not "Raise hand", then "Turn on sound")
    const el = panel.current;
    const at = document.activeElement;
    // Only for someone whose focus was in the panel (the pressed button just went away): never on a page load.
    if (el && (el.contains(at) || ((!at || at === document.body) && inPanel.current))) el.querySelector("[data-primary]")?.focus();
  }, [key]);
  const help = s.live && s.audio.error && AUDIO_ERRORS[s.audio.error];
  return html`<section class=${phone ? "scroll" : "stage scroll"} style=${phone ? "padding:8px 16px 24px;display:flex;flex-direction:column;gap:20px" : ""} aria-label="Voice stage">
    ${!phone && html`<div class="row" style="justify-content:space-between">
      <h2 style="font-size:15px;font-weight:600">Stage</h2>
      <span style="font-size:12px;font-weight:600;color:var(--sky);display:inline-flex;align-items:center;gap:6px"><${Equalizer} height=${10} />${listeners} listening</span>
    </div>`}
    <div style="position:relative">
      <ul class="speakers" role="list" aria-label="On stage">${speakers(s).map((p) => html`<li key=${p.who} class=${p.away ? "away" : ""}>
        <${Avatar} person=${person(p.who)} size=${size} speaking=${p.speaking} muted=${p.muted} />
        <span class="ellipsis" style=${{ fontSize: phone ? "13px" : "12px", fontWeight: 500, color: "rgba(235,235,245,.82)", maxWidth: "100%" }}>${p.me ? "you" : person(p.who).name}${p.away ? html`<span class="t2"> · away</span>` : ""}</span>
      </li>`)}</ul>
      <div class="cheer-layer" aria-hidden="true">${s.cheers.map((c) => html`<span key=${c.id} class="cheer" style=${{ left: `${c.x}%`, animationDelay: `${c.delay}ms` }}>${c.kind === "fire" ? "🔥" : "💀"}</span>`)}</div>
    </div>
    <div class="row cheer-bar" role="group" aria-label="React to the pitch">
      <button type="button" class="cheer-btn" aria-label=${`Fire: love this pitch, ${int(s.cheerCount.fire)}`} onClick=${() => a.cheer("fire")}><span aria-hidden="true">🔥</span><span class="num t2" aria-hidden="true">${int(s.cheerCount.fire)}</span></button>
      <button type="button" class="cheer-btn" aria-label=${`Skull: not this one, ${int(s.cheerCount.skull)}`} onClick=${() => a.cheer("skull")}><span aria-hidden="true">💀</span><span class="num t2" aria-hidden="true">${int(s.cheerCount.skull)}</span></button>
      <span class="t2" style="font-size:12px">Everyone on the stage sees them</span>
    </div>
    <div class="panel" ref=${panel} onFocusIn=${() => { inPanel.current = true; }} onFocusOut=${(e) => { if (e.relatedTarget) inPanel.current = panel.current?.contains(e.relatedTarget) ?? false; }} style="padding:14px;display:flex;flex-direction:column;gap:12px">
      ${!v.listening && !v.onStage && html`<span class="t2" style="font-size:13px;line-height:1.45">Pitches happen out loud. Listen in, or raise your hand to pitch your idea on stage.</span>`}
      <span role="status" style="display:flex;flex-direction:column;gap:4px">${mounted && html`
        ${(v.listening || v.onStage) && html`<span style=${{ fontSize: "13px", fontWeight: 600, color: TONE_COLOR[vs.tone] }}>${vs.text}</span>`}
        ${!v.listening && !v.onStage && wasActive.current && html`<span class="sr">${vs.text}</span>`}
        ${vs.link && html`<span style=${{ fontSize: "12px", fontWeight: 600, color: TONE_COLOR[vs.link.tone] }}>${vs.link.text}</span>`}
        ${v.onStage && v.invited && html`<span class="t2" style="font-size:13px;line-height:1.45;font-weight:400">Your microphone stays off until you choose Speak now.</span>`}
        ${help && html`<span class="wallet-error" style="font-size:13px;font-weight:400">${help}</span>`}`}
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
        ? html`${s.live.people?.length > 0 && html`<ul class="row faces" style="gap:6px" aria-label="Some of the people inside">
              ${s.live.people.map((who) => html`<li key=${who}><${Avatar} person=${person(who)} size=${phone ? 34 : 28} /><span class="sr">${person(who).name}</span></li>`)}
              ${pres.inside > s.live.people.length && html`<li class="num more" aria-label=${`and ${int(pres.inside - s.live.people.length)} more`}>+${int(pres.inside - s.live.people.length)}</li>`}
            </ul>`}
            <span class="t2 num" style="font-size:13px">${int(pres.inside)} ${pres.inside === 1 ? "person" : "people"} inside</span>`
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
  const flagged = manages(s) ? s.live.reports?.[d.ticker] ?? 0 : 0;
  const badges = html`${d.mine && html`<${Chip} tone="lime" class="sm">Your pledge</${Chip}>`}${d.yours && html`<${Chip} tone="sky">Your idea</${Chip}>`}${flagged > 0 && html`<${Chip} tone="amber">Reported · ${flagged}</${Chip}>`}`;
  const barColor = selected ? "var(--lime)" : "rgba(235,235,245,.38)";
  const tr = trend(s, d.ticker);
  const sparkColor = selected ? "var(--lime)" : `hsl(${d.hue} 80% 68%)`;
  const said = tr?.text && html`<span class="sr"> — ${tr.text}</span>`;
  if (phone) {
    return html`<button type="button" class="idea" aria-pressed=${String(selected)} onClick=${() => a.select(d.id)}>
      <${Coin} coin=${coin(d)} size=${48} />
      <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px">
        <span class="row" style="flex-wrap:nowrap;justify-content:space-between;gap:8px"><span class="ellipsis" style="font-size:15px;font-weight:600"><span class="sr">#${d.rank}, </span>${d.name}</span><span class="row" style="flex:none;gap:8px;flex-wrap:nowrap">${tr && html`<${Spark} points=${tr.points} width=${44} height=${18} color=${sparkColor} />`}<span class="num" style="font-size:14px;font-weight:600">${sol(d.total)}</span>${said}</span></span>
        <${Bar} value=${d.share} color=${barColor} />
        <span class="t2 num ellipsis" style="font-size:12px">${flagged > 0 ? html`<span style="color:#ffb340">Reported · ${flagged} · </span>` : ""}${ticker(d.ticker)} · ${d.backersShown} backers${d.yours ? " · you" : d.by ? ` · @${person(d.by).name}` : ""}${d.mine ? " · your pledge" : ""}</span>
      </span>
    </button>`;
  }
  return html`<button type="button" class="idea" aria-pressed=${String(selected)} onClick=${() => a.select(d.id)}>
    <span class="row" style="justify-content:space-between;align-items:flex-start;width:100%;flex-wrap:nowrap">
      <${Coin} coin=${coin(d)} size=${56} />
      ${tr && html`<span style="flex:1;display:flex;justify-content:center;padding:14px 10px 0"><${Spark} points=${tr.points} width=${88} height=${30} color=${sparkColor} /></span>`}
      <span style="display:flex;flex-direction:column;align-items:flex-end;gap:6px"><span class="num t2" style="font-size:13px;font-weight:600">#${d.rank}</span>${badges}</span>
    </span>
    <span style="display:flex;flex-direction:column;gap:4px">
      <span class="row" style="gap:8px;align-items:baseline"><span style="font-size:16px;font-weight:600">${d.name}</span><span class="t2" style="font-size:13px;font-weight:500">${ticker(d.ticker)}</span></span>
      <span class="t2 clamp2" style="font-size:13px;line-height:1.45;min-height:38px">${d.pitch}</span>
    </span>
    <span style="width:100%"><${Bar} value=${d.share} color=${barColor} /></span>
    <span class="row" style="justify-content:space-between;width:100%;align-items:baseline">
      <span class="num" style="font-size:15px;font-weight:600">${sol(d.total)}${said}</span>
      <span class="t2 num" style="font-size:12px">${d.backersShown} backers${d.yours ? " · you" : d.by ? ` · @${person(d.by).name}` : ""}</span>
    </span>
  </button>`;
}

function Dock({ s, a, ideas, phone }) {
  const d = dock(s, ideas);
  const ref = useRef(null);
  const before = useRef(null);
  useEffect(() => {
    // The lock takes the Pledge button away: someone who was on it lands on what the dock now says.
    const at = document.activeElement;
    if (before.current && before.current !== d.mode && d.mode === "closed" && (!at || at === document.body)) ref.current?.querySelector(".dock-chip-wrap")?.focus();
    before.current = d.mode;
  }, [d.mode]);
  const t = lobbyClock(s);
  const amounts = AMOUNTS.map((v) => ({ id: v, label: String(v), disabled: v > s.balance }));
  let action;
  if (d.mode === "pick") {
    action = html`<div class="row" style="flex-wrap:nowrap;gap:8px">
      <div style=${phone ? "flex:1" : ""}><${Segmented} label="Pledge amount in SOL" full=${phone} options=${amounts} value=${s.amount} onChange=${a.setAmount} /></div>
      <${Button} variant="prim" disabled=${s.amount > s.balance} aria-label=${`Pledge ${sol(s.amount)}`} onClick=${() => a.openSheet("pledge")}>${phone ? "Pledge" : `Pledge ${sol(s.amount)}`}</${Button}>
    </div>`;
  } else if (d.mode === "backed") {
    action = html`<div class="row" style="flex-wrap:nowrap;gap:8px">
      <${Chip} tone="lime" class="dock-chip"><${I.Check} size=${14} />Backing with ${sol(d.mine)}</${Chip}>
      <${Button} size="sm" onClick=${() => a.openSheet("withdraw")}>Withdraw</${Button}>
    </div>`;
  } else if (d.mode === "move") {
    action = html`<${Button} variant="prim" onClick=${() => a.movePledge()}>Move my ${sol(d.mine)} here</${Button}>`;
  } else {
    // After the lock, the dock says what the lock decided: who launches, or that everyone is refunded.
    const k = s.locked;
    const text = !k ? `Pledges locked · launch in ${t.launchIn}`
      : k.winner && !k.voided ? `${ticker(k.winner)} won · launch in ${t.launchIn}`
      : `No winner · every pledge refunded`;
    // Not a live region: its clock ticks every second (the lock itself is announced once, above the ideas).
    action = html`<span class="dock-chip-wrap" tabIndex="-1"><${Chip} tone="amber" class="dock-chip">${text}</${Chip}></span>`;
  }
  // The host removes an idea; anyone else can report one (not their own), once.
  // The host's Remove shows once they picked an idea, or for one people reported: never on the leader by default.
  const host = manages(s) && s.live?.practice && t.canPledge && (s.pickedIdea || (s.live.reports?.[d.sel.ticker] ?? 0) > 0);
  const reported = !!s.reported[d.sel.ticker];
  const flag = host
    ? html`<${IconButton} label=${`Remove ${ticker(d.sel.ticker)} from the race`} size="sm" class="dock-flag" aria-haspopup="dialog" onClick=${() => a.askRemove(d.sel.id)}><${I.Close} size=${13} /></${IconButton}>`
    : !d.sel.yours && t.canPledge && html`<${IconButton} label=${reported ? `${ticker(d.sel.ticker)} reported` : `Report ${ticker(d.sel.ticker)}`} size="sm" class="dock-flag" aria-haspopup=${reported ? undefined : "dialog"} disabled=${reported} onClick=${() => a.askReport(d.sel.id)}><${I.Alert} size=${14} /></${IconButton}>`;
  return html`<section class="dock glass" ref=${ref} aria-label="Your pledge">
    <div class="row" style="flex-wrap:nowrap;gap:12px;flex:1 1 260px;min-width:0">
      <${Coin} coin=${coin(d.sel)} size=${phone ? 40 : 48} />
      <div class="who" style="min-width:0;flex:1"><span style="font-size:16px;font-weight:600">${d.sel.name}</span><span class="t2 num ellipsis" style="font-size:13px">${d.sub}</span></div>
      ${flag}
    </div>
    ${action}
  </section>`;
}

// A light tap on phones that can, once the person has touched the page (browsers refuse it before), never when they
// asked for less motion.
function buzz(pattern) {
  try {
    if (!navigator.vibrate || navigator.userActivation?.hasBeenActive === false) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || !matchMedia("(pointer: coarse)").matches) return;
    navigator.vibrate(pattern);
  } catch {}
}

// The last five minutes: the gap between the top two, live, and the lock coming. A screen reader hears the lead
// when it changes, not every pledge.
function Finale({ f, a, phone }) {
  const lead = useRef(null);
  useEffect(() => {
    if (lead.current === null) buzz(20);
    else if (lead.current !== f.lead.id) buzz([30, 60, 30]);
    lead.current = f.lead.id;
  }, [f.lead.id]);
  // After Move or Keep it, the offer goes: the focus stays in the panel instead of falling to the page.
  const panel = useRef(null);
  const keep = (fn) => () => { fn(); requestAnimationFrame(() => panel.current?.focus()); };
  return html`<section ref=${panel} tabIndex="-1" class=${`finale glass${f.urgent ? " urgent" : ""}`} aria-label="Final minutes">
    <div class="row" style="justify-content:space-between;gap:8px;flex-wrap:nowrap">
      <span class="finale-kicker">Final minutes</span>
      <span class="num finale-left" aria-hidden="true">Locks in ${f.lockIn}</span>
    </div>
    <p class="finale-gap num">${f.text}</p>
    <div class="finale-bar" aria-hidden="true">
      <span style=${{ width: `${f.leadShare}%`, background: `hsl(${f.lead.hue} 85% 62%)` }} />
      <span style=${{ width: `${100 - f.leadShare}%`, background: `hsl(${f.next.hue} 70% 55% / .55)` }} />
    </div>
    <div class="row num t2" aria-hidden="true" style="justify-content:space-between;font-size:12px;margin-top:-4px"><span>$${f.lead.ticker} · ${sol(f.lead.total)}</span><span>$${f.next.ticker} · ${sol(f.next.total)}</span></div>
    ${f.nudge && html`<div class="finale-nudge">
      <span style="flex:1 1 200px;font-size:14px;line-height:1.4">${f.nudge.text}</span>
      <div class="row" style="flex-wrap:nowrap;gap:8px">
        <${Button} size="sm" variant="ghost" onClick=${keep(a.dismissNudge)}>Keep it</${Button}>
        <${Button} size="sm" variant="prim" onClick=${keep(() => a.movePledge(f.nudge.to.id))}>Move to $${f.nudge.to.ticker}</${Button}>
      </div>
    </div>`}
  </section>`;
}

const INTRO = [
  { icon: I.Wallet, title: "Your pledge is your vote", text: "Back the idea you want launched with SOL. Pledges lock 5 minutes before the launch; the idea with the most SOL then wins." },
  { icon: I.Check, title: "Lost? Refunded at the lock", text: "If your idea doesn’t win, you get your SOL back when pledges lock. Nothing to claim." },
  { icon: I.Flame, title: "Won? You’re a founder", text: "At 01:00 the coin launches. Your SOL buys its first tokens, and you get a founder number in its clan, for good." },
];

// The first minute in a lobby: three cards, once. Not a dialog: the lobby stays usable around it.
function Intro({ step, a }) {
  const ref = useRef(null);
  const c = INTRO[step];
  const last = step === INTRO.length - 1;
  const done = () => {
    const inside = ref.current?.contains(document.activeElement);
    a.introDone();
    if (inside) requestAnimationFrame(() => document.querySelector(".ideas .idea")?.focus());
  };
  return html`<section class="intro glass" ref=${ref} aria-label="How a lobby works">
    <div class="intro-icon" aria-hidden="true"><${c.icon} size=${20} /></div>
    <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:0">
      <span class="t2 num" style="font-size:12px;font-weight:600">${step + 1} of ${INTRO.length}</span>
      <h2 style="font-size:17px;font-weight:650">${c.title}</h2>
      <span class="sr" role="status">${step > 0 ? `${step + 1} of ${INTRO.length}: ${c.title}. ${c.text}` : ""}</span>
      <p class="t2" style="font-size:14px;line-height:1.45">${c.text}</p>
      <div class="row" style="justify-content:space-between;gap:8px;margin-top:8px;flex-wrap:nowrap">
        <span class="intro-dots" aria-hidden="true">${INTRO.map((_, i) => html`<span class=${i === step ? "on" : ""} />`)}</span>
        <div class="row" style="gap:6px;flex-wrap:nowrap">
          ${!last && html`<${Button} key="skip" size="sm" variant="ghost" onClick=${done}>Skip</${Button}>`}
          <${Button} key="next" size="sm" variant=${last ? "prim" : undefined} onClick=${last ? done : a.introNext}>${last ? "Got it" : "Next"}</${Button}>
        </div>
      </div>
    </div>
  </section>`;
}

// What a screen reader hears of the final minutes, in one region that is always in the page: their start (with the
// offer to move a pledge, if any), each change of leader, and the lock. Never every pledge.
function useFinaleWords(f, locked, lockWords) {
  const [words, setWords] = useState("");
  // Said, then cleared: a status line left in the page would show yesterday's numbers to someone browsing.
  useEffect(() => { if (!words) return undefined; const t = setTimeout(() => setWords(""), 6000); return () => clearTimeout(t); }, [words]);
  const was = useRef({ on: false, lead: null, nudge: false });
  useEffect(() => {
    const w = was.current;
    if (f && !w.on) setWords(`Final minutes: pledges lock in ${f.lockIn.replace(/^0/, "")}. ${f.text}.${f.nudge ? ` ${f.nudge.text}` : ""}`);
    else if (f && w.lead !== f.lead.id && Date.now() - (w.saidLeadAt ?? 0) > 10000) { setWords(`$${f.lead.ticker} takes the lead. ${f.text}.`); was.current.saidLeadAt = Date.now(); }
    else if (f && f.nudge && !w.nudge) setWords(f.nudge.text);
    else if (!f && w.on && locked) setWords(lockWords || "Pledges are locked.");
    was.current = { on: !!f, lead: f?.lead.id ?? null, nudge: !!f?.nudge, saidLeadAt: was.current.saidLeadAt };
  }, [!!f, f?.lead.id, !!f?.nudge, locked]);
  return words;
}

// The lock, marked: who won, when it launches, and what it means for the person.
function Locked({ s, t }) {
  const k = s.locked;
  const mine = s.pledge && k.winner && s.pledge.symbol === k.winner;
  return html`<section class="finale locked glass" aria-label="Pledges locked">
    <span class="finale-kicker">Pledges locked</span>
    <p class="finale-gap num">${k.winner && !k.voided ? `$${k.winner} wins with ${sol(k.pot)}` : "No winner: every pledge is refunded"}</p>
    <span class="t2 num" style="font-size:14px;line-height:1.45">${k.winner && !k.voided
      ? `${mine ? `You’re on the winner: your ${sol(s.pledge.amount)} makes you a founder at the launch.` : "Losing pledges are back in their wallets."} Launch in ${t.launchIn}.`
      : "Everyone’s SOL is back in their wallets."}</span>
  </section>`;
}

function Ideas({ s, a, phone }) {
  const ideas = race(s);
  const t = lobbyClock(s);
  const f = finale(s, ideas);
  const k = s.locked;
  // An idea taken out of the race while the focus was on it: the focus goes to the idea now selected.
  const list = useRef(null);
  const inList = useRef(false);
  const ids = ideas.map((d) => d.id).join();
  useEffect(() => {
    const at = document.activeElement;
    if (inList.current && (!at || at === document.body)) list.current?.querySelector(".idea[aria-pressed=true], .idea")?.focus();
  }, [ids]);
  const finaleWords = useFinaleWords(f, !t.canPledge, k ? (k.winner && !k.voided ? `Pledges are locked. $${k.winner} wins with ${sol(k.pot)}.${s.pledge?.symbol === k.winner ? " You’re on the winner." : ""}` : "Pledges are locked. No winner: every pledge is refunded.") : "");
  return html`<main class="ideas-col">
    <div class="list scroll" ref=${list} onFocusIn=${() => { inList.current = true; }} onFocusOut=${(e) => { if (e.relatedTarget) inList.current = list.current?.contains(e.relatedTarget) ?? false; }}>
      ${phone && html`<h2 class="sr">${ideas.length} ideas</h2>`}
      <span class="sr" role="status">${finaleWords}</span>
      ${f && html`<${Finale} f=${f} a=${a} phone=${phone} />`}
      ${!f && s.locked && !s.launched && html`<${Locked} s=${s} t=${t} />`}
      ${manages(s) && Object.keys(s.live.reports ?? {}).some((k) => s.live.reports[k] > 0 && ideas.some((d) => d.ticker === k)) && html`<div class="reported glass" role="group" aria-label="Reported ideas">
        <span class="t2" style="font-size:13px;font-weight:600">Reported</span>
        ${ideas.filter((d) => s.live.reports[d.ticker] > 0).map((d) => html`<button key=${d.id} type="button" class="chip amber" aria-pressed=${String(s.selected === d.id)} onClick=${() => a.select(d.id)}>$${d.ticker} · ${s.live.reports[d.ticker]}</button>`)}
        <span class="t2" style="font-size:12px">Select one to remove it from the dock</span>
      </div>`}
      ${s.intro !== null && t.canPledge && html`<${Intro} step=${s.intro} a=${a} />`}
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
    const dot = m.kind === "pledge" ? "var(--lime)" : m.kind === "arrive" ? "rgba(235,235,245,.4)" : "var(--sky)";
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
    ${s.welcome && !s.welcomeOff && html`<div class="welcome" role="note" aria-label="The host’s welcome">
      <${Avatar} person=${person(s.welcome.from ?? FEATURED.host)} size=${28} />
      <div style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:0">
        <span style="font-size:12px;font-weight:600">${person(s.welcome.from ?? FEATURED.host).name} <span class="t2" style="font-weight:500">· host · pinned</span></span>
        <span style="font-size:13px;line-height:1.45">${s.welcome.text}</span>
      </div>
      <${IconButton} label="Hide the welcome" size="sm" onClick=${() => { a.hideWelcome(); requestAnimationFrame(() => document.querySelector(".chat input, .chat textarea")?.focus()); }}><${I.Close} size=${12} /></${IconButton}>
    </div>`}
    <ol class="feed scroll" aria-live="off">${s.chat.slice().reverse().map((m, i) => html`<${ChatLine} key=${s.chat.length - i} m=${m} ideas=${byId} />`)}
      ${s.chat.length === 0 && html`<li class="t2 chat-empty">No messages yet. Say gm: everyone in the lobby reads this chat.</li>`}</ol>
    <${Composer} label=${hint === "Message" ? "Message the lobby" : hint} value=${s.draft} placeholder=${hint} maxLength=${200}
      onInput=${a.setDraft} onSend=${a.send}
      leading=${html`<${IconButton} label="Share the selected idea's art" onClick=${a.shareArt}><${I.Image} size=${17} /></${IconButton}>`} />
  </aside>`;
}

export function Lobby({ s, a, phone }) {
  const t = lobbyClock(s);
  const f = finale(s, race(s));
  const sel = race(s).find((d) => d.id === s.selected) || race(s)[0];
  const head = html`<header class="lobby-head">
    <${IconButton} label="Back to lobbies" size=${phone ? "sm" : undefined} onClick=${() => a.go({ screen: "discover" })}><${I.Back} size=${15} /></${IconButton}>
    <div class="title" style=${phone ? "flex:1" : ""}>
      <h1 class="ellipsis">${FEATURED.name}</h1>
      <span class="t2 num" style="font-size:13px">${phone ? t.label : `Hosted by ${FEATURED.host} · ${int(presence(s).inside)} inside${s.live && !s.live.connected ? " (last count)" : ""}`}</span>
    </div>
    ${!phone && html`<div class="tl"><${GestationTimeline} phases=${timeline(s.elapsed)} /></div>`}
    <div class="row" style="flex-wrap:nowrap;gap:14px">
      ${!phone && !s.live && html`<${Button} variant="ghost" size="sm" disabled=${s.elapsed >= 3594} title="Prototype only: jump to the last seconds before launch" onClick=${a.skipToLock}>Demo · skip to lock</${Button}>`}
      <div class=${`clock${f ? " finale-clock" : ""}${f?.urgent ? " urgent" : ""}`}>
        <span class="t2" style="font-size:12px;font-weight:600">${f ? "Pledges lock in" : t.phase === "lock" ? "Locked · launching in" : "Launch in"}</span>
        <span class="value display num" style=${{ color: f ? (f.urgent ? "#ffb340" : "var(--lime)") : t.phase === "lock" ? "#ffb340" : "var(--text)" }} role="timer" aria-label=${f ? `Pledges lock in ${f.lockIn}` : `Launch in ${t.launchIn}`}>${f ? f.lockIn : t.launchIn}</span>
      </div>
      <${WalletPill} s=${s} a=${a} compact=${phone} />
    </div>
  </header>`;
  const glow = `radial-gradient(50% 40% at 50% 0%, hsla(${sel.hue},90%,55%,.13), transparent 70%)`;
  if (phone) {
    return html`<div class="lobby screen">
      <div class="ambient" style=${{ background: glow, height: "100%" }} />
      ${head}
      <${NetBanner} net=${s.net} pledged=${!!s.pledge} inline />
      <div class="lobby-sub">
        <${GestationTimeline} phases=${timeline(s.elapsed)} labels=${false} height=${4} />
        <${Segmented} label="Lobby sections" full tabs options=${TABS} value=${s.lobbyTab} onChange=${a.setLobbyTab} />
      </div>
      <div class="lobby-body" id="lobby-panel" role="tabpanel" aria-labelledby=${`tab-${s.lobbyTab}`}>
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
    <${NetBanner} net=${s.net} pledged=${!!s.pledge} inline />
    <div class="lobby-body">
      <${Stage} s=${s} a=${a} />
      <${Ideas} s=${s} a=${a} />
      <${Chat} s=${s} a=${a} />
    </div>
  </div>`;
}
