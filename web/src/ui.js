// Interface primitives, after the dashboard-design skill's component patterns:
// one tooltip for the whole screen, letter avatars, delta badges with a one-word baseline, KPI cards,
// slim share bars, bullet graphs, segmented share bars, segmented controls, popover menus and one chart.

import { h } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";
import htm from "htm";

export const html = htm.bind(h);

// ------------------------------------------------------------------ tooltip

/** Any element with data-tip gets the same dark tooltip, on hover and on keyboard focus. */
export function installTooltip() {
  const tip = document.createElement("div");
  tip.id = "tip";
  tip.setAttribute("role", "tooltip");
  document.body.append(tip);
  let current = null;
  const show = (el) => {
    current = el;
    const [big, ...rest] = el.dataset.tip.split("\n");
    tip.replaceChildren();
    const b = document.createElement("strong");
    b.textContent = big;
    tip.append(b);
    if (rest.length) {
      const s = document.createElement("span");
      s.textContent = rest.join("\n");
      tip.append(s);
    }
    tip.classList.add("show");
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, ht = tip.offsetHeight;
    tip.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    tip.style.top = `${r.top - ht - 8 < 8 ? r.bottom + 8 : r.top - ht - 8}px`;
  };
  const hide = () => {
    current = null;
    tip.classList.remove("show");
  };
  for (const type of ["pointerover", "focusin"])
    document.addEventListener(type, (e) => {
      const el = e.target.closest?.("[data-tip]");
      el ? show(el) : hide();
    });
  document.addEventListener("pointerout", (e) => {
    if (current && !current.contains(e.relatedTarget)) hide();
  });
  document.addEventListener("scroll", hide, true);
  document.addEventListener("keydown", (e) => e.key === "Escape" && hide());
}

// ------------------------------------------------------------------ numbers

const nf = (opts) => new Intl.NumberFormat("fr-FR", opts);

/** 0 and evenly spaced round ticks covering max: steps of 1, 2, 2.5 or 5 × 10^n. */
export function niceTicks(max, count = 4) {
  if (!(max > 0)) return [0, 1];
  const raw = max / count, pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw);
  return Array.from({ length: Math.ceil(max / step - 1e-9) + 1 }, (_, i) => +(i * step).toPrecision(12));
}

/** Compact number with a few significant digits: 0,0162 · 12,9 M · 1,2 k. */
export function compact(n, digits = 3) {
  if (n === 0) return "0";
  if (Math.abs(n) >= 1000) return nf({ notation: "compact", maximumFractionDigits: 1 }).format(n);
  return nf({ maximumSignificantDigits: digits }).format(n);
}

// ------------------------------------------------------------------ avatars

/** Letter avatar tinted with the family's hue, so a meme and its variants read as one family. */
export function Avatar({ symbol, hue = 0, size = "md" }) {
  return html`<span class=${`avatar avatar-${size}`} style=${`--hue: var(--cat-${hue % 6})`} aria-hidden="true">${symbol.slice(0, 2)}</span>`;
}

// ------------------------------------------------------------------ delta

/**
 * Change against a baseline. Tiny bases say what they were instead of shouting a percentage; lower-is-better
 * metrics flip the colours; neutral ones stay grey.
 */
export function Delta({ cur, prev, vs, min = 0, invert = false, neutral = false, format = compact, tip }) {
  if (prev === null || prev === undefined || cur === null || cur === undefined) return null;
  if (prev === 0 || prev < min) return html`<span class="delta muted" data-tip=${tip}>${`avant ${format(prev)}`}</span>`;
  const d = ((cur - prev) / prev) * 100;
  const r = Math.round(d);
  if (r === 0) return html`<span class="delta muted" data-tip=${tip}>±0 % <span>${vs}</span></span>`;
  const good = invert ? d < 0 : d > 0;
  const text = Math.abs(d) > 999 ? (d > 0 ? "10×+" : "−99 %") : `${d > 0 ? "▲" : "▼"} ${Math.abs(r)} %`;
  return html`<span class="delta" data-tip=${tip ?? `${vs} : ${format(prev)}`}>
    <b class=${neutral ? "" : good ? "up" : "down"}>${text}</b> <span class="muted">${vs}</span>
  </span>`;
}

// ------------------------------------------------------------------ cards

export function Kpi({ label, icon, value, unit, delta, tip, tone, id }) {
  return html`<div class=${`card kpi ${tone ? `tone-${tone}` : ""}`} data-kpi=${id}>
    <div class="kpi-head">
      <span class="kpi-label">${label}</span>
      ${icon && html`<span class="icon-square">${icon}</span>`}
    </div>
    <div class="kpi-value" data-tip=${tip}>${value}${unit && html`<small>${unit}</small>`}</div>
    <div class="kpi-foot">${delta ?? html`<span class="delta muted"> </span>`}</div>
  </div>`;
}

export function Card({ title, value, actions, children, class: cls = "", id }) {
  return html`<section id=${id} class=${`card panel ${cls}`} aria-labelledby=${id && `${id}-title`}>
    ${(title || actions) && html`<header class="panel-head">
      <div>
        ${title && html`<h2 id=${id && `${id}-title`}>${title}</h2>`}
        ${value && html`<p class="panel-value">${value}</p>`}
      </div>
      ${actions && html`<div class="panel-actions">${actions}</div>`}
    </header>`}
    ${children}
  </section>`;
}

/** 3 px track along the bottom edge of a row, filled with its share. */
export function ShareBar({ pct, tone = "accent" }) {
  return html`<span class="sharebar" aria-hidden="true"><span class=${`tone-bg-${tone}`} style=${`width:${Math.max(1.5, Math.min(100, pct)).toFixed(2)}%`}></span></span>`;
}

/** Few's bullet graph: a bar for the measure, a line for the target, grey ranges behind. */
export function Bullet({ value, target, max, label }) {
  const pct = (v) => `${Math.max(0, Math.min(100, (v / max) * 100)).toFixed(2)}%`;
  return html`<div class="bullet" role="img" aria-label=${label} data-tip=${label}>
    <span class="bullet-range" style=${`width:${pct(target)}`}></span>
    <span class=${`bullet-bar ${value >= target ? "reached" : ""}`} style=${`width:${pct(value)}`}></span>
    <span class="bullet-target" style=${`left:${pct(target)}`}></span>
  </div>`;
}

/** A total split into ordered parts, each a pill as wide as its share. */
export function SegBar({ parts, label }) {
  const visible = parts.filter((p) => p.value > 0);
  return html`<div class="segbar" role="img" aria-label=${label}>
    ${visible.map((p) => html`<span key=${p.label} class=${`seg-${p.tone}`} style=${`flex:${p.value}`} data-tip=${p.tip}></span>`)}
  </div>`;
}

// ------------------------------------------------------------------ controls

export function Segmented({ options, value, onChange, label, size }) {
  return html`<div class=${`segmented ${size ?? ""}`} role="group" aria-label=${label}>
    ${options.map(
      ([v, text]) => html`<button key=${v} type="button" aria-pressed=${v === value} title=${text} onClick=${() => onChange(v)}>${text}</button>`,
    )}
  </div>`;
}

/** A pill that opens a popover; closes on outside click, Escape and after a choice. */
export function Popover({ trigger, label, children, align = "end", class: cls = "" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return html`<div class=${`popover ${cls}`} ref=${ref}>
    <button type="button" class="pill" aria-haspopup="menu" aria-expanded=${open} aria-label=${label} onClick=${() => setOpen(!open)}>${trigger}</button>
    ${open && html`<div class=${`menu menu-${align}`} role="menu" onClick=${(e) => e.target.closest("[data-close]") && setOpen(false)}>${children}</div>`}
  </div>`;
}

export function Skeleton({ lines = 3 }) {
  return html`<div class="skeleton" aria-hidden="true">${Array.from({ length: lines }, (_, i) => html`<span key=${i}></span>`)}</div>`;
}

// ------------------------------------------------------------------ chart

/**
 * One series over time with a dashed comparison series (the reference price), round ticks on the right edge,
 * a hairline and a dark tooltip on hover or keyboard focus. Prices move only on trades: steps, not slopes.
 */
export function StepChart({ points, compare, label, compareLabel, unit, timeOf }) {
  const [focus, setFocus] = useState(null);
  const box = useRef(null);
  if (!points || points.length < 2) return html`<div class="chart-empty">—</div>`;
  const narrow = globalThis.matchMedia?.("(max-width: 640px)").matches;
  const W = narrow ? 360 : 720, H = narrow ? 210 : 260, L = 4, R = 64, T = 14, B = 26;
  const t0 = points[0].t, t1 = Math.max(points.at(-1).t, t0 + 1);
  const max = Math.max(...points.map((p) => p.v), ...(compare ?? []).map((p) => p.v));
  const ticks = niceTicks(max);
  const top = ticks.at(-1);
  const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const y = (v) => T + (1 - v / top) * (H - T - B);
  const path = (pts) => {
    let d = `M${x(pts[0].t).toFixed(1)},${y(pts[0].v).toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) d += ` H${x(pts[i].t).toFixed(1)} V${y(pts[i].v).toFixed(1)}`;
    return d;
  };
  const line = path(points);
  const area = `${line} V${H - B} H${x(t0).toFixed(1)} Z`;
  const xTicks = Array.from({ length: narrow ? 3 : 5 }, (_, i) => t0 + ((t1 - t0) * i) / ((narrow ? 3 : 5) - 1));
  const at = focus === null ? null : points[focus];
  const cmpAt = at && compare ? [...compare].reverse().find((p) => p.t <= at.t) : null;

  const pick = (clientX) => {
    const r = box.current.getBoundingClientRect();
    const t = t0 + ((clientX - r.left) / r.width * W - L) / (W - L - R) * (t1 - t0);
    let best = 0;
    for (let i = 0; i < points.length; i++) if (points[i].t <= t) best = i;
    setFocus(best);
  };
  const onKey = (e) => {
    if (e.key === "ArrowRight") setFocus((f) => Math.min(points.length - 1, (f ?? -1) + 1));
    else if (e.key === "ArrowLeft") setFocus((f) => Math.max(0, (f ?? points.length) - 1));
    else return;
    e.preventDefault();
  };
  const last = points.at(-1);
  const summary = `${label} : ${compact(last.v)} ${unit} au ${timeOf(last.t)}, entre ${compact(Math.min(...points.map((p) => p.v)))} et ${compact(max)}`;

  return html`<figure class="chart" ref=${box}>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label=${summary} tabindex="0" onKeyDown=${onKey}
      onPointerMove=${(e) => pick(e.clientX)} onPointerLeave=${() => setFocus(null)} onBlur=${() => setFocus(null)}>
      ${ticks.map((v) => html`<g key=${v}>
        <line class="grid" x1=${L} x2=${W - R} y1=${y(v)} y2=${y(v)} />
        <text class="axis" x=${W - R + 8} y=${y(v) + 4}>${compact(v)}</text>
      </g>`)}
      ${xTicks.map((t, i) => html`<text key=${i} class="axis" x=${x(t)} y=${H - 6}
        text-anchor=${i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}>${timeOf(t)}</text>`)}
      <path class="area" d=${area} />
      ${compare && compare.length > 1 && html`<path class="compare" d=${path(compare)} />`}
      <path class="line" d=${line} />
      ${at
        ? html`<g><line class="hair" x1=${x(at.t)} x2=${x(at.t)} y1=${T} y2=${H - B} /><circle class="dot" cx=${x(at.t)} cy=${y(at.v)} r="4" /></g>`
        : html`<circle class="dot" cx=${x(last.t)} cy=${y(last.v)} r="3.5" />`}
    </svg>
    ${at && html`<div class="chart-tip" style=${`left:${((x(at.t) / W) * 100).toFixed(2)}%`}>
      <strong>${compact(at.v)} ${unit}</strong>
      <span>${timeOf(at.t)}${cmpAt ? ` · ${compareLabel} ${compact(cmpAt.v)}` : ""}</span>
    </div>`}
    <figcaption class="legend">
      <span><i class="key key-line"></i>${label}</span>
      ${compare && html`<span><i class="key key-dash"></i>${compareLabel}</span>`}
    </figcaption>
  </figure>`;
}
