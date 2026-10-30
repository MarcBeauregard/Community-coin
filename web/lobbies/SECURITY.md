# Lobbies: security review

Scope: the lobby instructions of `solana/programs/community-coin` (`create_lobby` to `return_bond`), the realtime
server (`web/lobbies/server`), and the app's handling of money. Reviewed in step 7; each finding has a test.
This is an internal review, not an external audit: one is still needed before mainnet.

## The program

Invariants checked by `tests/lobby.rs` and the random walk `tests/lobby_walk.rs` (books balanced after every step):

- The lobby account holds exactly the open pledges plus the unreturned bonds; it ends at 0 once settled.
- A pledge is on one idea; it is withdrawn, moved, refunded or committed once (`settled`); only to its own wallet
  (the pledge PDA is derived from the wallet the lamports go to).
- Pledges and withdrawals stop at the lock; finalize needs every idea once (bitmask over `MAX_IDEAS` = 16), owned
  by the program and of this lobby; the winner is the idea with the most SOL, the earliest on a tie.
- Only the winner launches, once, after the launch time; only its backers become founders, at one price.
- Every crank instruction is permissionless and idempotent: refunds, commitments and bonds go to fixed recipients.

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | **A ticker in the race could be launched by anyone on the launchpad.** A copycat could take the leading idea's ticker during the hour (or between the lock and the launch), get its mint, and force `void_winner`: the lobby's winner never launches. | High | Fixed: `propose_idea` creates a `Hold` for the ticker until the lobby's launch time plus a day (`HOLD_GRACE`); `launch` refuses a held ticker (`TickerHeld`); another lobby cannot race it meanwhile. Tests: `a_ticker_in_the_race_is_held_for_its_lobby`, `if_the_winners_ticker_is_taken_after_its_hold_everyone_is_refunded`. |
| 2 | Lobby ids are global (`[b"lobby", id]`): anyone can take an id first. | Low | Accepted: it costs the squatter rent and only makes the server pick another id. Namespacing by host is an option if it becomes a nuisance. |
| 3 | `create_lobby` accepts any `opens_at`, including the past. | Info | Accepted: a host can only shorten their own lobby; windows are bounded (`MAX_LOBBY_LENGTH` 4 h). |
| 4 | Repeated identical transactions in tests could be dropped as already processed (flaky test, not a program bug). | Info | Fixed in the tests: repeats come from another sender. |
| 5 | **Dust could get stuck** (final audit): a pledge below a wallet's rent-exempt minimum could never be refunded to an emptied wallet, and the crank would retry it forever. | Medium | Fixed: `MIN_PLEDGE` 0.001 SOL; a withdrawal leaves 0 or at least that (`PledgeTooSmall`). Test: `dust_cannot_get_stuck`. |
| 6 | Holding tickers cheaply (final audit): a lobby with a zero bond could hold any ticker for a day, renewably. | Low | Mitigated: `MIN_BOND` 0.01 SOL per proposal; the hold still blocks for at most the lobby plus a day. |

Finding 2 also means a server must check that the lobby it follows has the host it expects (the voice stage's host
is the lobby's on-chain host).

Not found: missing signer or owner checks, unchecked arithmetic on amounts (all `checked_*` or bounded by a prior
check), PDA substitution (every account is re-derived from seeds), double settlement.

## The server

- Sessions: Sign-In With Solana (ed25519 over a one-time nonce, 5 minutes), HMAC-signed tokens, 24 h. Nonces are
  capped (100,000 in flight) so a flood cannot exhaust memory.
- Limits: 120 HTTP requests per minute and 50 sockets per address (`--trust-proxy` behind a proxy), a token bucket
  per socket, 2 KB WebSocket frames, 4 KB JSON bodies, slow mode in chat; `--origins` restricts the app's origins.
- Clans: membership is read from the chain's events only; re-checked on every message. Media is accepted from its
  bytes (PNG, JPEG, GIF, WebP, MP4, MOV, WebM; never SVG or HTML), 8 MB, members-only, served with `nosniff` and a
  sandboxing CSP. Chat text is stripped of control and bidi characters.
- Voice: the server decides who publishes; tokens carry it and the SFU's admin API is told at once when it changes.
- Load: `load-check.mjs` holds 5,000 people in one lobby (chat to all in p95 ~110 ms, ~140 MB).

Fixed in the final audit (an independent review of this code, see `AUDIT.md`):

- Two unauthenticated crashes: a malformed `%`-escape in a path (`decodeURIComponent` threw in the async handler)
  and a JSON body of `null`. Bodies are now objects or `{}`, paths are decoded safely, and every request runs under
  a catch that answers 500 instead of stopping the process.
- A failing crank run (an RPC error, a refused operation) was an unhandled rejection: now caught, with back-off.
- On a cluster, clans are built from every event the indexer reads, not only the transactions our crank sent, so a
  launch or a founder's claim cranked by someone else still makes the clan and its members.
- A founder who reconnects is sent their settlement again; clan logs skip a torn line; the media index is written
  atomically; media has a 200 MB quota per member; an oversized JSON body no longer leaves a request hanging.

Known limits: the session token travels in the WebSocket URL and in media URLs (keep both out of access logs; a
short-lived media token would be better); one server process per
lobby set (several instances need a pub/sub between them).

## The app

- Money is never ambiguous: every amount on screen is the program's (receipts are read from its events), the pledge
  sheet says what happens on a win, a loss, a change of mind and what it costs, before signing.
- Losing pledges are refunded at the lock (00:55), as the copy says; the crank does it at once.
- Nothing here is fake in live mode: the demo's crowd and clock stop when the app is connected to a server.
