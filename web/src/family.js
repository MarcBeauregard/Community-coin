// A meme's family: the tree from its root down to every variant, and the union votes that can merge a rival root
// into it. A vote shows what would happen if it passed, computed from the curves as they are now with
// web/src/curve.js, and what voting costs you (nothing but a lock you can lift at any time).

import { useState, useEffect } from "preact/hooks";
import * as f from "./format.js";
import * as I from "./icons.js";
import { html, Bullet, compact, celebrate } from "./ui.js";
import { readCurves, simulateUnion } from "./curve.js";
import { useApp, MemeAvatar, MemeName, Phase, Term, countdown, n, lockedOf, memeHref, hueOf, ethOrTokens } from "./common.js";

/** Root first, then every variant under the meme it copies; the meme on screen is marked. */
export function FamilyTree({ m }) {
  const { world } = useApp();
  const joined = new Set(world.unions.filter((u) => u.executed).map((u) => u.meme));
  const node = (x) => html`<li key=${x.address}>
    <a class=${`tree-node ${x.address === m.address ? "here" : ""}`} href=${memeHref(x.address)} aria-current=${x.address === m.address ? "page" : null}>
      <${MemeAvatar} m=${x} />
      <span class="tree-id"><b>${x.symbol}</b><span class="muted fine tnum">${x.parent ? f.tokens(lockedOf(x), x.quoteSymbol) : `${compact(n(lockedOf(x)))} ETH`}</span></span>
      ${joined.has(x.address) && html`<span class="chip chip-accent" data-tip=${`Joined by a union\nIts ETH bought ${world.memes.get(x.parent)?.symbol}; its holders kept their tokens`}><${I.Merge} size=${12} /> Union</span>`}
      <${Phase} m=${x} />
    </a>
    ${x.children.length > 0 && html`<ul>${x.children.map((c) => node(world.memes.get(c)))}</ul>`}
  </li>`;
  return html`<ul class="tree" aria-label="Family tree">${node(world.memes.get(m.root))}</ul>`;
}

/** What executing the union now would do, from the live curves; null while it cannot be computed. */
function useUnionPreview(u, meme, target) {
  const { session, world } = useApp();
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    let live = true;
    if (u.executed || u.stale) return setPreview(null);
    readCurves(session.hub, [u.meme, ...target.lineage])
      .then((curves) => live && setPreview(simulateUnion(curves, { meme: u.meme, targetLineage: target.lineage, now: session.chain.now() })))
      .catch(() => live && setPreview(null));
    return () => {
      live = false;
    };
  }, [u.id, u.executed, world.loadedAt]);
  return preview;
}

function BeforeAfter({ u, meme, target, preview }) {
  const { world } = useApp();
  const root = world.memes.get(target.root);
  const ethPrice = (x) => `${compact(n(x) * 1e6)} ETH`;
  return html`<div class="before-after" aria-label="If it passes">
    <div class="ba-head"><span></span><span>Now</span><span>If it passes</span></div>
    <div class="ba-row"><span class="muted">${meme.symbol} priced in</span><span>ETH</span><span>${target.symbol}</span></div>
    <div class="ba-row"><span class="muted"><${Term} k="reserve">${meme.symbol} reserve</${Term}></span><span class="tnum">${ethOrTokens(preview.ethIn, "ETH")}</span>
      <span class="tnum">${f.tokens(preview.targetIn, target.symbol)}</span></div>
    <div class="ba-row"><span class="muted"><${Term} k="price1m">${meme.symbol} price · 1M</${Term}></span><span class="tnum">${ethPrice(meme.priceEth)}</span>
      <span class="tnum">≈ ${ethPrice(preview.priceAfterEth)}</span></div>
    <div class="ba-row"><span class="muted">${root.symbol} reserve</span><span class="tnum">${compact(n(lockedOf(root)))} ETH</span>
      <span class="tnum up-text">+${ethOrTokens(preview.ethIn, "ETH")}</span></div>
    <div class="ba-row"><span class="muted">Every ${meme.symbol} balance</span><span class="tnum">—</span><span>unchanged</span></div>
  </div>`;
}

export function UnionBlock({ u, here = false }) {
  const { world, act, busy, session } = useApp();
  const meme = world.memes.get(u.meme), target = world.memes.get(u.target);
  const [value, setValue] = useState("");
  const wei = f.parseAmount(value);
  const share = Number(u.locked) / Math.max(1, Number(u.circulating));
  const open = !u.executed && !u.stale && world.now <= u.deadline;
  const ready = !u.executed && !u.stale && world.now > u.deadline && u.locked * 2n > u.circulating;
  const failed = !u.executed && !u.stale && world.now > u.deadline && !ready;
  const preview = useUnionPreview(u, meme, target);
  const status = u.executed ? ["Executed", "money"] : u.stale ? ["Void", ""] : open ? [`closes in ${countdown(u.deadline - world.now)}`, "hot"] : ready ? ["Majority", "accent"] : ["Failed", ""];
  const toTrade = (e) => {
    if (!here) return;
    e.preventDefault();
    document.getElementById("trade")?.scrollIntoView({ behavior: "smooth", block: "center" });
    document.getElementById("trade-amount")?.focus({ preventScroll: true });
  };
  return html`<div class="union" data-union=${u.id}>
    <div class="row-between">
      <span class="union-pair"><${MemeName} m=${meme} name=${false} /><span class="union-arrow" aria-label="joins"><${I.Merge} size=${14} /></span><${MemeName} m=${target} name=${false} /></span>
      <span class=${`chip ${status[1] ? `chip-${status[1]}` : ""} tnum`} data-tip=${open ? `Vote open\nCloses ${f.fullDate(u.deadline)}` : undefined}>${status[0]}</span>
    </div>
    ${!u.executed && html`<${Bullet} value=${share} target=${0.5} max=${1} label=${`${f.percent(share, 0)} locked, majority at 50%`} />
      <div class="row-between fine"><span class="muted"><${Term} k="quorum">Locked in favour</${Term}></span><span class="tnum">${f.percent(share, 0)} <span class="muted">/ 50% needed</span></span></div>`}
    ${u.mine > 0n && html`<div class="row-between fine"><span class="muted">You locked</span><span class="tnum">${f.tokens(u.mine, meme.symbol)}</span></div>`}
    ${!u.executed && !u.stale && preview && html`<${BeforeAfter} u=${u} meme=${meme} target=${target} preview=${preview} />`}
    ${open && html`<p class="explain">If more than half of the ${meme.symbol} in circulation is locked when the vote closes, anyone can execute it: ${meme.symbol}'s ETH buys ${target.symbol} without fees and ${meme.symbol} becomes a variant of ${target.symbol}. Locking is the vote, and you can unlock at any time. Without a majority, nothing changes.</p>`}
    ${failed && html`<p class="explain">The vote closed without a majority: nothing changed. Locked tokens can be taken back.</p>`}
    ${u.executed && html`<p class="explain">${meme.symbol} joined the ${world.memes.get(target.root).symbol} family: its ETH bought ${target.symbol}, and every holder kept their ${meme.symbol}.</p>`}
    <div class="union-actions">
      ${open && meme.balance > 0n && html`<form class="inline" onSubmit=${async (e) => { e.preventDefault(); if (wei && (await act("Vote recorded", "lockUnion", [u.id, wei]))) setValue(""); }}>
        <div class="amount sm">
          <input id=${`lock-${u.id}`} type="text" inputmode="decimal" autocomplete="off" aria-label="Tokens to lock" placeholder="0" value=${value} onInput=${(e) => setValue(e.currentTarget.value)} />
          <button type="button" class="link-btn" onClick=${() => setValue(f.exact(meme.balance))}>Max</button>
          <span class="unit">${meme.symbol}</span>
        </div>
        <button class="btn btn-sm" disabled=${!wei || wei > meme.balance || busy}>Vote for</button>
      </form>`}
      ${open && meme.balance === 0n && html`<a class="btn btn-sm btn-quiet" href=${memeHref(meme.address)} onClick=${toTrade}>Buy ${meme.symbol} to vote</a>`}
      ${ready && html`<button type="button" class="btn btn-sm" disabled=${busy}
        onClick=${async () => (await act("Union executed", "executeUnion", [u.id, 0n])) && celebrate({ symbol: target.symbol, hue: hueOf(world, target) })}>Execute</button>`}
      ${u.mine > 0n && html`<button type="button" class="btn btn-quiet btn-sm" disabled=${busy} onClick=${() => act("Tokens unlocked", "unlockUnion", [u.id])}>Unlock</button>`}
    </div>
  </div>`;
}

export function ProposeUnion({ m }) {
  const { world, act, busy } = useApp();
  const targets = [...world.memes.values()].filter((t) => t.root !== m.address && !t.opening);
  const [target, setTarget] = useState(targets[0]?.address ?? "");
  if (!targets.length) return null;
  return html`<form class="inline propose" onSubmit=${(e) => { e.preventDefault(); act("Union proposed", "proposeUnion", [m.address, target]); }}>
    <label class="sr" for="union-target">Family to join</label>
    <select id="union-target" value=${target} onChange=${(e) => setTarget(e.currentTarget.value)}>
      ${targets.map((t) => html`<option key=${t.address} value=${t.address}>Join ${t.symbol}</option>`)}
    </select>
    <button class="btn btn-quiet btn-sm" disabled=${busy} data-tip=${`Union\nAsk ${m.symbol} holders to vote ${m.symbol} into another family`}>Propose</button>
  </form>`;
}
