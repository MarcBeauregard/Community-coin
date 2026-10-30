// One stroke icon family: 24 px grid, round caps and joins, currentColor. Decorative by default (aria-hidden); the
// button that holds an icon carries the accessible name.

import { h } from "preact";
import htm from "htm";

const html = htm.bind(h);

const icon = (paths, { fill = false, width = 2 } = {}) => ({ size = 18, stroke = width } = {}) => html`
  <svg width=${size} height=${size} viewBox="0 0 24 24" fill=${fill ? "currentColor" : "none"} stroke=${fill ? "none" : "currentColor"}
    stroke-width=${stroke} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const Back = icon(html`<path d="M15 5l-7 7 7 7" />`, { width: 2.4 });
export const Chevron = icon(html`<path d="M9 5l7 7-7 7" />`);
export const Arrow = icon(html`<path d="M5 12h14M13 6l6 6-6 6" />`, { width: 2.2 });
export const Up = icon(html`<path d="M12 19V5M6 11l6-6 6 6" />`, { width: 2.8 });
export const Plus = icon(html`<path d="M12 5v14M5 12h14" />`, { width: 2.4 });
export const Close = icon(html`<path d="M6 6l12 12M18 6L6 18" />`, { width: 2.4 });
export const Check = icon(html`<path d="M5 12l5 5 9-10" />`, { width: 3 });
export const Search = icon(html`<circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />`, { width: 2.2 });
export const Headphones = icon(html`<path d="M3 14v-2a9 9 0 0 1 18 0v2" /><path d="M21 15a2 2 0 0 1-2 2h-1v-5h1a2 2 0 0 1 2 2zM3 15a2 2 0 0 0 2 2h1v-5H5a2 2 0 0 0-2 2z" />`);
export const Mic = icon(html`<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" /><path d="M19 11a7 7 0 0 1-14 0M12 18v3" />`);
export const MicOff = icon(html`<path d="M3 3l18 18M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.7-1.3M19 11a7 7 0 0 1-1.2 3.9M5 11a7 7 0 0 0 10.6 6M12 18v3" />`);
export const Hand = icon(html`<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8a8 8 0 0 0 16 0v-3a2 2 0 0 0-4 0" />`);
export const Speaker = icon(html`<path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />`);
export const Screen = icon(html`<rect x="3" y="4" width="18" height="12" rx="2.5" /><path d="M8 20h8M12 16v4" />`);
export const Image = icon(html`<rect x="3" y="4" width="18" height="16" rx="3.5" /><circle cx="9" cy="10" r="1.8" /><path d="M21 16l-5-5-9 9" />`, { width: 1.9 });
export const Bell = icon(html`<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />`, { width: 2.2 });
export const People = icon(html`<circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14a6.5 6.5 0 0 1 3 6" />`);
export const Lock = icon(html`<rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />`);
export const Copy = icon(html`<rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />`);
export const Chat = icon(html`<path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12z" />`, { width: 1.9 });
export const Wallet = icon(html`<rect x="3" y="6" width="18" height="13" rx="3" /><path d="M3 10h18M16 14.5h2" />`, { width: 1.9 });
export const Heart = icon(html`<path d="M12 21s-7.5-4.6-9.5-9.3C1 8 3.3 4.5 7 4.5c2.1 0 3.6 1.2 5 3 1.4-1.8 2.9-3 5-3 3.7 0 6 3.5 4.5 7.2C19.5 16.4 12 21 12 21z" />`, { fill: true });
export const Flame = icon(html`<path d="M12 2c1 3.5 5 6 5 11a5 5 0 0 1-10 0c0-2.4 1.2-3.9 2.3-5 .2 1.6.9 2.8 2 3.4C11 8.6 11.3 5 12 2z" />`, { fill: true });
export const Play = icon(html`<path d="M6 4l14 8-14 8z" />`, { fill: true });

export function Logo({ size = 26 }) {
  return html`<svg width=${size} height=${size} viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="12.5" fill="none" stroke="var(--lime)" stroke-width="2" /><circle cx="14" cy="14" r="5.5" fill="var(--lime)" /></svg>`;
}
