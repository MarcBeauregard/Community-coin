// The birth card: a founder's proof of being there. Two shapes: a post (1200 × 630, the size link previews use on X
// and in messages) and a story (1080 × 1920, for Instagram and the like). The coin's logo in its own glow, the
// founder's number, and the facts of the launch. Drawn in the browser, from the launch the program recorded:
// nothing is sent anywhere to make it.

import { sol } from "../format.js";

export const FORMATS = {
  post: { width: 1200, height: 630, label: "Post" },
  story: { width: 1080, height: 1920, label: "Story" },
};
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
const day = (d) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

// Where things go in each shape: the coin's center and radius, then the words' anchor and sizes.
const LAYOUT = {
  post: { coin: [300, 315, 168], glow: [[300, 315, 420], [1180, 0, 520]], x: 560, align: "left", y: { kicker: 182, rank: 318, ticker: 384, born: 446, raised: 486, mark: 562 }, size: { kicker: 26, rank: 150, ticker: 44, name: 32, facts: 28, mark: 22 } },
  story: { coin: [540, 640, 270], glow: [[540, 640, 620], [1080, 1920, 900]], x: 540, align: "center", y: { kicker: 1100, rank: 1300, ticker: 1400, born: 1520, raised: 1574, mark: 1800 }, size: { kicker: 34, rank: 220, ticker: 60, name: 40, facts: 36, mark: 30 } },
};

/**
 * Draws the card; resolves to a PNG Blob. `c`: `{ ticker, name, hue, logo (url or null), rank, pot (SOL),
 * founders, lobby ("#0412"), date (Date) }`. `format`: "post" | "story".
 */
export async function drawBirthCard(c, format = "post") {
  await document.fonts?.ready;
  const { width: W, height: H } = FORMATS[format];
  const L = LAYOUT[format];
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d");

  // Ground: black, the coin's color glowing behind it, a cooler echo in the corner.
  g.fillStyle = "#000";
  g.fillRect(0, 0, W, H);
  const glow = ([x, y, r], color) => {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, color);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
  };
  glow(L.glow[0], `hsla(${c.hue}, 90%, 55%, 0.42)`);
  glow(L.glow[1], `hsla(${(c.hue + 150) % 360}, 80%, 55%, 0.14)`);

  // The coin: its logo in a circle, or its ticker on its color.
  const [cx, cy, r] = L.coin;
  g.save();
  g.shadowColor = `hsla(${c.hue}, 90%, 55%, 0.6)`;
  g.shadowBlur = r / 2;
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
    g.font = `700 ${Math.round(r * 0.57)}px ${FONT}`;
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
  const { x, y, size } = L;
  const center = L.align === "center";
  g.textAlign = L.align;
  g.textBaseline = "alphabetic";
  g.fillStyle = LIME;
  g.font = `600 ${size.kicker}px ${FONT}`;
  g.letterSpacing = "4px";
  g.fillText("FOUNDER", x, y.kicker);
  g.letterSpacing = "0px";
  g.fillStyle = "#f5f5f7";
  g.font = `700 ${size.rank}px ${FONT}`;
  g.letterSpacing = `-${Math.round(size.rank / 25)}px`;
  g.fillText(`#${int(c.rank)}`, center ? x : x - 6, y.rank);
  g.letterSpacing = "0px";
  // The ticker, then the name in grey; centered as one line in a story.
  g.font = `600 ${size.ticker}px ${FONT}`;
  const tk = `$${c.ticker}`;
  const tkW = g.measureText(tk).width;
  g.font = `500 ${size.name}px ${FONT}`;
  const room = (center ? W - 120 : W - 80 - x) - tkW - 18;
  const name = fit(g, c.name, room);
  const nameW = g.measureText(name).width;
  const start = center ? x - (tkW + 18 + nameW) / 2 : x;
  g.textAlign = "left";
  g.font = `600 ${size.ticker}px ${FONT}`;
  g.fillStyle = "#f5f5f7";
  g.fillText(tk, start, y.ticker);
  g.font = `500 ${size.name}px ${FONT}`;
  g.fillStyle = "rgba(235,235,245,0.64)";
  g.fillText(name, start + tkW + 18, y.ticker);
  g.textAlign = L.align;

  g.fillStyle = "rgba(235,235,245,0.8)";
  g.font = `500 ${size.facts}px ${FONT}`;
  g.fillText(`Born ${day(c.date)} in Lobby ${c.lobby}`, x, y.born);
  g.fillText(`${sol(c.pot)} raised · ${int(c.founders)} founders`, x, y.raised);
  if (c.mint) {
    g.fillStyle = "rgba(235,235,245,0.5)";
    g.font = `500 ${Math.round(size.facts * 0.78)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    g.fillText(`CA ${c.mint.slice(0, 6)}…${c.mint.slice(-6)}`, x, y.raised + Math.round(size.facts * 1.5));
  }

  // Signature: the mark and the name, small.
  g.font = `600 ${size.mark}px ${FONT}`;
  const sig = c.practice ? "Community Coin · practice lobby" : "Community Coin";
  const sigW = g.measureText(sig).width;
  const mr = Math.round(size.mark * 0.6);
  const mx = center ? x - (sigW + mr * 2 + 12) / 2 + mr : x + 14;
  g.strokeStyle = LIME;
  g.lineWidth = 3;
  g.beginPath();
  g.arc(mx, y.mark, mr, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = LIME;
  g.beginPath();
  g.arc(mx, y.mark, mr * 0.42, 0, Math.PI * 2);
  g.fill();
  g.textAlign = "left";
  g.fillStyle = "rgba(235,235,245,0.64)";
  g.fillText(sig, mx + mr + 12, y.mark + size.mark * 0.36);

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

// Shortens text with an ellipsis to fit `max` pixels.
function fit(g, text, max) {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** Everything the card says, in words: its alt text. */
export const cardText = (c) => `Birth card: Founder #${int(c.rank)} of $${c.ticker}, ${c.name}. Born ${day(c.date)} in Lobby ${c.lobby}. ${sol(c.pot)} raised, ${int(c.founders)} founders.`;

/** The words that go with the card when it is shared, with the way to the app. */
export const cardCaption = (c, link) => `I’m Founder #${int(c.rank)} of $${c.ticker}. ${int(c.founders)} of us picked it together in one hour on Community Coin.${c.mint ? ` CA: ${c.mint}` : ""}${link ? ` ${link}` : ""}`;

/** A file name for the card. */
export const cardFileName = (c, format = "post") => `founder-${c.rank}-${c.ticker.toLowerCase()}${format === "story" ? "-story" : ""}.png`;
