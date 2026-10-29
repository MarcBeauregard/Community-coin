// Monochrome 20 px line icons, drawn in currentColor.

import { h } from "preact";
import htm from "htm";

const html = htm.bind(h);

const icon = (paths) => (props = {}) =>
  html`<svg class=${`icon ${props.class ?? ""}`} viewBox="0 0 20 20" width=${props.size ?? 18} height=${props.size ?? 18}
    fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const Market = icon(html`<path d="M3 16.5h14" /><path d="M5.5 13v-3" /><path d="M10 13V6" /><path d="M14.5 13V9" />`);
export const Launch = icon(html`<path d="M10 4.5v11" /><path d="M4.5 10h11" />`);
export const Merge = icon(html`<path d="M6 3.5v4a4 4 0 0 0 4 4h0a4 4 0 0 1 4 4v1" /><path d="M14 3.5v4a4 4 0 0 1-4 4" /><path d="M11.5 14l2.5 2.5 2.5-2.5" />`);
export const Wallet = icon(html`<rect x="3" y="5.5" width="14" height="10" rx="2.5" /><path d="M3 8.5h14" /><path d="M13 12h1.5" />`);
export const Book = icon(html`<path d="M4 4.5h4.5a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 0-1.5-1.5H4z" /><path d="M16 4.5h-4.5A1.5 1.5 0 0 0 10 6v10a1.5 1.5 0 0 1 1.5-1.5H16z" />`);
export const Clock = icon(html`<circle cx="10" cy="10" r="6.5" /><path d="M10 6.5V10l2.5 1.5" />`);
export const Chevron = icon(html`<path d="M6 8l4 4 4-4" />`);
export const Menu = icon(html`<path d="M4 6h12" /><path d="M4 10h12" /><path d="M4 14h12" />`);
export const Close = icon(html`<path d="M5.5 5.5l9 9" /><path d="M14.5 5.5l-9 9" />`);
export const Lock = icon(html`<rect x="4.5" y="9" width="11" height="7.5" rx="2" /><path d="M7 9V7a3 3 0 0 1 6 0v2" />`);
export const Coins = icon(html`<ellipse cx="8" cy="7" rx="4.5" ry="2.2" /><path d="M3.5 7v3c0 1.2 2 2.2 4.5 2.2" /><ellipse cx="12.5" cy="12.5" rx="4" ry="2" /><path d="M8.5 12.5v2.2c0 1.1 1.8 2 4 2s4-.9 4-2v-2.2" />`);
export const Pulse = icon(html`<path d="M3 10.5h3l1.8-4 3.2 8 1.8-4H17" />`);
export const Spark = icon(html`<path d="M10 3v3" /><path d="M10 14v3" /><path d="M3 10h3" /><path d="M14 10h3" /><path d="M5.2 5.2l2 2" /><path d="M12.8 12.8l2 2" /><path d="M14.8 5.2l-2 2" /><path d="M7.2 12.8l-2 2" />`);
export const Timer = icon(html`<circle cx="10" cy="11" r="5.5" /><path d="M10 8.5V11" /><path d="M8 3.5h4" />`);
export const Arrow = icon(html`<path d="M5 10h10" /><path d="M11 6l4 4-4 4" />`);
export const Info = icon(html`<circle cx="10" cy="10" r="6.5" /><path d="M10 9v4" /><path d="M10 6.6v.1" />`);
export const Check = icon(html`<path d="M5 10.5l3 3 7-7" />`);
export const Sun = icon(html`<circle cx="10" cy="10" r="3.2" /><path d="M10 2.8v1.6" /><path d="M10 15.6v1.6" /><path d="M2.8 10h1.6" /><path d="M15.6 10h1.6" /><path d="M4.9 4.9l1.1 1.1" /><path d="M14 14l1.1 1.1" /><path d="M15.1 4.9L14 6" /><path d="M6 14l-1.1 1.1" />`);
export const Moon = icon(html`<path d="M15.5 12.2A6 6 0 0 1 7.8 4.5a6 6 0 1 0 7.7 7.7z" />`);
export const Swap = icon(html`<path d="M7 4v12" /><path d="M4 13l3 3 3-3" /><path d="M13 16V4" /><path d="M10 7l3-3 3 3" />`);
