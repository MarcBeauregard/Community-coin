# Lobbies: final audit

The seven steps of the plan, delivered in order, then audited: an independent review of the program, the server
and the crank (by a reviewer not told the earlier conclusions), every finding checked and fixed or accepted, and
every suite run again from a clean build.

## The steps

| Step | What | Commit |
|------|------|--------|
| 1 | Design system, components, every screen (desktop and phone) | `b56b964` |
| 2 | The lobby on chain (Anchor), the indexer, real receipts | `13605eb` |
| 3 | The live lobby: presence, chat, race, server clock, phases | `d4d9a42` |
| 4 | The crank, the launch ceremony, the clan's birth | `c187816` |
| 5 | Clan channels: text, media, reactions, moderation | `f1a89f9` |
| 6 | Voice: the lobby stage and the clan Campfire (SFU tokens) | `f1a89f9` |
| 7 | Hardening: security review, load, accessibility, legal copy | `fc5eb1c` |

## What the audit found and what was done

Program (details in `SECURITY.md`):
- High, fixed in step 7: a ticker in a lobby's race could be launched elsewhere to void the lobby → `Hold`.
- Medium, fixed: dust pledges could never be refunded to an emptied wallet → `MIN_PLEDGE` (0.001 SOL).
- Low, mitigated: tickers held cheaply → `MIN_BOND` (0.01 SOL). Low, accepted: global lobby ids.
- Checked and sound: one settlement per pledge, pledges tied to their idea, finalize's idea set, the hold's
  seeds and owner, `void_winner`, the lamport books (the random walk checks them after every step).

Server:
- High, fixed: two unauthenticated crashes (a bad `%`-escape in a path, a `null` JSON body); every request now
  runs under a catch.
- Medium, fixed: an unhandled crank failure stopped the process (now caught, with back-off); on a cluster, clans
  missed launches and claims cranked by others (now built from every indexed event).
- Low, fixed: settlement re-sent on reconnect, torn log lines skipped, atomic media index, media quota, oversized
  bodies answered. Low, accepted and documented: the session token in WebSocket and media URLs.

App:
- The money copy matches the program (refunds at the lock, no host fee that does not exist); WCAG 2.2 AA passes on
  every scene; a Risks and terms sheet; nothing fake in live mode.

## Checks run for this audit (all passing)

- Rust: the whole program suite, including the lobby tests (9) and the lobby random walk.
- Hardhat: 28 passing. Launchpad: wire-check and protocol-check (552 / 553 steps identical), the wallet and web e2e.
- Lobbies: chain-check (176 steps identical with the program, byte-for-byte instructions), realtime, crank, clans,
  voice (each ending in Chromium), visual (17 scenes at 4 widths), accessibility, and load: 5,000 people in one
  lobby, a message to all of them in p95 56 ms, 138 MB.
- CI now runs the lobby checks without a browser (it was failing on a removed `test:curve` script).

## Not done here, and why

- Devnet deploy (`solana/DEPLOY.md`): it needs network access and a funded key, which this work did not use.
- An external audit of the program before mainnet; counsel's review of `LEGAL.md`.
- The audio itself: the server issues LiveKit tokens and enforces who speaks; connecting the app's audio needs an
  SFU deployment.
