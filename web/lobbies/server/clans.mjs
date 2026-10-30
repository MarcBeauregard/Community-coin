// The clan registry: a clan is born when a lobby's winner launches, and its members are the founders, the wallets
// whose winning pledge became their commitment to the opening. Built from the program's events only, so membership
// is exactly what the chain says. The clan rooms (clan-room.mjs) check `isFounder` before letting anyone in.
// With a `store` (clan-room.mjs's fileStore) the events it was built from are kept, and replayed at start.

export function createClans({ store = null } = {}) {
  const clans = new Map(); // mint -> { mint, lobby, idea, name, symbol, pot, born, founders: Map(user -> { seq, amount }) }
  const names = new Map(); // mint -> { name, symbol, creator } from Launched, which comes just before LobbyLaunched
  const KEEP = new Set(["Launched", "LobbyLaunched", "FounderJoined"]);
  const registry = {
    apply(events, at = Date.now(), replay = false) {
      for (const e of events) {
        if (!KEEP.has(e.event)) continue;
        if (!replay) store?.append({ ...e, at, amount: e.amount === undefined ? undefined : String(e.amount), pot: e.pot === undefined ? undefined : String(e.pot) });
        if (e.event === "Launched") names.set(e.mint, { name: e.name, symbol: e.symbol, creator: e.creator });
        if (e.event === "LobbyLaunched") {
          clans.set(e.mint, { mint: e.mint, lobby: e.lobby, idea: e.idea, pot: e.pot, born: at, founders: new Map(), ...(names.get(e.mint) ?? {}) });
        }
        if (e.event === "FounderJoined") clans.get(e.mint)?.founders.set(e.user, { seq: e.seq, amount: e.amount });
      }
    },
    get: (mint) => clans.get(mint) ?? null,
    isFounder: (mint, user) => !!clans.get(mint)?.founders.has(user),
    list: () => [...clans.values()],
    /** A founder's number in the clan: 1 for the first wallet to back the winner, and so on in pledge order. */
    rankOf(mint, user) {
      const c = clans.get(mint);
      const me = c?.founders.get(user);
      if (!me) return null;
      let rank = 1;
      for (const f of c.founders.values()) if (f.seq < me.seq) rank++;
      return rank;
    },
    /** A clan as JSON: founders by rank, amounts in lamports as strings. */
    toJSON(mint) {
      const c = clans.get(mint);
      if (!c) return null;
      const founders = [...c.founders].sort((a, b) => a[1].seq - b[1].seq).map(([user, f], i) => ({ user, rank: i + 1, amount: String(f.amount) }));
      return { mint: c.mint, lobby: c.lobby, name: c.name, symbol: c.symbol, creator: c.creator, pot: String(c.pot), born: c.born, founders };
    },
  };
  // A registry kept on disk replays its events: the clans and their founders survive a restart.
  for (const r of store?.load() ?? []) registry.apply([{ ...r, amount: r.amount && BigInt(r.amount), pot: r.pot && BigInt(r.pot) }], r.at, true);
  return registry;
}
