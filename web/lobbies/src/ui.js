// Component library: Button, IconButton, Segmented, Chip, Coin, Avatar, Bar, GestationTimeline, Equalizer, Orbit,
// Sheet and Toast. Each one maps to a class family in styles.css and takes plain data, never the store.

import { h } from "preact";
import { useEffect, useRef } from "preact/hooks";
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

export function Segmented({ label, options, value, onChange, full }) {
  return html`<div class=${cx("seg", full && "full")} role="group" aria-label=${label}>
    ${options.map((o) => html`<button type="button" key=${o.id} aria-pressed=${String(o.id === value)} disabled=${o.disabled} onClick=${() => onChange(o.id)}>${o.label}</button>`)}
  </div>`;
}

export function Chip({ tone = "neutral", dot, live, children, class: extra }) {
  return html`<span class=${cx("chip", tone, extra)}>${live ? html`<span class="livedot" />` : dot ? html`<span class="dot" />` : null}${children}</span>`;
}

// A coin: its art when it has some, its ticker's first letters on a struck face otherwise.
export function Coin({ coin, size = 48, big, class: extra, alt = "" }) {
  const style = { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.32)}px`, ...coinStyle(coin.hue, big) };
  return html`<span class=${cx("coin", extra)} style=${style}>
    ${coin.ticker.slice(0, 2)}
    ${coin.logo && html`<img src=${coin.logo} alt=${alt} loading="lazy" decoding="async" />`}
  </span>`;
}

// A person: their photo over a tinted circle with initials (seen while the photo loads or if it fails).
export function Avatar({ person, size = 36, speaking, muted, status, class: extra, style }) {
  const base = { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.36)}px`,
    background: `linear-gradient(150deg, hsl(${person.hue} 75% 74%), hsl(${person.hue} 60% 48%))`, ...style };
  return html`<span class=${cx("av", speaking && "speaking", extra)} style=${base} title=${person.name}>
    ${person.name[0].toUpperCase()}
    ${person.src && html`<img src=${person.src} alt="" loading="lazy" decoding="async" />`}
    ${muted && html`<span class="muted" role="img" aria-label="Muted"><${I.MicOff} size=${11} stroke=${2.6} /></span>`}
    ${status && html`<span class="status" style=${{ background: status }} />`}
  </span>`;
}

export function Bar({ value, color = "var(--lime)", label }) {
  return html`<span class="bar" role=${label ? "img" : undefined} aria-label=${label}><span style=${{ width: `${value}%`, background: color }} /></span>`;
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
export function Sheet({ title, labelledBy, onClose, busy, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    // Forms start in their first field; other sheets take focus themselves, so no button is armed by accident.
    const field = el && el.querySelector("input, textarea");
    (field || el).focus();
  }, []);
  const onKey = (e) => { if (e.key === "Escape" && !busy) onClose(); };
  return html`<div class="sheet-bg" onClick=${() => !busy && onClose()}>
    <div ref=${ref} class="sheet glass" role="dialog" aria-modal="true" tabIndex="-1" aria-labelledby=${labelledBy} onClick=${(e) => e.stopPropagation()} onKeyDown=${onKey}>
      ${title && html`<div class="sheet-head"><h2 id=${labelledBy} class="display">${title}</h2>
        <${IconButton} label="Close" size="sm" onClick=${onClose}><${I.Close} size=${13} stroke=${2.6} /></${IconButton}></div>`}
      ${children}
    </div>
  </div>`;
}

const TONE = { lime: "var(--lime)", sky: "var(--sky)", white: "var(--text)" };
export function Toast({ toast }) {
  if (!toast) return null;
  return html`<div class="toast glass" role="status" aria-live="polite">
    <span class="tick" style=${{ background: TONE[toast.tone] || TONE.lime }}><${I.Check} size=${13} stroke=${3.2} /></span>${toast.text}
  </div>`;
}

// A composer: one field and a send button; Enter sends.
export function Composer({ label, value, placeholder, onInput, onSend, maxLength = 300, leading }) {
  return html`<div class="composer">
    ${leading}
    <label class="box">
      <span class="sr">${label}</span>
      <input type="text" value=${value} placeholder=${placeholder} maxLength=${maxLength}
        onInput=${(e) => onInput(e.currentTarget.value)} onKeyDown=${(e) => { if (e.key === "Enter") { e.preventDefault(); onSend(); } }} />
      <button type="button" class="send" aria-label="Send" disabled=${!value.trim()} onClick=${onSend}><${I.Up} size=${15} /></button>
    </label>
  </div>`;
}
