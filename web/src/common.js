// What every screen shares: the app context, the coin of a meme, names, phases, small number helpers, and the
// glossary buttons that make each term explainable on tap, click or keyboard.

import { useContext } from "preact/hooks";
import { createContext } from "preact";
import * as f from "./format.js";
import * as I from "./icons.js";
import { html, Coin, compact } from "./ui.js";
import { pointAt } from "./world.js";
import { term } from "./glossary.js";

export const App = createContext(null);
export const useApp = () => useContext(App);
export const memeHref = (address) => `#meme-${address}`;
export const go = (hash) => {
  location.hash = hash;
};

export const HOUR = 3600;
export const TOLERANCE = 99n; // minimum output at 99% of the quote
export const SPIKE_FLAG = 0.05; // a price 5% above its reference gets a warm chip
export const n = (value) => f.toNumber(value);
export const countdown = (s) => {
  const v = Math.max(0, Math.round(s));
  return v >= 3600 ? f.duration(v) : `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
};
/** An amount with its unit, compact: 1.2 SOL, 5.52M PNUT. */
export const amount = (a) => (!a ? "—" : a.unit === "SOL" ? `${compact(n(a.value))} SOL` : `${f.tokens(a.value)} ${a.unit}`);
export const solOrTokens = (value, unit) => (unit === "SOL" ? `${compact(n(value), 4)} SOL` : f.tokens(value, unit));

/** Each family keeps one metal, given by the order its root was launched. */
export function hueOf(world, m) {
  let i = 0;
  for (const r of world.memes.values()) {
    if (r.parent) continue;
    if (r.address === m.root) return i;
    i++;
  }
  return 0;
}

export function MemeAvatar({ m, size }) {
  const { world } = useApp();
  return html`<${Coin} symbol=${m.symbol} hue=${hueOf(world, m)} depth=${m.depth} size=${size} />`;
}

/** SOL gets a silver coin struck with its own sign. */
export const SolCoin = ({ size }) => html`<${Coin} symbol="SOL" glyph="◎" hue=${5} size=${size} />`;

/** The coin of whatever unit an amount is in: SOL, or one of the memes on screen. */
export function UnitCoin({ unit, size = "sm" }) {
  const { world } = useApp();
  if (unit === "SOL") return html`<${SolCoin} size=${size} />`;
  const m = [...world.memes.values()].find((x) => x.symbol === unit);
  return m ? html`<${MemeAvatar} m=${m} size=${size} />` : null;
}

export function MemeName({ m, link = true, name = true }) {
  const inner = html`<${MemeAvatar} m=${m} /><span class="meme-sym">${m.symbol}</span>${name && html`<span class="meme-name">${m.name}</span>`}`;
  return link ? html`<a class="meme-id" href=${memeHref(m.address)}>${inner}</a>` : html`<span class="meme-id">${inner}</span>`;
}

/** The SOL a family holds: settled reserve of its root, or the batch while the root's opening runs. */
export const lockedOf = (m) => (m.settled ? m.reserve : m.batchQuote);
export const pathFor = (session, m) => (session.history.get(m.address) ?? []).map((p) => ({ t: p.t, v: p.p }));
export const familyOf = (world, m) => [...world.memes.values()].filter((x) => x.root === m.root);
export const nameOf = (session, address) => session.hub.accounts.find((a) => a.address === address)?.name ?? f.shortAddress(address);

/** Price per million tokens an hour ago, from the recorded history; null when there is no such point. */
export function hourAgo(session, world, m, key = "p") {
  const p = pointAt(session.history.get(m.address), world.now - HOUR);
  return p ? p[key] : null;
}

/** The one state worth a chip on a meme: live opening, spike above the reference, or vesting. */
export function Phase({ m }) {
  const { world, session } = useApp();
  if (m.opening)
    return html`<span class="chip chip-hot" data-tip=${`Opening · ${f.duration(m.openUntil - world.now)} left\nEveryone in the batch pays one price when the timer ends`}>
      <${I.Timer} size=${14} /> ${countdown(m.openUntil - world.now)}</span>`;
  if (m.premium > SPIKE_FLAG)
    return html`<span class="chip chip-hot" data-tip=${`${f.signedPercent(m.premium)} vs 1h reference\nSelling now leaves ${f.percent(session.params.spikeShareBps / 10000, 0)} of the excess to holders`}>
      Spike ${f.signedPercent(m.premium)}</span>`;
  if (m.vesting)
    return html`<span class="chip" data-tip=${`Vesting ${f.percent(m.vestedShare, 0)}\nOpening tokens unlock over ${f.spoken(session.params.vestWindow)}`}>Vesting ${f.percent(m.vestedShare, 0)}</span>`;
  return null;
}

/**
 * A focusable "what is this?" button for a glossary term. Its definition shows on hover, focus or tap, and a link
 * to the full glossary sits behind it on the How it works page.
 */
export function Info({ k }) {
  const { session } = useApp();
  const t = term(k, session?.params);
  return html`<button type="button" class="info" data-term=${k} aria-label=${`What is ${t.name}?`} data-tip=${`${t.name}\n${t.text}`}>
    <${I.Info} size=${14} />
  </button>`;
}

/** A label followed by its glossary button. */
export const Term = ({ k, children }) => html`<span class="term">${children}<${Info} k=${k} /></span>`;
