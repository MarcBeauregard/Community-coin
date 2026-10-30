// Number and time formatting. Every amount on screen goes through here so the same value always reads the same.

export const HOUR = 3600;

export function sol(v) {
  return `${(Math.round(v * 10) / 10).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} SOL`;
}

export function int(v) {
  return Math.round(v).toLocaleString("en-US");
}

export function pct(v, digits = 2) {
  return `${v.toFixed(digits)}%`;
}

export function signedPct(v) {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
}

export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export const ticker = (t) => `$${t}`;

export function initials(name) {
  const words = name.trim().split(/\s+/);
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  return words[0].slice(0, 2).toUpperCase();
}
