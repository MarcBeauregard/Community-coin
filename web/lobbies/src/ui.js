// Component library: Button, IconButton, Segmented, Chip, Coin, Avatar, Bar, GestationTimeline, Equalizer, Orbit,
// Sheet and Toast. Each one maps to a class family in styles.css and takes plain data, never the store.

import { h } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import htm from "htm";
import { coinStyle } from "./tokens.js";
import * as I from "./icons.js";

export const html = htm.bind(h);
const cx = (...names) => names.filter(Boolean).join(" ");

export function Button({ variant = "fill", size, block, class: extra, children, ...props }) {
  return html`<button type="button" class=${cx("btn", variant, size, block && "block", extra)} ...${props}>${children}</button>`;
}

// Icon-only buttons always carry an accessible name.
export function IconButton({ label, tone, size, pressed, class: extra, children, ...props }) {
  return html`<button type="button" class=${cx("ibtn", tone, size, extra)} aria-label=${label} title=${label}
    aria-pressed=${pressed === undefined ? undefined : String(!!pressed)} ...${props}>${children}</button>`;
}

// A segmented control; with `tabs` it switches between views and is announced as tabs (tablist, tab, selected).
export function Segmented({ label, options, value, onChange, full, tabs }) {
  // Tabs move with the arrow keys (and Home / End), as tabs do.
  const onKey = tabs ? (e) => {
    const i = options.findIndex((o) => o.id === value);
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: options.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const next = options[(to + options.length) % options.length];
    onChange(next.id);
    const list = e.currentTarget;
    requestAnimationFrame(() => list.querySelectorAll("[role=tab]")[options.indexOf(next)]?.focus());
  } : undefined;
  return html`<div class=${cx("seg", full && "full")} role=${tabs ? "tablist" : "group"} aria-label=${label} onKeyDown=${onKey}>
    ${options.map((o) => tabs
      ? html`<button type="button" key=${o.id} role="tab" id=${`tab-${o.id}`} aria-controls="lobby-panel" aria-selected=${String(o.id === value)} tabIndex=${o.id === value ? 0 : -1} onClick=${() => onChange(o.id)}>${o.label}</button>`
      : html`<button type="button" key=${o.id} aria-pressed=${String(o.id === value)} disabled=${o.disabled} onClick=${() => onChange(o.id)}>${o.label}</button>`)}
  </div>`;
}

export function Chip({ tone = "neutral", dot, live, children, class: extra }) {
  return html`<span class=${cx("chip", tone, extra)}>${live ? html`<span class="livedot" />` : dot ? html`<span class="dot" />` : null}${children}</span>`;
}

// A coin: its art when it has some, its ticker's first letters on a struck face otherwise.
export function Coin({ coin, size = 48, big, class: extra, alt = "" }) {
  const style = { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.32)}px`, ...coinStyle(coin.hue, big) };
  // Decorative unless it has alt text: the coin's name is always said next to it.
  return html`<span class=${cx("coin", extra)} style=${style} aria-hidden=${alt ? undefined : "true"}>
    <span aria-hidden="true">${coin.ticker.slice(0, 2)}</span>
    ${coin.logo && html`<img src=${coin.logo} alt=${alt} loading="lazy" decoding="async" />`}
  </span>`;
}

// A person: their photo over a tinted circle with initials (seen while the photo loads or if it fails). Decorative
// for screen readers (the name is always said next to it), except what it alone shows: speaking, muted.
export function Avatar({ person, size = 36, speaking, muted, status, alone, class: extra, style }) {
  const base = { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.36)}px`,
    background: `linear-gradient(150deg, hsl(${person.hue} 75% 74%), hsl(${person.hue} 60% 48%))`, ...style };
  return html`<span class=${cx("av", speaking && "speaking", extra)} style=${base} title=${person.name}>
    <span aria-hidden="true">${person.glyph ?? (person.name || "?")[0].toUpperCase()}</span>
    ${speaking && html`<span class="sr">${alone ? `${person.name}, speaking` : "speaking, "}</span>`}
    ${person.src && html`<img src=${person.src} alt="" loading="lazy" decoding="async" />`}
    ${muted && html`<span class="muted" role="img" aria-label="Muted"><${I.MicOff} size=${11} stroke=${2.6} /></span>`}
    ${status && html`<span class="status" style=${{ background: status }} />`}
  </span>`;
}

export function Bar({ value, color = "var(--lime)", label }) {
  return html`<span class="bar" role=${label ? "img" : undefined} aria-label=${label}><span style=${{ width: `${value}%`, background: color }} /></span>`;
}

// A small line of a value over time: `points` [[t, v], ...], scaled to its own range (its shape, not its size).
// Decorative: what it says goes in words next to it.
export function Spark({ points, width = 96, height = 28, color = "var(--lime)" }) {
  if (!points || points.length < 2) return null;
  const t0 = points[0][0], t1 = points[points.length - 1][0] || 1;
  const max = Math.max(...points.map((p) => p[1])) || 1;
  const x = (t) => ((t - t0) / (t1 - t0 || 1)) * (width - 2) + 1;
  const y = (v) => height - 2 - (v / max) * (height - 4);
  const d = points.map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  const [lt, lv] = points[points.length - 1];
  return html`<svg class="spark" width=${width} height=${height} viewBox=${`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
    <path d=${`${d}L${x(lt).toFixed(1)} ${height}L${x(t0).toFixed(1)} ${height}Z`} fill=${color} opacity="0.12" />
    <path d=${d} fill="none" stroke=${color} stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" />
    <circle cx=${x(lt)} cy=${y(lv)} r="2.2" fill=${color} />
  </svg>`;
}

// The hour, as four segments sized by their duration, each filled as time passes.
export function GestationTimeline({ phases, labels = true, height = 6, mono }) {
  return html`<div class="timeline">
    <div class="track" style=${{ height: `${height}px` }}>
      ${phases.map((p) => html`<span key=${p.id} class="seg-t" style=${{ flex: `${p.weight} 1 0` }}><span style=${{ width: `${p.fill}%`, background: mono || p.color }} /></span>`)}
    </div>
    ${labels && html`<div class="labels">${phases.map((p) => html`<span key=${p.id} class=${p.current ? "on" : ""} style=${{ flex: `${p.weight} 1 0` }}>${p.label}</span>`)}</div>`}
  </div>`;
}

export function Equalizer({ height = 12 }) {
  return html`<span class="eq" style=${{ height: `${height}px` }} aria-hidden="true"><i /><i /><i /></span>`;
}

// People orbiting a coin: the room that made it.
export function Orbit({ people, radius = 47, base = 34, reverse, offset = 0 }) {
  return html`<div class=${cx("orbit", reverse && "reverse")} aria-hidden="true">
    ${people.map((p, i) => {
      const a = (i / people.length) * Math.PI * 2 + offset;
      const size = base - (i % 3) * 6;
      return html`<${Avatar} key=${i} person=${p} size=${size} style=${{ left: `${50 + Math.cos(a) * radius}%`, top: `${50 + Math.sin(a) * radius}%` }} />`;
    })}
  </div>`;
}

// A modal sheet: centered on desktop, from the bottom on a phone. Escape and the backdrop close it; focus moves in.
export function Sheet({ title, labelledBy, onClose, busy, refocus, refocusFirst, children }) {
  const ref = useRef(null);
  const closeRef = useRef(null);
  closeRef.current = () => { if (!busy) onClose(); };
  useLayoutEffect(() => { // at once, so a key pressed right after the sheet appears already lands in it
    const el = ref.current;
    const opener = document.activeElement;
    // Forms start in their first field; other sheets take focus themselves, so no button is armed by accident.
    const field = el && el.querySelector("input, textarea");
    (field || el).focus();
    // If the focus is still outside a frame later (a click's own focus landing after the sheet opened), take it back.
    const settle = requestAnimationFrame(() => { if (el.isConnected && !el.contains(document.activeElement)) (field || el).focus(); });
    // Escape closes the sheet wherever the focus is.
    const esc = (e) => { if (e.key === "Escape" && !e.defaultPrevented && !el.contains(e.target)) { e.preventDefault(); closeRef.current(); } };
    document.addEventListener("keydown", esc);
    // The second click of a double click lands behind the sheet: drop whatever it selected there.
    const clear = () => window.getSelection?.()?.removeAllRanges();
    clear();
    setTimeout(clear, 300);
    // Closed, the sheet gives focus back to what opened it; if that is gone (Connect became the wallet), to what
    // replaced it, else to the screen's heading.
    return () => { cancelAnimationFrame(settle); document.removeEventListener("keydown", esc); setTimeout(() => {
      if (document.querySelector("[role=dialog]")) return; // another sheet took over (pledge → receipt): it has the focus
      const preferred = refocusFirst && refocus && document.querySelector(refocus);
      if (preferred) return preferred.focus(); // the opener now stands for something else (the next idea)
      if (opener && opener !== document.body && opener.isConnected && !opener.disabled) return opener.focus(); // the page itself is no opener; a button the sheet disabled is none either
      const next = (refocus && document.querySelector(refocus)) || document.querySelector(".screen h1, h1");
      if (next) { if (!next.matches("button, a, input")) next.setAttribute("tabindex", "-1"); next.focus(); }
    }, 0); };
  }, []);
  const onKey = (e) => {
    if (e.key === "Escape" && !busy) return onClose();
    // A modal sheet keeps Tab inside it.
    if (e.key !== "Tab") return;
    const items = [...ref.current.querySelectorAll("button:not(:disabled), input:not(:disabled), textarea, select, a[href], [tabindex]:not([tabindex='-1'])")];
    if (!items.length) return;
    const [first, last] = [items[0], items.at(-1)];
    const at = document.activeElement;
    if (e.shiftKey && (at === first || at === ref.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  };
  return html`<div class="sheet-bg" onClick=${() => !busy && onClose(true)}>
    <div ref=${ref} class="sheet glass" role="dialog" aria-modal="true" tabIndex="-1" aria-labelledby=${labelledBy} onClick=${(e) => e.stopPropagation()} onKeyDown=${onKey}>
      ${title && html`<div class="sheet-head"><h2 id=${labelledBy} class="display">${title}</h2>
        <${IconButton} label="Close" size="sm" onClick=${onClose}><${I.Close} size=${13} stroke=${2.6} /></${IconButton}></div>`}
      ${children}
    </div>
  </div>`;
}

// A toast: a check for what went right, an exclamation for what didn't ("error" tone), never the other way round.
const TONE = { lime: "var(--lime)", sky: "var(--sky)", white: "var(--text)", error: "var(--amber)" };
// The live regions are always in the page (a region born with its text is often not read); the toast appears in one.
export function Toast({ toast }) {
  const bad = toast?.tone === "error";
  const body = toast && html`<div class="toast glass" key=${toast.id}>
    <span class="tick" style=${{ background: TONE[toast.tone] || TONE.lime }} aria-hidden="true">${bad ? html`<${I.Alert} size=${14} stroke=${3} />` : html`<${I.Check} size=${13} stroke=${3.2} />`}</span>${toast.text}
  </div>`;
  return html`<div role="status" aria-live="polite">${!bad && body}</div><div role="alert" aria-live="assertive">${bad && body}</div>`;
}

// A composer: one field and a send button; Enter sends.
export function Composer({ label, value, placeholder, onInput, onSend, maxLength = 300, leading }) {
  return html`<div class="composer">
    ${leading}
    <div class="box">
      <input type="text" aria-label=${label} value=${value} placeholder=${placeholder} maxLength=${maxLength}
        onInput=${(e) => onInput(e.currentTarget.value)} onKeyDown=${(e) => { if (e.key === "Enter") { e.preventDefault(); onSend(); } }} />
      <button type="button" class="send" aria-label="Send" disabled=${!value.trim()} onClick=${onSend}><${I.Up} size=${15} /></button>
    </div>
  </div>`;
}
