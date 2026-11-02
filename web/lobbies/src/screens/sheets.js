// Sheets: confirm a pledge, propose an idea, host a lobby, the wallet. Money sheets say what happens if the idea
// wins, if it loses, and what it costs, before anything is signed.

import { useEffect, useRef, useState } from "preact/hooks";
import { html, Button, Segmented, Coin, Sheet, Avatar, Chip } from "../ui.js";
import * as I from "../icons.js";
import { coin, FEATURED, LOBBIES } from "../demo/data.js";
import { nextOpening, icsFor, googleCalendarUrl, calendarFileName, LEAD_MS, hhmm, dayOf, notifyPermission } from "../remind/remind.js";
import { prepareReplay, playReplay, recordReplay, drawFrame, replayStory, videoType, replayFileName, SIZE as REPLAY_SIZE, LENGTH_MS } from "../race/replay.js";
import { addressPerson, shortAddress, WALLET_TINT, isAddress, txUrl } from "../wallet/wallets.js";
import { drawBirthCard, cardCaption, cardFileName, cardText, FORMATS } from "../card/birthcard.js";
import { race, dock, lobbyClock, profile, lobbyInfo } from "../demo/select.js";
import { PROPOSE_BOND } from "../demo/store.js";
import { sol, ticker, initials } from "../format.js";

// What someone typed, without invisible direction marks (a theme can't be shown reversed).
const plain = (t) => t.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\u061C\uFEFF]/g, "").trim();

const HUES = [[150, "Mint"], [205, "Sky"], [265, "Violet"], [340, "Pink"], [18, "Ember"], [45, "Gold"]];
const SLOTS = ["21:00", "22:00", "23:00"];

function PledgeSheet({ s, a }) {
  const d = dock(s, race(s));
  // Live, a pledge goes to the lobby's server: not while it can't be reached.
  const unreachable = !!s.live && (s.net.offline || s.net.server !== "ok");
  return html`<div style="display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center;padding-top:8px">
      <${Coin} coin=${coin(d.sel)} size=${84} big />
      <h2 id="pledge-title" style="font-size:16px;font-weight:600">Back ${ticker(d.sel.ticker)} · ${d.sel.name}</h2>
      <span class="display num" style="font-size:56px;line-height:1">${sol(s.amount)}</span>
      <${Chip} tone="amber">Practice pledge</${Chip}>
    </div>
    <div class="rows">
      <div><span>If it wins</span><span class="num">${d.shareIfWins >= 99.995 ? "You’d be its only backer: the whole opening batch" : `About ${d.shareIfWins.toFixed(2)}% of its opening batch, at the same price as every backer`}</span></div>
      <div><span>If it loses</span><span>Full refund when pledges lock, 5 minutes before the launch</span></div>
      <div><span>Change your mind</span><span>Withdraw or move it until pledges lock</span></div>
      <div><span>Your wallet</span><span>No SOL leaves it: this lobby is a rehearsal until it runs on Solana</span></div>
    </div>
    <span class="t2" style="font-size:12px;line-height:1.5;text-align:center">Memecoins are speculative and can lose all their value. This is not an investment or advice.
      <button type="button" class="link" onClick=${() => a.openSheet("terms")}>Risks and terms</button></span>
    ${unreachable && html`<span class="remind-error" role="alert"><${I.Alert} size=${14} />${s.net.offline ? "You’re offline. Confirm when you’re back online." : "The lobby server can’t be reached. Confirm when it’s back."}</span>`}
    <div class="sheet-actions">
      <${Button} size="lg" disabled=${s.signing} onClick=${a.closeSheet}>Cancel</${Button}>
      <span class="sr" role="status">${s.signing ? "Confirming your pledge" : ""}</span>
      <${Button} variant="prim" size="lg" style="flex:1.4" disabled=${unreachable} aria-disabled=${s.signing ? "true" : undefined} onClick=${() => { if (!s.signing) a.confirmPledge(); }}>
        ${s.signing ? html`<span class="spin" aria-hidden="true" />Confirming` : "Confirm practice pledge"}
      </${Button}>
    </div>`;
}

function ProposeSheet({ s, a }) {
  const [form, setForm] = useState({ name: "", ticker: "", pitch: "", hue: 150 });
  const taken = s.ideas.some((d) => d.ticker === form.ticker);
  const valid = form.name.trim().length >= 2 && form.ticker.length >= 2 && form.pitch.trim().length >= 8 && !taken && s.balance >= PROPOSE_BOND;
  const preview = { ticker: form.ticker || initials(form.name || "?"), hue: form.hue, name: form.name };
  return html`
    <div class="row" style="flex-wrap:nowrap;gap:16px;padding:16px;border-radius:20px;background:rgba(0,0,0,.3)">
      <${Coin} coin=${preview} size=${64} />
      <span style="display:flex;flex-direction:column;gap:2px;min-width:0"><span class="ellipsis" style="font-size:17px;font-weight:600">${form.name || "Your idea"}</span><span class="t2" style="font-size:14px">${ticker(form.ticker || "TICKR")}</span></span>
    </div>
    <label class="field"><span class="lbl">Name</span><input class="inp" value=${form.name} maxLength=${24} placeholder="Pigeon Wizard" onInput=${(e) => setForm({ ...form, name: e.currentTarget.value })} /></label>
    <label class="field"><span class="lbl">Ticker</span>
      <input class="inp" value=${form.ticker} maxLength=${6} placeholder="WZRD" aria-invalid=${String(taken)} aria-describedby="ticker-err"
        onInput=${(e) => setForm({ ...form, ticker: e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) })} />
      ${taken && html`<span id="ticker-err" class="err">${ticker(form.ticker)} is already in the race. Pick another ticker.</span>`}
    </label>
    <label class="field"><span class="lbl"><span>One-line pitch</span><span class="num" style="font-weight:500">${form.pitch.length}/90</span></span>
      <textarea class="inp" maxLength=${90} placeholder="Why should the lobby back it?" value=${form.pitch} onInput=${(e) => setForm({ ...form, pitch: e.currentTarget.value })} /></label>
    <div class="field"><span class="lbl">Color</span>
      <div class="row" role="group" aria-label="Coin color">${HUES.map(([hue, label]) => html`<button type="button" key=${hue} aria-label=${label} aria-pressed=${String(form.hue === hue)} onClick=${() => setForm({ ...form, hue })}
        style=${{ width: "36px", height: "36px", borderRadius: "50%", background: `radial-gradient(circle at 32% 24%, hsl(${hue} 100% 90%), hsl(${hue} 72% 48%))`, boxShadow: form.hue === hue ? "0 0 0 2px #000, 0 0 0 4px #f5f5f7" : "none" }} />`)}</div>
    </div>
    <span class="t2" style="font-size:13px;line-height:1.45">Proposing holds a ${PROPOSE_BOND} SOL bond against spam. You get it back at lock, win or lose.</span>
    <div class="sheet-actions">
      <${Button} onClick=${a.closeSheet}>Cancel</${Button}>
      <${Button} variant="white" disabled=${!valid} onClick=${() => a.proposeIdea({ name: form.name.trim(), ticker: form.ticker, pitch: form.pitch.trim(), hue: form.hue })}>Put it in the race</${Button}>
    </div>`;
}

function HostSheet({ a }) {
  const [form, setForm] = useState({ name: "", theme: "", slot: 0 });
  const valid = form.name.trim().length >= 3 && form.theme.trim().length >= 3;
  return html`
    <span class="t2" style="font-size:14px;line-height:1.5">You set the theme and run the stage: you bring people up to pitch, and you can move them back. Hosting earns nothing and costs only the network fee.</span>
    <label class="field"><span class="lbl">Lobby name</span><input class="inp" value=${form.name} maxLength=${32} placeholder="Late Night Lizards" onInput=${(e) => setForm({ ...form, name: e.currentTarget.value })} /></label>
    <label class="field"><span class="lbl">Theme</span><input class="inp" value=${form.theme} maxLength=${60} placeholder="Every coin must be a reptile" onInput=${(e) => setForm({ ...form, theme: e.currentTarget.value })} /></label>
    <div class="field"><span class="lbl">Opens at</span>
      <${Segmented} label="Opening time" options=${SLOTS.map((t, i) => ({ id: i, label: t }))} value=${form.slot} onChange=${(slot) => setForm({ ...form, slot })} /></div>
    <div class="sheet-actions">
      <${Button} onClick=${a.closeSheet}>Cancel</${Button}>
      <${Button} variant="white" disabled=${!valid} onClick=${() => a.hostLobby({ name: plain(form.name), theme: plain(form.theme), opens: SLOTS[form.slot] })}>Schedule lobby</${Button}>
    </div>`;
}

const WHY = {
  chat: "Connect a wallet to chat.",
  report: "Connect a wallet to report an idea.",
  speak: "Connect a wallet to speak on stage.",
  clan: "Connect the wallet you pledged with to enter your clan.",
  switched: "You switched accounts in your wallet, so you were signed out. Connect to continue with the new one.",
  pledge: "Connect a wallet to pledge. Each wallet gets 10 practice SOL here; none of your own SOL moves.",
};

// Connect: the installed wallets first, each one tap. Only the address is shared; on a live server the wallet then
// signs a one-time message to prove it (free, no transaction). Every state says what to do next.
function ConnectSheet({ s, a }) {
  const w = s.wallet;
  const wallets = a.wallets().sort((x, y) => Number(y.installed) - Number(x.installed));
  const none = !wallets.some((x) => x.installed);
  const busy = w.status === "connecting" || w.status === "signing";
  return html`
    <p class="t2" style="font-size:15px;line-height:1.5">${WHY[s.connectFor] ? html`<strong style="color:var(--text);font-weight:600">${WHY[s.connectFor]}</strong> ` : ""}Only your address is shared. Signing in is free: no transaction, no SOL moves.</p>
    <ul class="wallets" role="list">
      ${wallets.map((x) => {
        const mine = busy && w.id === x.id;
        const hint = !x.installed ? (x.browseUrl ? `Open in ${x.name}` : "Get it") : mine ? (w.status === "signing" ? `Sign the message in ${x.name}` : `Approve in ${x.name}`) : "Detected";
        return html`<li key=${x.id}>
          ${x.installed
            ? html`<button type="button" class="wallet-row" aria-label=${mine ? x.name : `${x.name}, detected`} disabled=${busy && !mine} aria-busy=${mine ? "true" : undefined} onClick=${() => a.connectWallet(x.id)}>
                <span class="wallet-mark" style=${{ background: WALLET_TINT[x.id] ?? WALLET_TINT.injected }} aria-hidden="true">${x.name[0]}</span>
                <span style="flex:1;text-align:left;font-size:16px;font-weight:600">${x.name}</span>
                <span class="t2" style="font-size:13px;font-weight:600;display:inline-flex;align-items:center;gap:8px">${mine && html`<span class="spin light" aria-hidden="true" />`}${hint}</span>
              </button>`
            : html`<a class="wallet-row" href=${x.browseUrl ?? x.url} target=${x.browseUrl ? undefined : "_blank"} rel="noopener">
                <span class="wallet-mark" style=${{ background: WALLET_TINT[x.id] ?? WALLET_TINT.injected }} aria-hidden="true">${x.name[0]}</span>
                <span style="flex:1;text-align:left;font-size:16px;font-weight:600">${x.name}</span>
                <span class="wallet-get" style="font-size:13px;font-weight:600;display:inline-flex;align-items:center;gap:8px">${hint}<${I.Arrow} size=${13} /><span class="sr">${x.browseUrl ? " (opens this page in the app)" : " (opens its site in a new tab)"}</span></span>
              </a>`}
        </li>`;
      })}
    </ul>
    <span class="sr" role="status">${busy ? (w.status === "signing" ? `Sign the message in ${w.name}` : `Approve in ${w.name}`) : ""}</span>
    ${w.error && html`<p class="wallet-error" role="alert">${w.error}</p>`}
    ${none && (wallets.some((x) => x.browseUrl)
      ? html`<p class="t2" style="font-size:13px;line-height:1.5">On a phone, your wallet is an app. Open this page in it to connect: tap your wallet above. No wallet yet? Phantom is the easiest to start with.</p>`
      : html`<p class="t2" style="font-size:13px;line-height:1.5">No wallet found in this browser. Phantom is the easiest to start with: install it, come back, and it shows up here.</p>`)}`;
}

function WalletSheet({ s, a }) {
  const mine = s.pledge && s.ideas.find((d) => d.id === s.pledge.id);
  const t = lobbyClock(s);
  const w = s.wallet;
  if (!w.address) return null; // just disconnected: the sheet is closing
  const real = w.balance !== null && w.balance !== undefined;
  // Live, only what is this wallet's: the clans it founded here, not the demo's.
  const clans = s.live ? s.clans.filter((k) => k.id === "new") : s.clans;
  return html`
    <div class="row" style="flex-wrap:nowrap;gap:14px">
      <${Avatar} person=${addressPerson(w.address)} size=${52} />
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">
        <${Button} variant="ghost" size="sm" class="num" style="align-self:flex-start;margin-left:-10px;padding:0 10px;font-size:17px" aria-label=${`Copy address ${shortAddress(w.address)}`} onClick=${a.copyAddress}>${shortAddress(w.address)}<${I.Copy} size=${14} /></${Button}>
        <span class="t2" style="font-size:13px">${w.name}${w.signedIn ? " · signed in" : ""}</span>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:2px">
      ${real
        ? html`<span class="display num" style="font-size:44px">${sol(w.balance)}</span><span class="t2" style="font-size:13px">Balance on Solana</span>`
        : html`<span style="align-self:flex-start"><${Chip} tone="amber">Practice SOL</${Chip}></span>
            <span class="display num" style="font-size:28px">${sol(s.balance)}</span>
            <span class="t2" style="font-size:13px;line-height:1.45">For pledging in practice lobbies. Not your wallet’s SOL: none of yours moves until a lobby runs on Solana.</span>`}
    </div>
    <div style="display:flex;flex-direction:column;gap:10px">
      <span class="t2" style="font-size:13px;font-weight:600">${s.launched ? "This lobby" : "Open pledge"}</span>
      ${s.launched
        ? html`<span style="font-size:14px">${s.launched.founder ? `Founder #${Number(s.launched.rank).toLocaleString("en-US")} of $${s.launched.id.toUpperCase()}` : s.launched.myAmount ? `Your ${sol(s.launched.myAmount)} came back: $${s.launched.id.toUpperCase()} won` : `$${s.launched.id.toUpperCase()} launched; you didn’t pledge`}</span>`
        : mine
        ? html`<div class="row" style="flex-wrap:nowrap;gap:12px;padding:12px;border-radius:16px;background:rgba(0,0,0,.3)">
            <${Coin} coin=${coin(mine)} size=${38} />
            <span style="flex:1;display:flex;flex-direction:column"><span style="font-size:14px;font-weight:600">${sol(s.pledge.amount)} on ${ticker(mine.ticker)}</span><span class="t2 num" style="font-size:12px">Friday Night Degens · locks in ${t.lockIn}</span></span>
            <${Button} size="sm" disabled=${!t.canPledge} onClick=${() => a.openSheet("withdraw")}>Withdraw</${Button}>
          </div>`
        : html`<span class="t2" style="font-size:14px">No open pledge. Back an idea in a live lobby.</span>`}
    </div>
    <div style="display:flex;flex-direction:column;gap:10px">
      <span class="t2" style="font-size:13px;font-weight:600">Founder of</span>
      ${clans.length === 0 && html`<span class="t2" style="font-size:14px">No clan yet. Back the winning idea in a lobby to become a founder.</span>`}
      <div class="row" style="gap:8px">${clans.map((k) => html`<${Button} key=${k.id} size="sm" style="padding:0 12px 0 4px;height:36px" onClick=${() => a.openClan(k.id)}><${Coin} coin=${coin(k)} size=${28} />${ticker(k.ticker)}</${Button}>`)}</div>
    </div>
    <div class="row" style="gap:8px">
      <${Button} variant="ghost" size="sm" style="margin-left:-10px;padding:0 10px;color:var(--sky)" onClick=${() => a.openSheet("profile")}>Founder profile</${Button}>
      <${Button} variant="ghost" size="sm" style="padding:0 10px" onClick=${() => a.openSheet("terms")}>Risks and terms</${Button}>
      <${Button} variant="ghost" size="sm" style="padding:0 10px;color:#ff6961" onClick=${a.disconnect}>Disconnect</${Button}>
    </div>
    ${s.receipts.length > 0 && html`<div style="display:flex;flex-direction:column;gap:10px">
      <span class="t2" style="font-size:13px;font-weight:600">Activity</span>
      <ol class="rows">${s.receipts.slice(0, 5).map((r, i) => html`<li key=${i} style="display:flex;justify-content:space-between;gap:12px;padding:12px 0;font-size:14px;border-top:${i ? "1px solid rgba(255,255,255,.07)" : "0"}">
        <button type="button" style="text-align:left;flex:1;min-height:44px" onClick=${() => a.showReceipt(r)}>${r.title}</button>
        ${proofLink(r) ? html`<a class="link" style="align-self:center;font-size:13px" href=${proofLink(r)} target="_blank" rel="noopener" aria-label=${`${r.title}: view on Solscan (opens in a new tab)`}>Solscan</a>` : html`<span class="t2" style="align-self:center"><${I.Chevron} size=${14} /></span>`}</li>`)}</ol>
    </div>`}`;
}

// The birth card: drawn when the sheet opens (and again for the other shape), then shared the way this device
// shares (the share sheet, with the image and its caption), saved, or its words copied. The sheet stays open, so
// one can save it and copy the caption, or make both shapes.
function BirthCardSheet({ s, a }) {
  const l = s.launched;
  const win = l && s.ideas.find((d) => d.id === l.id);
  const [format, setFormat] = useState("post");
  const [mounted, setMounted] = useState(false); // the status region exists empty first, so its words are read
  useEffect(() => { setMounted(true); }, []);
  const [card, setCard] = useState(null); // { url, file, facts, format }
  useEffect(() => {
    if (!l || !win) return undefined;
    let url = null;
    let live = true;
    setCard(null);
    const facts = { ticker: win.ticker, name: win.name, hue: win.hue, logo: coin(win).logo, rank: l.rank, pot: l.sol, founders: l.backers, lobby: "#0412", date: new Date(), mint: isAddress(l.mint) ? l.mint : null, practice: !isAddress(l.mint) };
    drawBirthCard(facts, format).then((blob) => {
      if (!live || !blob) return;
      url = URL.createObjectURL(blob);
      setCard({ url, facts, format, file: new File([blob], cardFileName(facts, format), { type: "image/png" }) });
    });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [l && l.id, l && l.rank, format]);
  if (!l || !win) return null;
  const ready = card && card.format === format ? card : null; // never the other shape's image under this one's name
  const { width, height } = FORMATS[format];
  const link = `${location.origin}${location.pathname}`;
  const caption = ready && cardCaption(ready.facts, link);
  const canShare = !!(ready && navigator.canShare?.({ files: [ready.file] }));
  const save = () => {
    const anchor = document.createElement("a");
    anchor.href = ready.url;
    anchor.download = ready.file.name;
    anchor.click();
    a.cardDone("Image saved");
  };
  const share = async () => {
    try {
      await navigator.share({ files: [ready.file], text: caption, title: `Founder #${ready.facts.rank} of $${ready.facts.ticker}` });
      a.cardDone("Shared");
    } catch (e) {
      if (e?.name !== "AbortError") save(); // a share sheet that fails still leaves the image
    }
  };
  const copy = () => navigator.clipboard?.writeText(caption).then(() => a.cardDone("Caption copied"), () => a.cardDone(caption));
  return html`
    <${Segmented} label="Card shape" full options=${Object.entries(FORMATS).map(([id, f]) => ({ id, label: f.label }))} value=${format} onChange=${setFormat} />
    <div class=${`card-preview ${format}`} style=${{ aspectRatio: `${width} / ${height}` }}>
      ${ready ? html`<img src=${ready.url} alt=${cardText(ready.facts)} width=${width} height=${height} />`
        : html`<span class="t2" style="font-size:14px">Drawing your card…</span>`}
    </div>
    <span class="sr" role="status">${ready ? `${FORMATS[format].label} card ready` : mounted ? "Drawing your card" : ""}</span>
    <p class="t2" style="font-size:14px;line-height:1.5">Made on this device from the launch. Only what you share leaves it.</p>
    <div class="sheet-actions">
      ${canShare
        ? html`<${Button} size="lg" disabled=${!ready} onClick=${save}>Save image</${Button}>
            <${Button} variant="prim" size="lg" style="flex:1.4" disabled=${!ready} onClick=${share}><${I.Share} size=${17} />Share…</${Button}>`
        : html`<${Button} size="lg" disabled=${!ready} onClick=${copy}>Copy caption</${Button}>
            <${Button} variant="prim" size="lg" style="flex:1.4" disabled=${!ready} onClick=${save}>Save image</${Button}>`}
    </div>`;
}

// The hour in 30 seconds: the race from what the lobby recorded, then the launch. It plays by itself (not when the
// person asked for less motion), says in words what happened, and can be saved or shared as a video.
function ReplaySheet({ s, a }) {
  const canvas = useRef(null);
  const player = useRef(null);
  const [r, setR] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [video, setVideo] = useState(null); // { file, url }
  const [recording, setRecording] = useState(false);
  const ms = globalThis.__replayMs ?? LENGTH_MS; // tests play it faster
  const l = s.launched;
  const winner = l ? s.ideas.find((d) => d.id === l.id) : null;
  useEffect(() => {
    let live = true;
    const coins = Object.fromEntries(s.ideas.map((d) => [d.ticker, { hue: d.hue, name: d.name, logo: coin(d).logo }]));
    prepareReplay({ curve: s.curve, coins, winner: winner?.ticker ?? null, pot: l?.sol ?? 0, lobby: lobbyInfo(s).name, practice: !isAddress(l?.mint) }).then((x) => {
      if (!live) return;
      setR(x);
      const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (still) { drawFrame(canvas.current.getContext("2d"), x, 1); setProgress(1); } else play(x, 0);
    });
    return () => { live = false; player.current?.stop(); };
  }, []);
  useEffect(() => () => { if (video) URL.revokeObjectURL(video.url); }, [video]);
  // The video made, its Save button takes the focus the Make a video button had.
  const actions = useRef(null);
  useEffect(() => { if (video) actions.current?.querySelector("button")?.focus(); }, [video]);
  function play(x = r, from = 0) {
    player.current?.stop();
    setPlaying(true);
    player.current = playReplay(canvas.current, x, { ms, from, onFrame: setProgress, onEnd: () => setPlaying(false) });
  }
  const pause = () => { player.current?.stop(); setPlaying(false); };
  const toggle = () => (playing ? pause() : play(r, progress >= 1 ? 0 : progress));
  const record = async () => {
    pause();
    setRecording(true);
    const file = await recordReplay(canvas.current, r, { ms, onFrame: setProgress });
    setRecording(false);
    if (!file) return a.cardDone("This browser can’t record video. Try another browser.");
    setVideo({ file, url: URL.createObjectURL(file) });
  };
  const save = () => {
    const anchor = document.createElement("a");
    anchor.href = video.url;
    anchor.download = video.file.name;
    anchor.click();
    a.cardDone("Video saved");
  };
  const caption = winner ? `The hour that launched $${winner.ticker}, in 30 seconds.${l && isAddress(l.mint) ? "" : " A Social Launch practice lobby."}` : "A Social Launch lobby, in 30 seconds.";
  const share = async () => {
    try { await navigator.share({ files: [video.file], text: caption, title: "Lobby replay" }); a.cardDone("Shared"); }
    catch (e) { if (e?.name !== "AbortError") save(); }
  };
  const canShare = !!(video && navigator.canShare?.({ files: [video.file] }));
  const story = r ? replayStory(r) : [];
  const canRecord = !!videoType();
  const left = Math.ceil(((1 - progress) * ms) / 1000);
  return html`
    <div class="card-preview replay">
      <canvas ref=${canvas} width=${REPLAY_SIZE} height=${REPLAY_SIZE} role="img" aria-label="The lobby’s race, replayed. What happened is listed below."></canvas>
      <span class="replay-progress" aria-hidden="true"><span style=${{ width: `${progress * 100}%` }} /></span>
    </div>
    <span class="sr" role="status">${recording ? "Recording the replay, 30 seconds" : video ? "Video ready: Save video" : ""}</span>
    <ol class="replay-story" aria-label="What happened">${story.map((e) => html`<li key=${e.t + e.text}><span class="num t2">${e.t}</span><span>${e.text}</span></li>`)}</ol>
    <div class="sheet-actions" ref=${actions}>
      ${video
        ? html`<${Button} size="lg" variant=${canShare ? undefined : "prim"} onClick=${save}>Save video</${Button}>
            ${canShare && html`<${Button} variant="prim" size="lg" style="flex:1.4" onClick=${share}><${I.Share} size=${17} />Share…</${Button}>`}`
        : html`${!recording && html`<${Button} size="lg" disabled=${!r} onClick=${toggle}>${playing ? html`Pause` : html`<${I.Play} size=${15} />${progress > 0 && progress < 1 ? "Resume" : "Play"}`}</${Button}>`}
            ${canRecord && html`<${Button} variant="prim" size="lg" style="flex:1.4;white-space:nowrap" disabled=${!r} aria-disabled=${recording ? "true" : undefined} aria-label=${recording ? "Recording the replay" : undefined} onClick=${() => { if (!recording) record(); }}>${recording ? html`<span aria-hidden="true">Recording… ${left} s</span>` : "Make a video"}</${Button}>`}`}
    </div>`;
}

// A reminder for a lobby that hasn't opened: a notification 5 minutes before, said honestly (it comes from this page,
// so a tab must be open), and the calendar, which always works.
function RemindSheet({ s, a }) {
  const lobby = [...s.hosted, ...LOBBIES].find((l) => l.id === s.remindFor);
  if (!lobby) return null;
  const r = s.reminders[lobby.id];
  const on = !!(r && r.notify);
  const at = on ? r.at : nextOpening(lobby.opens);
  const time = hhmm;
  const day = dayOf(at);
  const blocked = notifyPermission() === "denied";
  const url = `${location.origin}${location.pathname}`;
  const download = () => {
    const blob = new Blob([icsFor(lobby, at, url)], { type: "text/calendar" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = calendarFileName(lobby);
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    a.remindDone("Calendar event saved: open it to add it");
  };
  return html`
    <div class="row" style="gap:12px;flex-wrap:nowrap">
      <span class="intro-icon" aria-hidden="true"><${I.Bell} size=${18} /></span>
      <div style="display:flex;flex-direction:column;gap:2px;min-width:0">
        <span style="font-size:16px;font-weight:600" class="ellipsis">${lobby.name}</span>
        <span class="t2 num" style="font-size:13px">Opens ${day} at ${time(at)} · hosted by @${lobby.host}</span>
      </div>
    </div>
    <div class="remind-option">
      <div style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:0">
        <span style="font-size:15px;font-weight:600">${on ? `Notification at ${time(at - LEAD_MS)}` : "Notify me 5 minutes before"}</span>
        <span class="t2" style="font-size:13px;line-height:1.45">Sent by this page, so keep it open in a tab. For a reminder with the app closed, use your calendar.</span>
        <span role="alert" class="remind-error">${s.remindError ? html`<${I.Alert} size=${14} /> ${s.remindError}` : ""}</span>
      </div>
      ${on
        ? html`<${Button} size="sm" onClick=${() => a.stopReminder(lobby.id)}>Turn off</${Button}>`
        : html`<${Button} size="sm" variant="prim" aria-disabled=${blocked && s.remindError ? "true" : undefined} onClick=${() => { if (!(blocked && s.remindError)) a.notifyMe(lobby); }}>Notify me</${Button}>`}
    </div>
    <div class="remind-option">
      <div style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:0">
        <span style="font-size:15px;font-weight:600">Add to your calendar</span>
        <span class="t2" style="font-size:13px;line-height:1.45">Works with the app closed, with an alert 5 minutes before.</span>
      </div>
    </div>
    <div class="sheet-actions">
      <a class="btn fill lg" style="flex:1" href=${googleCalendarUrl(lobby, at, url)} target="_blank" rel="noopener">Google Calendar<span class="sr"> (opens in a new tab)</span></a>
      <${Button} size="lg" style="flex:1" onClick=${download}>Other calendars</${Button}>
    </div>`;
}

// The founder profile: what this person has done here, from what the lobbies recorded. Nothing to edit: it is a
// record, not a page about yourself.
function ProfileSheet({ s, a }) {
  const p = profile(s);
  const w = s.wallet;
  const who = w.address ? addressPerson(w.address) : null;
  const head = (t) => html`<h3 class="t2" style="font-size:13px;font-weight:600">${t}</h3>`;
  const row = (left, title, sub, right) => html`<li class="profile-row">${left}<span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><span class="ellipsis" style="font-size:15px;font-weight:600">${title}</span><span class="t2 num ellipsis" style="font-size:13px">${sub}</span></span>${right}</li>`;
  return html`
    <div class="row" style="flex-wrap:nowrap;gap:14px">
      ${who ? html`<${Avatar} person=${who} size=${52} />` : html`<span class="intro-icon" style="width:52px;height:52px;border-radius:50%" aria-hidden="true"><${I.People} size=${22} /></span>`}
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px">
        <span style="font-size:19px;font-weight:650" class="num">${who ? shortAddress(w.address) : "You"}</span>
        ${p.streak > 0
          ? html`<span style="align-self:flex-start"><${Chip} tone="lime"><${I.Flame} size=${13} />${p.streak === 1 ? "Streak: 1 lobby" : `${p.streak} lobbies in a row`}</${Chip}></span>`
          : html`<span class="t2" style="font-size:13px">Pledge in a lobby to start a streak</span>`}
      </div>
    </div>
    <dl class="stats profile-stats">
      <div><dt class="t2">Lobbies</dt><dd class="num">${p.lobbies.length}</dd></div>
      <div><dt class="t2">Founder of</dt><dd class="num">${p.clans.length}</dd></div>
      <div><dt class="t2">Ideas</dt><dd class="num">${p.proposed}</dd></div>
    </dl>
    <section style="display:flex;flex-direction:column;gap:8px" aria-label="Clans">
      ${head("Clans")}
      ${p.clans.length === 0
        ? html`<p class="t2" style="font-size:14px;line-height:1.5">No clan yet. Back the idea that wins a lobby to become one of its founders.</p>`
        : html`<ul class="profile-list">${p.clans.map((k) => html`<li key=${k.id}><button type="button" class="profile-row" onClick=${() => a.openClan(k.id)}>
            <${Coin} coin=${coin(k)} size=${36} />
            <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;text-align:left"><span style="font-size:15px;font-weight:600">${k.name} <span class="t2" style="font-weight:500">${ticker(k.ticker)}</span></span>
              <span class="t2 num" style="font-size:13px">${k.rank ? `Founder #${k.rank.toLocaleString("en-US")} of ${k.members.toLocaleString("en-US")}` : `${k.members.toLocaleString("en-US")} founders`}</span></span>
            <span class="t2"><${I.Chevron} size=${14} /></span>
          </button></li>`)}</ul>`}
    </section>
    <section style="display:flex;flex-direction:column;gap:8px" aria-label="Ideas you proposed">
      ${head("Ideas you proposed")}
      ${p.ideas.length === 0
        ? html`<p class="t2" style="font-size:14px;line-height:1.5">None yet. Before 00:30, Propose puts your idea in the race for a 0.05 SOL bond, returned at the lock.</p>`
        : html`<ul class="profile-list">${p.ideas.map((d, i) => row(html`<${Coin} coin=${coin(d)} size=${36} />`, html`${ticker(d.ticker)} <span class="t2" style="font-weight:500">${d.name}</span>`, d.status, null))}</ul>`}
    </section>
    <section style="display:flex;flex-direction:column;gap:8px" aria-label="Lobbies">
      ${head("Lobbies")}
      ${p.lobbies.length === 0
        ? html`<p class="t2" style="font-size:14px;line-height:1.5">${s.live && !w.address ? "Connect your wallet to see the lobbies you were in." : "Your lobbies will show here after their launch."}</p>`
        : html`<ul class="profile-list">${p.lobbies.map((l) => row(html`<span class=${`profile-dot ${l.tone}`} aria-hidden="true" />`, l.name, l.text, html`<span class="t2 num" style="font-size:13px;flex:none">${l.when}</span>`))}</ul>`}
    </section>
    ${s.live && html`<p class="t2" style="font-size:12px;line-height:1.5">Your past lobbies are kept on this device.</p>`}`;
}

// A sibling lobby: the clan's founders open the next lobby, for a little sibling of their coin. It is an ordinary
// lobby (anyone joins, pledges and pitches); the clan only gets it pinned.
function SiblingSheet({ s, a }) {
  const k = s.clans.find((c) => c.id === s.clan);
  const [form, setForm] = useState(() => ({ name: k ? `${k.name} Family Hour`.slice(0, 32) : "", theme: k ? `A little sibling for $${k.ticker}` : "", slot: 1 }));
  if (!k) return null;
  const valid = form.name.trim().length >= 3 && form.theme.trim().length >= 3;
  return html`
    <div class="row" style="gap:12px;flex-wrap:nowrap">
      <${Coin} coin=${coin(k)} size=${44} />
      <span class="t2" style="font-size:14px;line-height:1.5">Open the next lobby for the ${k.name} clan. It is pinned in the clan for its ${k.members.toLocaleString("en-US")} founders; like any lobby, anyone can join, pitch and pledge.</span>
    </div>
    <label class="field"><span class="lbl">Lobby name</span><input class="inp" value=${form.name} maxLength=${32} onInput=${(e) => setForm({ ...form, name: e.currentTarget.value })} /></label>
    <label class="field"><span class="lbl">Theme</span><input class="inp" value=${form.theme} maxLength=${60} onInput=${(e) => setForm({ ...form, theme: e.currentTarget.value })} /></label>
    <div class="field"><span class="lbl">Opens at</span>
      <${Segmented} label="Opening time" options=${SLOTS.map((t, i) => ({ id: i, label: t }))} value=${form.slot} onChange=${(slot) => setForm({ ...form, slot })} /></div>
    <div class="sheet-actions">
      <${Button} onClick=${a.closeSheet}>Cancel</${Button}>
      <${Button} variant="white" disabled=${!valid} onClick=${() => a.openSibling({ name: plain(form.name), theme: plain(form.theme), opens: SLOTS[form.slot] })}>Open the lobby</${Button}>
    </div>`;
}

// Reporting an idea: what the host can do with it, said before anything is sent.
function ReportSheet({ s, a }) {
  const d = s.ideas.find((x) => x.id === s.sheetIdea);
  if (!d) return null;
  return html`
    <div class="row" style="gap:12px;flex-wrap:nowrap"><${Coin} coin=${coin(d)} size=${44} /><span style="font-size:16px;font-weight:600">${ticker(d.ticker)} · ${d.name}</span></div>
    <p class="t2" style="font-size:14px;line-height:1.5">Report an idea that breaks the lobby’s rules: a scam, hate, someone impersonated, a ticker that copies a live coin. The host sees how many people reported it, not who, and can take it out of the race; everyone on it is then refunded.</p>
    <div class="sheet-actions">
      <${Button} size="lg" onClick=${a.closeSheet}>Cancel</${Button}>
      <${Button} variant="danger" size="lg" data-primary onClick=${() => a.report(d.id)}>Report ${ticker(d.ticker)}</${Button}>
    </div>`;
}

// The host takes an idea out of the race: what happens to the money first, then one tap.
function RemoveSheet({ s, a }) {
  const d = race(s).find((x) => x.id === s.sheetIdea);
  if (!d) return null;
  const n = s.live?.reports?.[d.ticker] ?? 0;
  return html`
    <div class="row" style="gap:12px;flex-wrap:nowrap"><${Coin} coin=${coin(d)} size=${44} /><span style="display:flex;flex-direction:column;gap:2px"><span style="font-size:16px;font-weight:600">${ticker(d.ticker)} · ${d.name}</span><span class="t2 num" style="font-size:13px">${sol(d.total)} from ${d.backersShown} ${d.backersShown === 1 ? "backer" : "backers"}${n ? ` · reported by ${n}` : ""}</span></span></div>
    ${d.rank === 1 && html`<p class="remind-error" role="note"><${I.Alert} size=${14} />${ticker(d.ticker)} leads the race. Remove it only if it breaks the lobby’s rules: its backers can’t win with it any more.</p>`}
    <p class="t2" style="font-size:14px;line-height:1.5">It leaves the race for good. Every pledge on it is refunded now, and its proposer’s bond is returned. Practice lobbies only, for now.</p>
    <div class="sheet-actions">
      <${Button} size="lg" onClick=${a.closeSheet}>Keep it</${Button}>
      <${Button} variant="danger" size="lg" data-primary onClick=${() => a.removeIdea(d.id)}>Remove ${ticker(d.ticker)}</${Button}>
    </div>`;
}

// Taking a pledge back: said plainly, asked once. A double tap can't withdraw twice.
function WithdrawSheet({ s, a }) {
  const p = s.pledge;
  if (!p) return null;
  return html`
    <p class="t2" style="font-size:15px;line-height:1.5">${sol(p.amount)} comes back from ${ticker(p.symbol)} to your ${s.live ? "practice SOL" : "balance"}. You can pledge again until pledges lock, 5 minutes before the launch; if you’re not backing the winner then, you won’t be one of its founders.</p>
    <div class="sheet-actions">
      <${Button} size="lg" onClick=${a.closeSheet}>Keep my pledge</${Button}>
      <${Button} variant="danger" size="lg" data-primary disabled=${s.signing} onClick=${a.withdraw}>Withdraw ${sol(p.amount)}</${Button}>
    </div>`;
}

// Risks and terms in plain words. A draft: counsel reviews it before launch (LEGAL.md).
function TermsSheet({ a }) {
  const item = (title, text) => html`<div style="display:flex;flex-direction:column;gap:4px"><h3 style="font-size:15px;font-weight:600">${title}</h3><p class="t2" style="font-size:14px;line-height:1.5">${text}</p></div>`;
  return html`<div class="scroll" style="display:flex;flex-direction:column;gap:16px;max-height:60vh;padding-right:4px">
      ${item("Practice lobbies, for now", "Until a lobby runs on Solana, pledges use practice SOL: none of yours moves, nothing is on chain, and a launch is a rehearsal. What follows is how lobbies work on Solana.")}
      ${item("What a pledge is", "A pledge moves SOL from your wallet into the lobby’s program account, which nobody controls. It is a vote with money: the idea with the most SOL at 00:55 launches.")}
      ${item("Your SOL until 00:55", "You can withdraw or move your pledge at any time before the lock at 00:55. After that it is locked by the program.")}
      ${item("If your idea doesn’t win", "Your pledge is refunded in full at the lock, automatically; anyone can send the refund, and it can only go to your wallet. If nothing is pledged, or the winner can’t launch, everyone is refunded.")}
      ${item("If your idea wins", "Your pledge buys the coin’s opening batch at the same price as every other backer. 25% of your tokens unlock at once, the rest over 3 days. You become a founder of its clan.")}
      ${item("Risks", "Memecoins are highly speculative. The price after launch can fall to zero, and the coin can be hard to sell. Smart contracts can have bugs. Only pledge what you can afford to lose. Nothing here is investment, legal or tax advice.")}
      ${item("Fees", "Solana’s network fee on each transaction. Proposing an idea holds a 0.05 SOL bond, returned at the lock. The launchpad’s trading fees apply after launch.")}
      ${item("Who can take part", "You must be of legal age where you live, and lobbies are not offered where taking part is not allowed. You are responsible for the taxes of your country.")}
      ${item("Clans and voice", "Clans are for their founders only. Moderators can hide and delete messages and mute members. Don’t share anything illegal, hateful or anyone’s private information; reports are reviewed. Voice is not recorded.")}
      ${item("Your data", "Your wallet address and your pledges are public on Solana. Clan messages and media are kept for the clan; a deleted message is erased. We don’t sell data.")}
    </div>
    <${Button} variant="white" size="lg" onClick=${a.closeSheet}>Done</${Button}>`;
}

// What the last operation did, read from the program's events: a pledge, a withdrawal, a move, a refund.
// Where a receipt can be checked: its transaction on Solscan, only for a real signature on a known cluster.
const proofLink = (r) => (r && !r.practice ? txUrl(r.signature, r.cluster) : null);

function ReceiptSheet({ s, a }) {
  const r = s.receipt;
  if (!r) return null;
  return html`<div style="display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center;padding-top:8px">
      <span class="pop" style="width:64px;height:64px;border-radius:50%;background:var(--lime);color:#0a0c04;display:flex;align-items:center;justify-content:center"><${I.Check} size=${30} stroke=${3} /></span>
      <h2 id="receipt-title" class="display" style="font-size:24px">${r.title}</h2>
    </div>
    <div class="rows">${r.lines.map(([k, v]) => html`<div key=${k}><span>${k}</span><span class="num">${sol(v)}</span></div>`)}</div>
    ${proofLink(r)
      ? html`<div class="row" style="justify-content:center;gap:8px;font-size:13px"><${Chip} tone="lime"><${I.Check} size=${12} />On Solana</${Chip}>
          <a class="link" href=${proofLink(r)} target="_blank" rel="noopener">View the transaction on Solscan<span class="sr"> (opens in a new tab)</span></a></div>`
      : html`<span class="t2" style="font-size:12px;line-height:1.5;text-align:center">${r.signature ? "This transaction is on a local validator: no explorer shows it." : "A practice pledge: no real SOL moved, so there is no transaction to look up."} You can withdraw or move it until pledges lock; if its idea loses, it comes back then.</span>`}
    <${Button} variant="white" size="lg" onClick=${a.closeSheet}>Done</${Button}>`;
}

// The beta's feedback: a rating and a few words, sent to the server that runs the lobby.
function FeedbackSheet({ a }) {
  const [rating, setRating] = useState(null);
  const [text, setText] = useState("");
  const [state, setState] = useState({ sending: false, error: null, sent: false });
  if (state.sent) return html`<div style="display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center;padding-top:8px">
      <h2 id="feedback-title" class="display" style="font-size:22px">Thank you</h2>
      <p class="t2" role="status" style="font-size:14px">Your feedback reached the team.</p>
    </div>
    <${Button} variant="white" size="lg" onClick=${a.closeSheet}>Done</${Button}>`;
  const send = async () => {
    setState({ sending: true, error: null, sent: false });
    const error = await a.sendFeedback({ rating, text: text.trim() });
    setState({ sending: false, error, sent: !error });
  };
  return html`<p class="t2" style="font-size:14px;line-height:1.5">This is a closed beta. What worked, what confused you, what you missed: every word is read.</p>
    <div role="group" aria-label="Your rating, 1 to 5" class="row" style="gap:8px">
      ${[1, 2, 3, 4, 5].map((n) => html`<${Button} key=${n} size="sm" aria-pressed=${rating === n} variant=${rating === n ? "white" : undefined} onClick=${() => setRating(n)}>${n}</${Button}>`)}
    </div>
    <label style="display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:600">Your words
      <textarea maxlength="1000" rows="4" value=${text} onInput=${(e) => setText(e.currentTarget.value)} style="font:inherit;font-weight:400;font-size:15px;padding:10px;border-radius:12px;background:var(--surface-2, #1a1a1a);color:inherit;border:1px solid rgba(255,255,255,.15);resize:vertical"></textarea>
    </label>
    ${state.error && html`<p role="alert" style="color:#ff6961;font-size:13px">${state.error}</p>`}
    <${Button} variant="white" size="lg" data-primary disabled=${state.sending || (!rating && !text.trim())} onClick=${send}>${state.sending ? "Sending…" : "Send feedback"}</${Button}>`;
}

const SHEETS = {
  pledge: { title: null, Body: PledgeSheet },
  propose: { title: "Propose an idea", Body: ProposeSheet },
  host: { title: "Host a lobby", Body: HostSheet },
  wallet: { title: "Wallet", Body: WalletSheet, refocus: ".wallet-pill" },
  receipt: { title: null, Body: ReceiptSheet, refocus: ".dock .btn" }, // back to the pledge it records
  terms: { title: "Risks and terms", Body: TermsSheet },
  connect: { title: "Connect a wallet", Body: ConnectSheet, refocus: ".wallet-pill" },
  withdraw: { title: "Withdraw your pledge?", Body: WithdrawSheet },
  card: { title: "Your birth card", Body: BirthCardSheet },
  remind: { title: "Remind me", Body: RemindSheet },
  report: { title: "Report this idea?", Body: ReportSheet, refocus: ".idea[aria-pressed=true]", refocusFirst: true }, // its button turns into "reported" // back to the idea
  remove: { title: "Remove this idea?", Body: RemoveSheet, refocus: ".idea[aria-pressed=true]", refocusFirst: true }, // to the idea now selected
  sibling: { title: "A sibling lobby", Body: SiblingSheet, refocus: ".sibling", refocusFirst: true }, // to the new lobby, pinned in the clan
  profile: { title: "Founder profile", Body: ProfileSheet, refocus: ".profile-open" },
  replay: { title: "The hour in 30 seconds", Body: ReplaySheet, refocus: ".replay-open" },
  feedback: { title: "Beta feedback", Body: FeedbackSheet, refocus: ".feedback-open" },
};

export function Sheets({ s, a }) {
  const def = s.sheet && SHEETS[s.sheet];
  if (!def) return null;
  const id = `${s.sheet}-title`;
  return html`<${Sheet} key=${s.sheet} title=${def.title} labelledBy=${id} busy=${s.signing} onClose=${a.closeSheet} refocus=${def.refocus} refocusFirst=${def.refocusFirst}><${def.Body} s=${s} a=${a} /></${Sheet}>`;
}

