// Sets the hub's parameters once the program is deployed, then writes the deployment into web/src/deployments.js
// so that the app offers "Connect wallet" on it.
//
//   node solana/scripts/initialize.mjs --fee-recipient <address> [--cluster devnet] [--keypair <file>]
//        [--program <address>] [--open 300] [--vest 3600] [--spike 5000] [--vote 259200] [--protocol 20]
//
// --fee-recipient receives the protocol's 0.2% (out of the 1% fee); --protocol 0 takes nothing. The keypair only
// pays the rent of the hub's two accounts (about 0.003 SOL): it gets no power over the hub, and nothing can change
// these parameters afterwards, not even it.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { Addresses, initializeInstruction, decodeConfig } from "../../web/src/solana.js";
import { options, setup, deployment, root } from "./cli.mjs";

const o = options();
const s = setup(o);
const A = new Addresses(s.programId);
const program = await s.connection.getAccountInfo(new PublicKey(s.programId));
if (!program?.executable) throw new Error(`no program at ${s.programId} on ${s.name}: deploy it first (anchor deploy)`);

let info = await s.connection.getAccountInfo(new PublicKey(A.config()));
if (info) {
  console.log(`The hub on ${s.name} is already initialized; its parameters cannot change.`);
} else {
  if (!o["fee-recipient"] && s.cluster !== "localnet") throw new Error("pass --fee-recipient <address>: the account that receives the protocol fee");
  const params = {
    openWindow: Number(o.open ?? 300),
    vestWindow: Number(o.vest ?? 3600),
    spikeShareBps: Number(o.spike ?? 5000),
    unionWindow: Number(o.vote ?? 3 * 24 * 3600),
    protocolFeeBps: Number(o.protocol ?? 20),
    feeRecipient: o["fee-recipient"] ?? s.payer.publicKey.toBase58(),
  };
  const tx = new Transaction().add(initializeInstruction(A, s.payer.publicKey.toBase58(), params));
  const signature = await sendAndConfirmTransaction(s.connection, tx, [s.payer]);
  console.log(`Initialized: ${signature}`);
  info = await s.connection.getAccountInfo(new PublicKey(A.config()));
}
const c = decodeConfig(info.data);
console.log(`Program        ${s.programId} on ${s.name}
Opening        ${c.openWindow} s
Vesting        ${c.vestWindow} s
Spike share    ${c.spikeShareBps / 100}%
Union vote     ${c.unionWindow} s
Protocol fee   ${c.protocolFeeBps / 100}% of each trade, out of the 1%, to ${c.feeRecipient}
Memes          ${c.memeCount}`);

const entry = deployment(s);
const file = join(root, "web/src/deployments.js");
writeFileSync(
  file,
  `// Where the program is deployed. The app offers "Connect wallet" only when there is an entry here.
// Written by solana/scripts/initialize.mjs.
export const DEPLOYMENTS = ${JSON.stringify({ [s.cluster]: entry }, null, 2)};
`,
);
console.log(`\nWrote ${file}: rebuild the app (npm run build:web) and publish it to offer wallet mode.`);
