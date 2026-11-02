// The launch: the winning coin pops in the middle of the room that made it. Founders see their allocation and the
// way into the clan; everyone else sees their refund and the way to the next lobby.

import { html, Button, IconButton, Chip, Coin, Orbit } from "../ui.js";
import * as I from "../icons.js";
import { person, coin, PEOPLE, FEATURED } from "../demo/data.js";
import { allocation, lobbyInfo } from "../demo/select.js";
import { sol, int, ticker } from "../format.js";
import { isAddress, explorerUrl, shortAddress, txUrl } from "../wallet/wallets.js";

const ROOM = Object.keys(PEOPLE).map(person);

export function Launch({ s, a, phone }) {
  const l = s.launched;
  if (!l) return null;
  const win = s.ideas.find((d) => d.id === l.id);
  const backed = l.myId && s.ideas.find((d) => d.id === l.myId);
  // The settlement's own transaction, when it is on Solana: where anyone can check it.
  const settledTx = s.receipts.map((r) => (r && !r.practice && (r.kind === "founder" || r.kind === "refund") ? txUrl(r.signature, r.cluster) : null)).find(Boolean);
  const txLink = settledTx && html`<a class="link" href=${settledTx} target="_blank" rel="noopener">View on Solscan<span class="sr"> (opens in a new tab)</span></a>`;
  const bg = `radial-gradient(55% 55% at ${phone ? "50% 20%" : "28% 45%"}, hsla(${win.hue},90%,55%,.28), transparent 70%), radial-gradient(40% 50% at 100% 0%, hsla(${(win.hue + 150) % 360},80%,55%,.12), transparent 70%), #000`;
  // Live, the recap says only what the lobby recorded; the demo's story (the crowd, the pitch) is the demo's.
  const recap = s.live ? [
    { t: "00:00", c: "var(--text)", text: "Lobby opens" },
    { t: "00:30", c: "var(--sky)", text: `Proposals close · ${s.ideas.length} ideas` },
    { t: "00:55", c: "var(--amber)", text: `Lock · ${sol(l.total)} pledged · ${ticker(win.ticker)} wins` },
    { t: "01:00", c: "var(--lime)", text: `${ticker(win.ticker)} launched · ${int(l.backers)} founders · the clan opens` },
  ] : [
    { t: "00:00", c: "var(--text)", text: `Lobby opens · ${int(FEATURED.inside)} join` },
    { t: "00:07", c: "var(--sky)", text: `${win.by === "you" ? "You pitch" : win.by ? `@${person(win.by).name} pitches` : "The winner is pitched"} ${ticker(win.ticker)} on stage` },
    { t: "00:30", c: "var(--sky)", text: `Proposals close · ${s.ideas.length} ideas` },
    { t: "00:55", c: "var(--amber)", text: `Lock · ${sol(l.total)} pledged` },
    { t: "01:00", c: "var(--lime)", text: `${ticker(win.ticker)} minted · the clan opens` },
  ];
  return html`<div class="launch scroll screen" style=${{ background: bg }}>
    <main class="launch-inner">
      <div class="row" style="justify-content:space-between">
        ${phone
          ? html`<${IconButton} label="Back to lobbies" size="sm" onClick=${() => a.go({ screen: "discover" })}><${I.Back} size=${15} /></${IconButton}>`
          : html`<${Button} variant="ghost" size="sm" aria-label="Back to lobbies" onClick=${() => a.go({ screen: "discover" })}><${I.Back} size=${14} />Lobbies</${Button}>`}
        <span class="t2 num" style="font-size:13px;font-weight:600">Lobby #${lobbyInfo(s).number} · launched at 01:00</span>
      </div>
      <div class="launch-main">
        <div class="launch-art">
          <div class="stage-ring">
            <${Orbit} people=${ROOM.slice(0, 17)} base=${phone ? 30 : 34} />
            ${!phone && html`<${Orbit} people=${ROOM.slice(3, 15)} radius=${34} base=${26} reverse offset=${0.3} />`}
            <${Coin} coin=${coin(win)} size=${phone ? 140 : 200} big class="pop glow" alt=${`${win.name} logo`} />
          </div>
        </div>
        <div class="launch-copy">
          <span class="row" style="gap:8px"><${Chip} tone="lime" live>Just launched</${Chip}>${!isAddress(l.mint) && html`<${Chip} tone="amber">Practice launch</${Chip}>`}</span>
          <h1 class="display">${ticker(win.ticker)}<br />is alive.</h1>
          <p class="t2" style=${{ fontSize: phone ? "15px" : "18px", lineHeight: 1.5, maxWidth: "500px" }}>
            ${win.name} beat ${s.ideas.length - 1} other ${s.ideas.length - 1 === 1 ? "idea" : "ideas"} in an hour of pitches. Its ${int(l.backers)} founders now share a clan that never closes.
          </p>
          <dl class="stats">
            <div><dt class="t2" style="font-size:13px;font-weight:600">Raised</dt><dd class="num">${sol(l.sol)}</dd></div>
            <div><dt class="t2" style="font-size:13px;font-weight:600">Founders</dt><dd class="num">${int(l.backers)}</dd></div>
            <div><dt class="t2" style="font-size:13px;font-weight:600">Refunded</dt><dd class="num">${sol(l.total - l.sol)}</dd></div>
          </dl>
          ${l.founder
            ? html`<div class="panel" style="padding:20px;display:flex;flex-direction:column;gap:12px;border-color:rgba(203,243,92,.3);text-align:left">
                <span style="font-size:17px;font-weight:600">Welcome, Founder #${int(l.rank)}</span>
                <div class="rows" style="background:none;padding:0">
                  <div><span>Your allocation</span><span class="num">${int(allocation(l))} ${win.ticker}</span></div>
                  <div><span>Price</span><span>Same for every founder</span></div>
                  <div><span>Unlocks</span><span>25% now · the rest over 3 days</span></div>
                  ${txLink && html`<div><span>Your commitment</span><span>${txLink}</span></div>`}
                  ${isAddress(l.mint) && html`<div><span>Contract</span><span class="row" style="gap:8px;justify-content:flex-end">
                    <button type="button" class="link num" aria-label=${`Copy the contract address ${l.mint}`} onClick=${() => a.copyText(l.mint, "Contract address copied")}>${shortAddress(l.mint)}</button>
                    ${l.cluster && html`<a class="link" href=${explorerUrl(l.mint, l.cluster)} target="_blank" rel="noopener">Solscan<span class="sr"> (opens in a new tab)</span></a>`}
                  </span></div>`}
                </div>
              </div>
              <div class="row" style=${phone ? "flex-direction:column;align-items:stretch" : ""}>
                <${Button} variant="prim" size="lg" onClick=${() => a.openClan("new")}>Enter the clan<${I.Arrow} size=${17} /></${Button}>
                <${Button} size="lg" onClick=${a.shareBirthCard}><${I.Share} size=${17} />Share birth card</${Button}>
              </div>`
            : html`<div class="panel" style="padding:20px;display:flex;flex-direction:column;gap:8px;text-align:left">
                <span style="font-size:17px;font-weight:600">${l.myAmount ? `Your ${sol(l.myAmount)} is back ${isAddress(l.mint) ? "in your wallet" : "in your practice SOL"}` : "You watched this one from the stands"}</span>
                <span class="t2" style="font-size:14px;line-height:1.5">${l.myAmount
                  ? `You backed ${backed ? ticker(backed.ticker) : "another idea"}, which didn’t win. Refunds land automatically at lock. ${win.name} launched without you, and the next lobby opens on the hour.`
                  : "Only people who pledged become founders of the clan. Pledge in the next lobby to be in the room for good."}</span>
                ${txLink && html`<span style="font-size:14px">Your refund on Solana: ${txLink}</span>`}
              </div>
              <div class="row" style=${phone ? "flex-direction:column;align-items:stretch" : ""}>
                <${Button} variant="white" size="lg" onClick=${() => a.go({ screen: "discover" })}>Find the next lobby</${Button}>
                ${!s.live && html`<${Button} size="lg" onClick=${a.replay}>Run this lobby again</${Button}>`}
              </div>`}
          ${s.curve.length > 1 && html`<${Button} variant="ghost" class="replay-open" style=${{ alignSelf: phone ? "center" : "flex-start", color: "var(--sky)" }} onClick=${() => a.openSheet("replay")}><${I.Play} size=${15} />Watch the hour in 30 seconds</${Button}>`}
        </div>
      </div>
      <ol class="recap">${recap.map((e) => html`<li key=${e.t} style=${{ borderColor: e.c }}><span class="num t2" style="font-size:12px;font-weight:600">${e.t}</span><span style="font-size:14px">${e.text}</span></li>`)}</ol>
    </main>
  </div>`;
}
