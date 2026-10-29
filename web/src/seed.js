// Example history for the demo chain: about two hours of a meme's life, replayed in a fraction of a second
// so that the page opens on a living market. Everything here goes through the real contracts.

import { ZeroAddress, parseEther } from "ethers";

export const DEMO_ACCOUNTS = ["You", "Alice", "Bob", "Chloe", "Dev Peanut", "Sniper bot"];

const STEPS = [
  ["Dev Peanut", "launch", ["Peanut the Squirrel", "PNUT", ZeroAddress], "0.5"],
  ["Alice", "commitEth", ["$PNUT", 0], "1.2"],
  ["Bob", "commitEth", ["$PNUT", 0], "0.8"],
  ["Sniper bot", "commitEth", ["$PNUT", 0], "2"],
  ["Chloe", "launch", ["Moo Deng", "MOODENG", ZeroAddress], "0.6"],
  ["Alice", "commitEth", ["$MOODENG", 0], "0.4"],
  { warp: 330 },
  ["Dev Peanut", "settle", ["$PNUT"]],
  ["Chloe", "buyEth", ["$PNUT", 0], "1.5"],
  ["Bob", "buyEth", ["$PNUT", 0], "0.4"],
  ["Bob", "buyEth", ["$MOODENG", 0], "0.9"],
  { warp: 900 },
  ["Sniper bot", "claim", ["$PNUT"]],
  ["Sniper bot", "sellToEth", ["$PNUT", "all", 0]],
  { warp: 1800 },
  ["Bob", "launch", ["Peanut wif hat", "PNUTWIFHAT", "$PNUT"], "0.3"],
  ["Chloe", "commitEth", ["$PNUTWIFHAT", 0], "0.6"],
  ["Alice", "commitEth", ["$PNUTWIFHAT", 0], "0.4"],
  ["Alice", "launch", ["Peanut (the real one)", "PEANUT", ZeroAddress], "0.4"],
  ["Bob", "commitEth", ["$PEANUT", 0], "0.3"],
  { warp: 330 },
  ["Dev Peanut", "buyEth", ["$PNUTWIFHAT", 0], "0.5"],
  ["Sniper bot", "buyEth", ["$PNUTWIFHAT", 0], "1"],
  ["Chloe", "buyEth", ["$PEANUT", 0], "0.6"],
  { warp: 600 },
  ["Sniper bot", "sellToEth", ["$PNUTWIFHAT", "all", 0]],
  ["Alice", "claim", ["$PEANUT"]],
  ["Alice", "proposeUnion", ["$PEANUT", "$PNUT"]],
  ["Alice", "lockUnion", [0, "all:$PEANUT"]],
  { warp: 3600 },
  ["Alice", "claim", ["$PNUT"]],
  ["Bob", "claim", ["$PNUT"]],
  ["Chloe", "claim", ["$PNUTWIFHAT"]],
  ["Alice", "sellToEth", ["$PNUT", "half", 0]],
  ["Dev Peanut", "launch", ["Baby Peanut", "BABYPNUT", "$PNUT"], "0.2"],
];

export const SEED_SPAN = STEPS.reduce((s, step) => s + (step.warp ?? 0), 0);

/**
 * Replays the steps. `$TICKER` stands for the token's address, "all" / "half" for a share of the actor's balance
 * of the token in the first argument, and "all:$TICKER" for the actor's whole balance of that token.
 */
export async function seed({ hub, accountOf, run, warp }) {
  const tokenOf = async (ticker) => hub.read("tokenOfKey", [await hub.read("symbolKey", [ticker])]);
  for (const step of STEPS) {
    if (step.warp) {
      await warp(step.warp);
      continue;
    }
    const [actor, fn, rawArgs, value] = step;
    const from = accountOf(actor);
    const args = [];
    for (const a of rawArgs) {
      if (typeof a === "string" && a.startsWith("$")) args.push(await tokenOf(a.slice(1)));
      else if (a === "all" || a === "half") {
        const balance = await hub.token(args[0], "balanceOf", [from]);
        args.push(a === "all" ? balance : balance / 2n);
      } else if (typeof a === "string" && a.startsWith("all:$")) {
        args.push(await hub.token(await tokenOf(a.slice(5)), "balanceOf", [from]));
      } else args.push(a);
    }
    await run(actor, fn, args, value ? parseEther(value) : 0n);
  }
}
