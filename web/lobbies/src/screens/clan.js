// The clan: the forever room of a coin's founders. Desktop shows the clan rail, channels, the conversation and the
// founders side by side; a phone goes two levels deep, clan then channel, with the Campfire call on top of the channel.

import { html, Button, IconButton, Chip, Coin, Avatar, Composer } from "../ui.js";
import * as I from "../icons.js";
import { person, coin, CAMPFIRE, ROLES, ME } from "../demo/data.js";
import { channels, currentClan, founders, myFounderRank } from "../demo/select.js";
import { int, sol, signedPct, ticker } from "../format.js";

const ROLE_TONE = { host: "sky", creator: "pink", mod: "sky", founder: "lime" };

function change(k) {
  if (k.change === null) return html`<span class="num" style="font-size:13px;font-weight:600;color:var(--sky)">New</span>`;
  return html`<span class="num" style=${{ fontSize: "13px", fontWeight: 600, color: k.change >= 0 ? "var(--lime)" : "var(--amber)" }}>${signedPct(k.change)}</span>`;
}

function birthLine(s, k) {
  return k.fresh && s.launched
    ? `Born tonight in Lobby #0412: ${int(k.members)} people pledged ${sol(s.launched.sol)}. Only founders can write here, forever.`
    : `${k.story} ${k.born}. Only founders can write here, forever.`;
}

function campfirePeople(s) {
  const list = s.campfire.joined ? [...CAMPFIRE, ME] : CAMPFIRE;
  const speaking = s.beat % 3;
  return list.map((who, i) => ({ who, speaking: i === speaking && !s.campfire.deafened && who !== ME, muted: who === "remi" || (who === ME && s.campfire.muted), live: who === "kai" || (who === ME && s.campfire.sharing) }));
}

function ScreenShare({ s, height }) {
  return html`<div class="screen-share" style=${height ? { height: `${height}px` } : null} role="img" aria-label=${s.campfire.sharing ? "Your shared screen" : "kai’s shared screen: price chart"}>
    <svg width="100%" height="100%" viewBox="0 0 320 150" preserveAspectRatio="none" aria-hidden="true" style="position:absolute;inset:0">
      <path d="M0 120 L25 112 L50 118 L75 96 L100 100 L125 76 L150 84 L175 60 L200 66 L225 44 L250 52 L275 30 L300 36 L320 24" fill="none" stroke="var(--lime)" stroke-width="2" />
      <path d="M0 120 L25 112 L50 118 L75 96 L100 100 L125 76 L150 84 L175 60 L200 66 L225 44 L250 52 L275 30 L300 36 L320 24 L320 150 L0 150 Z" fill="var(--lime)" opacity=".08" />
    </svg>
    <span class="glass chip" style="position:absolute;left:10px;bottom:10px;height:28px"><span class="dot" style="background:var(--red)" />${s.campfire.sharing ? "Your screen" : "kai’s screen · chart review"}</span>
  </div>`;
}

function CallControls({ s, a, size }) {
  const c = s.campfire;
  return html`<div class="call-controls">
    <${IconButton} label=${c.muted ? "Unmute microphone" : "Mute microphone"} tone="warn" size=${size} pressed=${c.muted} onClick=${a.toggleMute}>${c.muted ? html`<${I.MicOff} />` : html`<${I.Mic} />`}</${IconButton}>
    <${IconButton} label=${c.sharing ? "Stop sharing your screen" : "Share your screen"} tone="sky" size=${size} pressed=${c.sharing} onClick=${a.toggleShare}><${I.Screen} /></${IconButton}>
    <${IconButton} label=${c.deafened ? "Undeafen" : "Deafen"} tone="warn" size=${size} pressed=${c.deafened} onClick=${a.toggleDeafen}><${I.Headphones} /></${IconButton}>
    <${Button} variant="danger" style="height:50px;padding:0 24px" onClick=${a.leaveCampfire}>Leave</${Button}>
  </div>`;
}

function Call({ s, a, phone }) {
  const people = campfirePeople(s);
  if (phone) {
    return html`<section class="call" aria-label="Campfire call">
      <${ScreenShare} s=${s} height=${120} />
      <div class="call-strip">${people.map((p) => html`<span key=${p.who} style="flex:none;display:flex;flex-direction:column;align-items:center;gap:6px;width:54px">
        <${Avatar} person=${person(p.who)} size=${48} speaking=${p.speaking} /><span style="font-size:11px;color:rgba(235,235,245,.8)">${p.who === ME ? "you" : p.who}</span></span>`)}</div>
      <${CallControls} s=${s} a=${a} size="lg" />
    </section>`;
  }
  return html`<section class="call" aria-label="Campfire call">
    <div class="call-grid">
      <${ScreenShare} s=${s} />
      ${people.map((p) => html`<div key=${p.who} class="tile">
        <${Avatar} person=${person(p.who)} size=${48} speaking=${p.speaking} muted=${p.muted} />
        <span style="font-size:13px;font-weight:500">${p.who === ME ? "you" : p.who}</span>
      </div>`)}
    </div>
    <${CallControls} s=${s} a=${a} size="lg" />
  </section>`;
}

function Message({ m, k, a, phone, mod }) {
  const p = person(m.who);
  const role = m.role || ROLES[m.who] || "founder";
  const mine = m.yours ?? m.who === ME;
  if (m.deleted) {
    return html`<li class="cmsg"><${Avatar} person=${p} size=${phone ? 36 : 40} />
      <span class="t2" style="font-size:14px;font-style:italic;align-self:center">${p.name} deleted a message</span></li>`;
  }
  if (m.hidden && !m.text) {
    return html`<li class="cmsg"><${Avatar} person=${p} size=${phone ? 36 : 40} />
      <span class="t2" style="font-size:14px;font-style:italic;align-self:center">Hidden after reports. A moderator will look at it.</span></li>`;
  }
  return html`<li class="cmsg">
    <${Avatar} person=${p} size=${phone ? 36 : 40} />
    <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px">
      <span class="row" style="gap:8px;align-items:baseline">
        <span style="font-size:14px;font-weight:600">${p.name}</span>
        <${Chip} tone=${ROLE_TONE[role]} class="role">${role}</${Chip}>
        <span class="t2 num" style="font-size:12px">${m.t}</span>
      </span>
      ${m.text && html`<span style="font-size:15px;line-height:1.5;overflow-wrap:anywhere">${m.text}</span>`}
      ${m.hidden && html`<span style="font-size:12px;font-weight:600;color:var(--amber)">Hidden from founders after reports${mine ? "" : " · only moderators see this"}</span>`}
      ${m.media.length > 0 && m.media[0].url && html`<span class="media">${m.media.map((x, i) => (x.video
        ? html`<video key=${i} src=${x.url} controls preload="metadata" aria-label=${`Clip shared by ${p.name}`} />`
        : html`<img key=${i} src=${x.url} alt=${`Image shared by ${p.name}`} loading="lazy" />`))}</span>`}
      ${m.media.length > 0 && !m.media[0].url && html`<span class="media">${m.media.map((x, i) => html`<span key=${i} role="img" aria-label=${x.video ? "Video clip of the mascot" : "Meme of the mascot"} style=${{ background: `radial-gradient(circle at 50% 35%, hsla(${x.hue},85%,50%,.5), #141416 78%)` }}>
        <${Coin} coin=${coin(k)} size=${phone ? 52 : 70} />
        ${x.video && html`<span class="glass chip" style="position:absolute;right:8px;bottom:8px;height:24px;font-size:11px"><${I.Play} size=${9} />0:14</span>`}
      </span>`)}</span>`}
      <span class="row" style="gap:6px">
        <button type="button" class="react" aria-pressed=${String(m.heartOn)} aria-label=${`Love, ${m.hearts + (m.heartOn ? 1 : 0)}`} onClick=${() => a.react(m.id, "heart")}><${I.Heart} size=${13} /><span class="num">${m.hearts + (m.heartOn ? 1 : 0)}</span></button>
        <button type="button" class="react" aria-pressed=${String(m.fireOn)} aria-label=${`Hype, ${m.fires + (m.fireOn ? 1 : 0)}`} onClick=${() => a.react(m.id, "fire")}><${I.Flame} size=${13} /><span class="num">${m.fires + (m.fireOn ? 1 : 0)}</span></button>
        <span style="flex:1" />
        ${mine || mod
          ? html`<button type="button" class="msg-tool" aria-label=${mine ? "Delete your message" : `Delete message from ${p.name}`} onClick=${() => a.deleteMessage(m.id)}>Delete</button>`
          : null}
        ${!mine && html`<button type="button" class="msg-tool" aria-label=${`Report message from ${p.name}`} onClick=${() => a.reportMessage(m.id)}>Report</button>`}
      </span>
    </div>
  </li>`;
}

function Conversation({ s, a, k, phone }) {
  const list = s.clanMessages[s.channel] || [];
  // Live, the clan is the server's: the plus button picks a real file to upload; in the demo it shares a meme.
  const live = k.id === "new" && !!s.liveClan;
  let picker = null;
  const chan = channels(s).find((c) => c.current);
  return html`<main class="clan-main" style=${{ background: `radial-gradient(60% 35% at 50% 0%, hsla(${k.hue},90%,55%,.09), transparent 70%), #000` }}>
    <header class="clan-head">
      ${phone && html`<${IconButton} label="Back to channels" size="sm" onClick=${a.backToChannels}><${I.Back} size=${15} /></${IconButton}>`}
      ${phone
        ? html`<div style="flex:1;min-width:0;display:flex;flex-direction:column"><h1 style="font-size:16px;font-weight:600"># ${chan.id}</h1><span class="t2 ellipsis" style="font-size:12px">${ticker(k.ticker)} clan · founders only</span></div>
            <${IconButton} label=${s.campfire.joined ? "In Campfire" : "Join Campfire voice"} tone="sky" size="sm" pressed=${s.campfire.joined} onClick=${() => a.joinCampfire()}><${I.Speaker} size=${16} /></${IconButton}>`
        : html`<span class="t2" style="font-size:20px">#</span><h1 style="font-size:16px;font-weight:600">${chan.id}</h1>
            <span class="t2 ellipsis" style="font-size:13px;flex:1;min-width:0">${chan.topic}</span>
            <span class="t2 row" style="font-size:12px;gap:6px"><${I.Lock} size=${14} />Founders only</span>
            <${Button} size="sm" aria-pressed=${String(s.campfire.joined)} onClick=${() => a.joinCampfire()}><${I.Speaker} size=${14} />${s.campfire.joined ? "In Campfire" : "Join Campfire"}</${Button}>
            <${IconButton} label=${s.showMembers ? "Hide founders" : "Show founders"} size="sm" pressed=${s.showMembers} onClick=${a.toggleMembers}><${I.People} size=${16} /></${IconButton}>`}
    </header>
    ${s.campfire.joined && html`<${Call} s=${s} a=${a} phone=${phone} />`}
    <ol class="cfeed scroll">
      ${list.slice().reverse().map((m) => html`<${Message} key=${m.id} m=${m} k=${k} a=${a} phone=${phone} mod=${live && (s.liveClan.role !== "founder")} />`)}
      <li class="birth">
        <${Coin} coin=${coin(k)} size=${48} />
        <span style="flex:1;display:flex;flex-direction:column;gap:3px"><span style="font-size:15px;font-weight:600">The beginning of #${chan.id}</span><span class="t2" style="font-size:13px;line-height:1.45">${birthLine(s, k)}</span></span>
        ${k.fresh && !phone && html`<${Button} size="sm" onClick=${() => a.go({ screen: "launch" })}>Replay the launch</${Button}>`}
      </li>
    </ol>
    <div style=${{ padding: phone ? "8px 10px 14px" : "0 20px 20px" }}>
      <${Composer} label=${`Message #${chan.id}`} value=${s.clanDraft} placeholder=${`Message #${chan.id}`} onInput=${a.setClanDraft} onSend=${a.sendClan}
        leading=${live
          ? html`<${IconButton} label="Share an image or clip" onClick=${() => picker?.click()}><${I.Plus} size=${17} /></${IconButton}>
              <input type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/quicktime,video/webm" ref=${(el) => { picker = el; }}
                onChange=${(e) => { a.shareFile(e.currentTarget.files[0]); e.currentTarget.value = ""; }} />`
          : html`<${IconButton} label="Share a meme" onClick=${a.shareMeme}><${I.Plus} size=${17} /></${IconButton}>`} />
    </div>
  </main>`;
}

function ChannelList({ s, a, phone }) {
  return channels(s).map((c) => phone
    ? html`<button type="button" key=${c.id} class=${`mrow ${c.unread ? "unread" : ""}`} onClick=${() => a.openChannel(c.id)}>
        <span class="t2" style="width:20px;font-size:18px">#</span><span style="flex:1">${c.id}</span>
        ${c.unread > 0 && html`<span class="badge" aria-label=${`${c.unread} unread`}>${c.unread}</span>`}<span class="t2"><${I.Chevron} size=${14} /></span>
      </button>`
    : html`<button type="button" key=${c.id} class=${`chan ${c.unread ? "unread" : ""}`} aria-current=${c.current ? "page" : undefined} onClick=${() => a.openChannel(c.id)}>
        <span class="t2" style="width:14px;text-align:center">#</span><span style="flex:1">${c.id}</span>
        ${c.unread > 0 && html`<span class="badge" aria-label=${`${c.unread} unread`}>${c.unread}</span>`}
      </button>`);
}

function FounderRow({ f }) {
  return html`<span class="member">
    <${Avatar} person=${person(f.who)} size=${34} status=${f.online ? "#30d158" : "rgba(235,235,245,.3)"} />
    <span style="flex:1;min-width:0;display:flex;flex-direction:column"><span style="font-size:14px;font-weight:500">${person(f.who).name}</span><span class="t2 num" style="font-size:12px">pledged ${f.amount} SOL</span></span>
    <span class="t2 num" style="font-size:12px;font-weight:600">#${f.rank}</span>
  </span>`;
}

function PhoneClanList({ s, a, k }) {
  const people = campfirePeople(s);
  return html`<div class="clan-list scroll screen" style=${{ background: `radial-gradient(60% 35% at 50% 0%, hsla(${k.hue},90%,55%,.09), transparent 70%), #000` }}>
    <h1 class="display large-title" style="margin:20px 20px 14px">Clans</h1>
    <div class="hscroll" style="gap:12px;padding:4px 20px 14px" role="group" aria-label="Your clans">
      ${s.clans.map((c) => html`<button type="button" key=${c.id} class="rail-btn" aria-label=${`${ticker(c.ticker)} clan`} aria-current=${c.id === k.id ? "page" : undefined}
        style=${{ width: "56px", height: "56px", flex: "none", borderRadius: c.id === k.id ? "16px" : "50%", boxShadow: c.id === k.id ? "0 0 0 2px #000, 0 0 0 4px #f5f5f7" : "none", overflow: "hidden" }} onClick=${() => a.openClan(c.id)}>
        <${Coin} coin=${coin(c)} size=${56} /></button>`)}
    </div>
    <div style="display:flex;flex-direction:column;gap:20px;padding:0 16px">
      <div class="panel" style="padding:16px;display:flex;flex-direction:column;gap:12px">
        <div class="row" style="flex-wrap:nowrap;gap:12px">
          <${Coin} coin=${coin(k)} size=${52} />
          <div style="flex:1;min-width:0;display:flex;flex-direction:column"><span style="font-size:18px;font-weight:600">${k.name}</span><span class="t2 num" style="font-size:13px">${int(k.members)} founders · Founder #${myFounderRank(s, k)}</span></div>
          <span style="display:flex;flex-direction:column;align-items:flex-end"><span class="num" style="font-size:13px;font-weight:600">${ticker(k.ticker)}</span>${change(k)}</span>
        </div>
        <span class="t2" style="font-size:13px;line-height:1.45">${birthLine(s, k)}</span>
        ${k.fresh && html`<${Button} size="sm" style="align-self:flex-start" onClick=${() => a.go({ screen: "launch" })}>Replay the launch</${Button}>`}
      </div>
      <section aria-labelledby="m-voice" style="display:flex;flex-direction:column;gap:8px">
        <h2 id="m-voice" class="t2" style="font-size:13px;font-weight:600;padding:0 6px">Voice</h2>
        <div class="panel" style=${{ padding: "14px", display: "flex", flexDirection: "column", gap: "12px", borderColor: s.campfire.joined ? "rgba(100,210,255,.35)" : undefined }}>
          <div class="row" style="flex-wrap:nowrap;gap:12px">
            <span style="width:40px;height:40px;border-radius:12px;background:rgba(100,210,255,.14);color:var(--sky);display:flex;align-items:center;justify-content:center"><${I.Speaker} /></span>
            <span style="flex:1;display:flex;flex-direction:column"><span style="font-size:16px;font-weight:600">Campfire</span><span class="num" style="font-size:12px;color:var(--sky)">${people.length} connected</span></span>
            ${s.campfire.joined
              ? html`<${Button} size="sm" style="color:var(--sky)" onClick=${() => a.openChannel(s.channel)}>Open call</${Button}>`
              : html`<${Button} variant="white" size="sm" onClick=${() => a.joinCampfire(true)}>Join</${Button}>`}
          </div>
          <div class="row" style="gap:6px">${people.map((p) => html`<${Avatar} key=${p.who} person=${person(p.who)} size=${32} speaking=${p.speaking} />`)}</div>
        </div>
      </section>
      <section aria-labelledby="m-channels" style="display:flex;flex-direction:column;gap:8px">
        <h2 id="m-channels" class="t2" style="font-size:13px;font-weight:600;padding:0 6px">Channels</h2>
        <div class="panel" style="overflow:hidden"><${ChannelList} s=${s} a=${a} phone /></div>
      </section>
      <section aria-labelledby="m-founders" style="display:flex;flex-direction:column;gap:8px">
        <h2 id="m-founders" class="t2" style="font-size:13px;font-weight:600;padding:0 6px">Top founders</h2>
        <div class="panel" style="padding:6px 0">${founders(s, k).map((f) => html`<${FounderRow} key=${f.who} f=${f} />`)}</div>
      </section>
    </div>
  </div>`;
}

export function Clan({ s, a, phone }) {
  const k = currentClan(s);
  if (phone) return s.clanView === "chat" ? html`<${Conversation} s=${s} a=${a} k=${k} phone />` : html`<${PhoneClanList} s=${s} a=${a} k=${k} />`;
  const people = campfirePeople(s);
  return html`<div class="clan screen">
    <nav class="rail scroll" aria-label="Your clans">
      <button type="button" class="rail-btn" aria-label="Lobbies" style="background:var(--fill);display:flex;align-items:center;justify-content:center" onClick=${() => a.go({ screen: "discover" })}><${I.Logo} size=${24} /></button>
      <span style="width:28px;height:1px;background:rgba(255,255,255,.1)" />
      ${s.clans.map((c) => html`<span key=${c.id} class="rail-item">
        <span class="pill" style=${{ height: c.id === k.id ? "36px" : c.unread ? "8px" : "0" }} />
        <button type="button" class="rail-btn" aria-label=${`${ticker(c.ticker)} clan`} aria-current=${c.id === k.id ? "page" : undefined} style="overflow:hidden;border-radius:50%" onClick=${() => a.openClan(c.id)}><${Coin} coin=${coin(c)} size=${48} /></button>
      </span>`)}
      <button type="button" class="rail-btn" aria-label="Find a lobby" style="border:1px dashed rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;color:var(--lime)" onClick=${() => a.go({ screen: "discover" })}><${I.Plus} /></button>
    </nav>
    <aside class="channels" aria-label="Channels">
      <div style="padding:18px 16px 14px;display:flex;flex-direction:column;gap:14px;border-bottom:1px solid rgba(255,255,255,.05)">
        <div class="row" style="flex-wrap:nowrap;gap:12px"><${Coin} coin=${coin(k)} size=${40} />
          <div style="display:flex;flex-direction:column;min-width:0"><span class="ellipsis" style="font-weight:600;font-size:15px">${k.name}</span><span class="t2 num" style="font-size:12px">${int(k.members)} founders · ${k.born}</span></div></div>
        <div class="row" style="justify-content:space-between;height:38px;padding:0 12px;border-radius:12px;background:rgba(118,118,128,.16)"><span class="num" style="font-size:13px;font-weight:600">${ticker(k.ticker)}</span>${change(k)}</div>
      </div>
      <div class="scroll" style="flex:1;min-height:0;padding:14px 8px;display:flex;flex-direction:column;gap:18px">
        <div style="display:flex;flex-direction:column;gap:2px"><span class="group-label">Text</span><${ChannelList} s=${s} a=${a} /></div>
        <div style="display:flex;flex-direction:column;gap:2px"><span class="group-label">Voice</span>
          <button type="button" class="chan" aria-current=${s.campfire.joined ? "page" : undefined} onClick=${() => a.joinCampfire()}>
            <span style="color:var(--sky)"><${I.Speaker} size=${15} /></span><span style="flex:1">Campfire</span><span class="num" style="font-size:12px;font-weight:600;color:var(--sky)">${people.length}</span></button>
          <div style="display:flex;flex-direction:column;padding-left:30px">${people.map((p) => html`<span key=${p.who} class="row" style="height:30px;gap:8px;font-size:13px;color:rgba(235,235,245,.78);flex-wrap:nowrap">
            <${Avatar} person=${person(p.who)} size=${22} speaking=${p.speaking} /><span class="ellipsis" style="flex:1">${person(p.who).name}</span>${p.live && html`<${Chip} tone="red" class="live">LIVE</${Chip}>`}</span>`)}</div>
        </div>
      </div>
      <div style="padding:10px;display:flex;flex-direction:column;gap:8px;border-top:1px solid rgba(255,255,255,.05)">
        ${s.campfire.joined && html`<div class="row" style="flex-wrap:nowrap;padding:10px 12px;border-radius:14px;background:rgba(100,210,255,.08)">
          <span style="flex:1;display:flex;flex-direction:column"><span style="font-size:13px;font-weight:600;color:var(--sky)">Voice connected</span><span class="t2" style="font-size:12px">Campfire · ${k.ticker}</span></span>
          <${IconButton} label="Disconnect from voice" tone="danger" size="sm" onClick=${a.leaveCampfire}><${I.Close} size=${14} /></${IconButton}></div>`}
        <div class="me-strip">
          <${Avatar} person=${person(ME)} size=${34} />
          <span style="flex:1;min-width:0;display:flex;flex-direction:column"><span style="font-size:13px;font-weight:600">degen_marc</span><span style="font-size:12px;font-weight:600;color:var(--lime)">Founder #${myFounderRank(s, k)}</span></span>
          <${IconButton} label=${s.campfire.muted ? "Unmute microphone" : "Mute microphone"} tone="warn" size="sm" pressed=${s.campfire.muted} onClick=${a.toggleMute}>${s.campfire.muted ? html`<${I.MicOff} size=${15} />` : html`<${I.Mic} size=${15} />`}</${IconButton}>
          <${IconButton} label=${s.campfire.deafened ? "Undeafen" : "Deafen"} tone="warn" size="sm" pressed=${s.campfire.deafened} onClick=${a.toggleDeafen}><${I.Headphones} size=${15} /></${IconButton}>
        </div>
      </div>
    </aside>
    <${Conversation} s=${s} a=${a} k=${k} />
    ${s.showMembers && html`<aside class="members scroll" aria-label="Founders">
      <span class="t2 num" style="font-size:12px;font-weight:600;padding:0 10px 8px">Founders · ${int(k.members)}</span>
      ${founders(s, k).map((f) => html`<${FounderRow} key=${f.who} f=${f} />`)}
    </aside>`}
  </div>`;
}
