// Where a room's race comes from. On a cluster: the indexer following the lobby program (chain/indexer.js through
// indexer.mjs). For development and tests: the demo lobby on the program's rules, with a crowd that keeps pledging.

import { createDemoLobby } from "../src/demo/lobby.js";
import { createIndexer } from "../indexer.mjs";

const rows = (ideas) => ideas.map((d) => ({ index: d.index, symbol: d.symbol, name: d.name, pledged: d.pledged, backers: d.backers }));

/** The demo lobby: every `everySec` seconds of lobby time a new wallet pledges on an idea, weighted by its pot. */
export function simulatedSource({ everySec = 3, random = Math.random } = {}) {
  const chain = createDemoLobby();
  let last = null;
  let n = 0;
  return {
    chain,
    host: () => chain.lobby.host,
    ideas: () => rows(chain.ideas),
    tick(elapsed) {
      if (last === null) last = elapsed;
      while (elapsed - last >= everySec) {
        last += everySec;
        const total = chain.ideas.reduce((a, d) => a + Number(d.pledged), 0);
        let r = random() * total;
        const idea = chain.ideas.find((d) => (r -= Number(d.pledged)) <= 0) ?? chain.ideas[0];
        const amount = BigInt(Math.round((0.2 + random() * 2.2) * 10)) * 100_000_000n;
        chain.apply("pledge", { user: `live-${++n}`, symbol: idea.symbol, amount }, last);
      }
    },
  };
}

/** A lobby on a cluster, through the indexer. `tick` polls at most every `pollMs`. */
export function chainSource({ rpc, programId, lobby, pollMs = 2000, now = () => Date.now() }) {
  const listeners = [];
  const indexer = createIndexer({ rpc, programId, lobbies: [lobby], onEvents: (events) => listeners.forEach((f) => f(events)) });
  let polledAt = 0;
  let polling = null;
  return {
    ideas: () => rows((indexer.view(lobby)?.ideas ?? []).filter(Boolean)),
    host: () => indexer.view(lobby)?.lobby?.host ?? null,
    /** Every program event of the lobby's transactions, in order (the crank's, anyone else's). */
    onEvents: (f) => listeners.push(f),
    tick() {
      if (polling || now() - polledAt < pollMs) return;
      polledAt = now();
      polling = indexer.poll().catch(() => 0).finally(() => { polling = null; });
    },
    poll: () => indexer.poll(),
  };
}
