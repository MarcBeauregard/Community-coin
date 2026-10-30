// The demo's example history: about two hours of a meme market (web/src/seed.json), replayed through the hub in a
// fraction of a second when the demo opens, so that the page opens on a living market. The Rust cross-check
// replays the same file on the program and must end in the same state.

import SEED from "./seed.json";
import { Scenario, span, lamports } from "./scenario.js";

export const DEMO_ACCOUNTS = SEED.accounts;
/** The demo hub's parameters; its protocol fee (0.2% of every trade, out of the 1%) goes to the Treasury account. */
export const DEMO_PARAMS = SEED.params;
export const DEMO_LAMPORTS = lamports(SEED.lamportsEach);
export const SEED_SPAN = span(SEED);

/** Replays the history on `hub`: `run(signer, op, args)` sends each step, `warp(seconds)` moves the clock. */
export async function seed(hub, { run, warp }) {
  const scenario = new Scenario(SEED, { idOf: (name) => hub.idOf(name), engine: hub.engine });
  for (const step of SEED.steps) {
    if (step.warp !== undefined) {
      await warp(step.warp);
      continue;
    }
    const { op, signer, args } = scenario.resolve(step);
    await run(signer, op, args);
  }
}
