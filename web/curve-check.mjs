// Checks web/src/curve.js against the contract on the seeded demo chain: every simulated trade, sale with a spike
// share and union must give exactly the amount the hub itself quotes or emits. Usage: node web/curve-check.mjs

import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rmSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, ".curve-check.bundle.mjs");

const check = String.raw`
import { LocalChain } from "./chain.js";
import { Hub } from "./hub.js";
import { seed, DEMO_ACCOUNTS } from "./seed.js";
import { readCurves, simulateTrade, simulateUnion } from "./curve.js";
import { parseEther } from "ethers";

export async function run() {
  const chain = await LocalChain.create(DEMO_ACCOUNTS);
  const hub = await Hub.deploy(chain, chain.accounts[0].address, [300, 3600, 5000, 259200]);
  const accountOf = (n) => chain.accounts.find((a) => a.name === n).address;
  await seed({ hub, accountOf, run: (a, fn, args, v) => hub.write(accountOf(a), fn, args, v), warp: async (s) => chain.warp(s) });
  const tokenOf = async (ticker) => hub.read("tokenOfKey", [await hub.read("symbolKey", [ticker])]);
  const tokens = [];
  for (let i = 0; i < Number(await hub.read("memeCount")); i++) tokens.push(await hub.read("allMemes", [i]));
  let checks = 0, bad = 0;
  const same = (what, quoted, simulated) => {
    checks++;
    if (quoted !== simulated) {
      bad++;
      console.log("MISMATCH " + what + ": contract " + quoted + ", simulation " + simulated);
    }
  };

  const curves = await readCurves(hub, tokens);
  const now = chain.now();
  for (const t of tokens) {
    const sym = await hub.token(t, "symbol");
    const lineage = [...(await hub.read("lineageOf", [t]))];
    const c = curves.get(t);
    if (!c.settled && BigInt(now) < c.openUntil) continue;
    for (const eth of ["0.001", "0.1", "1", "7"]) {
      const amount = parseEther(eth);
      same(sym + " buyEth " + eth, await hub.read("quoteBuyEth", [t, amount]), simulateTrade(curves, { side: "buy", viaParent: false, lineage, amount, spikeBps: 5000n, now }).out);
      if (lineage.length > 1)
        same(sym + " buy " + eth, await hub.read("quoteBuy", [t, amount]), simulateTrade(curves, { side: "buy", viaParent: true, lineage, amount, spikeBps: 5000n, now }).out);
    }
    const supply = await hub.read("circulatingSupply", [t]);
    for (const frac of [1n, 10n, 100n, 1000n]) {
      const amount = supply / frac;
      if (amount === 0n) continue;
      same(sym + " sellToEth 1/" + frac, await hub.read("quoteSellToEth", [t, amount]), simulateTrade(curves, { side: "sell", viaParent: false, lineage, amount, spikeBps: 5000n, now }).out);
      same(sym + " sell 1/" + frac, await hub.read("quoteSell", [t, amount]), simulateTrade(curves, { side: "sell", viaParent: true, lineage, amount, spikeBps: 5000n, now }).out);
    }
  }

  // A sale right after a buy runs above the reference price: the spike share must match too.
  const wif = await tokenOf("PNUTWIFHAT");
  const you = accountOf("You");
  await hub.write(you, "buyEth", [wif, 0n], parseEther("3"));
  const lin = [...(await hub.read("lineageOf", [wif]))];
  const bal = await hub.token(wif, "balanceOf", [you]);
  const spiky = simulateTrade(await readCurves(hub, tokens), { side: "sell", viaParent: false, lineage: lin, amount: bal, spikeBps: 5000n, now: chain.now() });
  if (!spiky.hops.some((h) => h.spike > 0n)) { checks++; bad++; console.log("MISMATCH: expected a spike share"); }
  same("spike sale", await hub.read("quoteSellToEth", [wif, bal]), spiky.out);

  // Union: PEANUT joins PNUT once more than half of PEANUT is locked and the vote is over.
  const peanut = await tokenOf("PEANUT"), pnut = await tokenOf("PNUT");
  await hub.write(you, "buyEth", [peanut, 0n], parseEther("3"));
  await hub.write(you, "lockUnion", [0, await hub.token(peanut, "balanceOf", [you])]);
  chain.warp(3 * 86400 + 60);
  const union = simulateUnion(await readCurves(hub, tokens), { meme: peanut, targetLineage: [pnut], now: chain.now() + 1 });
  const res = await hub.write(accountOf("Alice"), "executeUnion", [0, 0n]);
  const ev = res.events.find((e) => e.name === "UnionExecuted").args;
  same("union ethIn", ev.ethIn, union.ethIn);
  same("union targetIn", ev.targetIn, union.targetIn);
  same("union price after", await hub.read("priceOf", [peanut]), union.priceAfter);

  console.log(checks + " checks, " + bad + " mismatches");
  if (bad) process.exitCode = 1;
}
`;

buildSync({
  stdin: { contents: check, resolveDir: join(here, "src"), loader: "js" },
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: out,
  logLevel: "warning",
});
try {
  await (await import(out)).run();
} finally {
  rmSync(out, { force: true });
}
