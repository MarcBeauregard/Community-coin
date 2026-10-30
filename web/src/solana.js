// The program's wire format: its addresses (PDAs), the layout of its accounts, its instructions with their
// accounts, its events and its error codes. Wallet mode reads the chain and builds transactions with it.
// web/wire-check.mjs checks every byte of it against the program: addresses, account data, instruction data and
// account lists as the Rust tests send them, and the events the program emits.

import { Buffer } from "buffer";
import { PublicKey, TransactionInstruction, SystemProgram } from "@solana/web3.js";
import { SOL, symbolKey } from "./protocol.js";

export const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ASSOCIATED_TOKEN = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const SYSTEM = SystemProgram.programId;
/** The program's address in solana/programs/community-coin (declare_id!); a deployment gives its own. */
export const PROGRAM_ID = "CommCoin11111111111111111111111111111111111";

const fromHex = (s) => Uint8Array.from(s.match(/../g), (b) => parseInt(b, 16));
export const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const utf8 = (s) => new TextEncoder().encode(s);

// Anchor discriminators: the first 8 bytes of sha256("global:<instruction>"), ("account:<Name>"), ("event:<Name>").
export const IX = {
  launch: "99f15de116454a3d", commit_sol: "459a54b8b840262b", commit: "df8c8ea5e5d09c4a", settle: "af2ab957908366d4",
  claim: "3ec6d6c1d59f6cd2", buy: "66063d1201daebea", buy_sol: "ce3b7d1ecaf86f31", sell: "33e685a4017f83ad",
  sell_to_sol: "1942d860ad7cb94e", claim_fees: "52fbe99c0c34b8ca", propose_union: "808e34be87df8a11",
  lock_union: "3ec8e1be95f6f3eb", unlock_union: "b5513be88fc8d3a1", execute_union: "7ad2bc8b1fae0596", initialize: "afaf6d1f0d989bed",
};
export const ACCOUNT = {
  Config: "9b0caae01efacc82", Vault: "d308e82b02987577", Meme: "e8e00093bbc2871a", Commitment: "3d70818018934d57",
  Union: "da1250ae890e2ecd", Lock: "08ff24cad2163989",
};
export const EVENT = {
  Launched: "d17f1d9881d4bdb7", Committed: "469ea2561d6f8fe2", Settled: "e8d228118e7c91ee", Claimed: "d9c07b486c96f821",
  Trade: "18feda98fd2b1251", FeesClaimed: "16686ede269d0e3e", UnionProposed: "663923bfb52a9252", UnionLocked: "e245ed63e3b7d799",
  UnionUnlocked: "7998b5f1344825c8", UnionExecuted: "e2623999c881025d",
};

/** CoinError, in order: the program's custom error 6000 + i. */
export const ERRORS = [
  "MemeExists", "UnknownMeme", "InvalidSymbol", "InvalidName", "TooDeep", "OpeningClosed", "StillOpening", "AlreadySettled",
  "NothingToClaim", "ZeroAmount", "WrongAsset", "Slippage", "NotRoot", "CycleDetected", "VotingOpen", "VotingClosed",
  "QuorumNotReached", "ReserveTooSmall", "ReserveInvariant", "InvalidConfig", "BadLineage", "Unauthorized", "MathOverflow",
];
const FRAMEWORK_ERRORS = { 3012: "AccountNotInitialized", 2006: "ConstraintSeeds", 2003: "ConstraintRaw", 2012: "ConstraintAddress" };

/** The name of the error a failed transaction carries, from its `InstructionError`, or null. */
export function errorName(err) {
  const custom = err?.InstructionError?.[1]?.Custom;
  if (custom === undefined) return null;
  if (custom >= 6000) return ERRORS[custom - 6000] ?? `Custom(${custom})`;
  if (FRAMEWORK_ERRORS[custom]) return FRAMEWORK_ERRORS[custom];
  return custom === 0 ? "AccountInUse" : custom === 1 ? "InsufficientFunds" : `Custom(${custom})`;
}

// ------------------------------------------------------------------ addresses

const DEFAULT_KEY = PublicKey.default.toBase58();
const u64le = (n) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return b;
};

/** Every address the program derives, cached: a PDA search hashes up to 255 times. */
export class Addresses {
  constructor(programId = PROGRAM_ID) {
    this.programId = new PublicKey(programId);
    this.cache = new Map();
  }
  _pda(label, seeds, program = this.programId) {
    const hit = this.cache.get(label);
    if (hit) return hit;
    const key = PublicKey.findProgramAddressSync(seeds, program)[0].toBase58();
    this.cache.set(label, key);
    return key;
  }
  config() {
    return this._pda("config", [utf8("config")]);
  }
  authority() {
    return this._pda("authority", [utf8("authority")]);
  }
  vault() {
    return this._pda("vault", [utf8("vault")]);
  }
  /** The mint of a ticker, from its normalized key (symbolKey): the reason a ticker can launch only once. */
  mint(key) {
    return this._pda(`mint:${key}`, [utf8("mint"), utf8(key)]);
  }
  meme(mint) {
    return this._pda(`meme:${mint}`, [utf8("meme"), new PublicKey(mint).toBytes()]);
  }
  commitment(mint, user) {
    return this._pda(`commit:${mint}:${user}`, [utf8("commit"), new PublicKey(mint).toBytes(), new PublicKey(user).toBytes()]);
  }
  union(id) {
    return this._pda(`union:${id}`, [utf8("union"), u64le(id)]);
  }
  lock(id, user) {
    return this._pda(`lock:${id}:${user}`, [utf8("lock"), u64le(id), new PublicKey(user).toBytes()]);
  }
  /** A wallet's associated token account for a Token-2022 mint. */
  ata(owner, mint) {
    return this._pda(`ata:${owner}:${mint}`, [new PublicKey(owner).toBytes(), TOKEN_2022.toBytes(), new PublicKey(mint).toBytes()], ASSOCIATED_TOKEN);
  }
}

// ------------------------------------------------------------------ Borsh

class Writer {
  constructor(discriminator) {
    this.parts = [fromHex(discriminator)];
  }
  bytes(b) {
    this.parts.push(b);
    return this;
  }
  u8(v) {
    return this.bytes(Uint8Array.of(v));
  }
  bool(v) {
    return this.u8(v ? 1 : 0);
  }
  u16(v) {
    return this.bytes(Uint8Array.of(v & 0xff, v >> 8));
  }
  u64(v) {
    return this.bytes(u64le(v));
  }
  i64(v) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigInt64(0, BigInt(v), true);
    return this.bytes(b);
  }
  vec(b) {
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, b.length, true);
    return this.bytes(len).bytes(b);
  }
  string(s) {
    return this.vec(utf8(s));
  }
  done() {
    const out = new Uint8Array(this.parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of this.parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}

class Reader {
  constructor(bytes, at = 0) {
    this.b = bytes;
    this.v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.at = at;
  }
  u8() {
    return this.b[this.at++];
  }
  bool() {
    return this.u8() !== 0;
  }
  u16() {
    const x = this.v.getUint16(this.at, true);
    this.at += 2;
    return x;
  }
  u64() {
    const x = this.v.getBigUint64(this.at, true);
    this.at += 8;
    return x;
  }
  i64() {
    const x = this.v.getBigInt64(this.at, true);
    this.at += 8;
    return Number(x);
  }
  u128() {
    const lo = this.u64(), hi = this.u64();
    return (hi << 64n) + lo;
  }
  pubkey() {
    const k = new PublicKey(this.b.subarray(this.at, this.at + 32)).toBase58();
    this.at += 32;
    return k;
  }
  /** A quote asset: the default key stands for SOL. */
  asset() {
    const k = this.pubkey();
    return k === DEFAULT_KEY ? SOL : k;
  }
  string() {
    const n = this.v.getUint32(this.at, true);
    this.at += 4;
    const s = new TextDecoder().decode(this.b.subarray(this.at, this.at + n));
    this.at += n;
    return s;
  }
}

// ------------------------------------------------------------------ accounts

function reader(data, name) {
  const bytes = data instanceof Uint8Array ? data : Uint8Array.from(data);
  if (toHex(bytes.subarray(0, 8)) !== ACCOUNT[name]) throw new Error(`not a ${name} account`);
  return new Reader(bytes, 8);
}

/** The hub's parameters, in the shape web/src/protocol.js takes them. */
export function decodeConfig(data) {
  const r = reader(data, "Config");
  return {
    openWindow: r.i64(), vestWindow: r.i64(), spikeShareBps: r.u16(), unionWindow: r.i64(), protocolFeeBps: r.u16(),
    feeRecipient: r.pubkey(), memeCount: r.u64(), unionCount: r.u64(),
  };
}

/** A meme, in the shape of web/src/protocol.js's state. */
export function decodeMeme(data) {
  const r = reader(data, "Meme");
  const m = {
    mint: r.pubkey(), parent: r.asset(), creator: r.pubkey(), index: Number(r.u64()), openUntil: r.i64(), settled: r.bool(),
    height: r.u8(), refTime: r.i64(), reference: r.u128(), vQuote: r.u128(), vToken: r.u128(), floor: r.u128(),
    batchQuote: r.u128(), batchTokens: r.u128(), batchClaimed: r.u128(), escrowed: r.u64(), creatorFees: r.u64(),
    protocolFees: r.u64(), name: r.string(), symbol: r.string(),
  };
  m.key = symbolKey(m.symbol);
  return m;
}

export function decodeCommitment(data) {
  const r = reader(data, "Commitment");
  return { committed: r.u64(), claimed: r.u64() };
}

export function decodeUnion(data) {
  const r = reader(data, "Union");
  return { id: Number(r.u64()), meme: r.pubkey(), target: r.pubkey(), deadline: r.i64(), executed: r.bool(), locked: r.u64() };
}

export function decodeLock(data) {
  return reader(data, "Lock").u64();
}

/** Token-2022 accounts start like SPL Token ones: a token account's amount at 64, a mint's supply at 36. */
export const tokenAmount = (data) => new Reader(Uint8Array.from(data), 64).u64();
export const mintSupply = (data) => new Reader(Uint8Array.from(data), 36).u64();

// ------------------------------------------------------------------ events

export const EVENT_FIELDS = {
  Launched: [["mint", "pubkey"], ["parent", "asset"], ["creator", "pubkey"], ["name", "string"], ["symbol", "string"]],
  Committed: [["mint", "pubkey"], ["user", "pubkey"], ["quote", "u64"]],
  Settled: [["mint", "pubkey"], ["quote", "u64"], ["tokens", "u64"]],
  Claimed: [["mint", "pubkey"], ["user", "pubkey"], ["amount", "u64"]],
  Trade: [["mint", "pubkey"], ["trader", "pubkey"], ["isBuy", "bool"], ["quoteAmount", "u64"], ["tokenAmount", "u64"], ["fee", "u64"], ["protocolFee", "u64"], ["spikeShare", "u64"]],
  FeesClaimed: [["owner", "pubkey"], ["meme", "pubkey"], ["asset", "asset"], ["amount", "u64"]],
  UnionProposed: [["id", "id"], ["meme", "pubkey"], ["target", "pubkey"], ["deadline", "i64"]],
  UnionLocked: [["id", "id"], ["voter", "pubkey"], ["amount", "u64"]],
  UnionUnlocked: [["id", "id"], ["voter", "pubkey"], ["amount", "u64"]],
  UnionExecuted: [["id", "id"], ["meme", "pubkey"], ["target", "pubkey"], ["solIn", "u64"], ["targetIn", "u64"]],
};
const EVENT_BY_DISCRIMINATOR = Object.fromEntries(Object.entries(EVENT).map(([name, d]) => [d, name]));

/** One event from its bytes (discriminator and Borsh fields), in the shape web/src/protocol.js emits; null if unknown. */
export function decodeEvent(bytes) {
  const name = EVENT_BY_DISCRIMINATOR[toHex(bytes.subarray(0, 8))];
  if (!name) return null;
  const r = new Reader(bytes, 8);
  const args = {};
  for (const [field, type] of EVENT_FIELDS[name]) args[field] = type === "id" ? Number(r.u64()) : r[type]();
  return { name, args };
}

/** The program's events in a transaction's logs: the "Program data: <base64>" lines it wrote. */
export function eventsFromLogs(logs, programId = PROGRAM_ID) {
  const events = [];
  const stack = [];
  for (const line of logs ?? []) {
    const invoke = line.match(/^Program (\w+) invoke \[\d+\]$/);
    if (invoke) stack.push(invoke[1]);
    else if (/^Program \w+ (success|failed)/.test(line)) stack.pop();
    else if (line.startsWith("Program data: ") && stack.at(-1) === programId) {
      const bin = atob(line.slice("Program data: ".length));
      const e = decodeEvent(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
      if (e) events.push(e);
    }
  }
  return events;
}

// ------------------------------------------------------------------ instructions

const meta = (pubkey, isSigner, isWritable) => ({ pubkey: new PublicKey(pubkey), isSigner, isWritable });

/**
 * Sets the hub's parameters, once, right after the program is deployed (solana/scripts/initialize.mjs). `params`:
 * openWindow, vestWindow, unionWindow (seconds), spikeShareBps, protocolFeeBps, feeRecipient (address).
 */
export function initializeInstruction(addresses, payer, p) {
  const A = addresses;
  return new TransactionInstruction({
    programId: A.programId,
    keys: [meta(payer, true, true), meta(A.config(), false, true), meta(A.authority(), false, false), meta(A.vault(), false, true), meta(SYSTEM, false, false)],
    data: Buffer.from(new Writer(IX.initialize).i64(p.openWindow).i64(p.vestWindow).u16(p.spikeShareBps).i64(p.unionWindow).u16(p.protocolFeeBps)
      .bytes(new PublicKey(p.feeRecipient).toBytes()).done()),
  });
}

/**
 * The instructions of one hub operation, as the Rust tests send them: an optional creation of the signer's account
 * for the parent token, then the program's instruction. `op` and the amounts are those of web/src/protocol.js
 * (base units, bigint); `engine` holds the hub's state, for lineages, parents and creators.
 */
export function instructionsFor(addresses, engine, signer, op, a) {
  const A = addresses, program = A.programId;
  const id = program.toBase58();
  const user = meta(signer, true, true);
  const config = (w) => meta(A.config(), false, w);
  const authority = meta(A.authority(), false, false);
  const vault = meta(A.vault(), false, true);
  const memeOf = (mint, w = true) => meta(A.meme(mint), false, w);
  const tokenProgram = meta(TOKEN_2022, false, false);
  const ataProgram = meta(ASSOCIATED_TOKEN, false, false);
  const system = meta(SYSTEM, false, false);
  const none = meta(id, false, false); // an absent optional account
  const lineage = (mint, w = true) => engine.ancestors(mint).map((m) => memeOf(m.mint, w));
  const ix = (keys, data) => new TransactionInstruction({ programId: program, keys, data: Buffer.from(data) });
  const ensureAta = (owner, mint) =>
    new TransactionInstruction({
      programId: ASSOCIATED_TOKEN,
      keys: [meta(signer, true, true), meta(A.ata(owner, mint), false, true), meta(owner, false, false), meta(mint, false, false), system, tokenProgram],
      data: Buffer.from([1]),
    });
  const parentOf = (mint) => {
    const p = engine.meme(mint).parent;
    return p === SOL ? null : p;
  };
  const tradeSol = (mint) => [user, config(false), authority, vault, memeOf(mint), meta(mint, false, true), meta(A.ata(signer, mint), false, true), tokenProgram, ataProgram, system, ...lineage(mint)];

  switch (op) {
    case "launch": {
      const key = symbolKey(a.symbol);
      const mint = A.mint(key);
      const parent = a.parent && a.parent !== SOL ? a.parent : null;
      const ancestors = parent ? [...engine.ancestors(parent).map((m) => m.mint), parent] : [];
      return [ix(
        [user, config(true), authority, vault, meta(mint, false, true), memeOf(mint), meta(A.commitment(mint, signer), false, true), tokenProgram, system, ...ancestors.map((m) => memeOf(m))],
        new Writer(IX.launch).vec(utf8(key)).string(a.name).string(a.symbol).string(a.uri ?? "").u64(a.solIn ?? 0n).done(),
      )];
    }
    case "commitSol":
      return [ix(
        [user, config(false), vault, memeOf(a.mint), meta(A.commitment(a.mint, signer), false, true), system, ...lineage(a.mint)],
        new Writer(IX.commit_sol).u64(a.solIn).u64(a.minQuote ?? 0n).done(),
      )];
    case "commit": {
      const p = parentOf(a.mint);
      return [ix(
        [user, config(false), vault, memeOf(a.mint), meta(A.commitment(a.mint, signer), false, true),
          p ? meta(p, false, true) : none, p ? meta(A.ata(signer, p), false, true) : none, tokenProgram, system],
        new Writer(IX.commit).u64(a.amount).done(),
      )];
    }
    case "settle":
      return [ix([memeOf(a.mint)], new Writer(IX.settle).done())];
    case "claim":
      return [ix(
        [user, config(false), authority, memeOf(a.mint), meta(a.mint, false, true), meta(A.commitment(a.mint, signer), false, true),
          meta(A.ata(signer, a.mint), false, true), tokenProgram, ataProgram, system],
        new Writer(IX.claim).done(),
      )];
    case "buy":
    case "sell": {
      const p = parentOf(a.mint);
      const keys = [user, config(false), authority, vault, memeOf(a.mint), meta(a.mint, false, true), meta(A.ata(signer, a.mint), false, true),
        p ? meta(p, false, true) : none, p ? meta(A.ata(signer, p), false, true) : none, tokenProgram, ataProgram, system];
      const data = new Writer(op === "buy" ? IX.buy : IX.sell).u64(a.amount).u64(a.minOut ?? 0n).done();
      return [...(p ? [ensureAta(signer, p)] : []), ix(keys, data)];
    }
    case "buySol":
      return [ix(tradeSol(a.mint), new Writer(IX.buy_sol).u64(a.solIn).u64(a.minOut ?? 0n).done())];
    case "sellToSol":
      return [ix(tradeSol(a.mint), new Writer(IX.sell_to_sol).u64(a.amount).u64(a.minOut ?? 0n).done())];
    case "claimFees": {
      const p = parentOf(a.mint);
      const keys = [user, config(false), authority, vault, memeOf(a.mint), p ? meta(p, false, true) : none, p ? meta(A.ata(signer, p), false, true) : none, tokenProgram, system];
      return [...(p ? [ensureAta(signer, p)] : []), ix(keys, new Writer(IX.claim_fees).bool(a.protocol).done())];
    }
    case "proposeUnion":
      return [ix(
        [user, config(true), memeOf(a.meme), memeOf(a.target, false), meta(A.union(engine.state.unions.length), false, true), system, ...lineage(a.target, false)],
        new Writer(IX.propose_union).done(),
      )];
    case "lockUnion": {
      const u = engine.state.unions[a.id];
      return [ix(
        [user, meta(A.union(a.id), false, true), memeOf(u.meme), meta(u.meme, false, true), meta(A.ata(signer, u.meme), false, true), meta(A.lock(a.id, signer), false, true), tokenProgram, system],
        new Writer(IX.lock_union).u64(a.amount).done(),
      )];
    }
    case "unlockUnion": {
      const u = engine.state.unions[a.id];
      return [ix(
        [user, config(false), authority, meta(A.union(a.id), false, true), memeOf(u.meme), meta(u.meme, false, true), meta(A.ata(signer, u.meme), false, true),
          meta(A.lock(a.id, signer), false, true), tokenProgram, ataProgram, system],
        new Writer(IX.unlock_union).done(),
      )];
    }
    case "executeUnion": {
      const u = engine.state.unions[a.id];
      const m = engine.meme(u.meme);
      return [ix(
        [user, config(false), vault, meta(A.union(a.id), false, true), memeOf(u.meme), meta(u.meme, false, false), memeOf(u.target),
          meta(m.creator, false, true), meta(engine.config.feeRecipient, false, true), ...lineage(u.target)],
        new Writer(IX.execute_union).u64(a.minTargetIn ?? 0n).done(),
      )];
    }
    default:
      throw new Error(`unknown operation ${op}`);
  }
}
