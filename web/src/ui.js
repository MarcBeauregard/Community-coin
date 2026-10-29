// Interface primitives, after the dashboard-design skill's component patterns: one tooltip for the whole screen,
// minted coins for memes and round initials for people, delta badges with a one-word baseline, KPI cards, slim share
// bars, sparklines, progress rings, bullet graphs, segmented share bars, segmented controls, popover menus, one chart
// and the minting celebration.

import { h, render } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";
import htm from "htm";

export const html = htm.bind(h);

// ------------------------------------------------------------------ tooltip

/**
 * Any element with data-tip gets the same dark tooltip: on hover with a mouse, on keyboard focus, and on tap on a touch
 * screen (where it stays until the next tap elsewhere).
 */
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
  const at = (e) => e.target.closest?.("[data-tip]");
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const el = at(e);
    el ? show(el) : hide();
  });
  document.addEventListener("pointerout", (e) => {
    if (e.pointerType !== "touch" && current && !current.contains(e.relatedTarget)) hide();
  });
  document.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch") return;
    const el = at(e);
    el && el !== current ? show(el) : hide();
  });
  document.addEventListener("focusin", (e) => {
    const el = at(e);
    el ? show(el) : hide();
  });
  document.addEventListener("focusout", (e) => current && !current.contains(e.relatedTarget) && hide());
  document.addEventListener("scroll", hide, true);
  document.addEventListener("keydown", (e) => e.key === "Escape" && hide());
}

// ------------------------------------------------------------------ numbers

const nf = (opts) => new Intl.NumberFormat("en-US", opts);

/** 0 and evenly spaced round ticks covering max: steps of 1, 2, 2.5 or 5 × 10^n. */
export function niceTicks(max, count = 4) {
  if (!(max > 0)) return [0, 1];
  const raw = max / count, pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw);
  return Array.from({ length: Math.ceil(max / step - 1e-9) + 1 }, (_, i) => +(i * step).toPrecision(12));
}

/**
 * Round ticks for a price axis: from 0 when the series spans most of its height anyway, otherwise tight around it
 * so that a 3% move is visible. Returns at least two ticks; the first and last bound the axis.
 */
export function niceRange(lo, hi, count = 4) {
  if (!(hi > 0)) return [0, 1];
  if (lo < hi * 0.45) return niceTicks(hi, count);
  const pad = Math.max((hi - lo) * 0.15, hi * 0.02);
  const a = Math.max(0, lo - pad), b = hi + pad;
  const raw = (b - a) / count, pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((x) => x >= raw);
  const first = Math.floor(a / step) * step;
  const n = Math.ceil((b - first) / step - 1e-9);
  return Array.from({ length: n + 1 }, (_, i) => +(first + i * step).toPrecision(12));
}

/** Compact number with a few significant digits: 0.0162 · 12.9M · 1.2K. */
export function compact(n, digits = 3) {
  if (n === 0) return "0";
  if (Math.abs(n) >= 1000) return nf({ notation: "compact", maximumFractionDigits: 1 }).format(n);
  return nf({ maximumSignificantDigits: digits }).format(n);
}

// ------------------------------------------------------------------ avatars and coins

/** A person: round initials on a neutral disc. Memes are coins, people are not. */
export function Avatar({ symbol, size = "md" }) {
  return html`<span class=${`avatar avatar-${size}`} aria-hidden="true">${symbol.slice(0, 2)}</span>`;
}

export const METALS = 6; // gold, sapphire, jade, ruby, amethyst, silver: one per family, in launch order

/**
 * Gradients shared by every coin and chart on the page, drawn once. Kept out of display:none so browsers still
 * paint them.
 */
export function Defs() {
  const mix = (i, pct, with_) => `stop-color: color-mix(in srgb, var(--metal-${i}) ${pct}%, ${with_})`;
  return html`<svg class="defs" aria-hidden="true" focusable="false" width="0" height="0">
    <defs>
      ${Array.from({ length: METALS }, (_, i) => html`
        <radialGradient key=${`f${i}`} id=${`coin-face-${i}`} cx="34%" cy="28%" r="82%">
          <stop offset="0" style=${mix(i, 38, "white")} />
          <stop offset="0.5" style=${`stop-color: var(--metal-${i})`} />
          <stop offset="1" style=${mix(i, 52, "black")} />
        </radialGradient>
        <linearGradient key=${`r${i}`} id=${`coin-rim-${i}`} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" style=${mix(i, 55, "white")} />
          <stop offset="0.48" style=${mix(i, 62, "black")} />
          <stop offset="0.75" style=${mix(i, 80, "white")} />
          <stop offset="1" style=${mix(i, 45, "black")} />
        </linearGradient>`)}
      <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style="stop-color: var(--gold); stop-opacity: 0.34" />
        <stop offset="1" style="stop-color: var(--gold); stop-opacity: 0" />
      </linearGradient>
    </defs>
  </svg>`;
}

/**
 * A minted coin: reeded rim, beaded ring, the ticker struck into the face. The family sets the metal, so a meme
 * and its variants are the same metal; a variant also carries a dark mint ring inside the rim (legible down to the
 * smallest size) and one dot above the legend per generation from its root.
 */
export function Coin({ symbol, hue = 0, size = "md", depth = 0, glyph }) {
  const text = glyph ?? (symbol.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?");
  const m = ((hue % METALS) + METALS) % METALS;
  const dots = Math.min(depth, 3);
  return html`<span class=${`coin coin-${size}`} style=${`--metal: var(--metal-${m})`} aria-hidden="true">
    <svg viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="31.5" fill=${`url(#coin-rim-${m})`} />
      <circle class="coin-reed" cx="32" cy="32" r="29.8" />
      <circle cx="32" cy="32" r="26.2" fill=${`url(#coin-face-${m})`} />
      <circle class="coin-bead" cx="32" cy="32" r="23" />
      ${depth > 0 && html`<circle class="coin-mark" cx="32" cy="32" r="25.4" />`}
      ${Array.from({ length: dots }, (_, i) => html`<circle key=${i} class="coin-dot" cx=${32 + (i - (dots - 1) / 2) * 5} cy="14.5" r="1.4" />`)}
      <text class="coin-hi" x="32" y="33.4" font-size=${text.length > 1 ? 18 : 22}>${text}</text>
      <text class="coin-lo" x="32" y="32.4" font-size=${text.length > 1 ? 18 : 22}>${text}</text>
    </svg>
  </span>`;
}

/** A progress ring around whatever it holds: the share of an opening still to run. */
export function Ring({ fraction, size = 120, stroke = 5, tone = "hot", children, label }) {
  const r = 50 - stroke / 2 - 1, c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, fraction));
  return html`<div class=${`ring ring-${tone}`} style=${`--size:${size}px`} role=${label ? "img" : null} aria-label=${label}>
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle class="ring-track" cx="50" cy="50" r=${r} stroke-width=${stroke} />
      <circle class="ring-arc" cx="50" cy="50" r=${r} stroke-width=${stroke} stroke-dasharray=${`${(c * f).toFixed(2)} ${c.toFixed(2)}`} />
    </svg>
    <div class="ring-inner">${children}</div>
  </div>`;
}

/** Price steps since the first recorded trade, as a line with a soft fill; green when it ends above where it began. */
export function Sparkline({ points, width = 88, height = 26 }) {
  if (!points || points.length < 2) return html`<span class="spark spark-empty" style=${`width:${width}px`} aria-hidden="true"></span>`;
  const t0 = points[0].t, t1 = Math.max(points.at(-1).t, t0 + 1);
  const vs = points.map((p) => p.v);
  const lo = Math.min(...vs), hi = Math.max(...vs);
  if (hi - lo <= hi * 1e-9)
    return html`<svg class="spark spark-flat" viewBox=${`0 0 ${width} ${height}`} width=${width} height=${height} aria-hidden="true">
      <path class="spark-line" d=${`M1,${height / 2} H${width - 3}`} />
    </svg>`;
  const span = Math.max(hi - lo, hi * 0.04); // a move under 4% stays a near-flat line instead of filling the box
  const floor = (hi + lo) / 2 - span / 2;
  const x = (t) => 1 + ((t - t0) / (t1 - t0)) * (width - 4);
  const y = (v) => 2 + (1 - (v - floor) / span) * (height - 5);
  let d = `M${x(points[0].t).toFixed(1)},${y(points[0].v).toFixed(1)}`;
  for (const p of points.slice(1)) d += ` H${x(p.t).toFixed(1)} V${y(p.v).toFixed(1)}`;
  const last = points.at(-1);
  const dir = last.v >= points[0].v ? "up" : "down";
  return html`<svg class=${`spark spark-${dir}`} viewBox=${`0 0 ${width} ${height}`} width=${width} height=${height} aria-hidden="true">
    <path class="spark-area" d=${`${d} V${height} H${x(t0).toFixed(1)} Z`} />
    <path class="spark-line" d=${d} />
    <circle class="spark-dot" cx=${x(last.t).toFixed(1)} cy=${y(last.v).toFixed(1)} r="2" />
  </svg>`;
}

/** Wraps a number that can change while you watch: it glows green or red for a moment when it moves. */
export function Flash({ value, children, class: cls = "" }) {
  const prev = useRef(value);
  const [state, setState] = useState({ dir: null, n: 0 });
  useEffect(() => {
    const before = prev.current;
    prev.current = value;
    if (before === null || before === undefined || value === null || value === undefined || before === value) return;
    setState((s) => ({ dir: value > before ? "up" : "down", n: s.n + 1 }));
    const t = setTimeout(() => setState((s) => ({ ...s, dir: null })), 1100);
    return () => clearTimeout(t);
  }, [value]);
  return html`<span key=${state.n} class=${`flash ${state.dir ? `flash-${state.dir}` : ""} ${cls}`}>${children}</span>`;
}

const reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * The minting moment: the new coin drops in and spins while a burst of smaller coins of the same metal flies out.
 * Purely decorative, gone after two seconds, skipped when the viewer asks for less motion.
 */
export function celebrate({ symbol, hue = 0 }) {
  if (reducedMotion()) return;
  const box = document.createElement("div");
  box.className = "mint";
  box.setAttribute("aria-hidden", "true");
  const coin = document.createElement("div");
  coin.className = "mint-coin";
  box.append(coin);
  for (let i = 0; i < 26; i++) {
    const piece = document.createElement("i");
    const angle = (i / 26) * Math.PI * 2 + Math.random() * 0.4;
    const dist = 140 + Math.random() * 220;
    piece.style.setProperty("--x", `${(Math.cos(angle) * dist).toFixed(0)}px`);
    piece.style.setProperty("--y", `${(Math.sin(angle) * dist * 0.8 - 60).toFixed(0)}px`);
    piece.style.setProperty("--spin", `${(360 + Math.random() * 720).toFixed(0)}deg`);
    piece.style.setProperty("--delay", `${(Math.random() * 120).toFixed(0)}ms`);
    piece.style.setProperty("--metal", `var(--metal-${i % 3 === 0 ? 0 : ((hue % METALS) + METALS) % METALS})`);
    piece.style.setProperty("--s", `${(8 + Math.random() * 10).toFixed(0)}px`);
    box.append(piece);
  }
  document.body.append(box);
  render(html`<${Coin} symbol=${symbol} hue=${hue} size="xl" />`, coin);
  setTimeout(() => {
    render(null, coin);
    box.remove();
  }, 2100);
}

// ------------------------------------------------------------------ delta

/**
 * Change against a baseline. Tiny bases say what they were instead of shouting a percentage; lower-is-better
 * metrics flip the colours; neutral ones stay grey.
 */
export function Delta({ cur, prev, vs, min = 0, invert = false, neutral = false, format = compact, tip }) {
  if (prev === null || prev === undefined || cur === null || cur === undefined) return null;
  if (prev === 0 || prev < min) return html`<span class="delta muted" data-tip=${tip}>${`was ${format(prev)}`}</span>`;
  const d = ((cur - prev) / prev) * 100;
  const r = Math.round(d);
  if (r === 0) return html`<span class="delta muted" data-tip=${tip}>±0% <span>${vs}</span></span>`;
  const good = invert ? d < 0 : d > 0;
  const text = Math.abs(d) > 999 ? (d > 0 ? "10×+" : "−99%") : `${d > 0 ? "▲" : "▼"} ${Math.abs(r)}%`;
  const spoken = Math.abs(d) > 999 ? (d > 0 ? "up more than tenfold" : "down 99%") : `${d > 0 ? "up" : "down"} ${Math.abs(r)}%`;
  return html`<span class="delta" data-tip=${tip ?? `${vs}: ${format(prev)}`}>
    <b class=${neutral ? "" : good ? "up" : "down"} aria-hidden="true">${text}</b><span class="sr">${spoken}</span> <span class="muted">${vs}</span>
  </span>`;
}

// ------------------------------------------------------------------ cards

export function Kpi({ label, icon, value, unit, delta, sub, tip, tone, id }) {
  return html`<div class=${`card kpi ${tone ? `tone-${tone}` : ""}`} data-kpi=${id}>
    <div class="kpi-head">
      <span class="kpi-label">${label}</span>
      ${icon && html`<span class="icon-square">${icon}</span>`}
    </div>
    <div class="kpi-value" data-tip=${tip}>${value}${unit && html`<small>${unit}</small>`}</div>
    <div class="kpi-foot">${delta ?? (sub ? html`<span class="delta muted">${sub}</span>` : html`<span class="delta muted"> </span>`)}</div>
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

/**
 * A pill that opens a menu: focus moves to the first item, arrow keys move between items, Escape closes and gives
 * focus back to the pill; it also closes on an outside click and after a choice.
 */
export function Popover({ trigger, label, children, align = "end", class: cls = "" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const items = () => [...(ref.current?.querySelectorAll(".menu [role^='menuitem']:not(:disabled)") ?? [])];
  const close = (refocus) => {
    setOpen(false);
    if (refocus) ref.current?.querySelector(".pill")?.focus();
  };
  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const outside = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const keys = (e) => {
      if (e.key === "Escape") return close(true);
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) || !ref.current?.contains(document.activeElement)) return;
      const list = items(), i = list.indexOf(document.activeElement);
      const next = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
      list[next]?.focus();
      e.preventDefault();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keys);
    };
  }, [open]);
  return html`<div class=${`popover ${cls}`} ref=${ref}>
    <button type="button" class="pill" aria-haspopup="menu" aria-expanded=${open} aria-label=${label} onClick=${() => setOpen(!open)}>${trigger}</button>
    ${open && html`<div class=${`menu menu-${align}`} role="menu" onClick=${(e) => e.target.closest("[data-close]") && close(true)}>${children}</div>`}
  </div>`;
}

export function Skeleton({ lines = 3 }) {
  return html`<div class="skeleton" aria-hidden="true">${Array.from({ length: lines }, (_, i) => html`<span key=${i}></span>`)}</div>`;
}

// ------------------------------------------------------------------ chart

/**
 * One series over time with a dashed comparison series (the reference price), round ticks on the right edge,
 * a hairline and a dark tooltip on hover or keyboard focus. Prices move only on trades: steps, not slopes.
 * `from` starts the window later than the first point (the value at that moment is carried in); `markers` pin
 * events (launch, opening close, union, big trades) along the bottom, each with its own tooltip.
 */
export function StepChart({ points: all, compare: allCompare, label, compareLabel, unit, timeOf, from, markers = [] }) {
  const [focus, setFocus] = useState(null);
  const box = useRef(null);
  const clip = (pts) => {
    if (!pts || from === undefined || from <= pts[0].t) return pts;
    const before = [...pts].reverse().find((p) => p.t <= from);
    return [...(before ? [{ ...before, t: from }] : []), ...pts.filter((p) => p.t > from)];
  };
  const points = clip(all), compare = clip(allCompare);
  if (!points || points.length < 2) return html`<div class="chart-empty">—</div>`;
  const narrow = globalThis.matchMedia?.("(max-width: 640px)").matches;
  const W = narrow ? 360 : 720, H = narrow ? 210 : 260, L = 4, R = 64, T = 14, B = 26;
  const t0 = points[0].t, t1 = Math.max(points.at(-1).t, t0 + 1);
  const values = [...points.map((p) => p.v), ...(compare ?? []).map((p) => p.v)];
  const lo = Math.min(...values), max = Math.max(...values);
  const ticks = niceRange(lo, max);
  const bottom = ticks[0], top = ticks.at(-1);
  const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const y = (v) => T + (1 - (v - bottom) / (top - bottom)) * (H - T - B);
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
  const shown = markers.filter((m) => m.t >= t0 && m.t <= t1);

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
  const summary = `${label}: ${compact(last.v)} ${unit} at ${timeOf(last.t)}, ranging ${compact(Math.min(...points.map((p) => p.v)))} to ${compact(Math.max(...points.map((p) => p.v)))}`
    + (shown.length ? `. Events: ${shown.map((m) => m.label.split("\n")[0]).join(", ")}` : "");

  return html`<figure class="chart" ref=${box}>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label=${summary} tabindex="0" onKeyDown=${onKey}
      onPointerMove=${(e) => pick(e.clientX)} onPointerLeave=${() => setFocus(null)} onBlur=${() => setFocus(null)}>
      ${ticks.map((v) => html`<g key=${v}>
        <line class="grid" x1=${L} x2=${W - R} y1=${y(v)} y2=${y(v)} />
        <text class="axis" x=${W - R + 8} y=${y(v) + 4}>${compact(v)}</text>
      </g>`)}
      ${xTicks.map((t, i) => html`<text key=${i} class="axis" x=${x(t)} y=${H - 6}
        text-anchor=${i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}>${timeOf(t)}</text>`)}
      <path class="area" d=${area} fill="url(#chart-fill)" />
      ${compare && compare.length > 1 && html`<path class="compare" d=${path(compare)} />`}
      <path class="line" d=${line} />
      ${shown.map((m, i) => html`<g key=${`m${i}`} class=${`marker marker-${m.tone ?? "plain"}`} data-tip=${m.label}>
        <line x1=${x(m.t)} x2=${x(m.t)} y1=${T} y2=${H - B} />
        <rect x=${x(m.t) - 5} y=${H - B - 5} width="10" height="10" rx="2" transform=${`rotate(45 ${x(m.t)} ${H - B})`} />
        <rect class="marker-hit" x=${x(m.t) - 9} y=${T} width="18" height=${H - B - T + 9} />
      </g>`)}
      ${at
        ? html`<g><line class="hair" x1=${x(at.t)} x2=${x(at.t)} y1=${T} y2=${H - B} /><circle class="dot" cx=${x(at.t)} cy=${y(at.v)} r="4" /></g>`
        : html`<g><circle class="dot-halo" cx=${x(last.t)} cy=${y(last.v)} r="9" /><circle class="dot" cx=${x(last.t)} cy=${y(last.v)} r="3.5" /></g>`}
    </svg>
    ${at && html`<div class="chart-tip" style=${`left:${((x(at.t) / W) * 100).toFixed(2)}%`}>
      <strong>${compact(at.v)} ${unit}</strong>
      <span>${timeOf(at.t)}${cmpAt ? ` · ${compareLabel} ${compact(cmpAt.v)}` : ""}</span>
    </div>`}
    <figcaption class="legend">
      <span><i class="key key-line"></i>${label}</span>
      ${compare && html`<span><i class="key key-dash"></i>${compareLabel}</span>`}
      ${shown.length > 0 && html`<span><i class="key key-marker"></i>Events</span>`}
    </figcaption>
  </figure>`;
}
