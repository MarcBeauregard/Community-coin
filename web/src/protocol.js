// The Solana program's rules, replayed in the browser: solana/programs/community-coin rewritten in JavaScript with
// BigInt, instruction for instruction, with the same units (lamports, tokens with 6 decimals), the same integer
// steps and the same rounding. The demo runs entirely on it; in wallet mode the same engine is loaded with the
// accounts read from the chain to show, before you sign, exactly what a transaction will do.
// web/protocol-check.mjs replays the demo history here and in the Rust program and requires identical state.

export const LAMPORTS = 1_000_000_000n;
export const TOKEN = 1_000_000n; // 6 decimals
export const VIRTUAL_TOKENS = 1_000_000_000n * TOKEN;
export const ROOT_VIRTUAL_QUOTE = 30n * LAMPORTS;
export const CHILD_VIRTUAL_QUOTE = 1_000_000n * TOKEN;
export const FEE_BPS = 100n;
export const BPS = 10_000n;
export const MAX_PROTOCOL_FEE_BPS = 50;
export const REF_WINDOW = 3600n;
export const DUST_TOKENS = 1_000n;
export const PRICE_SCALE = 10n ** 18n;
export const MAX_DEPTH = 6;
export const MIN_UNION_RESERVE = 30_000_000n;
export const SOL = ""; // the quote asset of a root: no mint
const U128_MAX = (1n << 128n) - 1n;

export class ProgramError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const fail = (code) => {
  throw new ProgramError(code);
};
const require = (cond, code) => {
  if (!cond) fail(code);
};

// ------------------------------------------------------------------ math (math.rs)

export function mulDiv(a, b, c) {
  const r = (a * b) / c;
  require(r <= U128_MAX, "MathOverflow");
  return r;
}
export function mulDivCeil(a, b, c) {
  const r = (a * b + c - 1n) / c;
  require(r <= U128_MAX, "MathOverflow");
  return r;
}
export function sqrt(n) {
  if (n < 2n) return n;
  let x = n, y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}
export function buyOut(vQuote, vToken, quoteIn) {
  const nq = vQuote + quoteIn;
  const nt = mulDivCeil(vQuote, vToken, nq);
  return [vToken - nt, nq, nt];
}
export function sellOut(vQuote, vToken, tokensIn) {
  const nt = vToken + tokensIn;
  const nq = mulDivCeil(vQuote, vToken, nt);
  return [vQuote - nq, nq, nt];
}
export const spot = (vQuote, vToken) => mulDiv(vQuote, PRICE_SCALE, vToken);

function refNow(m, vQuote, vToken, now) {
  const s = spot(vQuote, vToken);
  if (!m.settled) return s;
  const elapsed = BigInt(now) - BigInt(m.refTime);
  if (elapsed >= REF_WINDOW) return s;
  return s > m.reference ? m.reference + mulDiv(s - m.reference, elapsed, REF_WINDOW) : m.reference - mulDiv(m.reference - s, elapsed, REF_WINDOW);
}
function resetRef(m, now) {
  m.reference = spot(m.vQuote, m.vToken);
  m.refTime = now;
}
function updateRef(m, now) {
  m.reference = refNow(m, m.vQuote, m.vToken, now);
  m.refTime = now;
}
function rescale(m, newReserve) {
  const reserve = m.vQuote - m.floor;
  const newFloor = mulDiv(m.floor, newReserve, reserve);
  m.reference = mulDiv(m.reference, newReserve, reserve);
  m.floor = newFloor;
  m.vQuote = newFloor + newReserve;
}
const nobodyLeft = (reserveAfter, vTokenAfter) => reserveAfter === 0n || VIRTUAL_TOKENS - vTokenAfter <= DUST_TOKENS;

function spikeShare(vQuote, vToken, reference, tokensIn, gross, spikeBps) {
  const s = spot(vQuote, vToken);
  if (reference === 0n || s <= reference) return 0n;
  const root = sqrt((s * PRICE_SCALE * PRICE_SCALE) / reference);
  const scaled = (vToken * root) / PRICE_SCALE;
  require(scaled <= U128_MAX, "MathOverflow");
  const aboveRef = scaled - vToken;
  if (tokensIn > aboveRef) {
    tokensIn = aboveRef;
    gross = sellOut(vQuote, vToken, aboveRef)[0];
  }
  const atRef = mulDiv(tokensIn, reference, PRICE_SCALE);
  return gross > atRef ? ((gross - atRef) * spikeBps) / BPS : 0n;
}

function settle(m, now) {
  require(!m.settled, "AlreadySettled");
  require(now >= m.openUntil, "StillOpening");
  m.settled = true;
  if (m.batchQuote > 0n) {
    const [out, vq, vt] = buyOut(m.vQuote, m.vToken, m.batchQuote);
    m.batchTokens = out;
    m.vQuote = vq;
    m.vToken = vt;
  }
  resetRef(m, now);
}
function tradable(m, now) {
  if (!m.settled) {
    settle(m, now);
    return true;
  }
  return false;
}
function takeFee(m, amount, protocolBps) {
  const fee = (amount * FEE_BPS) / BPS;
  const toProtocol = (amount * protocolBps) / BPS;
  m.protocolFees += toProtocol;
  m.creatorFees += fee - toProtocol;
  return [fee, toProtocol];
}
function buyHop(m, quoteIn, takeFees, protocolBps, now) {
  const settledNow = tradable(m, now);
  updateRef(m, now);
  const [fee, protocolFee] = takeFees ? takeFee(m, quoteIn, protocolBps) : [0n, 0n];
  const [out, vq, vt] = buyOut(m.vQuote, m.vToken, quoteIn - fee);
  m.vQuote = vq;
  m.vToken = vt;
  return { quoteAmount: quoteIn, tokenAmount: out, fee, protocolFee, spike: 0n, out, settledNow };
}
function sellHop(m, tokensIn, spikeBps, protocolBps, now) {
  const settledNow = tradable(m, now);
  updateRef(m, now);
  const [vQuote, vToken] = [m.vQuote, m.vToken];
  const [gross, nq, nt] = sellOut(vQuote, vToken, tokensIn);
  require(nq >= m.floor, "ReserveInvariant");
  m.vQuote = nq;
  m.vToken = nt;
  const [fee, protocolFee] = takeFee(m, gross, protocolBps);
  const reserve = m.vQuote - m.floor;
  const spike = nobodyLeft(reserve, m.vToken) ? 0n : spikeShare(vQuote, vToken, m.reference, tokensIn, gross, spikeBps);
  if (spike > 0n) rescale(m, reserve + spike);
  return { quoteAmount: gross, tokenAmount: tokensIn, fee, protocolFee, spike, out: gross - fee - spike, settledNow };
}
function vested(m, share, vestWindow, now) {
  if (share === 0n || m.batchQuote === 0n) return 0n;
  const total = mulDiv(m.batchTokens, share, m.batchQuote);
  const elapsed = BigInt(now) - BigInt(m.openUntil);
  return elapsed >= BigInt(vestWindow) ? total : mulDiv(total, elapsed, BigInt(vestWindow));
}

/** Canonical key of a ticker, as bytes in a string: "PNUT", "$pnut", "P.N.U.T" and "PNU7" are all "PNUT". */
export function symbolKey(symbol) {
  const raw = new TextEncoder().encode(String(symbol));
  require(raw.length > 0 && raw.length <= 32, "InvalidSymbol");
  const fold = { 48: 79, 49: 73, 51: 69, 52: 65, 53: 83, 55: 84 }; // 0 1 3 4 5 7 → O I E A S T
  let out = "";
  for (let c of raw) {
    if (c >= 97 && c <= 122) c -= 32;
    c = fold[c] ?? c;
    if ((c >= 65 && c <= 90) || (c >= 48 && c <= 57)) out += String.fromCharCode(c);
  }
  require(out.length > 0 && out.length <= 16, "InvalidSymbol");
  return out;
}

// ------------------------------------------------------------------ the engine (lib.rs)

const EMPTY = () => ({
  memes: new Map(), // mint -> Meme
  order: [], // mints in launch order
  commitments: new Map(), // `${mint}|${user}` -> { committed, claimed }
  unions: [], // Union, by id
  locks: new Map(), // `${id}|${user}` -> amount
  balances: new Map(), // `${mint}|${owner}` -> tokens in that wallet
  supply: new Map(), // mint -> supply
  lamports: new Map(), // wallet -> lamports (demo wallets only)
  vault: 0n, // lamports the hub owes, rent left out
});

/**
 * The hub. `mintOf(key)` gives the mint address of a normalized ticker (a PDA on chain; any unique string in tests).
 * Every instruction takes the signer, its arguments and the time, and returns the events it emitted; a failing
 * instruction changes nothing.
 */
export class Engine {
  /**
   * `external`: wallets live elsewhere (wallet mode): lamports are not tracked, only the hub's side of each
   * payment. Token balances of the wallets loaded into the state are still checked on burns.
   */
  constructor(config, { mintOf = (key) => `mint:${key}`, state, external = false } = {}) {
    const { openWindow, vestWindow, spikeShareBps, unionWindow, protocolFeeBps = 0, feeRecipient = "" } = config;
    require(BigInt(spikeShareBps) + FEE_BPS <= BPS, "InvalidConfig");
    require(protocolFeeBps <= MAX_PROTOCOL_FEE_BPS, "InvalidConfig");
    require(protocolFeeBps === 0 || feeRecipient, "InvalidConfig");
    this.config = { openWindow, vestWindow, spikeShareBps, unionWindow, protocolFeeBps, feeRecipient };
    this.mintOf = mintOf;
    this.external = external;
    this.state = state ?? EMPTY();
  }

  // -------------------------------------------------- plumbing

  /** Runs `fn` on the state; on failure the state is restored and the error rethrown. */
  run(fn) {
    const saved = structuredClone(this.state);
    const events = [];
    try {
      fn(events);
      return events;
    } catch (e) {
      this.state = saved;
      throw e;
    }
  }

  /** What an instruction would do, without doing it: its events, or the error it would fail with. */
  dryRun(method, ...args) {
    const saved = structuredClone(this.state);
    try {
      return { events: this[method](...args) };
    } catch (e) {
      return { error: e };
    } finally {
      this.state = saved;
    }
  }

  meme(mint) {
    const m = this.state.memes.get(mint);
    require(m, "UnknownMeme");
    return m;
  }
  /** The meme's ancestors, root first, ending with its parent. */
  ancestors(mint) {
    const out = [];
    for (let p = this.meme(mint).parent; p !== SOL; p = this.meme(p).parent) out.unshift(this.meme(p));
    return out;
  }
  balance(mint, owner) {
    return this.state.balances.get(`${mint}|${owner}`) ?? 0n;
  }
  lamportsOf(owner) {
    return this.state.lamports.get(owner) ?? 0n;
  }
  circulating(mint) {
    return (this.state.supply.get(mint) ?? 0n) + this.meme(mint).escrowed;
  }
  commitment(mint, user) {
    return this.state.commitments.get(`${mint}|${user}`) ?? { committed: 0n, claimed: 0n };
  }
  lock(id, user) {
    return this.state.locks.get(`${id}|${user}`) ?? 0n;
  }

  _mint(mint, owner, amount) {
    if (amount === 0n) return;
    const k = `${mint}|${owner}`;
    this.state.balances.set(k, (this.state.balances.get(k) ?? 0n) + amount);
    this.state.supply.set(mint, (this.state.supply.get(mint) ?? 0n) + amount);
  }
  _burn(mint, owner, amount) {
    const k = `${mint}|${owner}`;
    const bal = this.state.balances.get(k) ?? 0n;
    require(bal >= amount, "InsufficientFunds");
    this.state.balances.set(k, bal - amount);
    this.state.supply.set(mint, this.state.supply.get(mint) - amount);
  }
  _payIn(user, lamports) {
    if (!this.external) {
      const bal = this.lamportsOf(user);
      require(bal >= lamports, "InsufficientLamports");
      this.state.lamports.set(user, bal - lamports);
    }
    this.state.vault += lamports;
  }
  _payOut(to, lamports) {
    if (lamports === 0n) return;
    require(this.state.vault >= lamports, "ReserveInvariant");
    this.state.vault -= lamports;
    if (!this.external) this.state.lamports.set(to, this.lamportsOf(to) + lamports);
  }
  _trade(events, m, trader, isBuy, h) {
    events.push({ name: "Trade", args: { mint: m.mint, trader, isBuy, quoteAmount: h.quoteAmount, tokenAmount: h.tokenAmount, fee: h.fee, protocolFee: h.protocolFee, spikeShare: h.spike } });
  }
  _settledIf(events, m, h) {
    if (h.settledNow) events.push({ name: "Settled", args: { mint: m.mint, quote: m.batchQuote, tokens: m.batchTokens } });
  }
  _buyPath(events, path, quoteIn, takeFees, trader, now) {
    let x = quoteIn;
    for (const m of path) {
      const h = buyHop(m, x, takeFees, BigInt(this.config.protocolFeeBps), now);
      this._settledIf(events, m, h);
      if (takeFees) this._trade(events, m, trader, true, h);
      x = h.out;
    }
    return x;
  }
  _pullQuote(m, user, amount) {
    if (m.parent === SOL) this._payIn(user, amount);
    else this._burn(m.parent, user, amount);
  }
  _pushQuote(m, to, amount) {
    if (m.parent === SOL) this._payOut(to, amount);
    else this._mint(m.parent, to, amount);
  }
  _commit(events, m, user, quote) {
    const k = `${m.mint}|${user}`;
    const c = this.state.commitments.get(k) ?? { committed: 0n, claimed: 0n };
    c.committed += quote;
    this.state.commitments.set(k, c);
    m.batchQuote += quote;
    events.push({ name: "Committed", args: { mint: m.mint, user, quote } });
  }
  static raiseHeights(chainUp, h) {
    for (const m of chainUp) {
      if (m.height >= h) break;
      m.height = h;
      h += 1;
    }
  }

  // -------------------------------------------------- instructions

  launch(creator, { name, symbol, uri = "", parent = SOL, solIn = 0n }, now) {
    return this.run((events) => {
      const key = symbolKey(symbol);
      require(name && name.length <= 40 && uri.length <= 200, "InvalidName");
      const mint = this.mintOf(key);
      require(!this.state.memes.has(mint), "MemeExists");
      const ancestors = parent === SOL ? [] : [...this.ancestors(parent), this.meme(parent)];
      require(ancestors.length <= MAX_DEPTH, "TooDeep");
      if (ancestors.length) Engine.raiseHeights([...ancestors].reverse(), 1);
      const virtualQuote = parent === SOL ? ROOT_VIRTUAL_QUOTE : CHILD_VIRTUAL_QUOTE;
      const m = {
        mint, parent, creator, index: this.state.order.length, openUntil: now + this.config.openWindow, settled: false, height: 0,
        refTime: now, reference: 0n, vQuote: virtualQuote, vToken: VIRTUAL_TOKENS, floor: virtualQuote, batchQuote: 0n, batchTokens: 0n,
        batchClaimed: 0n, escrowed: 0n, creatorFees: 0n, protocolFees: 0n, name, symbol, key,
      };
      resetRef(m, now);
      this.state.memes.set(mint, m);
      this.state.order.push(mint);
      this.state.commitments.set(`${mint}|${creator}`, { committed: 0n, claimed: 0n });
      events.push({ name: "Launched", args: { mint, parent, creator, name, symbol } });
      if (solIn > 0n) {
        this._payIn(creator, solIn);
        const quote = this._buyPath(events, ancestors, solIn, true, creator, now);
        require(quote > 0n, "ZeroAmount");
        this._commit(events, m, creator, quote);
      }
    });
  }

  commitSol(user, mint, solIn, minQuote, now) {
    return this.run((events) => {
      const m = this.meme(mint);
      require(!m.settled && now < m.openUntil, "OpeningClosed");
      require(solIn > 0n, "ZeroAmount");
      const ancestors = this.ancestors(mint);
      this._payIn(user, solIn);
      const quote = this._buyPath(events, ancestors, solIn, true, user, now);
      require(quote >= minQuote && quote > 0n, "Slippage");
      this._commit(events, m, user, quote);
    });
  }

  commit(user, mint, amount, now) {
    return this.run((events) => {
      require(amount > 0n, "ZeroAmount");
      const m = this.meme(mint);
      require(!m.settled && now < m.openUntil, "OpeningClosed");
      this._pullQuote(m, user, amount);
      this._commit(events, m, user, amount);
    });
  }

  settle(mint, now) {
    return this.run((events) => {
      const m = this.meme(mint);
      settle(m, now);
      events.push({ name: "Settled", args: { mint, quote: m.batchQuote, tokens: m.batchTokens } });
    });
  }

  claim(user, mint, now) {
    return this.run((events) => {
      const m = this.meme(mint);
      const c = this.state.commitments.get(`${mint}|${user}`);
      require(c, "AccountNotInitialized");
      if (tradable(m, now)) events.push({ name: "Settled", args: { mint, quote: m.batchQuote, tokens: m.batchTokens } });
      const amount = vested(m, c.committed, this.config.vestWindow, now) - c.claimed;
      require(amount > 0n, "NothingToClaim");
      c.claimed += amount;
      m.batchClaimed += amount;
      this._mint(mint, user, amount);
      events.push({ name: "Claimed", args: { mint, user, amount } });
    });
  }

  buy(user, mint, amount, minOut, now) {
    return this.run((events) => {
      require(amount > 0n, "ZeroAmount");
      const m = this.meme(mint);
      this._pullQuote(m, user, amount);
      const h = buyHop(m, amount, true, BigInt(this.config.protocolFeeBps), now);
      require(h.out >= minOut, "Slippage");
      this._settledIf(events, m, h);
      this._trade(events, m, user, true, h);
      this._mint(mint, user, h.out);
    });
  }

  buySol(user, mint, solIn, minOut, now) {
    return this.run((events) => {
      require(solIn > 0n, "ZeroAmount");
      const m = this.meme(mint);
      const ancestors = this.ancestors(mint);
      this._payIn(user, solIn);
      const quote = this._buyPath(events, ancestors, solIn, true, user, now);
      const h = buyHop(m, quote, true, BigInt(this.config.protocolFeeBps), now);
      require(h.out >= minOut, "Slippage");
      this._settledIf(events, m, h);
      this._trade(events, m, user, true, h);
      this._mint(mint, user, h.out);
    });
  }

  sell(user, mint, amount, minOut, now) {
    return this.run((events) => {
      require(amount > 0n, "ZeroAmount");
      const m = this.meme(mint);
      this._burn(mint, user, amount);
      const h = sellHop(m, amount, BigInt(this.config.spikeShareBps), BigInt(this.config.protocolFeeBps), now);
      require(h.out >= minOut, "Slippage");
      this._settledIf(events, m, h);
      this._trade(events, m, user, false, h);
      this._pushQuote(m, user, h.out);
    });
  }

  sellToSol(user, mint, amount, minOut, now) {
    return this.run((events) => {
      require(amount > 0n, "ZeroAmount");
      const m = this.meme(mint);
      const ancestors = this.ancestors(mint);
      this._burn(mint, user, amount);
      const spike = BigInt(this.config.spikeShareBps), protocol = BigInt(this.config.protocolFeeBps);
      const h = sellHop(m, amount, spike, protocol, now);
      this._settledIf(events, m, h);
      this._trade(events, m, user, false, h);
      let x = h.out;
      for (const a of [...ancestors].reverse()) {
        const ha = sellHop(a, x, spike, protocol, now);
        this._settledIf(events, a, ha);
        this._trade(events, a, user, false, ha);
        x = ha.out;
      }
      require(x >= minOut, "Slippage");
      this._payOut(user, x);
    });
  }

  claimFees(owner, mint, protocol, now) {
    return this.run((events) => {
      const m = this.meme(mint);
      let amount;
      if (protocol) {
        require(owner === this.config.feeRecipient, "Unauthorized");
        amount = m.protocolFees;
        m.protocolFees = 0n;
      } else {
        require(owner === m.creator, "Unauthorized");
        amount = m.creatorFees;
        m.creatorFees = 0n;
      }
      require(amount > 0n, "NothingToClaim");
      events.push({ name: "FeesClaimed", args: { owner, meme: mint, asset: m.parent, amount } });
      this._pushQuote(m, owner, amount);
    });
  }

  proposeUnion(proposer, meme, target, now) {
    return this.run((events) => {
      const m = this.meme(meme);
      const t = this.meme(target);
      require(m.parent === SOL, "NotRoot");
      const root = this.ancestors(target)[0]?.mint ?? t.mint;
      require(root !== m.mint, "CycleDetected");
      if (tradable(m, now)) events.push({ name: "Settled", args: { mint: meme, quote: m.batchQuote, tokens: m.batchTokens } });
      const u = { id: this.state.unions.length, meme, target, deadline: now + this.config.unionWindow, executed: false, locked: 0n };
      this.state.unions.push(u);
      events.push({ name: "UnionProposed", args: { id: u.id, meme, target, deadline: u.deadline } });
    });
  }

  lockUnion(user, id, amount, now) {
    return this.run((events) => {
      const u = this.state.unions[id];
      require(u, "AccountNotInitialized");
      require(!u.executed && now <= u.deadline, "VotingClosed");
      require(amount > 0n, "ZeroAmount");
      this._burn(u.meme, user, amount);
      const k = `${id}|${user}`;
      this.state.locks.set(k, (this.state.locks.get(k) ?? 0n) + amount);
      u.locked += amount;
      this.meme(u.meme).escrowed += amount;
      events.push({ name: "UnionLocked", args: { id, voter: user, amount } });
    });
  }

  unlockUnion(user, id) {
    return this.run((events) => {
      const u = this.state.unions[id];
      require(u, "AccountNotInitialized");
      const k = `${id}|${user}`;
      const amount = this.state.locks.get(k) ?? 0n;
      require(amount > 0n, "NothingToClaim");
      this.state.locks.set(k, 0n);
      if (!u.executed) u.locked -= amount;
      this.meme(u.meme).escrowed -= amount;
      this._mint(u.meme, user, amount);
      events.push({ name: "UnionUnlocked", args: { id, voter: user, amount } });
    });
  }

  executeUnion(executor, id, minTargetIn, now) {
    return this.run((events) => {
      const u = this.state.unions[id];
      require(u, "AccountNotInitialized");
      require(!u.executed, "VotingClosed");
      require(now > u.deadline, "VotingOpen");
      const m = this.meme(u.meme);
      require(m.parent === SOL, "NotRoot");
      require(u.locked * 2n > this.circulating(u.meme), "QuorumNotReached");
      const target = this.meme(u.target);
      const ancestors = this.ancestors(u.target);
      require((ancestors[0]?.mint ?? target.mint) !== m.mint, "CycleDetected");
      require(ancestors.length + 1 + m.height <= MAX_DEPTH, "TooDeep");
      const solIn = m.vQuote - m.floor;
      require(solIn >= MIN_UNION_RESERVE, "ReserveTooSmall");
      u.executed = true;
      const creatorFees = m.creatorFees, protocolFees = m.protocolFees;
      m.creatorFees = 0n;
      m.protocolFees = 0n;
      this._payOut(m.creator, creatorFees);
      this._payOut(this.config.feeRecipient, protocolFees);
      if (creatorFees > 0n) events.push({ name: "FeesClaimed", args: { owner: m.creator, meme: m.mint, asset: SOL, amount: creatorFees } });
      if (protocolFees > 0n) events.push({ name: "FeesClaimed", args: { owner: this.config.feeRecipient, meme: m.mint, asset: SOL, amount: protocolFees } });
      let x = this._buyPath(events, ancestors, solIn, false, executor, now);
      const h = buyHop(target, x, false, 0n, now);
      this._settledIf(events, target, h);
      x = h.out;
      require(x >= minTargetIn, "Slippage");
      rescale(m, x);
      require(m.floor !== 0n, "ReserveTooSmall");
      m.parent = target.mint;
      Engine.raiseHeights([target, ...[...ancestors].reverse()], m.height + 1);
      events.push({ name: "UnionExecuted", args: { id, meme: m.mint, target: target.mint, solIn, targetIn: x } });
    });
  }

  /**
   * Any instruction by name, its arguments in one object: the shape web/src/solana.js builds transactions from and
   * web/src/scenario.js resolves steps into.
   */
  exec(op, signer, a, now) {
    switch (op) {
      case "launch": return this.launch(signer, a, now);
      case "commitSol": return this.commitSol(signer, a.mint, a.solIn, a.minQuote ?? 0n, now);
      case "commit": return this.commit(signer, a.mint, a.amount, now);
      case "settle": return this.settle(a.mint, now);
      case "claim": return this.claim(signer, a.mint, now);
      case "buySol": return this.buySol(signer, a.mint, a.solIn, a.minOut ?? 0n, now);
      case "buy": return this.buy(signer, a.mint, a.amount, a.minOut ?? 0n, now);
      case "sell": return this.sell(signer, a.mint, a.amount, a.minOut ?? 0n, now);
      case "sellToSol": return this.sellToSol(signer, a.mint, a.amount, a.minOut ?? 0n, now);
      case "claimFees": return this.claimFees(signer, a.mint, !!a.protocol, now);
      case "proposeUnion": return this.proposeUnion(signer, a.meme, a.target, now);
      case "lockUnion": return this.lockUnion(signer, a.id, a.amount, now);
      case "unlockUnion": return this.unlockUnion(signer, a.id);
      case "executeUnion": return this.executeUnion(signer, a.id, a.minTargetIn ?? 0n, now);
      default: throw new Error(`unknown instruction ${op}`);
    }
  }

  // -------------------------------------------------- views (computed, like a client would)

  /** Spot price in the quote asset, quote base units per token base unit, 1e18-scaled, as if settled now. */
  price(mint, now) {
    const m = structuredClone(this.meme(mint));
    if (!m.settled && now >= m.openUntil) settle(m, now);
    return spot(m.vQuote, m.vToken);
  }
  /** Spot price in lamports per token base unit through the whole lineage, 1e18-scaled. */
  priceInSol(mint, now) {
    let p = PRICE_SCALE;
    for (const m of [...this.ancestors(mint), this.meme(mint)]) p = mulDiv(p, this.price(m.mint, now), PRICE_SCALE);
    return p;
  }
  referencePrice(mint, now) {
    const m = structuredClone(this.meme(mint));
    if (!m.settled && now >= m.openUntil) settle(m, now);
    return refNow(m, m.vQuote, m.vToken, now);
  }
  claimable(mint, user, now) {
    const m = this.meme(mint);
    if (now < m.openUntil) return 0n;
    const c = this.commitment(mint, user);
    const mm = structuredClone(m);
    if (!mm.settled) settle(mm, now);
    return vested(mm, c.committed, this.config.vestWindow, now) - c.claimed;
  }
  /** Tokens (or lamports, or parent tokens) a trade would return, from a dry run of the instruction. */
  quote(method, user, mint, amount, now) {
    const r = this.dryRun(method, user, mint, amount, 0n, now);
    if (r.error) throw r.error;
    const trades = r.events.filter((e) => e.name === "Trade");
    const last = trades.at(-1).args;
    return method.startsWith("buy") ? last.tokenAmount : last.quoteAmount - last.fee - last.spikeShare;
  }
}
