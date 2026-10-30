// Plays the same viral-meme scenario twice on the real contracts and reports who ends up with the money.
//
//   pvp: today's game. Plain bonding curves: no opening batch, no vesting, no spike share, and every copycat
//        is an independent ETH pool.
//   cc:  Community Coin. 5 minute batch opening vesting over 1 hour, half of any sale above the one-hour
//        reference price left to the holders, and every copycat is a variant of the original.
//
// Same actors, same amounts, same order in both worlds. Every launch goes: creator and sniper bot in first
// (cc: all in the opening batch with the early half of the wave), then the rest of the wave. Then the comedown:
// the bot sells everything it can, and half of that wave's buyers (the paper hands) sell right behind it.
// Later copycats repeat the cycle. When the hype ends, everybody sells what is left in a random order; the bot
// either leaves first (it knew where the top was) or at a random moment (it did not). Everyone ends in ETH,
// so the market is zero-sum: the question is only who pays whom.
// Run with `npm run simulate` (SEEDS=n to change the sample size). SIM_JSON=path also writes the means as JSON, which
// is how the app's "How it works" page gets its numbers (`npm run simulate:web`).

const { ethers, network } = require("hardhat");
const { writeFileSync } = require("node:fs");

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
const DEV_BAG = 0.3; // ETH each creator puts in at launch
const SNIPER_BAG = 2; // ETH the bot puts in every launch
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

const eth = (n) => ethers.parseEther(n.toFixed(6));
const toEth = (wei) => Number(ethers.formatEther(wei));
// Mines a block right away: until a block is mined, calls (claimable) do not see the time move.
const wait = async (seconds) => {
  await network.provider.send("evm_increaseTime", [seconds]);
  await network.provider.send("evm_mine");
};

// Everything random is drawn up front so both worlds see exactly the same scenario.
function draw(seed) {
  const rand = rng(seed);
  const buyer = () => ({ value: 0.1 + rand() * 1.4, paperHands: rand() < 0.5 });
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

async function play(world, scenario, botLeavesFirst) {
  const snapshot = await network.provider.send("evm_snapshot");
  const cc = world === "cc";
  const signers = await ethers.getSigners();
  const treasury = signers.at(-1); // the protocol's fee recipient, nobody's wallet in the scenario
  const hub = await ethers.deployContract(
    "CommunityCoin",
    cc ? [OPEN, VEST, SPIKE, 3 * 86400, PROTOCOL, treasury.address] : [0, 0, 0, 3 * 86400, PROTOCOL, treasury.address],
  );
  const [originalDev, ...rest] = signers.slice(0, -1);
  const copycatDevs = rest.splice(0, COPYCATS.length);
  const sniper = rest.shift();
  const retail = rest;

  const pnl = Object.fromEntries(Object.keys(GROUPS).map((g) => [g, 0]));
  const bags = []; // [signer, token, group] to sell when the hype ends
  const sniped = [];
  let original; // PNUT, once launched
  let peakOriginalReserve = 0n;

  const buy = async (who, group, token, value) => {
    await hub.connect(who).buyEth(token, 0, { value: eth(value) });
    pnl[group] -= value;
  };
  const commit = async (who, group, token, value) => {
    await hub.connect(who).commitEth(token, 0, { value: eth(value) });
    pnl[group] -= value;
  };
  const sellAll = async (who, group, token) => {
    if (cc && (await hub.claimable(token, who)) > 0n) await hub.connect(who).claim(token);
    const bal = await token.balanceOf(who);
    if (bal === 0n) return;
    const receipt = await (await hub.connect(who).sellToEth(token, bal, 0)).wait();
    // The last trade of the route is the root's: what it pays out is what the seller gets in ETH.
    const trades = receipt.logs.map((l) => hub.interface.parseLog(l)).filter((e) => e?.name === "Trade");
    const { quoteAmount, fee, spikeShare } = trades.at(-1).args;
    pnl[group] += toEth(quoteAmount - fee - spikeShare);
  };
  const botSells = async () => {
    for (const token of sniped) await sellAll(sniper, "sniper", token);
  };
  const tokenAt = async (symbol) => ethers.getContractAt("MemeToken", await hub.tokenOfKey(await hub.symbolKey(symbol)));

  // One launch: the creator, the bot, an early half of the wave (in the opening batch in the cc world, right
  // behind the bot in the pvp world), then the late half. Then the comedown.
  async function launch(symbol, parent, dev, devGroup, wave, buyerGroup) {
    let token;
    const early = wave.slice(0, Math.ceil(wave.length / 2));
    const late = wave.slice(early.length);
    if (!cc) {
      await hub.connect(dev).launch(symbol, symbol, ethers.ZeroAddress);
      token = await tokenAt(symbol);
      await buy(dev, devGroup, token, DEV_BAG);
      await buy(sniper, "sniper", token, SNIPER_BAG);
      for (const { who, value } of early) await buy(who, buyerGroup, token, value);
    } else {
      await hub.connect(dev).launch(symbol, symbol, parent, { value: eth(DEV_BAG) });
      pnl[devGroup] -= DEV_BAG;
      token = await tokenAt(symbol);
      await commit(sniper, "sniper", token, SNIPER_BAG);
      for (const { who, value } of early) await commit(who, buyerGroup, token, value);
      await wait(OPEN);
      await hub.settle(token);
    }
    sniped.push(token);
    for (const { who, value } of late) await buy(who, buyerGroup, token, value);
    const reserve = await hub.realReserve(original ?? token); // top of the wave
    if (reserve > peakOriginalReserve) peakOriginalReserve = reserve;
    await wait(WAVE);
    await botSells();
    for (const { who, paperHands } of wave) if (paperHands) await sellAll(who, buyerGroup, token);
    bags.push([dev, token, devGroup], ...wave.map(({ who }) => [who, token, buyerGroup]));
    return token;
  }

  let next = 0;
  const take = (wave) => wave.map((b) => ({ ...b, who: retail[next++] }));
  original = await launch("PNUT", ethers.ZeroAddress, originalDev, "originalDev", take(scenario.originalWave), "originalBuyers");
  for (let i = 0; i < COPYCATS.length; i++) {
    await wait(GAP);
    const parent = LINEAGE ? original : ethers.ZeroAddress;
    await launch(COPYCATS[i], parent, copycatDevs[i], "copycatDevs", take(scenario.copycatWaves[i]), "copycatBuyers");
  }

  // The hype is over: everybody leaves in a random order (the bot first if it saw the top), then creators
  // cash out their fees.
  await wait(VEST);
  const botTurn = botLeavesFirst ? 0 : scenario.botExit;
  for (let k = 0; k <= scenario.exitOrder.length; k++) {
    if (k === botTurn) await botSells();
    if (k === scenario.exitOrder.length) break;
    const [who, token, group] = bags[scenario.exitOrder[k]];
    await sellAll(who, group, token);
  }
  for (const [who, group] of [[originalDev, "originalDev"], ...copycatDevs.map((d) => [d, "copycatDevs"]), [treasury, "protocol"]]) {
    const ethFees = await hub.feesOf(who, ethers.ZeroAddress);
    if (ethFees > 0n) {
      await hub.connect(who).claimFees(ethers.ZeroAddress);
      pnl[group] += toEth(ethFees);
    }
    if ((await hub.feesOf(who, original)) > 0n) {
      await hub.connect(who).claimFees(original);
      await sellAll(who, group, original);
    }
  }

  const result = { pnl, peakOriginalReserve: toEth(peakOriginalReserve) };
  await network.provider.send("evm_revert", [snapshot]);
  return result;
}

async function main() {
  const reports = [
    ["The bot sees the top and leaves first", true],
    ["Nobody knows where the top is: the bot leaves at a random moment", false],
  ];
  const runs = reports.map(() => ({ pvp: [], cc: [] }));
  for (let seed = 1; seed <= SEEDS; seed++) {
    const scenario = draw(seed);
    for (const [i, [, first]] of reports.entries())
      for (const world of ["pvp", "cc"]) runs[i][world].push(await play(world, scenario, first));
    process.stdout.write(".");
  }
  console.log("\n");

  const money = (x) => (x >= 0 ? "+" : "") + x.toFixed(2);
  const row = (label, a, b) => console.log(`${label.padEnd(24)}${String(a).padStart(14)}${String(b).padStart(17)}`);
  const retailIn = (ORIGINAL_BUYERS + COPYCATS.length * COPYCAT_BUYERS) * 0.8;
  console.log(`Mean result in ETH over ${SEEDS} scenarios (~${retailIn.toFixed(0)} ETH of retail money each)`);
  console.log(`community coin: opening ${OPEN}s, vesting ${VEST}s, spike share ${SPIKE / 100}%, lineage ${LINEAGE ? "on" : "off"}`);
  console.log(`both worlds: 1% fee per trade, ${PROTOCOL / 100}% of the trade to the protocol, the rest to the meme's creator`);

  for (const [i, [title]] of reports.entries()) {
    const mean = (world, f) => runs[i][world].reduce((a, r) => a + f(r), 0) / runs[i][world].length;
    console.log(`\n${title}\n`);
    row("", "today (pvp)", "community coin");
    for (const [g, label] of Object.entries(GROUPS))
      row(label, money(mean("pvp", (r) => r.pnl[g])), money(mean("cc", (r) => r.pnl[g])));
    const retail = (r) => r.pnl.originalBuyers + r.pnl.copycatBuyers;
    row("All retail", money(mean("pvp", retail)), money(mean("cc", retail)));
    const sum = (r) => Object.values(r.pnl).reduce((a, b) => a + b, 0);
    row("Sum (zero-sum check)", money(mean("pvp", sum)), money(mean("cc", sum)));
    const wins = (world) => `${runs[i][world].filter((r) => r.pnl.sniper > 0).length}/${SEEDS}`;
    row("Sniper profitable in", wins("pvp"), wins("cc"));
    const peak = (world) => mean(world, (r) => r.peakOriginalReserve).toFixed(2);
    row("Peak ETH behind PNUT", peak("pvp"), peak("cc"));
  }
  console.log();
  row("ETH pools for the meme", 1 + COPYCATS.length, LINEAGE ? 1 : 1 + COPYCATS.length);

  if (process.env.SIM_JSON) {
    const round = (x) => Math.round(x * 100) / 100;
    const json = {
      source: "scripts/simulate.js",
      seeds: SEEDS,
      params: { openSeconds: OPEN, vestSeconds: VEST, spikeShareBps: SPIKE, lineage: LINEAGE, protocolFeeBps: PROTOCOL },
      retailInEth: round(retailIn),
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
    writeFileSync(process.env.SIM_JSON, JSON.stringify(json, null, 2) + "\n");
    console.log(`wrote ${process.env.SIM_JSON}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
