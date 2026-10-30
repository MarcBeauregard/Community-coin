// Plays the same viral-meme scenario twice on the program's rules (web/src/protocol.js, cross-checked against the
// Solana program) and reports who ends up with the money.
//
//   pvp: today's game. Plain bonding curves: no opening batch, no vesting, no spike share, and every copycat
//        is an independent SOL pool.
//   cc:  Community Coin. 5 minute batch opening vesting over 1 hour, half of any sale above the one-hour
//        reference price left to the holders, and every copycat is a variant of the original.
//
// Same actors, same amounts, same order in both worlds. Every launch goes: creator and sniper bot in first
// (cc: all in the opening batch with the early half of the wave), then the rest of the wave. Then the comedown:
// the bot sells everything it can, and half of that wave's buyers (the paper hands) sell right behind it.
// Later copycats repeat the cycle. When the hype ends, everybody sells what is left in a random order; the bot
// either leaves first (it knew where the top was) or at a random moment (it did not). Everyone ends in SOL,
// so the market is zero-sum: the question is only who pays whom.
//
//   node web/simulate.mjs            prints the means (SEEDS=n to change the sample size)
//   node web/simulate.mjs --json     also writes them to web/src/simulation.json, for the How it works page
//
// The Solidity version of this simulation, on the Base contracts, is scripts/simulate.js.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Engine, LAMPORTS, SOL } from "./src/protocol.js";

const OPEN = 300; // opening batch
const VEST = Number(process.env.VEST ?? 3600); // vesting of the batch
const SPIKE = Number(process.env.SPIKE ?? 5000); // share of a sale's proceeds above the reference price left in the reserve
const LINEAGE = process.env.LINEAGE !== "0"; // copycats launched as variants of the original
const WAVE = 600; // the late wave arrives within 10 minutes of the opening
const GAP = 1200; // next copycat 20 minutes later
const SEEDS = Number(process.env.SEEDS || 10);
const COPYCATS = ["PEANUT", "PNUTINU", "PNUTWIFHAT", "BABYPNUT", "PNUTAI"];
const ORIGINAL_BUYERS = 24;
const COPYCAT_BUYERS = 10;
const DEV_BAG = 9; // SOL each creator puts in at launch
const SNIPER_BAG = 60; // SOL the bot puts in every launch
const BUY_MIN = 3, BUY_SPREAD = 42; // a retail buy: 3 to 45 SOL
const PROTOCOL = Number(process.env.PROTOCOL ?? 20); // protocol's cut of the 1% trade fee, in bps of the trade, in both worlds

const GROUPS = {
  sniper: "Sniper bot",
  originalDev: "Original creator",
  copycatDevs: "Copycat creators",
  originalBuyers: "Original buyers",
  copycatBuyers: "Copycat buyers",
  protocol: "Protocol",
};

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const lamports = (sol) => BigInt(Math.round(sol * 1e6)) * 1000n;
const toSol = (x) => Number(x) / Number(LAMPORTS);

// Everything random is drawn up front so both worlds see exactly the same scenario.
function draw(seed) {
  const rand = rng(seed);
  const buyer = () => ({ value: BUY_MIN + rand() * BUY_SPREAD, paperHands: rand() < 0.5 });
  const originalWave = Array.from({ length: ORIGINAL_BUYERS }, buyer);
  const copycatWaves = COPYCATS.map(() => Array.from({ length: COPYCAT_BUYERS }, buyer));
  const holders = ORIGINAL_BUYERS + COPYCATS.length * COPYCAT_BUYERS + 1 + COPYCATS.length;
  const exitOrder = Array.from({ length: holders }, (_, i) => i);
  for (let i = exitOrder.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [exitOrder[i], exitOrder[j]] = [exitOrder[j], exitOrder[i]];
  }
  const botExit = Math.floor(rand() * (holders + 1));
  return { originalWave, copycatWaves, exitOrder, botExit };
}

function play(world, scenario, botLeavesFirst) {
  const cc = world === "cc";
  const hub = new Engine(
    { openWindow: cc ? OPEN : 0, vestWindow: cc ? VEST : 0, spikeShareBps: cc ? SPIKE : 0, unionWindow: 3 * 86400, protocolFeeBps: PROTOCOL, feeRecipient: "treasury" },
    { external: true }, // flows are counted below; wallets are not tracked
  );
  let now = 1_800_000_000;
  const wait = (s) => (now += s);
  const tick = () => (now += 1); // every transaction lands a second after the previous one
  const pnl = Object.fromEntries(Object.keys(GROUPS).map((g) => [g, 0]));
  const bags = []; // [who, mint, group] to sell when the hype ends
  const sniped = [];
  const creators = []; // [who, mint, group]
  let original; // PNUT, once launched
  let peakOriginalReserve = 0n;
  let retail = 0;

  const reserve = (mint) => {
    const m = hub.meme(mint);
    return m.settled ? m.vQuote - m.floor : m.batchQuote;
  };
  const buy = (who, group, mint, value) => {
    hub.buySol(who, mint, lamports(value), 0n, tick());
    pnl[group] -= value;
  };
  const commit = (who, group, mint, value) => {
    hub.commitSol(who, mint, lamports(value), 0n, tick());
    pnl[group] -= value;
  };
  const sellAll = (who, group, mint) => {
    if (hub.claimable(mint, who, now) > 0n) hub.claim(who, mint, tick());
    const bal = hub.balance(mint, who);
    if (bal === 0n) return;
    // The last trade of the route is the root's: what it pays out is what the seller gets in SOL.
    const last = hub.sellToSol(who, mint, bal, 0n, tick()).filter((e) => e.name === "Trade").at(-1).args;
    pnl[group] += toSol(last.quoteAmount - last.fee - last.spikeShare);
  };
  const botSells = () => {
    for (const mint of sniped) sellAll("sniper", "sniper", mint);
  };

  // One launch: the creator, the bot, an early half of the wave (in the opening batch in the cc world, right
  // behind the bot in the pvp world), then the late half. Then the comedown.
  function launch(symbol, parent, dev, devGroup, wave, buyerGroup) {
    const early = wave.slice(0, Math.ceil(wave.length / 2));
    const late = wave.slice(early.length);
    let mint;
    if (!cc) {
      mint = hub.launch(dev, { name: symbol, symbol }, tick())[0].args.mint;
      buy(dev, devGroup, mint, DEV_BAG);
      buy("sniper", "sniper", mint, SNIPER_BAG);
      for (const { who, value } of early) buy(who, buyerGroup, mint, value);
    } else {
      mint = hub.launch(dev, { name: symbol, symbol, parent, solIn: lamports(DEV_BAG) }, tick())[0].args.mint;
      pnl[devGroup] -= DEV_BAG;
      commit("sniper", "sniper", mint, SNIPER_BAG);
      for (const { who, value } of early) commit(who, buyerGroup, mint, value);
      wait(OPEN);
      hub.settle(mint, tick());
    }
    sniped.push(mint);
    creators.push([dev, mint, devGroup]);
    for (const { who, value } of late) buy(who, buyerGroup, mint, value);
    const top = reserve(original ?? mint); // top of the wave
    if (top > peakOriginalReserve) peakOriginalReserve = top;
    wait(WAVE);
    botSells();
    for (const { who, paperHands } of wave) if (paperHands) sellAll(who, buyerGroup, mint);
    bags.push([dev, mint, devGroup], ...wave.map(({ who }) => [who, mint, buyerGroup]));
    return mint;
  }

  const take = (wave) => wave.map((b) => ({ ...b, who: `retail${retail++}` }));
  original = launch("PNUT", SOL, "originalDev", "originalDev", take(scenario.originalWave), "originalBuyers");
  for (let i = 0; i < COPYCATS.length; i++) {
    wait(GAP);
    launch(COPYCATS[i], LINEAGE ? original : SOL, `copycatDev${i}`, "copycatDevs", take(scenario.copycatWaves[i]), "copycatBuyers");
  }

  // The hype is over: everybody leaves in a random order (the bot first if it saw the top), then creators
  // and the protocol cash out their fees (fees on a variant are paid in the original's tokens, sold right away).
  wait(VEST);
  const botTurn = botLeavesFirst ? 0 : scenario.botExit;
  for (let k = 0; k <= scenario.exitOrder.length; k++) {
    if (k === botTurn) botSells();
    if (k === scenario.exitOrder.length) break;
    const [who, mint, group] = bags[scenario.exitOrder[k]];
    sellAll(who, group, mint);
  }
  const cashOut = (who, group, mint, protocol) => {
    const m = hub.meme(mint);
    if ((protocol ? m.protocolFees : m.creatorFees) === 0n) return;
    const amount = hub.claimFees(who, mint, protocol, tick())[0].args.amount;
    if (m.parent === SOL) pnl[group] += toSol(amount);
    else sellAll(who, group, m.parent);
  };
  for (const [who, mint, group] of creators) cashOut(who, group, mint, false);
  for (const [, mint] of creators) cashOut("treasury", "protocol", mint, true);
  return { pnl, peakOriginalReserve: toSol(peakOriginalReserve) };
}

const reports = [
  ["The bot sees the top and leaves first", true],
  ["Nobody knows where the top is: the bot leaves at a random moment", false],
];
const runs = reports.map(() => ({ pvp: [], cc: [] }));
for (let seed = 1; seed <= SEEDS; seed++) {
  const scenario = draw(seed);
  for (const [i, [, first]] of reports.entries()) for (const world of ["pvp", "cc"]) runs[i][world].push(play(world, scenario, first));
}

const money = (x) => (x >= 0 ? "+" : "") + x.toFixed(2);
const row = (label, a, b) => console.log(`${label.padEnd(24)}${String(a).padStart(14)}${String(b).padStart(17)}`);
const retailIn = (ORIGINAL_BUYERS + COPYCATS.length * COPYCAT_BUYERS) * (BUY_MIN + BUY_SPREAD / 2);
console.log(`Mean result in SOL over ${SEEDS} scenarios (~${retailIn.toFixed(0)} SOL of retail money each)`);
console.log(`community coin: opening ${OPEN}s, vesting ${VEST}s, spike share ${SPIKE / 100}%, lineage ${LINEAGE ? "on" : "off"}`);
console.log(`both worlds: 1% fee per trade, ${PROTOCOL / 100}% of the trade to the protocol, the rest to the meme's creator`);
for (const [i, [title]] of reports.entries()) {
  const mean = (world, f) => runs[i][world].reduce((a, r) => a + f(r), 0) / runs[i][world].length;
  console.log(`\n${title}\n`);
  row("", "today (pvp)", "community coin");
  for (const [g, label] of Object.entries(GROUPS)) row(label, money(mean("pvp", (r) => r.pnl[g])), money(mean("cc", (r) => r.pnl[g])));
  const retail = (r) => r.pnl.originalBuyers + r.pnl.copycatBuyers;
  row("All retail", money(mean("pvp", retail)), money(mean("cc", retail)));
  const sum = (r) => Object.values(r.pnl).reduce((a, b) => a + b, 0);
  row("Sum (zero-sum check)", money(mean("pvp", sum)), money(mean("cc", sum)));
  const wins = (world) => `${runs[i][world].filter((r) => r.pnl.sniper > 0).length}/${SEEDS}`;
  row("Sniper profitable in", wins("pvp"), wins("cc"));
  const peak = (world) => mean(world, (r) => r.peakOriginalReserve).toFixed(2);
  row("Peak SOL behind PNUT", peak("pvp"), peak("cc"));
}
console.log();
row("SOL pools for the meme", 1 + COPYCATS.length, LINEAGE ? 1 : 1 + COPYCATS.length);

if (process.argv.includes("--json")) {
  const round = (x) => Math.round(x * 100) / 100;
  const json = {
    source: "web/simulate.mjs",
    seeds: SEEDS,
    params: { openSeconds: OPEN, vestSeconds: VEST, spikeShareBps: SPIKE, lineage: LINEAGE, protocolFeeBps: PROTOCOL },
    retailInSol: round(retailIn),
    buyers: { original: ORIGINAL_BUYERS, perCopycat: COPYCAT_BUYERS, copycats: COPYCATS.length },
    pools: { pvp: 1 + COPYCATS.length, cc: LINEAGE ? 1 : 1 + COPYCATS.length },
    reports: reports.map(([title, botLeavesFirst], i) => {
      const mean = (world, f) => runs[i][world].reduce((a, r) => a + f(r), 0) / runs[i][world].length;
      const both = (f) => ({ pvp: round(mean("pvp", f)), cc: round(mean("cc", f)) });
      return {
        title,
        botLeavesFirst,
        groups: Object.entries(GROUPS).map(([key, label]) => ({ key, label, ...both((r) => r.pnl[key]) })),
        retail: both((r) => r.pnl.originalBuyers + r.pnl.copycatBuyers),
        sniperProfitable: { pvp: runs[i].pvp.filter((r) => r.pnl.sniper > 0).length, cc: runs[i].cc.filter((r) => r.pnl.sniper > 0).length },
        peakOriginalReserve: both((r) => r.peakOriginalReserve),
      };
    }),
  };
  const out = join(dirname(fileURLToPath(import.meta.url)), "src/simulation.json");
  writeFileSync(out, JSON.stringify(json, null, 2) + "\n");
  console.log(`wrote ${out}`);
}
