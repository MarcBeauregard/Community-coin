// The clan registry: a clan is born when a lobby's winner launches, and its members are the founders, the wallets
// whose winning pledge became their commitment to the opening. Built from the program's events only, so membership
// is exactly what the chain says. Step 5's clan channels check `isFounder` before letting anyone write.

export function createClans() {
  const clans = new Map(); // mint -> { mint, lobby, idea, name, symbol, pot, born, founders: Map(user -> { seq, amount }) }
  const names = new Map(); // mint -> { name, symbol } from Launched, which comes just before LobbyLaunched
  return {
    apply(events, at = Date.now()) {
      for (const e of events) {
        if (e.event === "Launched") names.set(e.mint, { name: e.name, symbol: e.symbol });
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
      return { mint: c.mint, lobby: c.lobby, name: c.name, symbol: c.symbol, pot: String(c.pot), born: c.born, founders };
    },
  };
}
