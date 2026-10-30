// Sheets: confirm a pledge, propose an idea, host a lobby, the wallet. Money sheets say what happens if the idea
// wins, if it loses, and what it costs, before anything is signed.

import { useState } from "preact/hooks";
import { html, Button, Segmented, Coin, Sheet } from "../ui.js";
import * as I from "../icons.js";
import { coin } from "../demo/data.js";
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
    </div>
    <div class="rows">
      <div><span>If it wins</span><span class="num">${d.shareIfWins.toFixed(2)}% of the pot, same price as everyone</span></div>
      <div><span>If it loses</span><span>Full refund at 00:55</span></div>
      <div><span>Change your mind</span><span>Withdraw or move any time before 00:55</span></div>
      <div><span>Network fee</span><span class="num">≈ 0.000005 SOL</span></div>
    </div>
    <span class="t2" style="font-size:12px;line-height:1.5;text-align:center">Memecoins are speculative and can lose all their value. This is not an investment or advice.
      <button type="button" class="link" onClick=${() => a.openSheet("terms")}>Risks and terms</button></span>
    <div class="sheet-actions">
      <${Button} size="lg" disabled=${s.signing} onClick=${a.closeSheet}>Cancel</${Button}>
      <${Button} variant="prim" size="lg" style="flex:1.4" disabled=${s.signing} onClick=${a.confirmPledge}>
        ${s.signing ? html`<span class="spin" aria-hidden="true" />Confirming` : "Confirm pledge"}
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

function WalletSheet({ s, a }) {
  const mine = s.pledge && s.ideas.find((d) => d.id === s.pledge.id);
  const t = lobbyClock(s);
  return html`
    <div style="display:flex;flex-direction:column;gap:4px">
      <span class="display num" style="font-size:44px">${sol(s.balance)}</span>
      <${Button} variant="ghost" size="sm" class="num" style="align-self:flex-start;margin-left:-10px;padding:0 10px" onClick=${a.copyAddress}>7Hq4…k2Pf<${I.Copy} size=${13} /></${Button}>
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
      <div class="row" style="gap:8px">${s.clans.map((k) => html`<${Button} key=${k.id} size="sm" style="padding:0 12px 0 4px;height:36px" onClick=${() => a.openClan(k.id)}><${Coin} coin=${coin(k)} size=${28} />${ticker(k.ticker)}</${Button}>`)}</div>
    </div>
    <${Button} variant="ghost" size="sm" style="align-self:flex-start;margin-left:-10px;padding:0 10px" onClick=${() => a.openSheet("terms")}>Risks and terms</${Button}>
    ${s.receipts.length > 0 && html`<div style="display:flex;flex-direction:column;gap:10px">
      <span class="t2" style="font-size:13px;font-weight:600">Activity</span>
      <ol class="rows">${s.receipts.slice(0, 5).map((r, i) => html`<li key=${i} style="display:flex;justify-content:space-between;gap:12px;padding:12px 0;font-size:14px;border-top:${i ? "1px solid rgba(255,255,255,.07)" : "0"}">
        <button type="button" style="text-align:left;flex:1;min-height:44px" onClick=${() => a.showReceipt(r)}>${r.title}</button><span class="t2"><${I.Chevron} size=${14} /></span></li>`)}</ol>
    </div>`}`;
}

// Risks and terms in plain words. A draft: counsel reviews it before launch (LEGAL.md).
function TermsSheet({ a }) {
  const item = (title, text) => html`<div style="display:flex;flex-direction:column;gap:4px"><h3 style="font-size:15px;font-weight:600">${title}</h3><p class="t2" style="font-size:14px;line-height:1.5">${text}</p></div>`;
  return html`<div class="scroll" style="display:flex;flex-direction:column;gap:16px;max-height:60vh;padding-right:4px">
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
    <span class="t2" style="font-size:12px;line-height:1.5;text-align:center">Read from the lobby program’s events. Pledges can be withdrawn or moved until 00:55; losing pledges are refunded at the lock.</span>
    <${Button} variant="white" size="lg" onClick=${a.closeSheet}>Done</${Button}>`;
}

const SHEETS = {
  pledge: { title: null, Body: PledgeSheet },
  propose: { title: "Propose an idea", Body: ProposeSheet },
  host: { title: "Host a lobby", Body: HostSheet },
  wallet: { title: "Wallet", Body: WalletSheet },
  receipt: { title: null, Body: ReceiptSheet },
  terms: { title: "Risks and terms", Body: TermsSheet },
};

export function Sheets({ s, a }) {
  const def = s.sheet && SHEETS[s.sheet];
  if (!def) return null;
  const id = `${s.sheet}-title`;
  return html`<${Sheet} title=${def.title} labelledBy=${id} busy=${s.signing} onClose=${a.closeSheet}><${def.Body} s=${s} a=${a} /></${Sheet}>`;
}

