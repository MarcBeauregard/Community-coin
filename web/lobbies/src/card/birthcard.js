// The birth card: a founder's proof of being there, drawn as a 1200 × 630 image (the size link previews use on X
// and in messages). The coin's logo in its own glow, the founder's number, and the facts of the launch. Drawn in
// the browser, from the launch the program recorded: nothing is sent anywhere to make it.

import { sol } from "../format.js";

export const CARD = { width: 1200, height: 630 };
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", Inter, "Segoe UI", system-ui, sans-serif';
const LIME = "#cbf35c";

const loadImage = (src) => new Promise((resolve) => {
  if (!src) return resolve(null);
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  img.src = src;
});

const int = (n) => n.toLocaleString("en-US");

/**
 * Draws the card; resolves to a PNG Blob. `c`: `{ ticker, name, hue, logo (url or null), rank, pot (SOL),
 * founders, lobby ("#0412"), date (Date) }`.
 */
export async function drawBirthCard(c) {
  await document.fonts?.ready;
  const canvas = document.createElement("canvas");
  canvas.width = CARD.width;
  canvas.height = CARD.height;
  const g = canvas.getContext("2d");
  const { width: W, height: H } = CARD;

  // Ground: black, the coin's color glowing behind it, a cooler echo in the corner.
  g.fillStyle = "#000";
  g.fillRect(0, 0, W, H);
  const glow = (x, y, r, color) => {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, color);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
  };
  glow(300, 315, 420, `hsla(${c.hue}, 90%, 55%, 0.42)`);
  glow(1180, 0, 520, `hsla(${(c.hue + 150) % 360}, 80%, 55%, 0.14)`);

  // The coin: its logo in a circle, or its ticker on its color.
  const cx = 300, cy = 315, r = 168;
  g.save();
  g.shadowColor = `hsla(${c.hue}, 90%, 55%, 0.6)`;
  g.shadowBlur = 80;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  const face = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  face.addColorStop(0, `hsl(${c.hue} 95% 82%)`);
  face.addColorStop(1, `hsl(${c.hue} 70% 46%)`);
  g.fillStyle = face;
  g.fill();
  g.restore();
  const logo = await loadImage(c.logo);
  g.save();
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.clip();
  if (logo) g.drawImage(logo, cx - r, cy - r, r * 2, r * 2);
  else {
    g.fillStyle = "rgba(0,0,0,0.78)";
    g.font = `700 96px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(c.ticker.slice(0, 4), cx, cy + 4);
  }
  g.restore();
  g.strokeStyle = "rgba(255,255,255,0.18)";
  g.lineWidth = 2;
  g.beginPath();
  g.arc(cx, cy, r + 1, 0, Math.PI * 2);
  g.stroke();

  // The words: who you are to this coin, then the facts.
  const x = 560;
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  g.fillStyle = LIME;
  g.font = `600 26px ${FONT}`;
  g.letterSpacing = "4px";
  g.fillText("FOUNDER", x, 182);
  g.letterSpacing = "0px";
  g.fillStyle = "#f5f5f7";
  g.font = `700 150px ${FONT}`;
  g.letterSpacing = "-6px";
  g.fillText(`#${int(c.rank)}`, x - 6, 318);
  g.letterSpacing = "0px";
  g.font = `600 44px ${FONT}`;
  g.fillText(`$${c.ticker}`, x, 384);
  const tickerWidth = g.measureText(`$${c.ticker}`).width;
  g.fillStyle = "rgba(235,235,245,0.64)";
  g.font = `500 32px ${FONT}`;
  g.fillText(fit(g, c.name, W - 80 - x - tickerWidth - 18), x + tickerWidth + 18, 384);

  g.fillStyle = "rgba(235,235,245,0.8)";
  g.font = `500 28px ${FONT}`;
  const day = c.date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  g.fillText(`Born ${day} in Lobby ${c.lobby}`, x, 446);
  g.fillText(`${sol(c.pot)} raised · ${int(c.founders)} founders`, x, 486);

  // Signature: the mark and the name, small, bottom right.
  g.strokeStyle = LIME;
  g.lineWidth = 3;
  g.beginPath();
  g.arc(x + 14, 562, 13, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = LIME;
  g.beginPath();
  g.arc(x + 14, 562, 5.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(235,235,245,0.64)";
  g.font = `600 22px ${FONT}`;
  g.fillText("Community Coin", x + 40, 570);

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

// Shortens text with an ellipsis to fit `max` pixels.
function fit(g, text, max) {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** The words that go with the card when it is shared. */
export const cardCaption = (c) => `I’m Founder #${int(c.rank)} of $${c.ticker}. ${int(c.founders)} of us picked it together in one hour on Community Coin.`;

/** A file name for the card. */
export const cardFileName = (c) => `founder-${c.rank}-${c.ticker.toLowerCase()}.png`;
