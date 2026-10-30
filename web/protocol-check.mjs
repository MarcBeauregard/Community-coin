// Cross-check of web/src/protocol.js against the Solana program.
//
//   cd solana && cargo test --test cross_check     replays every scenario on the program (solana-program-test)
//                                                  and writes solana/target/cross-check/<scenario>.json
//   node web/protocol-check.mjs                    replays the same scenarios here and requires, after every
//                                                  step, the same result (ok or the same error) and the same state
//   node web/protocol-check.mjs --write-walk       regenerates the random walk scenario
//
// Scenarios: web/src/seed.json (the demo history) and solana/programs/community-coin/tests/scenarios/*.json.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { LAMPORTS, SOL, MIN_UNION_RESERVE } from "./src/protocol.js";
import { Scenario } from "./src/scenario.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const scenarioDir = join(root, "solana/programs/community-coin/tests/scenarios");
const outDir = join(root, "solana/target/cross-check");

/** A scenario replayed on the engine, with its state in the shape the Rust test writes it. */
class Replay extends Scenario {
  snapshot() {
    const st = this.engine.state;
    const symbolOf = new Map(st.order.map((m) => [m, st.memes.get(m).symbol]));
    const str = (x) => String(x);
    const memes = {}, supply = {}, balances = {}, commitments = {}, locks = {};
    for (const mint of st.order) {
      const x = st.memes.get(mint), symbol = x.symbol;
      memes[symbol] = {
        parent: symbolOf.get(x.parent) ?? "", creator: this.nameOf.get(x.creator), settled: x.settled, height: x.height,
        openUntil: str(x.openUntil), refTime: str(x.refTime), reference: str(x.reference),
        vQuote: str(x.vQuote), vToken: str(x.vToken), floor: str(x.floor),
        batchQuote: str(x.batchQuote), batchTokens: str(x.batchTokens), batchClaimed: str(x.batchClaimed),
        escrowed: str(x.escrowed), creatorFees: str(x.creatorFees), protocolFees: str(x.protocolFees),
      };
      supply[symbol] = str(st.supply.get(mint) ?? 0n);
      for (const [n, id] of this.ids) {
        const b = this.engine.balance(mint, id);
        if (b > 0n) balances[`${n}|${symbol}`] = str(b);
        const c = st.commitments.get(`${mint}|${id}`);
        if (c) commitments[`${symbol}|${n}`] = { committed: str(c.committed), claimed: str(c.claimed) };
      }
    }
    const unions = st.unions.map((u) => ({ meme: symbolOf.get(u.meme), target: symbolOf.get(u.target), deadline: str(u.deadline), executed: u.executed, locked: str(u.locked) }));
    st.unions.forEach((u) => {
      for (const [n, id] of this.ids) {
        const l = this.engine.lock(u.id, id);
        if (l > 0n) locks[`${u.id}|${n}`] = str(l);
      }
    });
    return { memes, supply, balances, commitments, unions, locks, vault: str(st.vault) };
  }
}

/** The first difference between two JSON values, as a path and both sides, or null. */
function diff(a, b, path = "") {
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b) || (a === null) !== (b === null)) return { path, rust: a, js: b };
  if (a && typeof a === "object") {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const k of keys) {
      const d = diff(a[k], b[k], `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return a === b ? null : { path, rust: a, js: b };
}

function scenarios() {
  const out = [["demo", join(root, "web/src/seed.json")]];
  if (existsSync(scenarioDir)) for (const f of readdirSync(scenarioDir).filter((f) => f.endsWith(".json")).sort()) out.push([basename(f, ".json"), join(scenarioDir, f)]);
  return out;
}

function check() {
  let failed = 0;
  for (const [name, file] of scenarios()) {
    const scenario = JSON.parse(readFileSync(file, "utf8"));
    const rustFile = join(outDir, `${name}.json`);
    if (!existsSync(rustFile)) {
      console.error(`${name}: ${rustFile} is missing; run: cd solana && cargo test --test cross_check`);
      failed++;
      continue;
    }
    const rust = JSON.parse(readFileSync(rustFile, "utf8")).steps;
    const r = new Replay(scenario);
    let i = 0, ok = 0, failures = 0, bad = null;
    for (const s of scenario.steps) {
      const result = r.step(s);
      if (result === null) continue;
      const expected = rust[i];
      if (!expected) {
        bad = `step ${i}: the program trace ends here`;
        break;
      }
      if (result !== expected.result) {
        bad = `step ${i} ${JSON.stringify(s)}: program ${expected.result}, engine ${result}`;
        break;
      }
      const d = diff(expected.state, r.snapshot());
      if (d) {
        bad = `step ${i} ${JSON.stringify(s)}: state${d.path} is ${JSON.stringify(d.rust)} in the program, ${JSON.stringify(d.js)} in the engine`;
        break;
      }
      if (result === "ok") ok++;
      else failures++;
      i++;
    }
    if (!bad && i !== rust.length) bad = `the program trace has ${rust.length} steps, the engine ${i}`;
    if (bad) {
      console.error(`✗ ${name}: ${bad}`);
      failed++;
    } else {
      console.log(`✓ ${name}: ${i} steps identical (${ok} succeeded, ${failures} failed the same way on both sides)`);
    }
  }
  if (failed) process.exit(1);
}

// ------------------------------------------------------------------ the random walk

function rng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0;
    return s / 4_294_967_296;
  };
  return { next, pick: (xs) => xs[Math.floor(next() * xs.length) % xs.length], int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)) };
}

/**
 * A long walk through every instruction: launches (roots and variants down to the depth limit), openings with
 * SOL and with parent tokens, vesting claims, buys and sells in SOL and in the parent token, pumps followed by
 * quick dumps (spike shares), fees claimed by creators and by the protocol, unions that fail and one that passes,
 * and a sprinkle of deliberately invalid steps. Amounts are recorded in base units, so both sides do the same.
 */
function writeWalk(seed = 20261030, length = 260) {
  const accounts = ["Ana", "Ben", "Cleo", "Dan", "Eve", "Finn", "Treasury"];
  const traders = accounts.slice(0, 6);
  const scenario = {
    comment: "Generated by node web/protocol-check.mjs --write-walk. Amounts in base units: lamports for SOL, 1e-6 for tokens.",
    accounts,
    lamportsEach: "10000", // what the Rust harness gives every account, so neither side runs dry before the other
    params: { openWindow: 300, vestWindow: 1800, spikeShareBps: 5000, unionWindow: 7200, protocolFeeBps: 20, feeRecipient: "Treasury" },
    steps: [],
  };
  const r = new Replay(scenario);
  const e = r.engine;
  const R = rng(seed);
  const push = (s, expect) => {
    const result = r.step(s);
    if (expect && result !== expect) throw new Error(`walk: ${JSON.stringify(s)} gave ${result}, meant to give ${expect}`);
    scenario.steps.push(expect ? { ...s, expect } : s);
    return result;
  };
  const warp = (t) => push({ warp: t });
  const sol = (lo, hi) => String(BigInt(Math.round((lo + R.next() * (hi - lo)) * 1e3)) * 1_000_000n); // lamports, 0.001 SOL steps
  const share = (x, lo = 0.1, hi = 1) => (x * BigInt(Math.max(1, Math.round((lo + R.next() * (hi - lo)) * 1000)))) / 1000n;
  const tickers = ["PNUT", "MOODENG", "GOAT", "FWOG", "CHILLGUY", "BONK", "WIF", "POPCAT", "MEW", "SLERF", "MYRO", "BOME", "PONKE", "GIGA", "MICHI"];
  let nextTicker = 0;
  const launched = () => e.state.order.map((m) => e.state.memes.get(m).symbol);
  const meme = (sym) => e.state.memes.get(r.mint(sym));
  const depth = (sym) => e.ancestors(r.mint(sym)).length;
  const open = (sym) => !meme(sym).settled && r.now < meme(sym).openUntil;
  const holders = (sym) => accounts.filter((n) => e.balance(r.mint(sym), n) > 0n);
  const launch = (actor, parent, solIn) => {
    const symbol = tickers[nextTicker++ % tickers.length] + (nextTicker > tickers.length ? String(Math.floor(nextTicker / tickers.length) + 1) : "");
    return push({ actor, op: "launch", name: `${symbol[0]}${symbol.slice(1).toLowerCase()} coin`, symbol, ...(parent ? { parent } : {}), lamports: solIn });
  };

  // Opening act: three roots with openings, a variant launched while its parent is still opening.
  launch("Ana", null, sol(5, 20));
  launch("Ben", null, sol(5, 20));
  launch("Cleo", null, "0");
  push({ actor: "Dan", op: "commitSol", meme: "PNUT", lamports: sol(3, 30) });
  push({ actor: "Eve", op: "commitSol", meme: "PNUT", lamports: sol(3, 30) });
  push({ actor: "Finn", op: "commitSol", meme: "MOODENG", lamports: sol(3, 30) });
  push({ actor: "Dan", op: "launch", name: "Too early", symbol: "PNUTJR", parent: "PNUT", lamports: sol(1, 5) }, "StillOpening");
  push({ actor: "Dan", op: "launch", name: "Taken", symbol: "PNU7", lamports: "0" }, "MemeExists");
  push({ actor: "Dan", op: "launch", name: "Empty", symbol: "$$$", lamports: "0" }, "InvalidSymbol");
  push({ actor: "Eve", op: "settle", meme: "PNUT" }, "StillOpening");
  push({ actor: "Eve", op: "claim", meme: "PNUT" }, "StillOpening");
  warp(301);
  push({ actor: "Finn", op: "commitSol", meme: "PNUT", lamports: sol(1, 3) }, "OpeningClosed");
  push({ actor: "Eve", op: "settle", meme: "PNUT" });
  push({ actor: "Eve", op: "settle", meme: "PNUT" }, "AlreadySettled");
  push({ actor: "Ana", op: "claim", meme: "GOAT" }, "AccountNotInitialized");
  push({ actor: "Cleo", op: "claim", meme: "GOAT" }, "NothingToClaim");
  push({ actor: "Ben", op: "buySol", meme: "PNUT", lamports: sol(1, 3), minOut: "999999999999999999" }, "Slippage");
  push({ actor: "Ben", op: "buySol", meme: "PNUT", lamports: "0" }, "ZeroAmount");
  push({ actor: "Ben", op: "claimFees", meme: "PNUT", protocol: false }, "Unauthorized");
  push({ actor: "Ana", op: "claimFees", meme: "PNUT", protocol: true }, "Unauthorized");

  // A chain of variants down to the depth limit: the seventh level is refused.
  let parent = "GOAT";
  for (let d = 1; d <= 6; d++) {
    launch(traders[d % traders.length], parent, "0");
    parent = launched().at(-1);
  }
  push({ actor: "Ana", op: "launch", name: "One level too deep", symbol: "DEEP", parent, lamports: "0" }, "TooDeep");

  let union = null, scriptedUnion = false;
  for (let i = 0; i < length; i++) {
    if (R.next() < 0.5) warp(R.int(10, 500));
    const actor = R.pick(traders);
    const syms = launched();
    const x = R.pick(syms);
    const mx = r.mint(x);
    const held = e.balance(mx, actor);
    const parentSym = e.state.memes.get(meme(x).parent)?.symbol;
    const parentHeld = parentSym ? e.balance(r.mint(parentSym), actor) : 0n;
    const lam = e.lamportsOf(actor);
    const roll = R.next();

    if (!scriptedUnion && i === Math.floor(length / 2)) {
      // A union that passes: a root with a real reserve joins another family; every holder votes with everything.
      scriptedUnion = true;
      const roots = syms.filter((s) => meme(s).parent === SOL && meme(s).settled && meme(s).vQuote - meme(s).floor >= MIN_UNION_RESERVE * 10n);
      const m = roots.find((s) => s !== "PNUT") ?? roots[0];
      const target = syms.find((s) => s !== m && depth(s) <= 2 && (e.ancestors(r.mint(s))[0]?.mint ?? r.mint(s)) !== r.mint(m) && meme(s).settled);
      if (m && target) {
        const id = e.state.unions.length;
        push({ actor: "Ana", op: "proposeUnion", meme: m, target });
        push({ actor: "Ben", op: "executeUnion", union: id }, "VotingOpen");
        const voters = holders(m);
        for (const n of voters) push({ actor: n, op: "lockUnion", union: id, amount: String(e.balance(r.mint(m), n)) });
        warp(7201);
        push({ actor: voters[0], op: "lockUnion", union: id, amount: "1" }, "VotingClosed");
        push({ actor: "Cleo", op: "executeUnion", union: id }, "ok");
        push({ actor: "Cleo", op: "executeUnion", union: id }, "VotingClosed");
        for (const n of accounts) if (e.lock(id, n) > 0n) push({ actor: n, op: "unlockUnion", union: id });
        push({ actor: "Dan", op: "proposeUnion", meme: m, target }, "NotRoot");
        continue;
      }
    }

    if (roll < 0.07 && syms.length < 24) {
      // A launch, and a few buyers in its opening, in SOL or (for a variant) in the parent token.
      const p = R.next() < 0.4 ? null : R.pick(syms.filter((s) => depth(s) < 5));
      if (launch(actor, p, R.next() < 0.3 ? "0" : sol(0.5, 10)) === "ok") {
        const s = launched().at(-1);
        for (let k = R.int(1, 3); k > 0; k--) {
          const who = R.pick(traders);
          const ph = meme(s).parent === SOL ? 0n : e.balance(meme(s).parent, who);
          if (ph > 0n && R.next() < 0.5) push({ actor: who, op: "commit", meme: s, amount: String(share(ph, 0.1, 0.6)) });
          else push({ actor: who, op: "commitSol", meme: s, lamports: sol(0.5, 12) });
        }
      }
    } else if (roll < 0.15) {
      // Claims, mostly from someone who took part in the opening.
      const mine = syms.filter((s) => e.state.commitments.has(`${r.mint(s)}|${actor}`));
      push({ actor, op: "claim", meme: mine.length && R.next() < 0.85 ? R.pick(mine) : x });
    } else if (roll < 0.4) {
      // Now and then a pump: a big buy, then the same trader dumps right away (above the lagging reference).
      if (R.next() < 0.15 && !open(x)) {
        push({ actor, op: "buySol", meme: x, lamports: sol(20, 35) });
        warp(R.int(5, 60));
        push({ actor, op: "sellToSol", meme: x, amount: String(e.balance(mx, actor)) });
      } else {
        push({ actor, op: "buySol", meme: x, lamports: sol(0.2, 15) });
      }
    } else if (roll < 0.5) {
      if (parentHeld > 0n) push({ actor, op: "buy", meme: x, amount: String(share(parentHeld, 0.1, 0.8)) });
      else if (meme(x).parent === SOL) push({ actor, op: "buy", meme: x, amount: sol(0.2, 5) });
    } else if (roll < 0.62) {
      if (held > 0n) push({ actor, op: "sellToSol", meme: x, amount: String(share(held)) });
    } else if (roll < 0.72) {
      if (held > 0n) push({ actor, op: "sell", meme: x, amount: String(share(held)) });
    } else if (roll < 0.76) {
      if (meme(x).creatorFees > 0n) push({ actor: meme(x).creator, op: "claimFees", meme: x, protocol: false });
      if (meme(x).protocolFees > 0n && R.next() < 0.5) push({ actor: "Treasury", op: "claimFees", meme: x, protocol: true });
    } else if (roll < 0.79) {
      // The treasury cashes out the parent tokens its fees on variants were paid in.
      const t = syms.filter((s) => e.balance(r.mint(s), "Treasury") > 0n);
      if (t.length) {
        const s = R.pick(t);
        push({ actor: "Treasury", op: "sellToSol", meme: s, amount: String(e.balance(r.mint(s), "Treasury")) });
      }
    } else if (roll < 0.88) {
      // A union proposed, or a holder voting on the last one.
      const u = union === null ? null : e.state.unions[union];
      if (!u || u.executed || r.now > Number(u.deadline)) {
        const m = R.pick(syms), target = R.pick(syms);
        if (m !== target && push({ actor, op: "proposeUnion", meme: m, target }) === "ok") union = e.state.unions.length - 1;
      } else {
        const voters = holders(e.state.memes.get(u.meme).symbol).filter((n) => n !== "Treasury");
        if (voters.length) {
          const n = R.pick(voters);
          push({ actor: n, op: "lockUnion", union, amount: String(share(e.balance(u.meme, n), 0.05, 0.8)) });
        }
      }
    } else if (roll < 0.92) {
      if (union !== null && !e.state.unions[union].executed && r.now > Number(e.state.unions[union].deadline)) {
        push({ actor, op: "executeUnion", union });
      }
    } else if (roll < 0.96) {
      const mine = e.state.unions.filter((u) => e.lock(u.id, actor) > 0n && (u.executed || r.now > Number(u.deadline)));
      if (mine.length) push({ actor, op: "unlockUnion", union: R.pick(mine).id });
    } else {
      push({ actor, op: "settle", meme: x });
    }
  }

  // Everybody leaves, deepest memes first, and fees are cashed out on the way.
  for (let round = 0; round < 3; round++) {
    warp(1801);
    const byDepth = launched().sort((a, b) => depth(b) - depth(a));
    for (const s of byDepth) {
      for (const n of traders) if (e.commitment(r.mint(s), n).committed > e.commitment(r.mint(s), n).claimed) push({ actor: n, op: "claim", meme: s });
      if (meme(s).creatorFees > 0n) push({ actor: meme(s).creator, op: "claimFees", meme: s, protocol: false });
      if (meme(s).protocolFees > 0n) push({ actor: "Treasury", op: "claimFees", meme: s, protocol: true });
      for (const u of e.state.unions) for (const n of accounts) if (e.lock(u.id, n) > 0n && (u.executed || r.now > Number(u.deadline))) push({ actor: n, op: "unlockUnion", union: u.id });
    }
    for (const s of byDepth) for (const n of accounts) if (e.balance(r.mint(s), n) > 0n) push({ actor: n, op: "sellToSol", meme: s, amount: "all" });
  }

  mkdirSync(scenarioDir, { recursive: true });
  const file = join(scenarioDir, "walk.json");
  const lines = scenario.steps.map((s) => "    " + JSON.stringify(s));
  const head = JSON.stringify({ ...scenario, steps: undefined }, null, 2).replace(/\n}$/, "");
  writeFileSync(file, `${head},\n  "steps": [\n${lines.join(",\n")}\n  ]\n}\n`);
  const results = {};
  const replay = new Replay(scenario);
  for (const s of scenario.steps) {
    const res = replay.step(s);
    if (res) results[`${s.op}:${res}`] = (results[`${s.op}:${res}`] ?? 0) + 1;
  }
  console.log(`wrote ${file}: ${scenario.steps.length} steps`);
  console.log(results);
}

if (process.argv.includes("--write-walk")) writeWalk();
else check();
