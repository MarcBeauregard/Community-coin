// The network banner (src/demo/select.js netState says which line). Over most screens it floats at the top; in a
// lobby it sits in the page, under the header, so it never covers the race or a sheet.

import { html } from "../ui.js";
import { netState } from "../demo/select.js";

// The network, said calmly at the top while something is off (the most pressing thing only), and "Back online" for
// a moment after. One status region, always in the page, so a screen reader hears each change once.
const NET = {
  offline: ["amber", "You’re offline. The lobby catches up when you’re back."],
  down: ["amber", "Can’t reach the lobby server. Still trying."],
  gone: ["amber", "The lobby closed this connection. Reload the page to come back in."],
  reconnecting: ["sky", "Reconnecting to the lobby…"],
  solanaDown: ["amber", "Solana isn’t answering. Your balance may be out of date."],
  slow: ["sky", "The lobby is slow right now. Numbers may lag a few seconds."],
  solanaSlow: ["sky", "Solana is slow right now. Your balance may lag."],
  back: ["lime", "Back online"],
};
export function NetBanner({ net, pledged, inline = false }) {
  const k = netState(net);
  // Someone with a pledge hears that it is safe: it is kept by the lobby, not by this page.
  const text = k === "down" && pledged ? "Can’t reach the lobby server. Still trying; your pledge is safe on it." : k && NET[k][1];
  return html`<div role="status" class=${inline ? "net-inline" : "net-wrap"}>${k && html`<div class=${`net glass ${NET[k][0]}`}><span class="dot" aria-hidden="true" />${text}</div>`}</div>`;
}

