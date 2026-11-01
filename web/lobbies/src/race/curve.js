// The race over the hour: samples of each idea's SOL, the ground for the per-idea curves and the replay. One sample
// per 15 s of the lobby's time at most (a newer one in the same window replaces it), a few hundred at most.
// Shared by the app and the realtime server.

export const CURVE_STEP = 15;
export const CURVE_MAX = 260;

/** `curve` with the totals at `t` (seconds into the lobby) added. `totals`: { TICKER: SOL }. Never mutates. */
export function addSample(curve, t, totals) {
  const last = curve[curve.length - 1];
  if (last && t < last.t) return curve; // the clock never runs back
  if (last && same(last.v, totals)) return curve;
  // The last sample moves forward until it is a full step past the one before it.
  const next = curve.length > 1 && t - curve[curve.length - 2].t < CURVE_STEP
    ? [...curve.slice(0, -1), { t, v: totals }]
    : [...curve, { t, v: totals }];
  return next.length > CURVE_MAX ? thin(next) : next;
}

const same = (a, b) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};

// Halves the older half, keeps the recent half whole.
function thin(curve) {
  const half = Math.floor(curve.length / 2);
  return [...curve.slice(0, half).filter((_, i) => i % 2 === 0), ...curve.slice(half)];
}

/** The totals of the race as the curve keeps them. */
export const totalsOf = (ideas) => Object.fromEntries(ideas.map((d) => [d.ticker, Math.round(d.sol * 1000) / 1000]));

/** One idea's series: [[t, sol], ...]; 0 before it was proposed. */
export const seriesOf = (curve, ticker) => curve.map((p) => [p.t, p.v[ticker] ?? 0]);

/**
 * The race at time `t`, read between samples: [{ ticker, sol }] sorted, leader first. Each idea's SOL is the line
 * between the two samples around `t`.
 */
export function standingsAt(curve, t) {
  if (!curve.length) return [];
  let i = curve.findIndex((p) => p.t > t);
  if (i === -1) i = curve.length;
  const a = curve[Math.max(0, i - 1)];
  const b = curve[Math.min(curve.length - 1, i)];
  const k = b.t === a.t ? 1 : Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
  const tickers = new Set([...Object.keys(a.v), ...Object.keys(b.v)]);
  return [...tickers].map((ticker) => {
    const from = a.v[ticker] ?? 0;
    const to = b.v[ticker] ?? 0;
    return { ticker, sol: t < a.t ? 0 : from + (to - from) * k };
  }).sort((x, y) => y.sol - x.sol);
}

/** Every moment the lead changed hands: [{ t, ticker }], the first leader at its first sample. */
export function leadChanges(curve) {
  const out = [];
  for (const p of curve) {
    const top = Object.entries(p.v).sort((x, y) => y[1] - x[1])[0];
    if (top && top[1] > 0 && out[out.length - 1]?.ticker !== top[0]) out.push({ t: p.t, ticker: top[0] });
  }
  return out;
}
