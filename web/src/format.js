// Display helpers. Amounts are bigint wei (18 decimals) everywhere until they reach the screen.

import { formatEther, parseEther } from "ethers";

const WAD = 10n ** 18n;
const nf = (digits) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: 0 });

export const toNumber = (wei) => Number(formatEther(wei));

/** Exact decimal string of an amount, for filling an input. */
export const exact = (wei) => formatEther(wei).replace(/\.0$/, "");

/** ETH amount with as many decimals as small amounts need. */
export function eth(wei, digits) {
  const n = toNumber(wei);
  const d = digits ?? (n === 0 ? 0 : n >= 100 ? 2 : n >= 1 ? 3 : n >= 0.01 ? 4 : 6);
  return `${nf(d).format(n)} ETH`;
}

/** Token amounts in thousands, millions or billions. */
export function tokens(wei, symbol) {
  const n = toNumber(wei);
  const unit = n >= 1e9 ? [1e9, " Md"] : n >= 1e6 ? [1e6, " M"] : n >= 1e3 ? [1e3, " k"] : [1, ""];
  const v = n / unit[0];
  const out = `${nf(v >= 100 ? 0 : v >= 10 ? 1 : 2).format(v)}${unit[1]}`;
  return symbol ? `${out} ${symbol}` : out;
}

/** Price of one million tokens, the unit memes are easiest to read in. */
export function perMillion(priceWad, unit = "ETH") {
  const n = toNumber(priceWad) * 1e6;
  const d = n >= 100 ? 2 : n >= 1 ? 3 : n >= 0.01 ? 4 : 6;
  return `${nf(d).format(n)} ${unit}`;
}

export function percent(x, digits = 1) {
  return `${nf(digits).format(x * 100)} %`;
}

export function signedPercent(x) {
  if (Math.abs(x) < 0.0005) return "0 %";
  return `${x >= 0 ? "+" : "−"}${percent(Math.abs(x))}`;
}

/** How long ago, for the activity feed. */
export function ago(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return `il y a ${Math.floor(s / 86400)} j`;
}

export function shortAddress(a) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function duration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")} min`;
  return `${Math.floor(s / 86400)} j ${Math.floor((s % 86400) / 3600)} h`;
}

export function clock(seconds) {
  return new Date(seconds * 1000).toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Parses a user-typed decimal amount ("1,5" or "1.5") into wei; null when invalid or not positive. */
export function parseAmount(text) {
  const clean = String(text ?? "").trim().replace(",", ".");
  if (!/^\d*\.?\d+$|^\d+\.$/.test(clean)) return null;
  try {
    const wei = parseEther(clean.endsWith(".") ? clean + "0" : clean);
    return wei > 0n ? wei : null;
  } catch {
    return null;
  }
}

export const mulWad = (a, b) => (a * b) / WAD;

/** Mirrors CommunityCoin.symbolKey so the launch form can show the canonical ticker as you type. */
export function canonicalTicker(symbol) {
  const fold = { 0: "O", 1: "I", 3: "E", 4: "A", 5: "S", 7: "T" };
  let out = "";
  for (const ch of new TextEncoder().encode(symbol)) {
    let c = String.fromCharCode(ch).toUpperCase();
    if (ch >= 0x80) continue;
    c = fold[c] ?? c;
    if (/[A-Z0-9]/.test(c)) out += c;
  }
  return out;
}
