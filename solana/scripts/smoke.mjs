// Smoke test of a deployment, through the app's own wallet layer (web/src/hub.js) with the local keypair standing
// in for Phantom: launches a meme with a commit, waits for its opening to close, claims, buys and sells; with
// --variant, launches a variant through it and trades it through the lineage too. Prints what every step did and
// the compute units it used. Costs a few hundredths of a SOL on devnet and 6 minutes (12 with --variant).
//
//   node solana/scripts/smoke.mjs [--cluster devnet] [--keypair <file>] [--program <address>] [--variant]

import { LAMPORTS, SOL } from "../../web/src/protocol.js";
import { WalletHub } from "../../web/src/hub.js";
import { options, setup, deployment } from "./cli.mjs";

const o = options();
const s = setup(o);
const owner = s.payer.publicKey.toBase58();
const wallet = {
  async signAndSendTransaction(tx) {
    tx.sign(s.payer);
    return { signature: await s.connection.sendRawTransaction(tx.serialize()) };
  },
};
const hub = new WalletHub(wallet, deployment(s), owner);
await hub.refresh();
const balance = await s.connection.getBalance(s.payer.publicKey);
console.log(`${s.name}, program ${s.programId}, paying with ${owner} (${balance / 1e9} SOL)`);
if (BigInt(balance) < LAMPORTS / 10n) throw new Error("the keypair needs at least 0.1 SOL: solana airdrop 1 (devnet)");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sol = (x) => BigInt(Math.round(x * 1e9));
async function step(label, op, args) {
  const res = await hub.write(owner, op, args);
  const tx = await s.connection.getTransaction(res.hash, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  const events = res.events.map((e) => e.name).join(", ");
  console.log(`  ok  ${label.padEnd(46)} ${String(tx?.meta?.computeUnitsConsumed ?? "?").padStart(7)} CU  ${events}`);
  return res;
}
async function waitForClose(mint) {
  const m = hub.engine.meme(mint);
  const left = m.openUntil - hub.now() + 15;
  if (left > 0) {
    console.log(`      waiting ${left} s for ${m.symbol}'s opening to close…`);
    await sleep(left * 1000);
  }
  await hub.refresh();
}

const symbol = `SMK${Date.now().toString(36).toUpperCase().slice(-6)}`;
const launched = await step(`launch ${symbol}, commit 0.02 SOL`, "launch", { name: "Smoke test", symbol, parent: SOL, solIn: sol(0.02) });
const mint = launched.events[0].args.mint;
await waitForClose(mint);
await step("claim (settles the opening)", "claim", { mint });
await step("buy 0.01 SOL", "buySol", { mint, solIn: sol(0.01), minOut: 0n });
await step("sell everything to SOL", "sellToSol", { mint, amount: hub.engine.balance(mint, owner), minOut: 0n });

if (o.variant) {
  const v = `${symbol}V`;
  const child = await step(`launch ${v}, commit 0.01 SOL via ${symbol}`, "launch", { name: "Smoke variant", symbol: v, parent: mint, solIn: sol(0.01) });
  const vmint = child.events[0].args.mint;
  await waitForClose(vmint);
  await step("claim the variant", "claim", { mint: vmint });
  await step(`buy ${v} with 0.01 SOL (2 hops)`, "buySol", { mint: vmint, solIn: sol(0.01), minOut: 0n });
  await step(`sell ${v} into ${symbol}`, "sell", { mint: vmint, amount: hub.engine.balance(vmint, owner) / 2n, minOut: 0n });
  await step(`sell the rest of ${v} to SOL (2 hops)`, "sellToSol", { mint: vmint, amount: hub.engine.balance(vmint, owner), minOut: 0n });
  await step(`sell ${symbol} to SOL`, "sellToSol", { mint, amount: hub.engine.balance(mint, owner), minOut: 0n });
}
console.log(`\nThe deployment works. Balance now ${(await s.connection.getBalance(s.payer.publicKey)) / 1e9} SOL.`);
