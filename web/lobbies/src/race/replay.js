// The replay: the lobby's hour in 30 seconds, drawn on a canvas so it can be saved as a video. The race (bars that
// grow and pass each other, from the samples in src/race/curve.js), each change of leader called out, then the lock
// and the launch. Drawn on this device from what the lobby recorded: nothing is made up between samples but the
// straight line from one to the next.

import { standingsAt, leadChanges } from "./curve.js";
import { sol } from "../format.js";

// The lobby's hour as the app writes it elsewhere: 00:00 opens, 00:55 locks, 01:00 launches.
export const hm = (t) => `${String(Math.floor(t / 3600)).padStart(2, "0")}:${String(Math.floor(t / 60) % 60).padStart(2, "0")}`;

export const SIZE = 1080; // square: it fits a feed, a story (letterboxed) and a message
export const LENGTH_MS = 30_000;
const RACE_SHARE = 0.84; // the race takes this much of the replay, the launch the rest
const LOCK_AT = 3300;
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", Inter, "Segoe UI", system-ui, sans-serif';
const LIME = "#cbf35c";
const ROWS = 5;

const loadImage = (src) => new Promise((resolve) => {
  if (!src) return resolve(null);
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  img.src = src;
});

/**
 * What a replay needs: `{ curve, coins: { TICKER: { hue, name, logo } }, winner (ticker or null), pot (SOL), lobby
 * ("Friday Night Degens"), practice }`. Resolves to the same with the logos loaded.
 */
export async function prepareReplay(data) {
  const images = {};
  await Promise.all(Object.entries(data.coins).map(async ([t, c]) => { images[t] = await loadImage(c.logo); }));
  await document.fonts?.ready;
  const start = data.curve[0]?.t ?? 0;
  return { ...data, images, start, end: Math.max(LOCK_AT, data.curve[data.curve.length - 1]?.t ?? 0), changes: leadChanges(data.curve) };
}

/** The lobby's time shown at `p` (0 to 1) of the replay; past the race, the lock. */
export const lobbyTimeAt = (r, p) => r.start + (r.end - r.start) * Math.min(1, p / RACE_SHARE);

/** The moments a person reads in words: who led when, the lock, the launch. */
export function replayStory(r) {
  const out = r.changes.map((c, i) => ({ t: hm(c.t), text: i === 0 ? `$${c.ticker} leads` : `$${c.ticker} takes the lead` }));
  out.push({ t: "00:55", text: r.winner ? `Pledges lock · $${r.winner} wins with ${sol(r.pot)}` : "Pledges lock · no winner, every pledge refunded" });
  if (r.winner) out.push({ t: "01:00", text: `$${r.winner} launches` });
  return out;
}

/** Draws the frame at `p` (0 to 1) of the replay on the 2D context `g`. */
export function drawFrame(g, r, p) {
  const W = SIZE, H = SIZE;
  const t = lobbyTimeAt(r, p);
  const rows = standingsAt(r.curve, t).slice(0, ROWS);
  const leader = rows[0];
  const hue = r.coins[leader?.ticker]?.hue ?? 150;

  g.fillStyle = "#000";
  g.fillRect(0, 0, W, H);
  const glow = (x, y, rad, color) => {
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, color);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
  };
  glow(W * 0.5, 0, 760, `hsla(${hue}, 90%, 55%, 0.22)`);

  // Header: the lobby, and the clock of its hour.
  g.textBaseline = "alphabetic";
  g.textAlign = "left";
  g.fillStyle = LIME;
  g.font = `600 30px ${FONT}`;
  g.letterSpacing = "4px";
  g.fillText(r.practice ? "REPLAY · PRACTICE LOBBY" : "REPLAY", 72, 112);
  g.letterSpacing = "0px";
  g.fillStyle = "#f5f5f7";
  g.font = `700 54px ${FONT}`;
  g.fillText(r.lobby, 72, 180);
  g.textAlign = "right";
  g.font = `700 64px ui-monospace, SFMono-Regular, Menlo, monospace`;
  g.fillText(hm(p < RACE_SHARE ? t : 3600), W - 72, 180);

  if (p < RACE_SHARE) drawRace(g, r, rows, t);
  else drawLaunch(g, r, (p - RACE_SHARE) / (1 - RACE_SHARE));

  // Signature.
  g.textAlign = "left";
  g.fillStyle = "rgba(235,235,245,0.6)";
  g.font = `600 26px ${FONT}`;
  g.strokeStyle = LIME;
  g.lineWidth = 3;
  g.beginPath();
  g.arc(88, H - 70, 15, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = LIME;
  g.beginPath();
  g.arc(88, H - 70, 6, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(235,235,245,0.6)";
  g.fillText("Social Launch", 116, H - 61);
}

function coinAt(g, r, ticker, x, y, rad) {
  const c = r.coins[ticker] ?? { hue: 150 };
  g.save();
  g.beginPath();
  g.arc(x, y, rad, 0, Math.PI * 2);
  g.fillStyle = `hsl(${c.hue} 80% 60%)`;
  g.fill();
  g.clip();
  const img = r.images[ticker];
  if (img) g.drawImage(img, x - rad, y - rad, rad * 2, rad * 2);
  else {
    g.fillStyle = "rgba(0,0,0,0.75)";
    g.font = `700 ${Math.round(rad * 0.6)}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(ticker.slice(0, 3), x, y + 2);
    g.textBaseline = "alphabetic";
  }
  g.restore();
}

function drawRace(g, r, rows, t) {
  const W = SIZE;
  const top = 270, rowH = 128, left = 72, barX = 230, barMax = W - barX - 72;
  const max = Math.max(1, rows[0]?.sol ?? 1);
  rows.forEach((row, i) => {
    const y = top + i * rowH;
    const c = r.coins[row.ticker] ?? { hue: 150 };
    coinAt(g, r, row.ticker, left + 50, y + 50, 50);
    const w = Math.max(8, (row.sol / max) * barMax);
    g.fillStyle = i === 0 ? `hsl(${c.hue} 85% 62%)` : `hsla(${c.hue}, 60%, 60%, 0.45)`;
    roundRect(g, barX, y + 18, w, 64, 32);
    g.fill();
    // The ticker inside its bar when it fits, else just after it; the amount at the bar's end the same way.
    g.font = `650 32px ${FONT}`;
    const label = `$${row.ticker}`;
    const labelW = g.measureText(label).width;
    g.font = `500 28px ${FONT}`;
    const amount = sol(row.sol);
    const amountW = g.measureText(amount).width;
    const labelIn = w > labelW + 48;
    const amountIn = labelIn && w > labelW + amountW + 96;
    g.textAlign = "left";
    g.font = `650 32px ${FONT}`;
    g.fillStyle = labelIn && i === 0 ? "rgba(0,0,0,0.82)" : "#f5f5f7";
    g.fillText(label, labelIn ? barX + 24 : barX + w + 18, y + 61);
    g.font = `500 28px ${FONT}`;
    g.fillStyle = amountIn ? (i === 0 ? "rgba(0,0,0,0.7)" : "rgba(235,235,245,0.85)") : "rgba(235,235,245,0.75)";
    if (amountIn) { g.textAlign = "right"; g.fillText(amount, barX + w - 24, y + 60); }
    else g.fillText(amount, (labelIn ? barX + w : barX + w + labelW + 18) + 18, y + 60);
  });
  // The last change of leader, called out for a few seconds of the hour.
  const change = [...r.changes].reverse().find((c) => c.t <= t);
  if (change && r.changes.indexOf(change) > 0 && t - change.t < 180) {
    g.textAlign = "center";
    g.fillStyle = LIME;
    g.font = `700 44px ${FONT}`;
    g.fillText(`$${change.ticker} takes the lead`, SIZE / 2, top + ROWS * rowH + 40);
  }
}

function drawLaunch(g, r, k) {
  const W = SIZE;
  g.textAlign = "center";
  if (!r.winner) {
    g.fillStyle = "#f5f5f7";
    g.font = `700 64px ${FONT}`;
    g.fillText("No winner tonight", W / 2, 560);
    g.fillStyle = "rgba(235,235,245,0.75)";
    g.font = `500 34px ${FONT}`;
    g.fillText("Every pledge was refunded at the lock", W / 2, 630);
    return;
  }
  const ease = 1 - (1 - Math.min(1, k * 1.6)) ** 3;
  const c = r.coins[r.winner] ?? { hue: 150 };
  g.save();
  g.shadowColor = `hsla(${c.hue}, 90%, 55%, 0.7)`;
  g.shadowBlur = 90;
  coinAt(g, r, r.winner, W / 2, 500, 70 + 110 * ease);
  g.restore();
  g.fillStyle = "#f5f5f7";
  g.font = `700 76px ${FONT}`;
  g.fillText(`$${r.winner} launched`, W / 2, 800);
  g.fillStyle = "rgba(235,235,245,0.75)";
  g.font = `500 34px ${FONT}`;
  g.fillText(`${sol(r.pot)} raised · picked by the lobby in one hour`, W / 2, 860);
}

function roundRect(g, x, y, w, h, rad) {
  const q = Math.min(rad, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + q, y);
  g.arcTo(x + w, y, x + w, y + h, q);
  g.arcTo(x + w, y + h, x, y + h, q);
  g.arcTo(x, y + h, x, y, q);
  g.arcTo(x, y, x + w, y, q);
  g.closePath();
}

/**
 * Plays the replay on `canvas` from `from` (0 to 1) over the rest of `ms`. Returns `{ stop() }`; `onFrame(p)` each
 * frame, `onEnd()` once at the end.
 */
export function playReplay(canvas, r, { ms = LENGTH_MS, from = 0, onFrame, onEnd } = {}) {
  const g = canvas.getContext("2d");
  const t0 = performance.now() - from * ms;
  let raf = 0;
  let stopped = false;
  const step = () => {
    if (stopped) return;
    const p = Math.min(1, (performance.now() - t0) / ms);
    drawFrame(g, r, p);
    onFrame?.(p);
    if (p < 1) raf = requestAnimationFrame(step);
    else onEnd?.();
  };
  step();
  return { stop() { stopped = true; cancelAnimationFrame(raf); } };
}

/** The video formats this browser can record a canvas to, best first; null if it can't. */
export function videoType() {
  if (typeof MediaRecorder === "undefined" || !HTMLCanvasElement.prototype.captureStream) return null;
  return ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

/**
 * Records the whole replay as a video, playing it on `canvas` meanwhile. Resolves to a File, or null when the
 * browser can't record. `onFrame(p)` follows the progress.
 */
export function recordReplay(canvas, r, { ms = LENGTH_MS, onFrame } = {}) {
  const type = videoType();
  if (!type) return Promise.resolve(null);
  return new Promise((resolve) => {
    const stream = canvas.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6_000_000 });
    const parts = [];
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    rec.onstop = () => {
      stream.getTracks().forEach((tr) => tr.stop());
      const ext = type.startsWith("video/mp4") ? "mp4" : "webm";
      const blob = new Blob(parts, { type: type.split(";")[0] });
      resolve(blob.size ? new File([blob], `${replayFileName(r)}.${ext}`, { type: blob.type }) : null);
    };
    rec.start(500);
    playReplay(canvas, r, { ms, onFrame, onEnd: () => setTimeout(() => rec.stop(), 400) });
  });
}

export const replayFileName = (r) => `lobby-replay${r.winner ? `-${r.winner.toLowerCase()}` : ""}`;
