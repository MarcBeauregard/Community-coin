# Lobbies

The social launchpad: an hour-long lobby where a crowd proposes coin ideas, pledges SOL on them (the pledge is the
vote), launches the winner at one price for every backer, and keeps them together in a clan that never closes.

```
npm run build:lobbies   # → web/dist/lobbies (open index.html)
npm run test:lobbies    # every check below, on a fresh build (about 15 minutes); `-- finale net` runs only those
npm run index:lobbies -- --rpc <url> --program <id> --lobby <id>   # follow lobbies on a cluster, serve JSON
```

Each check is a file here (`<name>-check.mjs`, and `visual.mjs` for every scene at 390, 768, 1280 and 1440 px);
`chain-check` reads what the program's tests wrote, so `npm run test:solana` comes first.

The lobby on chain (`solana/programs/community-coin`, instructions under "lobbies"): `create_lobby`, `propose_idea`
(ticker free on the launchpad and in the lobby, refundable bond), `pledge`, `withdraw`, `move_pledge` (one idea per
wallet, a per-wallet cap, all until the lock), `finalize` (anyone, at the lock: most SOL wins, earliest on a tie),
`launch_winner` (the pot becomes the opening batch: one price for every backer), `refund`, `claim_founder` (a
winning pledge becomes a commitment to the opening, then the hub's claim and vesting), `return_bond`, and
`void_winner` if the winner's ticker was taken meanwhile. The host can take an idea out until five minutes before
the lock (`remove_idea`, then `refund_removed` for each pledge on it).

On a cluster (after the hub is deployed and initialized, see "Déployer sur Solana" in the repository's README): the
host sends `create_lobby(id, opens_at, 1800, 3300, 3600, max_pledge, bond)`; the server follows it with
`--rpc <url> --program <address> --lobby <id>` and cranks it (`finalize` at 00:55, then `launch_winner`, `refund`,
`claim_founder` and `return_bond` at 01:00; each is permissionless).

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
(`--rpc`), or from the demo lobby on the program's rules. `realtime-check` checks the room on a fake clock,
sign-in, the server over real sockets, and the app joining it in Chromium.

The end of the hour (`src/chain/crank.js`, `server/crank.mjs`, `server/clans.mjs`): the server cranks each lobby
(anyone may: the program checks the time). At the lock it finalizes and announces the winner; at 01:00 it launches
the winner, refunds every other pledge, turns every winning pledge into its founder's commitment, returns the bonds,
and the clan is born with exactly the winner's backers as members (`GET /clans/:mint`). Each wallet hears only what
its own pledge became. `crank-check` plays a whole hour through the server on a fake clock and checks it.

The clans (`server/clan-room.mjs`, `server/media.mjs`): each launched coin's founders get its channels forever, over
`/ws?clan=<mint>`: posts, images and clips (checked from their bytes, members-only), reactions, deletes, reports that
hide a message after three, and moderators (the winning idea's creator first) who mute and set slow mode. With
`--data <dir>` it all survives restarts. `clan-check` checks it, then plays it in the app as a founder.
For local development, `--dev-sessions` lets the app sign in as a named wallet with `&as=<name>`.

Voice (`server/voice.mjs`): the server runs the lobby stage (host, raised hands, up to 8 speakers, co-hosts) and the
clan Campfire, and hands out SFU access tokens (LiveKit's format) that say who may publish; a change is pushed to
the SFU's admin API at once. Start the server with `--sfu wss://…` and `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`.
`voice-check` checks it against a fake SFU, then runs the stage from two browsers.

Hardening: `load-check` (5,000 people in one lobby), `a11y-check` (WCAG 2.2 AA on every scene), `SECURITY.md` (the
program and server review), `LEGAL.md` (the risks and terms copy, for counsel).

The app connects wallets (`wallet-check`), plays the voice rooms through LiveKit (`audio-check`, against a stand-in
room), and draws the founder's birth card (`card-check`). Live lobbies are practice lobbies until they run on
Solana: pledges use practice SOL on the server, and say so.

The experience: the last five minutes and a one-tap move (`finale-check`), the first minute (`intro-check`), each
idea's curve and the hour replayed in 30 seconds (`replay-check`), the host's welcome, arrivals, live faces and
stage reactions (`alive-check`), reminders (`remind-check`), the founder profile and sibling lobbies
(`profile-check`), reporting and removing an idea (`moderate-check`), verifiable receipts and the network banner
(`net-check`), and the hosted beta (`beta-check`; hosting it is in the repository's README). The server takes
`--welcome <text>` for the host's pinned welcome.

## What is left

- The program on devnet, then real pledges in the screens (the client is ready and checked: `src/chain/client.js`),
  which replaces the practice SOL. An external audit of the program and counsel's review of `LEGAL.md` before
  mainnet.
- Audio against a real SFU (LiveKit server or LiveKit Cloud keys): the app is tested against a stand-in room.
- What a lobby holds while it runs (ideas, practice pledges, chat) lives in the server's memory: a restart during
  an hour empties that hour. Clans, media and feedback are kept in `--data <dir>`, which must be a disk that
  survives restarts. Several server instances behind one lobby would need a pub/sub between them.
- The creator's settings screen (naming moderators: the server and client support it).
- Notifications from a closed tab need a push service (Web Push and a service worker); until then the calendar is
  the reminder that always works.
