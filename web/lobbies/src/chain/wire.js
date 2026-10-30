// The lobby instructions' wire format: addresses (PDAs), instruction data and accounts, events, account layouts
// and error codes, as solana/programs/community-coin defines them. Wallet mode builds its transactions with it and
// the indexer reads the chain with it. web/lobbies/chain-check.mjs checks every byte against the Rust tests.

import { PublicKey, SystemProgram } from "@solana/web3.js";
import { symbolKey } from "../../../src/protocol.js";

export const PROGRAM_ID = "CommCoin11111111111111111111111111111111111";
export const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const SYSTEM = SystemProgram.programId.toBase58();
export const DEFAULT_KEY = PublicKey.default.toBase58();
export const NO_WINNER = 255;

// Anchor discriminators: sha256("global:<ix>"), ("account:<Name>"), ("event:<Name>"), first 8 bytes.
export const IX = {
  create_lobby: "74374a302833879b", propose_idea: "4d2b59c508c68343", pledge: "eb2f9cfe0058d48e", withdraw: "b712469c946da122",
  move_pledge: "4c2c5007184b833a", finalize: "ab3dda387f730cd9", launch_winner: "e3b596c4349a8926", void_winner: "e27a8e87f6ace064",
  refund: "0260b7fb3fd02e2e", claim_founder: "c191d74dd2d68700", return_bond: "94423e08ceb80a49",
};
export const ACCOUNT = { Lobby: "a7c2d9a35c5c6731", Idea: "59dc53d6fce4247b", Pledge: "a1c5792e634ba983" };

// Program errors in declaration order (code 6000 + index), then the framework's that lobby calls can hit.
export const ERRORS = [
  "MemeExists", "UnknownMeme", "InvalidSymbol", "InvalidName", "TooDeep", "OpeningClosed", "StillOpening", "AlreadySettled", "NothingToClaim",
  "ZeroAmount", "WrongAsset", "Slippage", "NotRoot", "CycleDetected", "VotingOpen", "VotingClosed", "QuorumNotReached", "ReserveTooSmall",
  "ReserveInvariant", "InvalidConfig", "BadLineage", "Unauthorized", "MathOverflow",
  "InvalidLobby", "LobbyNotOpen", "ProposalsClosed", "PledgesLocked", "StillPledging", "AlreadyFinalized", "NotFinalized", "TooManyIdeas",
  "OnAnotherIdea", "PledgeCap", "NotLaunchTime", "NoWinner", "AlreadyLaunched", "NotLaunched", "PledgeSettled", "NotTheWinner",
  "WinnerNoRefund", "BadIdeas", "TickerFree",
];
// An address that is already in use when `init` creates it (the system program's error 0), and an account that
// does not exist yet (Anchor's AccountNotInitialized).
export const FRAMEWORK = { AccountInUse: 0, AccountNotInitialized: 3012 };

export function errorCode(name) {
  if (name in FRAMEWORK) return FRAMEWORK[name];
  const i = ERRORS.indexOf(name);
  if (i < 0) throw new Error(`unknown error ${name}`);
  return 6000 + i;
}

export function errorName(code) {
  if (code >= 6000 && code < 6000 + ERRORS.length) return ERRORS[code - 6000];
  return Object.keys(FRAMEWORK).find((k) => FRAMEWORK[k] === code) ?? `Error ${code}`;
}

// What a person reads when a transaction fails.
export const ERROR_TEXT = {
  LobbyNotOpen: "The lobby is not open yet.", ProposalsClosed: "Proposals are closed.", PledgesLocked: "Pledges are locked.",
  OnAnotherIdea: "Your pledge is on another idea: move it instead.", PledgeCap: "That is above this lobby's pledge limit.",
  MemeExists: "This ticker already exists on the launchpad.", AccountInUse: "This ticker is already in the race.", ZeroAmount: "Enter an amount above zero.",
  TooManyIdeas: "This lobby is full.", PledgeSettled: "Already refunded or committed.", WinnerNoRefund: "A pledge on the winner becomes your founder allocation.",
};

// ------------------------------------------------------------------ addresses

const utf8 = (s) => new TextEncoder().encode(s);
const keyBytes = (symbol) => utf8(symbolKey(symbol));
const u64le = (n) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return b;
};

export class Addresses {
  constructor(programId = PROGRAM_ID) {
    this.program = new PublicKey(programId);
    this.cache = new Map();
  }
  pda(...seeds) {
    const id = seeds.map((s) => (typeof s === "string" ? s : Array.from(s).join(","))).join("|");
    if (!this.cache.has(id)) {
      const bytes = seeds.map((s) => (typeof s === "string" ? new PublicKey(s).toBytes() : s));
      this.cache.set(id, PublicKey.findProgramAddressSync(bytes, this.program)[0].toBase58());
    }
    return this.cache.get(id);
  }
  config() { return this.pda(utf8("config")); }
  authority() { return this.pda(utf8("authority")); }
  vault() { return this.pda(utf8("vault")); }
  lobby(id) { return this.pda(utf8("lobby"), u64le(id)); }
  idea(lobby, symbol) { return this.pda(utf8("idea"), lobby, keyBytes(symbol)); }
  pledge(lobby, user) { return this.pda(utf8("pledge"), lobby, user); }
  mint(symbol) { return this.pda(utf8("mint"), keyBytes(symbol)); }
  meme(mint) { return this.pda(utf8("meme"), mint); }
  commit(mint, user) { return this.pda(utf8("commit"), mint, user); }
}

// ------------------------------------------------------------------ instructions

class Writer {
  constructor() { this.parts = []; }
  raw(bytes) { this.parts.push(Uint8Array.from(bytes)); return this; }
  u8(n) { return this.raw([n]); }
  u64(n) { return this.raw(u64le(BigInt.asUintN(64, BigInt(n)))); }
  i64(n) { return this.raw(u64le(BigInt.asUintN(64, BigInt(n)))); }
  u32(n) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return this.raw(b); }
  bytes(b) { return this.u32(b.length).raw(b); }
  string(s) { return this.bytes(utf8(s)); }
  done() {
    const out = new Uint8Array(this.parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of this.parts) { out.set(p, o); o += p.length; }
    return out;
  }
}
const fromHex = (s) => Uint8Array.from(s.match(/../g), (b) => parseInt(b, 16));
export const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

// [address, isSigner, isWritable], in the order of the program's Accounts structs.
const signer = (k) => [k, true, true];
const w = (k) => [k, false, true];
const r = (k) => [k, false, false];

/**
 * The instruction for one lobby operation: `{ keys: [[address, isSigner, isWritable]], data: Uint8Array }`.
 * Amounts and times may be numbers or bigints. `mint` (claim_founder) is the lobby's launched mint.
 */
export function lobbyInstruction(addr, op, a) {
  const d = new Writer().raw(fromHex(IX[op]));
  const lobby = addr.lobby(a.id);
  switch (op) {
    case "create_lobby":
      return { keys: [signer(a.host), w(lobby), r(SYSTEM)],
        data: d.u64(a.id).i64(a.opensAt).i64(a.proposeSecs).i64(a.lockSecs).i64(a.length).u64(a.maxPledge).u64(a.bond).done() };
    case "propose_idea":
      return { keys: [signer(a.proposer), w(lobby), w(addr.idea(lobby, a.symbol)), r(addr.mint(a.symbol)), r(SYSTEM)],
        data: d.bytes(keyBytes(a.symbol)).string(a.name).string(a.symbol).string(a.uri ?? "").done() };
    case "pledge":
      return { keys: [signer(a.user), w(lobby), w(addr.idea(lobby, a.symbol)), w(addr.pledge(lobby, a.user)), r(SYSTEM)], data: d.u64(a.amount).done() };
    case "withdraw":
      return { keys: [signer(a.user), w(lobby), w(addr.idea(lobby, a.symbol)), w(addr.pledge(lobby, a.user))], data: d.u64(a.amount).done() };
    case "move_pledge":
      return { keys: [[a.user, true, false], r(lobby), w(addr.idea(lobby, a.from)), w(addr.idea(lobby, a.to)), w(addr.pledge(lobby, a.user))], data: d.done() };
    case "finalize":
      return { keys: [w(lobby), ...a.symbols.map((s) => r(addr.idea(lobby, s)))], data: d.done() };
    case "launch_winner": {
      const mint = addr.mint(a.symbol);
      return { keys: [signer(a.payer), w(addr.config()), r(addr.authority()), w(addr.vault()), w(lobby), r(addr.idea(lobby, a.symbol)), w(mint), w(addr.meme(mint)), r(TOKEN_2022), r(SYSTEM)], data: d.done() };
    }
    case "void_winner":
      return { keys: [w(lobby), r(addr.idea(lobby, a.symbol)), r(addr.mint(a.symbol))], data: d.done() };
    case "refund":
      return { keys: [w(lobby), w(addr.pledge(lobby, a.user)), w(a.user)], data: d.done() };
    case "claim_founder":
      return { keys: [signer(a.payer), r(lobby), w(addr.pledge(lobby, a.user)), w(addr.commit(a.mint, a.user)), r(SYSTEM)], data: d.done() };
    case "return_bond":
      return { keys: [w(lobby), w(addr.idea(lobby, a.symbol)), w(a.proposer)], data: d.done() };
    default:
      throw new Error(`unknown lobby instruction ${op}`);
  }
}

// ------------------------------------------------------------------ reading

class Reader {
  constructor(bytes, offset = 0) { this.b = bytes; this.o = offset; this.v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  u8() { return this.b[this.o++]; }
  bool() { return this.u8() === 1; }
  u32() { const x = this.v.getUint32(this.o, true); this.o += 4; return x; }
  u64() { const x = this.v.getBigUint64(this.o, true); this.o += 8; return x; }
  i64() { const x = this.v.getBigInt64(this.o, true); this.o += 8; return x; }
  key() { const k = new PublicKey(this.b.subarray(this.o, this.o + 32)).toBase58(); this.o += 32; return k; }
  bytes() { const n = this.u32(); const out = this.b.slice(this.o, this.o + n); this.o += n; return out; }
  string() { return new TextDecoder().decode(this.bytes()); }
}

const FIELDS = {
  LobbyCreated: [["lobby", "key"], ["id", "u64"], ["host", "key"], ["opens_at", "i64"], ["proposals_close", "i64"], ["lock_at", "i64"], ["launch_at", "i64"], ["max_pledge", "u64"], ["bond", "u64"]],
  IdeaProposed: [["lobby", "key"], ["index", "u8"], ["proposer", "key"], ["name", "string"], ["symbol", "string"]],
  Pledged: [["lobby", "key"], ["user", "key"], ["idea", "u8"], ["amount", "u64"], ["user_total", "u64"], ["idea_total", "u64"], ["lobby_total", "u64"]],
  Withdrawn: [["lobby", "key"], ["user", "key"], ["idea", "u8"], ["amount", "u64"], ["user_total", "u64"], ["idea_total", "u64"], ["lobby_total", "u64"]],
  PledgeMoved: [["lobby", "key"], ["user", "key"], ["from", "u8"], ["to", "u8"], ["amount", "u64"], ["from_total", "u64"], ["to_total", "u64"]],
  LobbyFinalized: [["lobby", "key"], ["winner", "u8"], ["pot", "u64"], ["total", "u64"]],
  WinnerVoided: [["lobby", "key"], ["idea", "u8"]],
  LobbyLaunched: [["lobby", "key"], ["mint", "key"], ["idea", "u8"], ["pot", "u64"], ["founders", "u32"]],
  PledgeRefunded: [["lobby", "key"], ["user", "key"], ["amount", "u64"]],
  FounderJoined: [["lobby", "key"], ["user", "key"], ["mint", "key"], ["amount", "u64"], ["seq", "u32"]],
  BondReturned: [["lobby", "key"], ["idea", "u8"], ["proposer", "key"], ["amount", "u64"]],
  Launched: [["mint", "key"], ["parent", "key"], ["creator", "key"], ["name", "string"], ["symbol", "string"]],
  Committed: [["mint", "key"], ["user", "key"], ["quote", "u64"]],
};
export const EVENT = {
  LobbyCreated: "6da91032a9f2ed41", IdeaProposed: "9662096d37181a16", Pledged: "629a44e318301a10", Withdrawn: "1459dfc6c27cdb0d",
  PledgeMoved: "0bf5fbf439f4bdac", LobbyFinalized: "8c19981cf961cdcb", WinnerVoided: "e16cb974cc298701", LobbyLaunched: "0bc57740fd2d2604",
  PledgeRefunded: "51813ab1cbe046bf", FounderJoined: "9c4a560f55ba5aed", BondReturned: "295596f7d296a076", Launched: "d17f1d9881d4bdb7",
  Committed: "469ea2561d6f8fe2",
};
const EVENT_BY_DISC = Object.fromEntries(Object.entries(EVENT).map(([n, d]) => [d, n]));

/** An event's bytes (discriminator + Borsh fields) as `{ event, ...fields }`, or null for an event this file does not know. */
export function decodeEvent(bytes) {
  const name = EVENT_BY_DISC[toHex(bytes.subarray(0, 8))];
  if (!name) return null;
  const rd = new Reader(bytes, 8);
  const out = { event: name };
  for (const [f, t] of FIELDS[name]) out[f] = rd[t]();
  return out;
}

/** The program's events in a transaction's logs ("Program data: <base64>" lines). */
export function eventsFromLogs(logs) {
  const out = [];
  for (const line of logs ?? []) {
    const m = /^Program data: (.+)$/.exec(line);
    if (!m) continue;
    const e = decodeEvent(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)));
    if (e) out.push(e);
  }
  return out;
}

function account(data, name) {
  const bytes = Uint8Array.from(data);
  if (toHex(bytes.subarray(0, 8)) !== ACCOUNT[name]) throw new Error(`not a ${name} account`);
  return new Reader(bytes, 8);
}

export function decodeLobby(data) {
  const r = account(data, "Lobby");
  return { id: r.u64(), host: r.key(), opens_at: r.i64(), proposals_close: r.i64(), lock_at: r.i64(), launch_at: r.i64(), max_pledge: r.u64(), bond: r.u64(),
    idea_count: r.u8(), pledgers: r.u32(), total: r.u64(), finalized: r.bool(), winner: r.u8(), launched: r.bool(), mint: r.key() };
}

export function decodeIdea(data) {
  const r = account(data, "Idea");
  return { lobby: r.key(), index: r.u8(), proposer: r.key(), key: new TextDecoder().decode(r.bytes()), name: r.string(), symbol: r.string(), uri: r.string(),
    pledged: r.u64(), backers: r.u32(), bond_returned: r.bool() };
}

export function decodePledge(data) {
  const r = account(data, "Pledge");
  return { lobby: r.key(), user: r.key(), seq: r.u32(), idea: r.u8(), amount: r.u64(), settled: r.bool() };
}
