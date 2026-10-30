// A stand-in for a Solana cluster, for the wallet-mode test (web/e2e-wallet.mjs): the JSON-RPC methods the app
// calls, answered from web/src/protocol.js (the program's rules, cross-checked against the program) with every
// account laid out as the program lays it out, so that the decoders of web/src/solana.js (checked against the
// program) read it back. A transaction sent here is decoded instruction by instruction, its accounts are checked
// against those the program expects, and it is executed; its events come back in its logs as a validator writes
// them ("Program data: …"). Not a validator: no signatures, no rent, a fixed fee per transaction.

import { Transaction, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { randomBytes } from "node:crypto";
import { SOL } from "./src/protocol.js";
import {
  Addresses, IX, ACCOUNT, EVENT, EVENT_FIELDS, ERRORS, TOKEN_2022, ASSOCIATED_TOKEN, SYSTEM, instructionsFor, toHex,
  decodeConfig, decodeMeme, decodeUnion, decodeCommitment, decodeLock, tokenAmount, mintSupply,
} from "./src/solana.js";

const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const FEE = 5000n;
const rent = (len) => (128 + len) * 6960;
const fromHex = (s) => Uint8Array.from(s.match(/../g), (b) => parseInt(b, 16));

class Writer {
  constructor(discriminator) {
    this.parts = discriminator ? [fromHex(discriminator)] : [];
  }
  bytes(b) {
    this.parts.push(Uint8Array.from(b));
    return this;
  }
  int(v, size, signed = false) {
    const b = new Uint8Array(size);
    let x = BigInt(v);
    if (signed && x < 0n) x += 1n << BigInt(8 * size);
    for (let i = 0; i < size; i++, x >>= 8n) b[i] = Number(x & 0xffn);
    return this.bytes(b);
  }
  u8(v) { return this.int(v, 1); }
  u16(v) { return this.int(v, 2); }
  u64(v) { return this.int(v, 8); }
  id(v) { return this.int(v, 8); }
  i64(v) { return this.int(v, 8, true); }
  u128(v) { return this.int(v, 16); }
  bool(v) { return this.u8(v ? 1 : 0); }
  pubkey(k) { return this.bytes(new PublicKey(k).toBytes()); }
  asset(k) { return this.pubkey(k === SOL ? PublicKey.default : k); }
  string(s) {
    const b = new TextEncoder().encode(s);
    return this.int(b.length, 4).bytes(b);
  }
  done() {
    return Buffer.concat(this.parts.map((p) => Buffer.from(p)));
  }
}

class Reader {
  constructor(bytes) {
    this.b = Buffer.from(bytes);
    this.at = 8;
  }
  u64() {
    const x = this.b.readBigUInt64LE(this.at);
    this.at += 8;
    return x;
  }
  bool() {
    return this.b[this.at++] !== 0;
  }
  vec() {
    const n = this.b.readUInt32LE(this.at);
    this.at += 4 + n;
    return this.b.subarray(this.at - n, this.at);
  }
  string() {
    return new TextDecoder().decode(this.vec());
  }
}

// ------------------------------------------------------------------ accounts, as the program lays them out

export function encodeConfig(c, memeCount, unionCount) {
  return new Writer(ACCOUNT.Config).i64(c.openWindow).i64(c.vestWindow).u16(c.spikeShareBps).i64(c.unionWindow).u16(c.protocolFeeBps)
    .pubkey(c.feeRecipient).u64(memeCount).u64(unionCount).u8(255).u8(255).u8(255).done();
}
export function encodeMeme(m) {
  return new Writer(ACCOUNT.Meme).pubkey(m.mint).asset(m.parent).pubkey(m.creator).u64(m.index).i64(m.openUntil).bool(m.settled).u8(m.height)
    .i64(m.refTime).u128(m.reference).u128(m.vQuote).u128(m.vToken).u128(m.floor).u128(m.batchQuote).u128(m.batchTokens).u128(m.batchClaimed)
    .u64(m.escrowed).u64(m.creatorFees).u64(m.protocolFees).string(m.name).string(m.symbol).u8(255).done();
}
export const encodeCommitment = (c) => new Writer(ACCOUNT.Commitment).u64(c.committed).u64(c.claimed).done();
export const encodeUnion = (u) => new Writer(ACCOUNT.Union).u64(u.id).pubkey(u.meme).pubkey(u.target).i64(u.deadline).bool(u.executed).u64(u.locked).done();
export const encodeLock = (amount) => new Writer(ACCOUNT.Lock).u64(amount).done();
function encodeMint(supply) {
  const b = Buffer.alloc(234);
  b.writeBigUInt64LE(supply, 36);
  b[44] = 6; // decimals
  b[45] = 1; // initialized
  return b;
}
function encodeTokenAccount(mint, owner, amount) {
  const b = Buffer.alloc(170);
  b.set(new PublicKey(mint).toBytes(), 0);
  b.set(new PublicKey(owner).toBytes(), 32);
  b.writeBigUInt64LE(amount, 64);
  b[108] = 1; // initialized
  return b;
}
export function encodeEvent({ name, args }) {
  const w = new Writer(EVENT[name]);
  for (const [field, type] of EVENT_FIELDS[name]) w[type](args[field]);
  return w.done();
}

/** Every account of the hub and its wallets, by address: { owner, lamports, data }. */
function accountsOf(A, e) {
  const st = e.state, program = A.programId.toBase58(), out = new Map();
  const put = (address, owner, data, lamports = rent(data.length)) => out.set(address, { owner, lamports, data });
  put(A.config(), program, encodeConfig(e.config, st.order.length, st.unions.length));
  const vault = Buffer.from(fromHex(ACCOUNT.Vault));
  put(A.vault(), program, vault, rent(vault.length) + Number(st.vault));
  for (const mint of st.order) {
    const m = st.memes.get(mint);
    put(mint, TOKEN_2022.toBase58(), encodeMint(st.supply.get(mint) ?? 0n));
    put(A.meme(mint), program, encodeMeme(m));
  }
  for (const [k, c] of st.commitments) {
    const [mint, user] = k.split("|");
    put(A.commitment(mint, user), program, encodeCommitment(c));
  }
  for (const [k, amount] of st.balances) {
    const [mint, owner] = k.split("|");
    put(A.ata(owner, mint), TOKEN_2022.toBase58(), encodeTokenAccount(mint, owner, amount));
  }
  for (const u of st.unions) put(A.union(u.id), program, encodeUnion(u));
  for (const [k, amount] of st.locks) {
    const [id, user] = k.split("|");
    put(A.lock(Number(id), user), program, encodeLock(amount));
  }
  for (const [wallet, lamports] of st.lamports) put(wallet, SYSTEM.toBase58(), Buffer.alloc(0), Number(lamports));
  return out;
}

/** Encoding then decoding with web/src/solana.js gives back the engine's state, or this throws. */
export function selfCheck(A, e) {
  const st = e.state;
  const same = (what, a, b) => {
    const show = (x) => JSON.stringify(x, (_, v) => (typeof v === "bigint" ? `${v}n` : v));
    if (show(a) !== show(b)) throw new Error(`mock cluster: ${what} does not round-trip:\n${show(a)}\n${show(b)}`);
  };
  const all = accountsOf(A, e);
  const c = decodeConfig(all.get(A.config()).data);
  same("Config", c, { ...e.config, memeCount: BigInt(st.order.length), unionCount: BigInt(st.unions.length) });
  for (const mint of st.order) {
    const m = decodeMeme(all.get(A.meme(mint)).data), want = st.memes.get(mint);
    same(`Meme ${want.symbol}`, m, Object.fromEntries(Object.keys(m).map((k) => [k, want[k]])));
    same(`supply of ${want.symbol}`, mintSupply(all.get(mint).data), st.supply.get(mint) ?? 0n);
  }
  for (const [k, cm] of st.commitments) same(`Commitment ${k}`, decodeCommitment(all.get(A.commitment(...k.split("|"))).data), cm);
  for (const [k, amount] of st.balances) {
    const [mint, owner] = k.split("|");
    same(`balance ${k}`, tokenAmount(all.get(A.ata(owner, mint)).data), amount);
  }
  for (const u of st.unions) same(`Union ${u.id}`, decodeUnion(all.get(A.union(u.id)).data), u);
  for (const [k, amount] of st.locks) same(`Lock ${k}`, decodeLock(all.get(A.lock(Number(k.split("|")[0]), k.split("|")[1])).data), amount);
}

// ------------------------------------------------------------------ the cluster

const OPS = Object.fromEntries(Object.entries(IX).map(([name, d]) => [d, name.replace(/_(\w)/g, (_, c) => c.toUpperCase())]));

export class MockCluster {
  /** `engine`: the hub's state, with wallets' lamports tracked; `start`: its clock now. */
  constructor({ engine, addresses = new Addresses(), start = Math.floor(Date.now() / 1000) }) {
    this.engine = engine;
    this.A = addresses;
    this.startWall = Date.now();
    this.startChain = start;
    this.offset = 0;
    this.slot = 1000;
    this.txs = new Map(); // signature -> { slot, blockTime, err, logs, message }
    this.sent = []; // every transaction executed: { signature, ops, err }
    selfCheck(this.A, engine);
  }

  now() {
    return this.startChain + Math.floor((Date.now() - this.startWall) / 1000) + this.offset;
  }

  warp(seconds) {
    this.offset += seconds;
  }

  /** Which meme or union an instruction is about, from its accounts: what its arguments do not carry. */
  _args(op, keys, data) {
    const r = new Reader(data);
    const memeAt = (i) => [...this.engine.state.memes.values()].find((m) => this.A.meme(m.mint) === keys[i])?.mint;
    const unionAt = (i) => this.engine.state.unions.find((u) => this.A.union(u.id) === keys[i])?.id ?? this.engine.state.unions.length;
    switch (op) {
      case "launch": {
        r.vec();
        const name = r.string(), symbol = r.string(), uri = r.string(), solIn = r.u64();
        const parent = keys.length > 9 ? memeAt(keys.length - 1) : SOL;
        return { name, symbol, uri, parent, solIn };
      }
      case "commitSol": return { mint: memeAt(3), solIn: r.u64(), minQuote: r.u64() };
      case "commit": return { mint: memeAt(3), amount: r.u64() };
      case "settle": return { mint: memeAt(0) };
      case "claim": return { mint: memeAt(3) };
      case "buySol": return { mint: memeAt(4), solIn: r.u64(), minOut: r.u64() };
      case "buy": case "sell": case "sellToSol": return { mint: memeAt(4), amount: r.u64(), minOut: r.u64() };
      case "claimFees": return { mint: memeAt(4), protocol: r.bool() };
      case "proposeUnion": return { meme: memeAt(2), target: memeAt(3) };
      case "lockUnion": return { id: unionAt(1), amount: r.u64() };
      case "unlockUnion": return { id: unionAt(3) };
      case "executeUnion": return { id: unionAt(3), minTargetIn: r.u64() };
      default: throw new Error(`mock cluster: no instruction ${op}`);
    }
  }

  /** Executes a transaction (base64, as sendTransaction receives it) and returns its signature. */
  send(base64) {
    const tx = Transaction.from(Buffer.from(base64, "base64"));
    const payer = tx.feePayer.toBase58();
    const e = this.engine, now = this.now(), program = this.A.programId.toBase58();
    const saved = structuredClone(e.state);
    const logs = [], ops = [];
    let err = null;
    e.state.lamports.set(payer, (e.state.lamports.get(payer) ?? 0n) - FEE);
    tx.instructions.forEach((ix, index) => {
      if (err) return;
      const id = ix.programId.toBase58();
      logs.push(`Program ${id} invoke [1]`);
      const keys = ix.keys.map((k) => k.pubkey.toBase58());
      if (id === COMPUTE_BUDGET || id === ASSOCIATED_TOKEN.toBase58()) {
        if (id === ASSOCIATED_TOKEN.toBase58() && (ix.data[0] !== 1 || keys[0] !== payer)) throw new Error("mock cluster: unexpected associated token instruction");
        logs.push(`Program ${id} success`);
        return;
      }
      if (id !== program) throw new Error(`mock cluster: unexpected program ${id}`);
      const op = OPS[toHex(ix.data.subarray(0, 8))];
      const args = this._args(op, keys, ix.data);
      // The accounts must be exactly those the program expects for this operation.
      const expected = instructionsFor(this.A, e, payer, op, args).at(-1).keys.map((k) => k.pubkey.toBase58());
      if (expected.join() !== keys.join()) throw new Error(`mock cluster: ${op} sent with the wrong accounts:\n${keys.join()}\n${expected.join()}`);
      ops.push(op);
      try {
        for (const event of e.exec(op, payer, args, now)) logs.push(`Program data: ${encodeEvent(event).toString("base64")}`);
        logs.push(`Program ${id} success`);
      } catch (x) {
        if (!x.code) throw x;
        const code = ERRORS.includes(x.code) ? 6000 + ERRORS.indexOf(x.code) : x.code === "AccountNotInitialized" ? 3012 : 1;
        err = { InstructionError: [index, { Custom: code }] };
        logs.push(`Program log: AnchorError: ${x.code}`, `Program ${id} failed: custom program error: 0x${code.toString(16)}`);
      }
    });
    if (err) {
      e.state = saved;
      e.state.lamports.set(payer, (e.state.lamports.get(payer) ?? 0n) - FEE);
    }
    const signature = bs58.encode(randomBytes(64));
    this.slot += 1;
    this.txs.set(signature, { slot: this.slot, blockTime: now, err, logs, message: tx.compileMessage() });
    this.sent.push({ signature, ops, err });
    return signature;
  }

  /** Answers one JSON-RPC request. */
  rpc({ method, params = [] }) {
    const ctx = (value) => ({ context: { slot: this.slot }, value });
    const info = (a) => a && { data: [a.data.toString("base64"), "base64"], executable: false, lamports: a.lamports, owner: a.owner, rentEpoch: 0, space: a.data.length };
    switch (method) {
      case "getSlot":
      case "getBlockHeight":
        return this.slot;
      case "getBlockTime":
        return this.now();
      case "getMinimumBalanceForRentExemption":
        return rent(params[0]);
      case "getLatestBlockhash":
        return ctx({ blockhash: new PublicKey(randomBytes(32)).toBase58(), lastValidBlockHeight: this.slot + 150 });
      case "getAccountInfo":
        return ctx(info(accountsOf(this.A, this.engine).get(params[0])) ?? null);
      case "getMultipleAccounts": {
        const all = accountsOf(this.A, this.engine);
        return ctx(params[0].map((k) => info(all.get(k)) ?? null));
      }
      case "getBalance":
        return ctx(Number(this.engine.state.lamports.get(params[0]) ?? 0n));
      case "getProgramAccounts": {
        const owner = params[0], filters = params[1]?.filters ?? [];
        const match = (a) => filters.every((f) => {
          const want = Buffer.from(f.memcmp.bytes, f.memcmp.encoding === "base64" ? "base64" : undefined);
          return a.data.subarray(f.memcmp.offset, f.memcmp.offset + want.length).equals(want);
        });
        return [...accountsOf(this.A, this.engine)].filter(([, a]) => a.owner === owner && match(a)).map(([pubkey, a]) => ({ pubkey, account: info(a) }));
      }
      case "sendTransaction":
        return this.send(params[0]);
      case "getSignatureStatuses":
        return ctx(params[0].map((s) => {
          const t = this.txs.get(s);
          return t ? { slot: t.slot, confirmations: null, err: t.err, status: t.err ? { Err: t.err } : { Ok: null }, confirmationStatus: "confirmed" } : null;
        }));
      case "getTransaction": {
        const t = this.txs.get(params[0]);
        if (!t) return null;
        const m = t.message;
        return {
          slot: t.slot,
          blockTime: t.blockTime,
          version: "legacy",
          meta: {
            err: t.err, fee: Number(FEE), preBalances: m.accountKeys.map(() => 0), postBalances: m.accountKeys.map(() => 0), innerInstructions: [],
            logMessages: t.logs, preTokenBalances: [], postTokenBalances: [], rewards: [], loadedAddresses: { readonly: [], writable: [] },
            status: t.err ? { Err: t.err } : { Ok: null }, computeUnitsConsumed: 0,
          },
          transaction: {
            signatures: [params[0]],
            message: {
              accountKeys: m.accountKeys.map((k) => k.toBase58()),
              header: m.header,
              instructions: m.instructions.map((i) => ({ programIdIndex: i.programIdIndex, accounts: i.accounts, data: i.data })),
              recentBlockhash: m.recentBlockhash,
            },
          },
        };
      }
      default:
        throw new Error(`mock cluster: no RPC method ${method}`);
    }
  }
}
