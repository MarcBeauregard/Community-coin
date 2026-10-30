// The lobby indexer: follows lobbies on a cluster through its JSON-RPC, decodes the program's events from each
// transaction's logs and folds them (src/chain/indexer.js) into the race, the pledges and the founders, served as
// JSON for the app. In memory for now; a later step puts the same fold behind Postgres.
//
//   node web/lobbies/indexer.mjs --rpc https://api.devnet.solana.com --program <id> --lobby 412 [--lobby …] [--port 8787]
//   GET /lobbies/412  →  { lobby, ideas, pledges, founders, winner, finalized, launched, mint }

import http from "node:http";
import { Addresses, eventsFromLogs, PROGRAM_ID } from "./src/chain/wire.js";
import { emptyView, apply } from "./src/chain/indexer.js";

async function rpc(url, method, params) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

/** Follows the given lobbies. `poll()` reads every new transaction since the last poll, oldest first. */
export function createIndexer({ rpc: url, programId = PROGRAM_ID, lobbies, onEvents = null }) {
  const addresses = new Addresses(programId);
  const followed = new Map(lobbies.map((id) => [String(id), { address: addresses.lobby(id), view: emptyView(), last: null }]));
  async function pollOne(f) {
    // Newest first, in pages, down to the last signature already read.
    const fresh = [];
    let before;
    for (;;) {
      const page = await rpc(url, "getSignaturesForAddress", [f.address, { limit: 1000, before, until: f.last ?? undefined, commitment: "confirmed" }]);
      fresh.push(...page);
      if (page.length < 1000) break;
      before = page[page.length - 1].signature;
    }
    for (const s of fresh.reverse()) {
      if (!s.err) {
        const tx = await rpc(url, "getTransaction", [s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }]);
        // One transaction may touch several lobbies (or none): keep this lobby's events.
        const events = eventsFromLogs(tx?.meta?.logMessages);
        for (const e of events) if (e.lobby === f.address) apply(f.view, e);
        // Listeners get the whole transaction's events (a launch's `Launched` carries no lobby, only its mint).
        if (onEvents && events.some((e) => e.lobby === f.address)) onEvents(events);
      }
      f.last = s.signature;
    }
    return fresh.length;
  }
  return {
    async poll() {
      let n = 0;
      for (const f of followed.values()) n += await pollOne(f);
      return n;
    },
    view(id) { return followed.get(String(id))?.view ?? null; },
  };
}

/** A view as JSON: bigints as decimal strings, maps and sets as plain values. */
export function toJSON(view) {
  return JSON.parse(JSON.stringify({
    lobby: view.lobby, ideas: view.ideas, pledges: Object.fromEntries(view.pledges), founders: view.founders, winner: view.winner,
    finalized: view.finalized, launched: view.launched, mint: view.mint, refunded: [...view.refunded],
  }, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

export function serve(indexer, port) {
  return http.createServer((req, res) => {
    const m = /^\/lobbies\/(\d+)$/.exec(req.url);
    const view = m && indexer.view(m[1]);
    res.writeHead(view ? 200 : 404, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify(view ? toJSON(view) : { error: "unknown lobby" }));
  }).listen(port);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name, all = false) => {
    const values = process.argv.flatMap((a, i) => (a === `--${name}` ? [process.argv[i + 1]] : []));
    return all ? values : values[0];
  };
  const indexer = createIndexer({ rpc: arg("rpc"), programId: arg("program") ?? PROGRAM_ID, lobbies: arg("lobby", true) });
  const port = Number(arg("port") ?? 8787);
  serve(indexer, port);
  console.log(`indexing lobbies ${arg("lobby", true).join(", ")} on ${arg("rpc")}, serving on :${port}`);
  for (;;) {
    try {
      const n = await indexer.poll();
      if (n) console.log(`${new Date().toISOString()} ${n} transaction(s)`);
    } catch (e) {
      console.error(e.message);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}
