// Scenarios: lists of steps, each an account doing one hub operation or the clock moving on, as in
// web/src/seed.json (the demo history, replayed when the demo opens) and solana/programs/community-coin/tests/
// scenarios/ (replayed by the cross-checks, here and in the Rust program).
//
// A step: { actor, op, ...arguments } or { warp: seconds }. Memes are named by the ticker they launched with;
// "sol" is in SOL, "lamports" in lamports; "amount" is "all" or "half" of the actor's balance of the meme,
// "all:TICKER" the whole balance of another meme, or a number of base units.

import { Engine, LAMPORTS, SOL } from "./protocol.js";

/** The start time of the Rust test harness: scenarios replayed for a cross-check start there. */
export const T0 = 1_800_000_000;

export function lamports(sol) {
  const [whole, frac = ""] = String(sol).split(".");
  return BigInt(whole) * LAMPORTS + BigInt((frac + "000000000").slice(0, 9));
}

/** How long a scenario's clock runs. */
export const span = (scenario) => scenario.steps.reduce((s, x) => s + (x.warp ?? 0), 0);

export class Scenario {
  /**
   * `idOf(name)` is the address an account signs with, `mintOf(key)` the mint of a ticker key; `start` the time
   * of the first step. Every account starts with `lamportsEach` SOL. With `engine`, the steps resolve against that
   * engine instead of a new one (the demo resolves its history against its own hub).
   */
  constructor(scenario, { idOf = (name) => name, mintOf, start = T0, engine } = {}) {
    this.scenario = scenario;
    this.names = scenario.accounts;
    this.ids = new Map(this.names.map((n) => [n, idOf(n)]));
    this.nameOf = new Map([...this.ids].map(([n, id]) => [id, n]));
    this.engine = engine;
    if (!engine) {
      const params = { ...scenario.params, feeRecipient: this.ids.get(scenario.params.feeRecipient) };
      this.engine = new Engine(params, mintOf ? { mintOf } : {});
      for (const id of this.ids.values()) this.engine.state.lamports.set(id, lamports(scenario.lamportsEach));
    }
    this.now = start;
  }

  /** The mint of the meme launched with this ticker. */
  mint(symbol) {
    if (!symbol) return SOL;
    for (const m of this.engine.state.memes.values()) if (m.symbol === symbol) return m.mint;
    return `unknown:${symbol}`;
  }

  _amount(id, spec, mint) {
    const e = this.engine;
    if (spec.startsWith("all:")) return e.balance(this.mint(spec.slice(4)), id);
    if (spec === "all") return e.balance(mint, id);
    if (spec === "half") return e.balance(mint, id) / 2n;
    return BigInt(spec);
  }

  /** A step as an instruction: its name, its signer and its arguments in base units, against the state now. */
  resolve(s) {
    const signer = this.ids.get(s.actor);
    if (signer === undefined) throw new Error(`unknown account ${s.actor}`);
    const mint = this.mint(s.meme ?? "");
    const sol = s.sol !== undefined ? lamports(s.sol) : BigInt(s.lamports ?? 0);
    const minOut = BigInt(s.minOut ?? 0);
    const amount = () => this._amount(signer, s.amount, mint);
    const args = {
      launch: () => ({ name: s.name, symbol: s.symbol, parent: s.parent ? this.mint(s.parent) : SOL, solIn: sol }),
      commitSol: () => ({ mint, solIn: sol }),
      commit: () => ({ mint, amount: amount() }),
      settle: () => ({ mint }),
      claim: () => ({ mint }),
      buySol: () => ({ mint, solIn: sol, minOut }),
      buy: () => ({ mint, amount: amount(), minOut }),
      sell: () => ({ mint, amount: amount(), minOut }),
      sellToSol: () => ({ mint, amount: amount(), minOut }),
      claimFees: () => ({ mint, protocol: !!s.protocol }),
      proposeUnion: () => ({ meme: mint, target: this.mint(s.target) }),
      lockUnion: () => ({ id: s.union, amount: this._amount(signer, s.amount, SOL) }),
      unlockUnion: () => ({ id: s.union }),
      executeUnion: () => ({ id: s.union }),
    }[s.op];
    if (!args) throw new Error(`unknown op ${s.op}`);
    return { op: s.op, signer, args: args() };
  }

  /** Runs a resolved step: its events, or the code of the error it failed with (nothing changed then). */
  apply({ op, signer, args }) {
    try {
      return { events: this.engine.exec(op, signer, args, this.now) };
    } catch (e) {
      if (!e.code) throw e;
      return { error: e.code };
    }
  }

  /** One step: null for the clock, else "ok" or the error's code. */
  step(s) {
    if (s.warp !== undefined) {
      this.now += s.warp;
      return null;
    }
    const r = this.apply(this.resolve(s));
    return r.error ?? "ok";
  }
}
