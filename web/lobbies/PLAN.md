# Lobbies — step 1: design system, components, screens

Reference: the interactive prototype (desktop + mobile) on claude.ai. This step turns it into code inside the repo,
on the same stack as the launchpad (`web/`): Preact + htm, bundled by esbuild into one script, no framework runtime.

## User stories covered by step 1
- As a visitor I see the live lobby of the hour, its countdown, the race and how a lobby works.
- As a member I join a lobby, listen to the stage, raise my hand, read and write in the chat.
- I propose an idea (name, ticker, color, pitch) and see it enter the race.
- I pledge on an idea after a confirmation that says what happens if it wins, if it loses, and the fee;
  I can withdraw or move my pledge until the lock.
- At 01:00 I see the launch: founder (allocation, vesting) or refunded.
- As a founder I enter the clan: channels, media, reactions, the Campfire voice room, the founders.
- Everything works on a phone (390 px) as well as on a desktop (1440 px).

## Scope
In: tokens, component library, every screen and state of the prototype, responsive layouts, a demo store that
plays the hour (behind `demo`, the only data source in this step), visual and flow tests.
Out (later steps): the Solana lobby program, the indexer, websockets, voice transport, uploads, auth.

## Data flow
`demo/data.js` (fixtures) → `demo/store.js` (state + actions + 1 s clock) → `demo/select.js` (derived view data)
→ `screens/*` render with `ui.js` components. The store is the only seam later steps replace: the same actions
will call the program and the realtime channel instead of mutating local state.

## States per screen
Discover: live hero, filtered list, empty search, upcoming with reminder on/off, listening mini player.
Lobby: gathering / open floor / pledge only / locked; dock: pick, backed, move, closed; stage: out, listening,
hand raised, on stage (mic on/off); chat: empty draft, sending art.
Launch: founder / refunded / spectator. Clan: list, channel, voice joined (mute, deafen, sharing), members hidden.
Sheets: propose (invalid, valid, ticker taken), pledge (idle, signing), host, wallet (with / without pledge).

## Risks
- Pixel parity across 4 widths: covered by a screenshot run at 390, 768, 1280 and 1440 for every scene.
- Clock-driven UI is flaky to test: `?freeze` stops the clock, `?scene=` seeds deterministic states.
- Third-party logos: kept as demo fixtures only, credited in `assets/CREDITS.md`.

# Step 2: the lobby on chain, the indexer, real receipts

## Done
- Program: lobby accounts (Lobby, Idea, Pledge), eleven instructions, eleven events, nineteen errors. The pot of the
  winner is the opening batch of the existing protocol, so a lobby launch is a fair launch with vesting.
- Books: after every step of a random walk, the ideas add up to the lobby's total and the lobby holds exactly what
  it owes (pledges not yet refunded or committed, bonds not yet returned). At the end it holds nothing, and what
  the founders committed equals the opening batch.
- JavaScript: rules replica, wire format, client, indexer, all checked against the program by `chain-check.mjs`.
- App: the demo's money goes through the rules; a pledge ends on a receipt read from the program's events; the
  wallet lists every receipt; the launch shows the founder's exact token allocation and first-pledge rank.

## Left for later steps
- Deploying to devnet (no toolchain or network here): `solana/DEPLOY.md`.
- Wallet mode in the screens (the client is ready; the screens still run on the demo store).
- Postgres behind the indexer, and the crank as a service.
- The lobby tests in CI (they need the Rust toolchain and Playwright on the runner).

# Step 3: the live lobby

## Done
- Realtime server (`server/`): Sign-In With Solana sessions, a room per lobby with presence, chat, race deltas,
  phases and the server clock; race from the chain (indexer) or from the simulated lobby.
- App: `?live=` joins the server as a guest; presence, chat, race and clock then come from it; deep links to a
  screen (#/lobby, #/clan) open on it.
- Checks: `realtime-check.mjs` (room rules, sign-in, sockets, the app in Chromium).

## Left
- Wallet sign-in in the screens (the server and client support it; the screens offer guest only until wallet mode).
- Several server instances behind one lobby (a pub/sub between them), for step 7's load.
