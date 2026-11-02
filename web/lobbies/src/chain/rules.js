// The lobby's rules, replayed in JavaScript exactly as the program applies them: same checks in the same order,
// same errors, same lamports, same events. The demo plays the hour on it, so every number the app shows is the
// program's; web/lobbies/chain-check.mjs replays the Rust walk on it and must find identical results and state.
// Amounts are lamports (bigint); addresses are base58 strings.

import { symbolKey } from "../../../src/protocol.js";

export const NO_WINNER = 255;
export const MAX_IDEAS = 16;
export const MAX_LOBBY_LENGTH = 4 * 3600;
export const LAMPORTS = 1_000_000_000n;
/** The program's MIN_PLEDGE (above a wallet's rent-exempt minimum, and the rent of what a pledge costs others) and MIN_BOND. */
export const MIN_PLEDGE = 10_000_000n;
/** How long before the lock the host can still remove an idea (the program's REMOVE_CUTOFF). */
export const REMOVE_CUTOFF = 300n;
export const MIN_BOND = 10_000_000n;

export class RuleError extends Error {
  constructor(name) {
    super(name);
    this.name = name;
  }
}
const require = (cond, name) => { if (!cond) throw new RuleError(name); };
const DEFAULT_KEY = "11111111111111111111111111111111";

function tryKey(symbol) {
  try { return symbolKey(symbol); } catch { return null; }
}

/**
 * One lobby. `env` gives what the lobby needs from outside it: `lobbyKey`, `mintOf(tickerKey)` (the launchpad
 * address of a ticker), `isTaken(tickerKey)` (whether that ticker is already a meme on the launchpad) and, optionally,
 * `isHeld(tickerKey, now)` (whether another lobby's race holds it).
 */
export class LobbyRules {
  constructor(env) {
    this.env = env;
    this.lobby = null; // the Lobby account, field names as the program's
    this.ideas = []; // by index
    this.pledges = new Map(); // user -> Pledge
    this.balance = 0n; // lamports above rent
    this.minted = new Set(); // tickers this lobby launched
  }

  idea(symbol) {
    const key = tryKey(symbol);
    const i = this.ideas.find((d) => d.key === key);
    if (!i) throw new RuleError("AccountNotInitialized");
    return i;
  }
  pledgeOf(user) {
    const p = this.pledges.get(user);
    // A closed pledge account is gone on chain; the rules keep it (marked) for the app's own reading.
    if (!p || p.closed) throw new RuleError("AccountNotInitialized");
    return p;
  }
  taken(key) {
    return this.minted.has(key) || this.env.isTaken(key);
  }

  create({ host, id, opensAt, proposeSecs, lockSecs, length, maxPledge, bond }) {
    require(!this.lobby, "AccountInUse");
    require(0 < proposeSecs && proposeSecs <= lockSecs && lockSecs <= length && length <= MAX_LOBBY_LENGTH, "InvalidLobby");
    require(BigInt(maxPledge) >= MIN_PLEDGE && BigInt(bond) >= MIN_BOND, "InvalidLobby");
    this.lobby = { id: BigInt(id), host, opens_at: BigInt(opensAt), proposals_close: BigInt(opensAt + proposeSecs), lock_at: BigInt(opensAt + lockSecs),
      launch_at: BigInt(opensAt + length), max_pledge: BigInt(maxPledge), bond: BigInt(bond), idea_count: 0, pledgers: 0, total: 0n,
      finalized: false, winner: NO_WINNER, launched: false, mint: DEFAULT_KEY };
    const l = this.lobby;
    return [{ event: "LobbyCreated", lobby: this.env.lobbyKey, id: l.id, host, opens_at: l.opens_at, proposals_close: l.proposals_close, lock_at: l.lock_at,
      launch_at: l.launch_at, max_pledge: l.max_pledge, bond: l.bond }];
  }

  propose({ proposer, symbol, name, uri = "" }, now) {
    const l = this.lobby;
    require(l, "AccountNotInitialized");
    const key = tryKey(symbol);
    require(!(key && this.ideas.some((d) => d.key === key)), "AccountInUse");
    require(key !== null, "InvalidSymbol");
    require(name.length > 0 && new TextEncoder().encode(name).length <= 40 && uri.length <= 200, "InvalidName");
    const t = BigInt(now);
    require(t >= l.opens_at, "LobbyNotOpen");
    require(t < l.proposals_close, "ProposalsClosed");
    require(l.idea_count < MAX_IDEAS, "TooManyIdeas");
    require(!this.taken(key), "MemeExists");
    // Another lobby racing this ticker holds it (the program's Hold account); `env.isHeld` answers for the others.
    require(!this.env.isHeld?.(key, t), "TickerHeld");
    this.balance += l.bond;
    const idea = { index: l.idea_count, proposer, key, name, symbol, uri, pledged: 0n, backers: 0, bond_returned: false, removed: false };
    this.ideas.push(idea);
    l.idea_count += 1;
    return [{ event: "IdeaProposed", lobby: this.env.lobbyKey, index: idea.index, proposer, name, symbol }];
  }

  pledge({ user, symbol, amount }, now) {
    const l = this.lobby;
    const i = this.idea(symbol);
    const a = BigInt(amount);
    const t = BigInt(now);
    require(a > 0n, "ZeroAmount");
    require(t >= l.opens_at, "LobbyNotOpen");
    require(t < l.lock_at, "PledgesLocked");
    require(!i.removed, "IdeaRemoved");
    const found = this.pledges.get(user);
    const existing = found && !found.closed ? found : null; // a closed account is made anew
    const current = existing ? existing.amount : 0n;
    require(current === 0n || existing.idea === i.index, "OnAnotherIdea");
    const userTotal = current + a;
    require(userTotal <= l.max_pledge, "PledgeCap");
    require(userTotal >= MIN_PLEDGE, "PledgeTooSmall");
    let p = existing;
    if (!p) {
      p = { user, seq: l.pledgers, idea: i.index, amount: 0n, settled: false };
      this.pledges.set(user, p);
      l.pledgers += 1;
    }
    if (p.amount === 0n) i.backers += 1;
    p.idea = i.index;
    p.amount = userTotal;
    i.pledged += a;
    l.total += a;
    this.balance += a;
    return [{ event: "Pledged", lobby: this.env.lobbyKey, user, idea: i.index, amount: a, user_total: userTotal, idea_total: i.pledged, lobby_total: l.total }];
  }

  withdraw({ user, symbol, amount }, now) {
    const l = this.lobby;
    const i = this.idea(symbol);
    const p = this.pledgeOf(user);
    const a = BigInt(amount);
    require(i.index === p.idea, "OnAnotherIdea");
    require(BigInt(now) < l.lock_at, "PledgesLocked");
    require(a > 0n && a <= p.amount, "ZeroAmount");
    require(p.amount - a === 0n || p.amount - a >= MIN_PLEDGE, "PledgeTooSmall");
    p.amount -= a;
    i.pledged -= a;
    l.total -= a;
    this.balance -= a;
    if (p.amount === 0n) i.backers -= 1;
    return [{ event: "Withdrawn", lobby: this.env.lobbyKey, user, idea: i.index, amount: a, user_total: p.amount, idea_total: i.pledged, lobby_total: l.total }];
  }

  move({ user, from, to }, now) {
    const l = this.lobby;
    const f = this.idea(from);
    const tIdea = this.idea(to);
    const p = this.pledgeOf(user);
    require(f.index === p.idea, "OnAnotherIdea");
    require(BigInt(now) < l.lock_at, "PledgesLocked");
    require(p.amount > 0n, "ZeroAmount");
    require(f.index !== tIdea.index, "OnAnotherIdea");
    require(!tIdea.removed, "IdeaRemoved");
    f.pledged -= p.amount;
    f.backers -= 1;
    tIdea.pledged += p.amount;
    tIdea.backers += 1;
    p.idea = tIdea.index;
    return [{ event: "PledgeMoved", lobby: this.env.lobbyKey, user, from: f.index, to: tIdea.index, amount: p.amount, from_total: f.pledged, to_total: tIdea.pledged }];
  }

  finalize({ symbols }, now) {
    const l = this.lobby;
    const passed = symbols.map((s) => this.idea(s));
    require(BigInt(now) >= l.lock_at, "StillPledging");
    require(!l.finalized, "AlreadyFinalized");
    require(passed.length === l.idea_count, "BadIdeas");
    let seen = 0;
    let best = NO_WINNER;
    let pot = 0n;
    for (const i of passed) {
      require(i.index < l.idea_count && (seen & (1 << i.index)) === 0, "BadIdeas");
      seen |= 1 << i.index;
      if (i.removed) continue; // taken out of the race by the host: it can't win
      if (i.pledged > pot || (i.pledged === pot && i.pledged > 0n && i.index < best)) {
        best = i.index;
        pot = i.pledged;
      }
    }
    l.finalized = true;
    l.winner = best;
    return [{ event: "LobbyFinalized", lobby: this.env.lobbyKey, winner: best, pot, total: l.total }];
  }

  launch({ symbol }, now) {
    const l = this.lobby;
    const i = this.idea(symbol);
    require(i.index === l.winner, "NotTheWinner");
    require(!this.taken(i.key), "AccountInUse");
    require(l.finalized, "NotFinalized");
    require(l.winner !== NO_WINNER, "NoWinner");
    require(!l.launched, "AlreadyLaunched");
    require(BigInt(now) >= l.launch_at, "NotLaunchTime");
    const mint = this.env.mintOf(i.key);
    this.minted.add(i.key);
    this.balance -= i.pledged;
    l.launched = true;
    l.mint = mint;
    return [
      { event: "Launched", mint, parent: DEFAULT_KEY, creator: i.proposer, name: i.name, symbol: i.symbol },
      { event: "LobbyLaunched", lobby: this.env.lobbyKey, mint, idea: i.index, pot: i.pledged, founders: i.backers },
    ];
  }

  voidWinner({ symbol }) {
    const l = this.lobby;
    const i = this.idea(symbol);
    require(i.index === l.winner, "NotTheWinner");
    require(l.finalized, "NotFinalized");
    require(l.winner !== NO_WINNER, "NoWinner");
    require(!l.launched, "AlreadyLaunched");
    require(this.taken(i.key), "TickerFree");
    l.winner = NO_WINNER;
    return [{ event: "WinnerVoided", lobby: this.env.lobbyKey, idea: i.index }];
  }

  refund({ user }) {
    const l = this.lobby;
    const p = this.pledgeOf(user);
    require(l.finalized, "NotFinalized");
    require(!p.settled, "PledgeSettled");
    if (p.amount === 0n) {
      // Withdrawn in full before the lock: the account just closes (its rent back), with an event of 0.
      p.settled = true;
      p.closed = true;
      return [{ event: "PledgeRefunded", lobby: this.env.lobbyKey, user, amount: 0n }];
    }
    require(l.winner === NO_WINNER || p.idea !== l.winner, "WinnerNoRefund");
    this.balance -= p.amount;
    p.settled = true;
    p.closed = true;
    return [{ event: "PledgeRefunded", lobby: this.env.lobbyKey, user, amount: p.amount }];
  }

  claimFounder({ user }) {
    const l = this.lobby;
    const p = this.pledgeOf(user);
    require(l.launched, "NotLaunched");
    require(!p.settled, "PledgeSettled");
    require(p.amount > 0n, "ZeroAmount");
    require(p.idea === l.winner, "NotTheWinner");
    p.settled = true;
    p.closed = true; // its rent pays for the commitment
    return [
      { event: "Committed", mint: l.mint, user, quote: p.amount },
      { event: "FounderJoined", lobby: this.env.lobbyKey, user, mint: l.mint, amount: p.amount, seq: p.seq },
    ];
  }

  returnBond({ symbol }) {
    const l = this.lobby;
    const i = this.idea(symbol);
    require(l.finalized, "NotFinalized");
    require(!i.bond_returned, "PledgeSettled");
    this.balance -= l.bond;
    i.bond_returned = true;
    return [{ event: "BondReturned", lobby: this.env.lobbyKey, idea: i.index, proposer: i.proposer, amount: l.bond }];
  }

  removeIdea({ host, symbol }, now) {
    const l = this.lobby;
    const i = this.idea(symbol);
    require(host === l.host, "HostOnly");
    require(BigInt(now) < l.lock_at - REMOVE_CUTOFF, "TooLateToRemove");
    require(!i.removed, "IdeaRemoved");
    i.removed = true;
    const events = [{ event: "IdeaRemoved", lobby: this.env.lobbyKey, idea: i.index }];
    if (!i.bond_returned) {
      this.balance -= l.bond;
      i.bond_returned = true;
      events.push({ event: "BondReturned", lobby: this.env.lobbyKey, idea: i.index, proposer: i.proposer, amount: l.bond });
    }
    return events;
  }

  refundRemoved({ user, symbol }) {
    const l = this.lobby;
    const i = this.idea(symbol);
    const p = this.pledgeOf(user);
    require(i.index === p.idea, "OnAnotherIdea");
    require(!l.finalized, "AlreadyFinalized");
    require(i.removed, "NotRemoved");
    require(!p.settled, "PledgeSettled");
    require(p.amount > 0n, "ZeroAmount");
    const a = p.amount;
    this.balance -= a;
    i.pledged -= a;
    i.backers -= 1;
    l.total -= a;
    p.settled = true;
    p.closed = true;
    return [{ event: "PledgeRefunded", lobby: this.env.lobbyKey, user, amount: a }];
  }

  /** Runs one operation; on failure nothing changes (as a failed transaction) and the error is returned. */
  apply(op, args, now) {
    const snapshot = structuredClone({ lobby: this.lobby, ideas: this.ideas, pledges: this.pledges, balance: this.balance, minted: this.minted });
    try {
      const fn = { create_lobby: "create", propose_idea: "propose", pledge: "pledge", withdraw: "withdraw", move_pledge: "move", finalize: "finalize",
        launch_winner: "launch", void_winner: "voidWinner", refund: "refund", claim_founder: "claimFounder", return_bond: "returnBond",
        remove_idea: "removeIdea", refund_removed: "refundRemoved" }[op];
      return { ok: true, events: this[fn](args, now) };
    } catch (e) {
      if (!(e instanceof RuleError)) throw e;
      Object.assign(this, snapshot);
      return { ok: false, error: e.message, events: [] };
    }
  }
}
