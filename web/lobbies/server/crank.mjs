// The crank: what a lobby needs done once its time has come, which the program lets anyone do. At the lock,
// `finalize`; at launch time, `launch_winner`, then every refund, every founder's commitment and every bond.
// `planCrank` decides from the lobby's state what is due; an executor does it, on the demo's rules or on a cluster.
// Its events feed the room (the ceremony) and the clan registry (who the founders are).

import { Keypair, Transaction } from "@solana/web3.js";
import { Addresses, lobbyInstruction, eventsFromLogs } from "../src/chain/wire.js";
import { toInstruction, programError } from "../src/chain/client.js";
import { planCrank } from "../src/chain/crank.js";

export { NO_WINNER, planCrank, stateOfRules } from "../src/chain/crank.js";

/** Executes on the program's rules; returns the events. */
export function rulesExecutor(chain) {
  return async (ops, now) => ops.flatMap(({ op, args }) => chain.apply(op, args, now).events);
}

/**
 * Executes on a cluster with a funded keypair (`secretKey` bytes): one transaction per operation, the events read
 * back from its logs. A failure (someone cranked first) is skipped: every crank operation is idempotent.
 */
export function clusterExecutor({ connection, programId, secretKey, lobbyId, mintOf }) {
  const payer = Keypair.fromSecretKey(Uint8Array.from(secretKey));
  const addr = new Addresses(programId);
  return async (ops) => {
    const events = [];
    for (const { op, args } of ops) {
      const ix = lobbyInstruction(addr, op, { id: lobbyId, payer: payer.publicKey.toBase58(), mint: mintOf?.(), ...args });
      const tx = new Transaction().add(toInstruction(programId, ix));
      tx.feePayer = payer.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx.sign(payer);
      try {
        const sig = await connection.sendRawTransaction(tx.serialize());
        const done = await connection.confirmTransaction(sig);
        if (done.value.err) { console.error(`${op}: ${programError(done.value.err)}`); continue; }
        const sent = await connection.getTransaction(sig, { maxSupportedTransactionVersion: 0 });
        events.push(...eventsFromLogs(sent?.meta?.logMessages));
      } catch (e) {
        console.error(`${op}: ${e.message}`);
      }
    }
    return events;
  };
}

/** Runs the plan whenever it has something due; at most one run at a time. */
export function createCrank({ state, execute, onEvents }) {
  let running = false;
  return {
    async tick(now) {
      if (running) return;
      const ops = planCrank(state(), now);
      if (!ops.length) return;
      running = true;
      try {
        const events = await execute(ops, now);
        if (events.length) onEvents(events);
      } finally {
        running = false;
      }
    },
  };
}
