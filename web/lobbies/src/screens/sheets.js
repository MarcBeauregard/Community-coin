// Sheets: confirm a pledge, propose an idea, host a lobby, the wallet. Money sheets say what happens if the idea
// wins, if it loses, and what it costs, before anything is signed.

import { useEffect, useState } from "preact/hooks";
import { html, Button, Segmented, Coin, Sheet, Avatar, Chip } from "../ui.js";
import * as I from "../icons.js";
import { coin } from "../demo/data.js";
import { addressPerson, shortAddress, WALLET_TINT, isAddress } from "../wallet/wallets.js";
import { drawBirthCard, cardCaption, cardFileName, cardText, FORMATS } from "../card/birthcard.js";
import { race, dock, lobbyClock } from "../demo/select.js";
import { PROPOSE_BOND } from "../demo/store.js";
import { sol, ticker, initials } from "../format.js";

const HUES = [[150, "Mint"], [205, "Sky"], [265, "Violet"], [340, "Pink"], [18, "Ember"], [45, "Gold"]];
const SLOTS = ["21:00", "22:00", "23:00"];

function PledgeSheet({ s, a }) {
  const d = dock(s, race(s));
  return html`<div style="display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center;padding-top:8px">
      <${Coin} coin=${coin(d.sel)} size=${84} big />
      <h2 id="pledge-title" class="t2" style="font-size:15px;font-weight:600">Back ${ticker(d.sel.ticker)} · ${d.sel.name}</h2>
      <span class="display num" style="font-size:56px;line-height:1">${sol(s.amount)}</span>
      <${Chip} tone="amber">Practice pledge</${Chip}>
    </div>
    <div class="rows">
      <div><span>If it wins</span><span class="num">${d.shareIfWins >= 99.995 ? "You’d be its only backer: the whole opening batch" : `About ${d.shareIfWins.toFixed(2)}% of its opening batch, at the same price as every backer`}</span></div>
      <div><span>If it loses</span><span>Full refund at the lock (00:55 on the lobby clock)</span></div>
      <div><span>Change your mind</span><span>Withdraw or move any time before 00:55</span></div>
      <div><span>Your wallet</span><span>No SOL leaves it: this lobby is a rehearsal until it runs on Solana</span></div>
    </div>
    <span class="t2" style="font-size:12px;line-height:1.5;text-align:center">Memecoins are speculative and can lose all their value. This is not an investment or advice.
      <button type="button" class="link" onClick=${() => a.openSheet("terms")}>Risks and terms</button></span>
    <div class="sheet-actions">
      <${Button} size="lg" disabled=${s.signing} onClick=${a.closeSheet}>Cancel</${Button}>
      <${Button} variant="prim" size="lg" style="flex:1.4" disabled=${s.signing} onClick=${a.confirmPledge}>
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
      <textarea class="inp" maxLength=${90} placeholder="Why should 1,284 people back it?" value=${form.pitch} onInput=${(e) => setForm({ ...form, pitch: e.currentTarget.value })} /></label>
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
      <${Button} variant="white" disabled=${!valid} onClick=${() => a.hostLobby({ name: form.name.trim(), theme: form.theme.trim(), opens: SLOTS[form.slot] })}>Schedule lobby</${Button}>
    </div>`;
}

const WHY = {
  chat: "Connect a wallet to chat.",
  speak: "Connect a wallet to speak on stage.",
  clan: "Connect the wallet you pledged with to enter your clan.",
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
            ? html`<button type="button" class="wallet-row" disabled=${busy && !mine} aria-busy=${mine ? "true" : undefined} onClick=${() => a.connectWallet(x.id)}>
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
        <${Button} variant="ghost" size="sm" class="num" style="align-self:flex-start;margin-left:-10px;padding:0 10px;font-size:17px" aria-label="Copy your address" onClick=${a.copyAddress}>${shortAddress(w.address)}<${I.Copy} size=${14} /></${Button}>
        <span class="t2" style="font-size:13px">${w.name}${w.signedIn ? " · signed in" : ""}</span>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:2px">
      <span class="display num" style="font-size:44px">${sol(real ? w.balance : s.balance)}</span>
      <span class="t2" style="font-size:13px">${real ? "Balance on Solana" : "Practice SOL: pledges here are a rehearsal, not your wallet’s SOL, until this lobby runs on Solana"}</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px">
      <span class="t2" style="font-size:13px;font-weight:600">Open pledge</span>
      ${mine
        ? html`<div class="row" style="flex-wrap:nowrap;gap:12px;padding:12px;border-radius:16px;background:rgba(0,0,0,.3)">
            <${Coin} coin=${coin(mine)} size=${38} />
            <span style="flex:1;display:flex;flex-direction:column"><span style="font-size:14px;font-weight:600">${sol(s.pledge.amount)} on ${ticker(mine.ticker)}</span><span class="t2 num" style="font-size:12px">Friday Night Degens · locks in ${t.lockIn}</span></span>
            <${Button} size="sm" disabled=${!t.canPledge} onClick=${a.withdraw}>Withdraw</${Button}>
          </div>`
        : html`<span class="t2" style="font-size:14px">No open pledge. Back an idea in a live lobby.</span>`}
    </div>
    <div style="display:flex;flex-direction:column;gap:10px">
      <span class="t2" style="font-size:13px;font-weight:600">Founder of</span>
      ${clans.length === 0 && html`<span class="t2" style="font-size:14px">No clan yet. Back the winning idea in a lobby to become a founder.</span>`}
      <div class="row" style="gap:8px">${clans.map((k) => html`<${Button} key=${k.id} size="sm" style="padding:0 12px 0 4px;height:36px" onClick=${() => a.openClan(k.id)}><${Coin} coin=${coin(k)} size=${28} />${ticker(k.ticker)}</${Button}>`)}</div>
    </div>
    <div class="row" style="gap:8px">
      <${Button} variant="ghost" size="sm" style="margin-left:-10px;padding:0 10px" onClick=${() => a.openSheet("terms")}>Risks and terms</${Button}>
      <${Button} variant="ghost" size="sm" style="padding:0 10px;color:#ff6961" onClick=${a.disconnect}>Disconnect</${Button}>
    </div>
    ${s.receipts.length > 0 && html`<div style="display:flex;flex-direction:column;gap:10px">
      <span class="t2" style="font-size:13px;font-weight:600">Activity</span>
      <ol class="rows">${s.receipts.slice(0, 5).map((r, i) => html`<li key=${i} style="display:flex;justify-content:space-between;gap:12px;padding:12px 0;font-size:14px;border-top:${i ? "1px solid rgba(255,255,255,.07)" : "0"}">
        <button type="button" style="text-align:left;flex:1;min-height:44px" onClick=${() => a.showReceipt(r)}>${r.title}</button><span class="t2"><${I.Chevron} size=${14} /></span></li>`)}</ol>
    </div>`}`;
}

// The birth card: drawn when the sheet opens (and again for the other shape), then shared the way this device
// shares (the share sheet, with the image and its caption), saved, or its words copied. The sheet stays open, so
// one can save it and copy the caption, or make both shapes.
function BirthCardSheet({ s, a }) {
  const l = s.launched;
  const win = l && s.ideas.find((d) => d.id === l.id);
  const [format, setFormat] = useState("post");
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
    <span class="sr" role="status">${ready ? `${FORMATS[format].label} card ready` : "Drawing your card"}</span>
    <p class="t2" style="font-size:14px;line-height:1.5">Made on this device from the launch. Only what you share leaves it.</p>
    <div class="sheet-actions">
      ${canShare
        ? html`<${Button} size="lg" disabled=${!ready} onClick=${save}>Save image</${Button}>
            <${Button} variant="prim" size="lg" style="flex:1.4" disabled=${!ready} onClick=${share}><${I.Share} size=${17} />Share…</${Button}>`
        : html`<${Button} size="lg" disabled=${!ready} onClick=${copy}>Copy caption</${Button}>
            <${Button} variant="prim" size="lg" style="flex:1.4" disabled=${!ready} onClick=${save}>Save image</${Button}>`}
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
function ReceiptSheet({ s, a }) {
  const r = s.receipt;
  if (!r) return null;
  return html`<div style="display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center;padding-top:8px">
      <span class="pop" style="width:64px;height:64px;border-radius:50%;background:var(--lime);color:#0a0c04;display:flex;align-items:center;justify-content:center"><${I.Check} size=${30} stroke=${3} /></span>
      <h2 id="receipt-title" class="display" style="font-size:24px">${r.title}</h2>
    </div>
    <div class="rows">${r.lines.map(([k, v]) => html`<div key=${k}><span>${k}</span><span class="num">${sol(v)}</span></div>`)}</div>
    <span class="t2" style="font-size:12px;line-height:1.5;text-align:center">${r.practice ? "Practice: recorded by the lobby server under the lobby program’s rules; no SOL moved." : "Practice: worked out by the lobby program’s own rules on this device; no SOL moved."} Pledges can be withdrawn or moved until 00:55; losing pledges are refunded at the lock.</span>
    <${Button} variant="white" size="lg" onClick=${a.closeSheet}>Done</${Button}>`;
}

const SHEETS = {
  pledge: { title: null, Body: PledgeSheet },
  propose: { title: "Propose an idea", Body: ProposeSheet },
  host: { title: "Host a lobby", Body: HostSheet },
  wallet: { title: "Wallet", Body: WalletSheet, refocus: ".wallet-pill" },
  receipt: { title: null, Body: ReceiptSheet },
  terms: { title: "Risks and terms", Body: TermsSheet },
  connect: { title: "Connect a wallet", Body: ConnectSheet, refocus: ".wallet-pill" },
  card: { title: "Your birth card", Body: BirthCardSheet },
};

export function Sheets({ s, a }) {
  const def = s.sheet && SHEETS[s.sheet];
  if (!def) return null;
  const id = `${s.sheet}-title`;
  return html`<${Sheet} title=${def.title} labelledBy=${id} busy=${s.signing} onClose=${a.closeSheet} refocus=${def.refocus}><${def.Body} s=${s} a=${a} /></${Sheet}>`;
}

