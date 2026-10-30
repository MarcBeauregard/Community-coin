// Cross-check of the lobbies app's chain code against the Solana program.
//
//   cd solana && cargo test --test lobby_walk    writes solana/target/cross-check/lobby.json: a random walk through a
//                                                lobby's life, every step with the instructions sent, the result, the
//                                                events emitted and the lobby's state after it
//   node web/lobbies/chain-check.mjs             replays the walk and requires, step after step:
//     - src/chain/rules.js: the same result (success or the same error) and the same state, to the lamport
//     - src/chain/wire.js: the same instructions (accounts, signer and writable flags, data) built byte for byte,
//       the same events decoded from the program's bytes as the rules emitted, and the discriminators recomputed
//     - src/chain/indexer.js: the program's events folded give the same race, pledges and founders as the state

import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LobbyRules } from "./src/chain/rules.js";
import { Addresses, lobbyInstruction, decodeEvent, errorCode, toHex, IX, ACCOUNT, EVENT } from "./src/chain/wire.js";
import { fold, rankOf } from "./src/chain/indexer.js";
import { decodeLobby, decodeIdea, decodePledge, ACCOUNT as LAYOUT } from "./src/chain/wire.js";
import { createIndexer } from "./indexer.mjs";
import { LobbyClient, programError } from "./src/chain/client.js";
import http from "node:http";
import { PublicKey } from "@solana/web3.js";
import { symbolKey } from "../src/protocol.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const file = join(root, "solana/target/cross-check/lobby.json");
if (!existsSync(file)) {
  console.error("Run `cd solana && cargo test --test lobby_walk` first.");
  process.exit(1);
}
const walk = JSON.parse(readFileSync(file, "utf8"));
let failures = 0;
const fail = (m) => { failures++; console.error(`✗ ${m}`); };
/** JSON with bigints marked and object keys sorted, to compare values whatever order their fields were built in. */
const show = (x) =>
  JSON.stringify(x, (_, v) =>
    typeof v === "bigint" ? `${v}n` : v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v);
const same = (a, b) => show(a) === show(b);
const fromHex = (s) => Uint8Array.from(s.match(/../g) ?? [], (b) => parseInt(b, 16));

// Discriminators, recomputed.
const disc = (s) => createHash("sha256").update(s).digest().subarray(0, 8).toString("hex");
for (const [k, v] of Object.entries(IX)) if (disc(`global:${k}`) !== v) fail(`instruction discriminator ${k}`);
for (const [k, v] of Object.entries(ACCOUNT)) if (disc(`account:${k}`) !== v) fail(`account discriminator ${k}`);
for (const [k, v] of Object.entries(EVENT)) if (disc(`event:${k}`) !== v) fail(`event discriminator ${k}`);

const addr = new Addresses(walk.program);
const users = walk.users;
const lobbyKey = addr.lobby(walk.id);
const taken = new Set([symbolKey("PNUT")]); // launched on the launchpad before the walk
const rules = new LobbyRules({ lobbyKey, mintOf: (key) => addr.pda(new TextEncoder().encode("mint"), new TextEncoder().encode(key)), isTaken: (k) => taken.has(k) });

// The walk's steps as rules operations and instruction arguments.
function translate(op, a) {
  const u = (i) => users[i];
  switch (op) {
    case "create_lobby":
      return { host: u(a.user), id: a.id, opensAt: a.opens_at, proposeSecs: walk.propose, lockSecs: walk.lock, length: walk.length, maxPledge: a.max_pledge, bond: a.bond };
    case "propose": return { proposer: u(a.user), id: walk.id, symbol: a.symbol, name: `${a.symbol} coin`, uri: "" };
    case "pledge": case "withdraw": return { user: u(a.user), id: walk.id, symbol: a.symbol, amount: a.amount };
    case "move_pledge": return { user: u(a.user), id: walk.id, from: a.from, to: a.to };
    case "finalize": return { id: walk.id, symbols: a.symbols };
    case "launch_winner": return { payer: u(a.user), id: walk.id, symbol: a.symbol };
    case "refund": return { id: walk.id, user: u(a.of) };
    case "claim_founder": return { payer: u(a.user), id: walk.id, user: u(a.of), mint: rules.lobby.mint };
    case "return_bond": return { id: walk.id, symbol: a.symbol, proposer: rules.ideas.find((d) => d.key === symbolKey(a.symbol))?.proposer };
    default: throw new Error(op);
  }
}

const program = []; // every event the program emitted, decoded
let steps = 0, ixs = 0, events = 0;
for (const [n, step] of walk.steps.entries()) {
  const op = step.op === "propose" ? "propose_idea" : step.op;
  const args = translate(step.op, step.args);
  // Instructions first: built from the state before the step, as a wallet would.
  for (const tx of step.sent) {
    for (const ix of tx.instructions) {
      ixs++;
      let built;
      try { built = lobbyInstruction(addr, op, args); } catch (e) { fail(`step ${n} ${op}: cannot build (${e.message})`); continue; }
      if (toHex(built.data) !== ix.data) fail(`step ${n} ${op}: data ${toHex(built.data)} ≠ ${ix.data}`);
      if (!same(built.keys, ix.keys)) fail(`step ${n} ${op}: accounts\n  js   ${show(built.keys)}\n  rust ${show(ix.keys)}`);
    }
  }
  const r = rules.apply(op, args, step.time);
  const expected = step.result === "ok" ? "ok" : step.result;
  const got = r.ok ? "ok" : errorCode(r.error);
  if (got !== expected) fail(`step ${n} ${op} ${show(step.args)}: rules ${r.ok ? "ok" : r.error} (${got}), program ${expected}`);
  // Events: the program's bytes decoded must equal what the rules emitted.
  const decoded = step.sent.flatMap((t) => t.events.map((h) => decodeEvent(fromHex(h))));
  events += decoded.length;
  if (decoded.some((e) => !e)) fail(`step ${n}: an event did not decode`);
  if (!same(decoded, r.events)) fail(`step ${n} ${op}: events\n  program ${show(decoded)}\n  rules   ${show(r.events)}`);
  program.push(...decoded.filter(Boolean));
  // State after the step.
  const s = step.state;
  const l = rules.lobby;
  const mine = { total: Number(l.total), idea_count: l.idea_count, pledgers: l.pledgers, finalized: l.finalized, winner: l.winner, launched: l.launched, mint: l.mint };
  if (!same(mine, s.lobby)) fail(`step ${n} ${op}: lobby\n  rules   ${show(mine)}\n  program ${show(s.lobby)}`);
  const ideas = rules.ideas.map((d) => ({ symbol: d.symbol, index: d.index, pledged: Number(d.pledged), backers: d.backers, bond_returned: d.bond_returned }));
  if (!same(ideas, s.ideas)) fail(`step ${n} ${op}: ideas\n  rules   ${show(ideas)}\n  program ${show(s.ideas)}`);
  const pledges = [...rules.pledges.values()].map((p) => ({ user: users.indexOf(p.user), seq: p.seq, idea: p.idea, amount: Number(p.amount), settled: p.settled })).sort((a, b) => a.user - b.user);
  if (!same(pledges, s.pledges)) fail(`step ${n} ${op}: pledges\n  rules   ${show(pledges)}\n  program ${show(s.pledges)}`);
  if (Number(rules.balance) !== s.balance) fail(`step ${n} ${op}: balance ${rules.balance} ≠ ${s.balance}`);
  // The indexer, fed the program's events so far, sees the same race.
  const view = fold(program);
  const race = rules.ideas.map((d) => [Number(d.pledged), d.backers]);
  const seen = view.ideas.map((d) => [Number(d.pledged), d.backers]);
  if (!same(race, seen)) fail(`step ${n} ${op}: indexer race ${show(seen)} ≠ ${show(race)}`);
  steps++;
}

// Founders, as the indexer ranks them, are the winner's backers in first-pledge order.
const view = fold(program);
const winners = [...rules.pledges.values()].filter((p) => p.idea === rules.lobby.winner && p.amount > 0n).sort((a, b) => a.seq - b.seq);
if (!same(view.founders.map((f) => [f.user, f.rank]), winners.map((p) => [p.user, p.seq + 1]))) fail("indexer founders");
for (const p of winners) if (rankOf(view, p.user) !== p.seq + 1) fail(`rank of ${p.user}`);

// ------------------------------------------------------------------ account decoders

const kind = (hex) => Object.keys(LAYOUT).find((k) => hex.startsWith(LAYOUT[k]));
const strip = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => keys.includes(k)));
let decoded = 0;
for (const [key, a] of Object.entries(walk.accounts)) {
  const data = fromHex(a.data);
  const k = kind(a.data);
  if (k === "Lobby") {
    const l = decodeLobby(data);
    const want = rules.lobby;
    if (!same(strip(l, Object.keys(want)), strip({ ...want, id: BigInt(walk.id) }, Object.keys(l)))) fail(`decodeLobby\n  ${show(l)}\n  ${show(want)}`);
  } else if (k === "Idea") {
    const i = decodeIdea(data);
    const want = rules.ideas[i.index];
    if (!same(strip(i, ["index", "proposer", "key", "name", "symbol", "uri", "pledged", "backers", "bond_returned"]), strip(want, ["index", "proposer", "key", "name", "symbol", "uri", "pledged", "backers", "bond_returned"]))) fail(`decodeIdea ${show(i)}`);
  } else if (k === "Pledge") {
    const p = decodePledge(data);
    const want = rules.pledges.get(p.user);
    if (!same(strip(p, ["seq", "idea", "amount", "settled"]), strip(want, ["seq", "idea", "amount", "settled"]))) fail(`decodePledge ${show(p)}`);
  } else fail(`unknown account ${key}`);
  decoded++;
}

// ------------------------------------------------------------------ the indexer and the client, against a fake RPC
// The fake node answers from the walk: the program's real transactions (their events as "Program data" log lines)
// and its real accounts.

const sigs = walk.steps.flatMap((st, n) => (st.result === "ok" ? [{ signature: `sig${n}`, events: st.sent.flatMap((t) => t.events) }] : []));
const b64 = (hex) => Buffer.from(fromHex(hex)).toString("base64");
function answer(method, params) {
  switch (method) {
    case "getSignaturesForAddress": {
      if (params[0] !== lobbyKey) return [];
      const { limit = 1000, before, until } = params[1] ?? {};
      let list = sigs.slice().reverse();
      if (before) list = list.slice(list.findIndex((x) => x.signature === before) + 1);
      if (until) list = list.slice(0, list.findIndex((x) => x.signature === until));
      return list.slice(0, limit).map((x) => ({ signature: x.signature, err: null, slot: 1 }));
    }
    case "getTransaction": {
      const t = sigs.find((x) => x.signature === params[0]);
      return { slot: 1, meta: { err: null, logMessages: [`Program ${walk.program} invoke [1]`, ...t.events.map((e) => `Program data: ${b64(e)}`), `Program ${walk.program} success`] } };
    }
    case "getAccountInfo": {
      const a = walk.accounts[params[0]];
      return { context: { slot: 1 }, value: a ? { data: [b64(a.data), "base64"], executable: false, lamports: a.lamports, owner: a.owner, rentEpoch: 0, space: a.data.length / 2 } : null };
    }
    case "getProgramAccounts": {
      const want = params[1].filters[0].memcmp;
      const bytes = new PublicKey(want.bytes).toBytes();
      return Object.entries(walk.accounts)
        .filter(([, a]) => fromHex(a.data).subarray(want.offset, want.offset + 32).every((b, i) => b === bytes[i]))
        .map(([pubkey, a]) => ({ pubkey, account: { data: [b64(a.data), "base64"], executable: false, lamports: a.lamports, owner: a.owner, rentEpoch: 0, space: a.data.length / 2 } }));
    }
    default:
      throw new Error(`fake RPC: ${method}`);
  }
}
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const { id, method, params } = JSON.parse(body);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id, result: answer(method, params) }));
  });
});
await new Promise((r) => server.listen(0, r));
const rpcUrl = `http://localhost:${server.address().port}`;

const indexer = createIndexer({ rpc: rpcUrl, programId: walk.program, lobbies: [walk.id] });
const read = await indexer.poll();
const iv = indexer.view(walk.id);
if (read !== sigs.length) fail(`indexer read ${read} of ${sigs.length} transactions`);
if (!same(iv.ideas.map((d) => [d.symbol, d.pledged, d.backers]), rules.ideas.map((d) => [d.symbol, d.pledged, d.backers]))) fail("indexer race from the RPC");
if (iv.winner !== rules.lobby.winner || iv.mint !== rules.lobby.mint || !iv.launched) fail("indexer outcome from the RPC");
if (!same(iv.founders.map((f) => f.user), winners.map((p) => p.user))) fail("indexer founders from the RPC");
if ((await indexer.poll()) !== 0) fail("a second poll reads nothing new");

const client = new LobbyClient({ rpc: rpcUrl, programId: walk.program, wallet: { publicKey: new PublicKey(users[1]) } });
const cl = await client.lobby(walk.id);
if (!cl || cl.total !== rules.lobby.total || cl.winner !== rules.lobby.winner || cl.mint !== rules.lobby.mint) fail(`client lobby ${show(cl)}`);
const ci = await client.ideas(walk.id);
if (!same(ci.map((d) => [d.index, d.symbol, d.pledged, d.backers]), rules.ideas.map((d) => [d.index, d.symbol, d.pledged, d.backers]))) fail(`client ideas ${show(ci)}`);
const cp = await client.pledge(walk.id);
const rp = rules.pledges.get(users[1]);
if (!same(cp && [cp.idea, cp.amount, cp.settled, cp.seq], rp && [rp.idea, rp.amount, rp.settled, rp.seq])) fail(`client pledge ${show(cp)}`);
if (programError({ InstructionError: [0, { Custom: 6032 }] }) !== "PledgeCap" || programError({ InstructionError: [0, { Custom: 0 }] }) !== "AccountInUse") fail("client error names");
server.close();

if (failures) {
  console.error(`\n${failures} difference(s)`);
  process.exit(1);
}
console.log(`✓ lobby walk: ${steps} steps identical, ${ixs} instructions built byte for byte, ${events} events decoded and matched, ${view.founders.length} founders ranked`);
console.log(`✓ ${decoded} accounts decoded; indexer followed ${read} transactions over RPC; client read the lobby, ${ci.length} ideas and a pledge`);
