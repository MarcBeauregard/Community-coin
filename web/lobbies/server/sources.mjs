// Where a room's race comes from. On a cluster: the indexer following the lobby program (chain/indexer.js through
// indexer.mjs). For development and tests: the demo lobby on the program's rules, with a crowd that keeps pledging.

import { createDemoLobby, WINDOWS, MAX_PLEDGE, BOND } from "../src/demo/lobby.js";
import { LobbyRules } from "../src/chain/rules.js";
import { createIndexer } from "../indexer.mjs";

const rows = (ideas) => ideas.map((d) => ({ index: d.index, symbol: d.symbol, name: d.name, proposer: d.proposer, pledged: d.pledged, backers: d.backers }));

/**
 * The demo lobby: every `everySec` seconds of lobby time a new wallet pledges on an idea, weighted by its pot. It is a
 * practice lobby: signed-in people pledge, withdraw, move and propose in it (on the program's rules, with practice
 * SOL), so their pledges count for everyone, survive a reload and settle at the launch like real ones.
 */
export function simulatedSource({ everySec = 3, random = Math.random } = {}) {
  const chain = createDemoLobby();
  let last = null;
  let n = 0;
  return {
    chain,
    practice: true,
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

export const clusterOf = (rpc) => (/devnet/.test(rpc) ? "devnet" : /testnet/.test(rpc) ? "testnet" : /mainnet|api\.solana\.com|helius|quiknode|alchemy/.test(rpc) ? "mainnet" : null);

/**
 * A real practice lobby: the program's rules, empty at the opening. No crowd and no seeded ideas: what is in it is
 * what people propose and pledge (practice SOL). `host`: the host's wallet address (the stage, removals).
 */
export function practiceSource({ id, host }) {
  const chain = new LobbyRules({ lobbyKey: `lobby-${id}`, mintOf: (key) => `mint-${key}`, isTaken: () => false });
  chain.apply("create_lobby", { host, id, opensAt: 0, ...WINDOWS, maxPledge: MAX_PLEDGE, bond: BOND }, 0);
  chain.seedCurve = [];
  return { chain, practice: true, host: () => chain.lobby.host, ideas: () => rows(chain.ideas), tick() {} };
}

/** A lobby on a cluster, through the indexer. `tick` polls at most every `pollMs`. */
export function chainSource({ rpc, programId, lobby, pollMs = 2000, now = () => Date.now() }) {
  const listeners = [];
  const indexer = createIndexer({ rpc, programId, lobbies: [lobby], onEvents: (events) => listeners.forEach((f) => f(events)) });
  let polledAt = 0;
  let polling = null;
  return {
    /** The cluster, for explorer links: "devnet", "testnet", "mainnet", or null (a local validator: no explorer). */
    cluster: clusterOf(rpc),
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
