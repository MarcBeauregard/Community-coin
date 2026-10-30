// The guided tour of the demo: a few steps, each pointing at the real button and waiting for the real transaction
// (or the clock) before moving on. It ends after a commit, a claim, a buy of a copy, a sale into the spike and a look
// at a union vote: the whole idea in about two minutes. Only in demo mode.

import { useEffect, useState } from "preact/hooks";
import { html } from "./ui.js";
import { go, memeHref } from "./common.js";

const isAct = (...fns) => (ev) => ev.type === "act" && fns.includes(ev.fn);

/** The steps for the market as it is now; steps whose example is missing (no live opening, no vote) are left out. */
export function planTour(world) {
  const memes = [...world.memes.values()];
  const opening = memes.filter((m) => m.opening).sort((a, b) => b.openUntil - a.openUntil)[0];
  const variant = memes.filter((m) => m.parent && !m.opening && m.settled).sort((a, b) => Number(b.reserve - a.reserve))[0];
  const union = world.unions.find((u) => !u.executed && !u.stale && world.now <= u.deadline);
  const steps = [];
  if (opening) {
    const at = memeHref(opening.address);
    steps.push(
      { id: "commit", route: at, target: "#opening .btn-lg", done: isAct("commit", "commitSol"), title: "Join the live opening",
        body: `${opening.symbol} is in its opening. Commit 1 SOL with the gold button: everyone in this batch pays the same price when the timer ends.` },
      { id: "warp", route: at, target: ".clock > .pill", done: (ev) => ev.type === "warp", title: "Skip ahead an hour",
        body: "In the demo, time is yours. Open the clock at the top and pick 1 hour: the opening closes and its tokens unlock." },
      { id: "claim", route: at, target: "#position .btn", done: isAct("claim"), title: "Claim your tokens",
        body: "The batch bought its tokens at one price and yours have unlocked. Claim them into your balance." },
    );
  }
  if (variant) {
    const root = world.memes.get(variant.root);
    const at = memeHref(variant.address);
    steps.push(
      { id: "buy", route: at, target: "#trade .btn-lg", done: isAct("buySol", "buy"), title: "Buy the copy",
        body: `${variant.symbol} is a copy of ${root.symbol}. Buy it with SOL and read the breakdown under the amount: your SOL lands in ${root.symbol}'s reserve first.` },
      { id: "sell", route: at, target: "#trade [aria-label='Side']", done: isAct("sellToSol", "sell"), title: "Sell into the spike",
        body: `Your buy pushed ${variant.symbol} above its 1h reference. Switch to Sell, press Max and sell: part of the gain above the reference stays with the holders.` },
    );
  }
  if (union) {
    const meme = world.memes.get(union.meme), target = world.memes.get(union.target);
    steps.push({ id: "union", route: memeHref(union.meme), target: `[data-union='${union.id}']`, manual: "Next", title: "Rivals can merge",
      body: `${meme.symbol} holders are voting to join the ${target.symbol} family. The block shows what would change if the vote passes, and what voting costs you.` });
  }
  steps.push({ id: "end", manual: "Finish", title: "That is the whole idea",
    body: "Copies feed the original, the opening is one price for everyone, spikes pay the holders and rivals can merge. How it works has the numbers behind it." });
  return steps;
}

/** Where the target is on screen, followed frame by frame so the ring tracks scrolling and layout changes. */
function useRect(selector) {
  const [rect, setRect] = useState(null);
  useEffect(() => {
    if (!selector) return setRect(null);
    let frame, last = "";
    const tick = () => {
      const el = document.querySelector(selector);
      const r = el?.getBoundingClientRect();
      const key = r ? `${r.left|0},${r.top|0},${r.width|0},${r.height|0}` : "";
      if (key !== last) {
        last = key;
        setRect(r && r.width ? { left: r.left, top: r.top, width: r.width, height: r.height } : null);
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [selector]);
  return rect;
}

export function Tour({ tour, onNext, onClose }) {
  const step = tour.steps[tour.i];
  const rect = useRect(step.target);
  useEffect(() => {
    if (step.route && location.hash !== step.route) go(step.route);
    const t = setTimeout(() => document.querySelector(step.target)?.scrollIntoView({ behavior: "smooth", block: "center" }), 350);
    return () => clearTimeout(t);
  }, [tour.i]);
  const pad = 6;
  return html`<div class="tour-layer">
    ${rect && html`<div class="tour-ring" aria-hidden="true"
      style=${`left:${rect.left - pad}px;top:${rect.top - pad}px;width:${rect.width + pad * 2}px;height:${rect.height + pad * 2}px`}></div>`}
    <aside class="tour" role="dialog" aria-modal="false" aria-labelledby="tour-title" data-tour-step=${step.id}>
      <div class="tour-top">
        <span class="tour-count tnum">Step ${tour.i + 1} of ${tour.steps.length}</span>
        <span class="tour-dots" aria-hidden="true">${tour.steps.map((_, i) => html`<i key=${i} class=${i < tour.i ? "done" : i === tour.i ? "now" : ""}></i>`)}</span>
      </div>
      <h2 id="tour-title" aria-live="polite">${step.title}</h2>
      <p>${step.body}</p>
      <div class="tour-actions">
        ${step.id === "end" ? html`<a class="link-btn" href="#how" onClick=${onClose}>How it works</a>` : html`<button type="button" class="link-btn" onClick=${onClose}>Skip tour</button>`}
        ${step.manual ? html`<button type="button" class="btn btn-sm" onClick=${step.id === "end" ? onClose : onNext}>${step.manual}</button>` : html`<span class="tour-wait">Waiting for you</span>`}
      </div>
    </aside>
  </div>`;
}
