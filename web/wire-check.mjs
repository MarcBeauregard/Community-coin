// Cross-check of web/src/solana.js, the wire format wallet mode speaks, against the Solana program.
//
//   cd solana && cargo test --test cross_check     also writes solana/target/cross-check/<scenario>.wire.json:
//                                                  every transaction the Rust tests sent (instructions, accounts,
//                                                  data), the events the program emitted, and the raw data of
//                                                  every account at the end
//   node web/wire-check.mjs                        replays the same scenarios on web/src/protocol.js with the real
//                                                  addresses and requires, for every step, the same instructions
//                                                  built by solana.js, the same events decoded by it, and at the
//                                                  end the same state decoded from the raw accounts
//
// Together with web/protocol-check.mjs (same state after every step), this covers what a wallet sends and reads.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { Scenario } from "./src/scenario.js";
import {
  Addresses, IX, ACCOUNT, EVENT, instructionsFor, initializeInstruction, decodeEvent, decodeConfig, decodeMeme, decodeCommitment, decodeUnion, decodeLock,
  tokenAmount, mintSupply, toHex, TOKEN_2022,
} from "./src/solana.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const scenarioDir = join(root, "solana/programs/community-coin/tests/scenarios");
const outDir = join(root, "solana/target/cross-check");
const fromHex = (s) => Uint8Array.from(s.match(/../g) ?? [], (b) => parseInt(b, 16));
/** JSON with bigints marked and object keys sorted, to compare values whatever order their fields were built in. */
const show = (x) =>
  JSON.stringify(x, (_, v) =>
    typeof v === "bigint" ? `${v}n` : v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v);

let failures = 0;
const fail = (msg) => {
  failures++;
  console.error(`✗ ${msg}`);
};

// The discriminators solana.js carries, recomputed.
const disc = (s) => createHash("sha256").update(s).digest().subarray(0, 8).toString("hex");
const snake = (s) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
for (const [name, d] of Object.entries(IX)) if (disc(`global:${snake(name)}`) !== d) fail(`instruction discriminator of ${name}`);
for (const [name, d] of Object.entries(ACCOUNT)) if (disc(`account:${name}`) !== d) fail(`account discriminator of ${name}`);
for (const [name, d] of Object.entries(EVENT)) if (disc(`event:${name}`) !== d) fail(`event discriminator of ${name}`);

function scenarios() {
  const out = [["demo", join(root, "web/src/seed.json")]];
  if (existsSync(scenarioDir)) for (const f of readdirSync(scenarioDir).filter((f) => f.endsWith(".json")).sort()) out.push([basename(f, ".json"), join(scenarioDir, f)]);
  return out;
}

const keysOf = (ix) => ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]);

for (const [name, file] of scenarios()) {
  const wireFile = join(outDir, `${name}.wire.json`);
  if (!existsSync(wireFile)) {
    fail(`${name}: ${wireFile} is missing; run: cd solana && cargo test --test cross_check`);
    continue;
  }
  const wire = JSON.parse(readFileSync(wireFile, "utf8"));
  const scenario = JSON.parse(readFileSync(file, "utf8"));
  const A = new Addresses(wire.programId);
  const r = new Scenario(scenario, { idOf: (n) => wire.accounts[n], mintOf: (key) => A.mint(key) });
  const keysOfWire = (ix) => ({ program: ix.program, keys: ix.keys, data: ix.data });
  const asWire = (ix) => ({ program: ix.programId.toBase58(), keys: keysOf(ix), data: toHex(ix.data) });
  const init = initializeInstruction(A, r.engine.config.feeRecipient, r.engine.config);
  if (show(asWire(init)) !== show(keysOfWire(wire.initialize[0].instructions[0]))) {
    fail(`${name}: the initialize instruction differs:\n  ${show(asWire(init))}\n  ${show(wire.initialize[0].instructions[0])}`);
    continue;
  }
  let i = 0, built = 0, events = 0, skipped = 0, bad = null;
  for (const s of scenario.steps) {
    if (s.warp !== undefined) {
      r.step(s);
      continue;
    }
    const step = r.resolve(s);
    const sent = wire.steps[i];
    if (sent?.length !== 1) {
      bad = `step ${i}: the program trace has ${sent?.length ?? 0} transactions`;
      break;
    }
    const [tx] = sent;
    let ixs = null;
    try {
      ixs = instructionsFor(A, r.engine, step.signer, step.op, step.args);
    } catch (e) {
      if (!e.code) throw e;
      skipped++; // an instruction the app never builds (an invalid ticker): the Rust test sent raw bytes
    }
    if (ixs) {
      const mine = ixs.map((ix) => ({ program: ix.programId.toBase58(), keys: keysOf(ix), data: toHex(ix.data) }));
      const theirs = tx.instructions.map((ix) => ({ program: ix.program, keys: ix.keys, data: ix.data }));
      if (show(mine) !== show(theirs)) {
        const k = mine.findIndex((x, j) => show(x) !== show(theirs[j]));
        const a = mine[k], b = theirs[k];
        const detail = !a || !b ? `${mine.length} instructions here, ${theirs.length} in the test`
          : a.data !== b.data ? `data ${a.data} here, ${b.data} in the test`
          : `accounts ${show(a.keys)} here,\n  ${show(b.keys)} in the test`;
        bad = `step ${i} ${show(s)}: instruction ${k}: ${detail}`;
        break;
      }
      built++;
    }
    const res = r.apply(step);
    if (!res.error) {
      const decoded = tx.events.map((h) => decodeEvent(fromHex(h)));
      if (show(decoded) !== show(res.events)) {
        bad = `step ${i} ${show(s)}: events\n  ${show(decoded)} from the program,\n  ${show(res.events)} from the engine`;
        break;
      }
      events += decoded.length;
    }
    i++;
  }
  if (bad) {
    fail(`${name}: ${bad}`);
    continue;
  }

  // Every account the program holds, decoded, against the engine's state.
  const e = r.engine, st = e.state;
  const owners = Object.values(wire.accounts);
  const expected = new Map();
  const expect = (address, what, value) => expected.set(address, { what, value });
  expect(A.config(), "Config", { ...e.config, memeCount: BigInt(st.order.length), unionCount: BigInt(st.unions.length) });
  for (const mint of st.order) {
    const m = st.memes.get(mint);
    expect(mint, "Mint", st.supply.get(mint) ?? 0n);
    expect(A.meme(mint), "Meme", Object.fromEntries(Object.keys(m).map((k) => [k, m[k]])));
    for (const o of owners) {
      const c = st.commitments.get(`${mint}|${o}`);
      if (c) expect(A.commitment(mint, o), "Commitment", c);
      if (st.balances.has(`${mint}|${o}`)) expect(A.ata(o, mint), "Token", e.balance(mint, o));
    }
  }
  for (const u of st.unions) {
    expect(A.union(u.id), "Union", u);
    for (const o of owners) if (st.locks.has(`${u.id}|${o}`)) expect(A.lock(u.id, o), "Lock", e.lock(u.id, o));
  }
  const decode = {
    Config: decodeConfig, Meme: decodeMeme, Commitment: decodeCommitment, Union: decodeUnion, Lock: decodeLock,
    Mint: mintSupply, Token: tokenAmount,
  };
  let accounts = 0;
  for (const [address, { what, value }] of expected) {
    const raw = wire.final[address];
    if (!raw) {
      // The engine keeps a zero balance for a wallet whose token account the program never had to create.
      if (what === "Token" && value === 0n) continue;
      bad = `${what} ${address} is missing on chain`;
      break;
    }
    if ((what === "Mint" || what === "Token") !== (raw.owner === TOKEN_2022.toBase58())) {
      bad = `${what} ${address} is owned by ${raw.owner}`;
      break;
    }
    const got = decode[what](fromHex(raw.data));
    const want = what === "Meme" ? Object.fromEntries(Object.keys(got).map((k) => [k, value[k]])) : value;
    if (show(got) !== show(want)) {
      bad = `${what} ${address}:\n  ${show(got)} decoded,\n  ${show(want)} in the engine`;
      break;
    }
    accounts++;
  }
  const vault = wire.final[A.vault()];
  const rent = (128n + BigInt(fromHex(vault.data).length)) * 6960n;
  if (!bad && BigInt(vault.lamports) - rent !== st.vault) bad = `vault: ${BigInt(vault.lamports) - rent} on chain, ${st.vault} in the engine`;
  if (bad) fail(`${name}: ${bad}`);
  else console.log(`✓ ${name}: ${built + 1} transactions built byte for byte${skipped ? ` (${skipped} invalid tickers left out)` : ""}, ${events} events decoded, ${accounts} accounts decoded`);
}

if (failures) process.exit(1);
