// Display helpers. Amounts are bigint display units (18 decimals, see world.js) everywhere until they reach the
// screen, whether they count SOL or tokens.

export const LOCALE = "en-US";
const WAD = 10n ** 18n;
const nf = (digits) => new Intl.NumberFormat(LOCALE, { maximumFractionDigits: digits, minimumFractionDigits: 0 });

/** Exact decimal string of an amount, for filling an input: 1500000000000000000n is "1.5". */
export function exact(value) {
  const v = value < 0n ? -value : value;
  const frac = (v % WAD).toString().padStart(18, "0").replace(/0+$/, "");
  return `${value < 0n ? "-" : ""}${v / WAD}${frac ? `.${frac}` : ""}`;
}

export const toNumber = (value) => Number(exact(value));

/** SOL amount with as many decimals as small amounts need. */
export function sol(value, digits) {
  const n = toNumber(value);
  const d = digits ?? (n === 0 ? 0 : n >= 100 ? 2 : n >= 1 ? 3 : n >= 0.01 ? 4 : 6);
  return `${nf(d).format(n)} SOL`;
}

/** Token amounts in thousands, millions or billions: 12.9M. */
export function tokens(value, symbol) {
  const n = toNumber(value);
  const unit = n >= 1e9 ? [1e9, "B"] : n >= 1e6 ? [1e6, "M"] : n >= 1e3 ? [1e3, "K"] : [1, ""];
  const v = n / unit[0];
  const out = `${nf(v >= 100 ? 0 : v >= 10 ? 1 : 2).format(v)}${unit[1]}`;
  return symbol ? `${out} ${symbol}` : out;
}

/** Price of one million tokens, the unit memes are easiest to read in. */
export function perMillion(priceWad, unit = "SOL") {
  const n = toNumber(priceWad) * 1e6;
  const d = n >= 100 ? 2 : n >= 1 ? 3 : n >= 0.01 ? 4 : 6;
  return `${nf(d).format(n)} ${unit}`;
}

export function percent(x, digits = 1) {
  return `${nf(digits).format(x * 100)}%`;
}

export function signedPercent(x) {
  if (Math.abs(x) < 0.0005) return "0%";
  return `${x >= 0 ? "+" : "−"}${percent(Math.abs(x))}`;
}

/** How long ago, for the activity feed. */
export function ago(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function shortAddress(a) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** 45s · 5m · 5m 07s · 1h · 1h 05m · 3d · 2d 22h */
export function duration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const pair = (big, bigUnit, small, smallUnit, pad = true) =>
    small ? `${big}${bigUnit} ${pad ? String(small).padStart(2, "0") : small}${smallUnit}` : `${big}${bigUnit}`;
  if (s < 60) return `${s}s`;
  if (s < 3600) return pair(Math.floor(s / 60), "m", s % 60, "s");
  if (s < 86400) return pair(Math.floor(s / 3600), "h", Math.floor((s % 3600) / 60), "m");
  return pair(Math.floor(s / 86400), "d", Math.floor((s % 86400) / 3600), "h", false);
}

/** 5 minutes · 1 hour · 3 days, for sentences; falls back to the short form when the span is not whole. */
export function spoken(seconds) {
  for (const [unit, word] of [[86400, "day"], [3600, "hour"], [60, "minute"]]) {
    if (seconds >= unit && seconds % unit === 0) {
      const k = seconds / unit;
      return `${k} ${word}${k === 1 ? "" : "s"}`;
    }
  }
  return duration(seconds);
}

/** 1 root · 3 variants */
export const count = (k, word) => `${k} ${word}${k === 1 ? "" : "s"}`;

/** A date and time on the chain's clock, 24-hour: Oct 29, 00:22:40. */
export function clock(seconds) {
  return new Date(seconds * 1000).toLocaleString(LOCALE, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

/** Hours and minutes only, 24-hour: 00:22. */
export function hourMinute(seconds) {
  return new Date(seconds * 1000).toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

/** A full date for tooltips. */
export function fullDate(seconds) {
  return new Date(seconds * 1000).toLocaleString(LOCALE, { dateStyle: "medium", timeStyle: "medium", hourCycle: "h23" });
}

/** Parses a typed decimal amount ("1.5", or "1,5" from a comma keyboard) into display units; null when invalid or not positive. */
export function parseAmount(text) {
  const clean = String(text ?? "").trim().replace(",", ".");
  if (!/^\d*\.?\d+$|^\d+\.$/.test(clean)) return null;
  const [whole, frac = ""] = clean.split(".");
  if (frac.length > 18) return null;
  const value = BigInt(whole || "0") * WAD + BigInt(frac.padEnd(18, "0"));
  return value > 0n ? value : null;
}

export const mulWad = (a, b) => (a * b) / WAD;

/** Mirrors the program's symbol_key so the launch form can show the canonical ticker as you type. */
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
