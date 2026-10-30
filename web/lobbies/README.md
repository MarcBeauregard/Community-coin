# Lobbies

The social launchpad: an hour-long lobby where a crowd proposes coin ideas, pledges SOL on them (the pledge is the
vote), launches the winner at one price for every backer, and keeps them together in a clan that never closes.

Steps 1 (design system, components, every screen), 2 (the lobby on chain) and 3 (the live lobby) of the plan in `PLAN.md`.

```
npm run build:lobbies   # → web/dist/lobbies (open index.html)
npm run test:lobbies    # every scene at 390, 768, 1280 and 1440 px, then the whole hour by hand, in Chromium
npm run test:lobby-chain   # the program's lobby tests, then the JavaScript side checked against them
npm run index:lobbies -- --rpc <url> --program <id> --lobby <id>   # follow lobbies on a cluster, serve JSON
```

The lobby on chain (`solana/programs/community-coin`, instructions under "lobbies"): `create_lobby`, `propose_idea`
(ticker free on the launchpad and in the lobby, refundable bond), `pledge`, `withdraw`, `move_pledge` (one idea per
wallet, a per-wallet cap, all until the lock), `finalize` (anyone, at the lock: most SOL wins, earliest on a tie),
`launch_winner` (the pot becomes the opening batch: one price for every backer), `refund`, `claim_founder` (a
winning pledge becomes a commitment to the opening, then the hub's claim and vesting), `return_bond`, and
`void_winner` if the winner's ticker was taken meanwhile. `solana/DEPLOY.md` says how to put it on devnet.

- `src/chain/rules.js`: the same rules in JavaScript. The demo plays the hour on it, so every amount and receipt
  the app shows is what the program would do.
- `src/chain/wire.js`: addresses, instructions, events, account layouts and errors. `src/chain/client.js` sends
  operations from a wallet and reads lobbies back. `src/chain/indexer.js` folds events into the race, pledges,
  founders and receipts; `indexer.mjs` follows a cluster with it.
- `chain-check.mjs`: replays the program's random walk (`tests/lobby_walk.rs`) step by step on all of the above:
  same results, same state to the lamport, same instruction bytes, same events, same decoded accounts, and the
  indexer and client against a fake RPC serving the program's real transactions and accounts.

- `src/tokens.js`, `src/styles.css`: the tokens ("Obsidian Glass"), kept equal by the test.
- `src/ui.js`, `src/icons.js`: Button, IconButton, Segmented, Chip, Coin, Avatar, Bar, GestationTimeline, Equalizer,
  Orbit, Sheet, Toast, Composer, and the stroke icon set.
- `src/screens/`: Discover, Lobby, Launch, Clan and the sheets. Each screen has a desktop and a phone layout
  (below 900 px).
- `src/demo/`: fixtures, the store (state, actions, the clock) and derived views. Later steps replace the store's
  actions with the lobby program and the realtime channel; the screens stay.
- URL parameters: `?scene=<name>` opens a seeded state (see `demo/store.js`), `?freeze` stops the clock.

The live lobby (`server/`): `npm run serve:lobbies` starts the realtime server; open the app with
`?live=http://localhost:8790` to play the lobby on it. One WebSocket room per lobby: Sign-In With Solana (a wallet
signs a one-time nonce; guests can read but not write), the server's clock (clients render from it), presence
(people, not tabs), chat (cleaned of control and bidi characters, 200 characters, slow mode, flood protection), the
race as deltas batched every 250 ms, and phase changes. The race comes from the chain through the indexer
(`--rpc`), or from the demo lobby on the program's rules. `npm run test:realtime` checks the room on a fake clock,
sign-in, the server over real sockets, and the app joining it in Chromium.

The end of the hour (`src/chain/crank.js`, `server/crank.mjs`, `server/clans.mjs`): the server cranks each lobby
(anyone may: the program checks the time). At the lock it finalizes and announces the winner; at 01:00 it launches
the winner, refunds every other pledge, turns every winning pledge into its founder's commitment, returns the bonds,
and the clan is born with exactly the winner's backers as members (`GET /clans/:mint`). Each wallet hears only what
its own pledge became. `npm run test:crank` plays a whole hour through the server on a fake clock and checks it.
