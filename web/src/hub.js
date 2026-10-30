// Two ways to reach the hub, behind one small interface:
//
//   DemoHub    the program's rules replayed in the page (web/src/protocol.js, cross-checked step by step against
//              the Solana program), example accounts with play SOL, and a clock that runs in real time and can
//              jump forward.
//   WalletHub  the program on a Solana cluster, through Phantom or any wallet that injects the same provider. The
//              same engine, loaded with the accounts read from the chain, runs every transaction first: what the
//              program would refuse is explained before the wallet is asked, and the breakdowns are exact.
//
// Both expose: kind, label, accounts, params, engine, programAddress, now(), write(), refresh(), solBalance(); DemoHub
// alone warp(). Amounts here are base units (lamports, token units with 6 decimals); world.js converts for the screen.

import { Connection, PublicKey, Transaction, ComputeBudgetProgram } from "@solana/web3.js";
import { Engine, ProgramError } from "./protocol.js";
import {
  Addresses, PROGRAM_ID, ACCOUNT, SYSTEM, instructionsFor, eventsFromLogs, errorName, decodeConfig, decodeMeme, decodeUnion,
  decodeCommitment, decodeLock, tokenAmount, mintSupply,
} from "./solana.js";

const MESSAGES = {
  MemeExists: "This ticker is taken. Buy the original or launch a variant.",
  UnknownMeme: "This meme does not exist on this hub. Check you are on the right network.",
  InvalidSymbol: "Invalid ticker: use 1 to 16 letters or digits.",
  InvalidName: "The name must be 1 to 40 characters.",
  TooDeep: "Too deep: a family has 6 levels at most. Launch it as a variant of a meme higher up.",
  OpeningClosed: "The opening is over. Buy on the curve instead.",
  StillOpening: "The opening is still running. Commit to the auction or wait for it to close.",
  AlreadySettled: "The opening has already closed. Trade on the curve instead.",
  NothingToClaim: "Nothing to claim yet. Opening tokens unlock gradually: skip ahead or come back later.",
  ZeroAmount: "Enter an amount above zero.",
  Slippage: "The price moved more than 1% before your trade went through, so nothing happened. Try again.",
  NotRoot: "Only a root meme (priced in SOL) can join another family.",
  CycleDetected: "These two memes are already in the same family.",
  VotingOpen: "The vote is still open. The union executes after the deadline.",
  VotingClosed: "The vote is closed. Unlock your tokens, or execute the union if it reached a majority.",
  QuorumNotReached: "No majority yet: more than half of the circulating supply must be locked when the vote closes.",
  ReserveTooSmall: "The reserve is too small for a union: it needs at least 0.03 SOL.",
  Unauthorized: "Only the meme's creator, or the protocol's treasury, can withdraw these fees.",
  AccountNotInitialized: "Nothing to do here for this account yet.",
  InsufficientFunds: "Not enough tokens. Lower the amount or press Max.",
  InsufficientLamports: "Not enough SOL. Lower the amount.",
};

/** A sentence for whatever went wrong: the program's refusal, the wallet's, or the network's. */
export function explain(error) {
  if (error instanceof ProgramError) return MESSAGES[error.code] ?? "The program refused the transaction and nothing changed. Check the amount and try again.";
  if (error?.code === 4001 || /reject|declin|cancel/i.test(error?.message ?? "")) return "You declined in your wallet. Nothing was sent.";
  return error?.message ?? String(error);
}

const utf8 = (s) => new TextEncoder().encode(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ demo

export class DemoHub {
  /** `params.feeRecipient` names one of the accounts; `start` is the clock's time now, in seconds. */
  constructor({ names, lamportsEach, params, start = Math.floor(Date.now() / 1000), programId = PROGRAM_ID }) {
    this.kind = "local";
    this.label = "Demo";
    this.addresses = new Addresses(programId);
    this.programAddress = this.addresses.programId.toBase58();
    // Deterministic addresses derived from the names, shaped like any Solana account.
    this.accounts = names.map((name) => ({ name, address: PublicKey.findProgramAddressSync([utf8("demo"), utf8(name)], SYSTEM)[0].toBase58() }));
    this.params = { ...params, feeRecipient: this.idOf(params.feeRecipient) };
    this.engine = new Engine(this.params, { mintOf: (key) => this.addresses.mint(key) });
    for (const a of this.accounts) this.engine.state.lamports.set(a.address, lamportsEach);
    this.startWall = Date.now();
    this.startChain = start;
    this.offset = 0;
  }

  idOf(name) {
    return this.accounts.find((a) => a.name === name).address;
  }

  /** Seconds: follows the wall clock, plus every jump forward. */
  now() {
    return this.startChain + Math.floor((Date.now() - this.startWall) / 1000) + this.offset;
  }

  warp(seconds) {
    this.offset += seconds;
  }

  async refresh() {}

  async write(from, op, args) {
    const timestamp = this.now();
    return { events: this.engine.exec(op, from, args, timestamp), timestamp };
  }

  solBalance(address) {
    return this.engine.lamportsOf(address);
  }
}

// ------------------------------------------------------------------ wallet

/** Asks for many accounts at once, 100 per request (the RPC limit). */
async function accountsOf(connection, keys) {
  const out = [];
  for (let i = 0; i < keys.length; i += 100) out.push(...(await connection.getMultipleAccountsInfo(keys.slice(i, i + 100).map((k) => new PublicKey(k)))));
  return out;
}

const base64 = (hex) => btoa(String.fromCharCode(...hex.match(/../g).map((b) => parseInt(b, 16))));

export class WalletHub {
  /**
   * Connects to the injected wallet and reads the hub. `deployment`: { name, rpc, programId, cluster, explorer }
   * (see web/src/deployments.js).
   */
  static async connect(deployment) {
    const wallet = globalThis.phantom?.solana ?? globalThis.solana;
    if (!wallet) throw new Error("No Solana wallet found in this browser. Install Phantom, then connect again.");
    const res = await wallet.connect();
    const hub = new WalletHub(wallet, deployment, (res?.publicKey ?? wallet.publicKey).toBase58());
    await hub.refresh();
    return hub;
  }

  constructor(wallet, deployment, owner) {
    this.kind = "wallet";
    this.label = deployment.name;
    this.wallet = wallet;
    this.deployment = deployment;
    this.connection = new Connection(deployment.rpc, "confirmed");
    this.addresses = new Addresses(deployment.programId);
    this.programAddress = this.addresses.programId.toBase58();
    this.accounts = [{ name: "Wallet", address: owner }];
  }

  /** A link to a transaction or an account on the cluster's explorer. */
  link(kind, id) {
    const { explorer, cluster } = this.deployment;
    return explorer ? `${explorer}/${kind}/${id}${cluster ? `?cluster=${cluster}` : ""}` : undefined;
  }

  now() {
    return this.chainTime + Math.floor((Date.now() - this.fetchedAt) / 1000);
  }

  /** Reads the hub: its parameters, every meme and union, and what the connected wallet holds. */
  async refresh() {
    const c = this.connection, A = this.addresses, owner = this.accounts[0].address;
    const ofType = (name) => c.getProgramAccounts(A.programId, { filters: [{ memcmp: { offset: 0, bytes: base64(ACCOUNT[name]), encoding: "base64" } }] });
    const [configInfo, memeAccounts, unionAccounts, slot, vaultRent] = await Promise.all([
      c.getAccountInfo(new PublicKey(A.config())), ofType("Meme"), ofType("Union"), c.getSlot(), c.getMinimumBalanceForRentExemption(8),
    ]);
    if (!configInfo) throw new Error(`Community Coin is not set up on ${this.label} yet.`);
    const config = decodeConfig(configInfo.data);
    const memes = memeAccounts.map((a) => decodeMeme(a.account.data)).sort((a, b) => a.index - b.index);
    const unions = unionAccounts.map((a) => decodeUnion(a.account.data)).sort((a, b) => a.id - b.id);

    const keys = [owner, A.vault()];
    for (const m of memes) keys.push(m.mint, A.ata(owner, m.mint), A.commitment(m.mint, owner));
    for (const u of unions) keys.push(A.lock(u.id, owner));
    const infos = await accountsOf(c, keys);
    const info = new Map(keys.map((k, i) => [k, infos[i]]));

    const state = {
      memes: new Map(memes.map((m) => [m.mint, m])), order: memes.map((m) => m.mint), commitments: new Map(), unions,
      locks: new Map(), balances: new Map(), supply: new Map(), lamports: new Map(), vault: BigInt(info.get(A.vault())?.lamports ?? 0) - BigInt(vaultRent),
    };
    for (const m of memes) {
      const mint = info.get(m.mint), ata = info.get(A.ata(owner, m.mint)), commit = info.get(A.commitment(m.mint, owner));
      state.supply.set(m.mint, mint ? mintSupply(mint.data) : 0n);
      if (ata) state.balances.set(`${m.mint}|${owner}`, tokenAmount(ata.data));
      if (commit) state.commitments.set(`${m.mint}|${owner}`, decodeCommitment(commit.data));
    }
    for (const u of unions) {
      const lock = info.get(A.lock(u.id, owner));
      if (lock) state.locks.set(`${u.id}|${owner}`, decodeLock(lock.data));
    }
    this.lamports = BigInt(info.get(owner)?.lamports ?? 0);
    this.engine = new Engine(config, { external: true, state, mintOf: (key) => A.mint(key) });
    this.params = this.engine.config;
    this.chainTime = (await c.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
    this.fetchedAt = Date.now();
  }

  /**
   * Runs the operation on the engine first (a refusal is explained without bothering the wallet), then has the
   * wallet sign and send it, waits for it and returns the events the program logged. `hooks.onSent(signature)`
   * runs once the wallet has signed.
   */
  async write(from, op, args, hooks = {}) {
    const dry = this.engine.dryRun("exec", op, from, args, this.now());
    if (dry.error) throw dry.error;
    const c = this.connection;
    const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash();
    // Routed trades touch up to seven curves; the default budget of 200k compute units can be short.
    const tx = new Transaction({ feePayer: new PublicKey(from), blockhash, lastValidBlockHeight })
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }), ...instructionsFor(this.addresses, this.engine, from, op, args));
    const { signature } = await this.wallet.signAndSendTransaction(tx);
    hooks.onSent?.(signature);
    const status = await this.landed(signature, lastValidBlockHeight);
    if (status.err) throw errorName(status.err) ? new ProgramError(errorName(status.err)) : new Error("The network refused the transaction and nothing changed. Try again.");
    let done = null;
    for (let i = 0; i < 10 && !done; i++) {
      done = await c.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      if (!done) await sleep(500);
    }
    await this.refresh();
    return { events: eventsFromLogs(done?.meta?.logMessages, this.programAddress), timestamp: done?.blockTime ?? this.now(), hash: signature };
  }

  /** Waits until the transaction is confirmed or failed, by asking (no websocket); throws once its blockhash expired. */
  async landed(signature, lastValidBlockHeight) {
    const c = this.connection;
    for (;;) {
      const { value: [status] } = await c.getSignatureStatuses([signature]);
      if (status?.err || status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return status;
      if ((await c.getBlockHeight("confirmed")) > lastValidBlockHeight) throw new Error("The network dropped the transaction: nothing happened. Try again.");
      await sleep(800);
    }
  }

  solBalance() {
    return this.lamports;
  }
}

