// What solana/scripts/*.mjs share: their options, the cluster, the paying keypair and the program's address.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { Connection, Keypair } from "@solana/web3.js";

export const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

export const CLUSTERS = {
  devnet: { name: "Solana Devnet", rpc: "https://api.devnet.solana.com" },
  testnet: { name: "Solana Testnet", rpc: "https://api.testnet.solana.com" },
  localnet: { name: "Local validator", rpc: "http://127.0.0.1:8899" },
  "mainnet-beta": { name: "Solana", rpc: "https://api.mainnet-beta.solana.com" },
};

/** --name value pairs, and bare --flags as true. */
export function options(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) throw new Error(`unexpected argument ${argv[i]}`);
    const key = argv[i].slice(2);
    out[key] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
  }
  return out;
}

const readKeypair = (path) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));

/** The cluster, the keypair that pays and signs, and the program's address, from the options. */
export function setup(o) {
  const cluster = o.cluster ?? "devnet";
  const known = CLUSTERS[cluster];
  if (!known && !o.rpc) throw new Error(`unknown cluster ${cluster}: use devnet, testnet, localnet or --rpc <url>`);
  if (cluster === "mainnet-beta" && !o["unaudited-ok"])
    throw new Error("The program is not audited. Refusing mainnet; pass --unaudited-ok if you really mean it.");
  const rpc = o.rpc ?? known.rpc;
  const keypairPath = o.keypair ?? join(os.homedir(), ".config/solana/id.json");
  if (!existsSync(keypairPath)) throw new Error(`no keypair at ${keypairPath}: create one with solana-keygen new, or pass --keypair <file>`);
  const programKeypair = join(root, "solana/target/deploy/community_coin-keypair.json");
  const programId = o.program ?? (existsSync(programKeypair) ? readKeypair(programKeypair).publicKey.toBase58() : null);
  if (!programId) throw new Error("program address unknown: run anchor build first, or pass --program <address>");
  return { cluster, name: known?.name ?? cluster, rpc, connection: new Connection(rpc, "confirmed"), payer: readKeypair(keypairPath), programId };
}

/** The entry web/src/deployments.js needs for wallet mode. */
export const deployment = ({ cluster, name, rpc, programId }) => ({
  name,
  ...(CLUSTERS[cluster] ? { cluster } : {}),
  rpc,
  programId,
  explorer: "https://explorer.solana.com",
});
