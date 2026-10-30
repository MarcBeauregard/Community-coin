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

# Step 4: the crank, the launch ceremony, the clan's birth

## Done
- The crank (`src/chain/crank.js`, shared by the app and the server): from the lobby's state, what is due now:
  `finalize` at the lock; at 01:00 `launch_winner` (or `void_winner` if its ticker was taken meanwhile), then every
  pledge settled its way (`refund` or `claim_founder`) and every bond returned. Idempotent and resumable: a crank
  cut short picks up where it stopped. `server/crank.mjs` runs it on the program's rules or on a cluster
  (one transaction per operation, events read back from the logs).
- The room announces it: `locked` (winner, pot, total) to everyone, `voided` if the winner can't launch, `launch`
  (mint, symbol, pot, founders) to everyone, and `settled` to each wallet only (its refund, or founder with its rank
  in the clan). A late joiner's hello carries the lock and the launch.
- The clan registry (`server/clans.mjs`) is built from the events only: a clan per launched mint, its members the
  winner's backers ranked in pledge order; `GET /clans/:mint`; `isFounder` gates step 5's channels.
- App: the dock says what the lock decided ("$WIF won · launch in 04:12", or "No launch · refunds at 01:00"); live,
  the launch moves the lobby to the launch screen, a founder sees their rank and allocation, a refunded wallet a toast.
- Checks: `crank-check.mjs` (the plan in every state; a whole hour through the server on a fake clock: winner = most
  SOL, refunds to the lamport, clan = winner's backers, lobby balance 0, no repeats, late joiners; the app live from
  the lock to the launch in Chromium).

# Step 5: the clan's channels: text, media, reactions, moderation

## Done
- Clan rooms (`server/clan-room.mjs`), one per launched coin, over `WS /ws?clan=<mint>`: only the founders (the
  registry, from the chain) and the winning idea's creator get in; guests and other wallets are refused (4403).
  Five channels; posts cleaned and capped at 2000 characters, a moment between two posts, history paged back.
- Media (`server/media.mjs`): PNG, JPEG, GIF, WebP, MP4, MOV, WebM, recognised from the bytes (never SVG or HTML),
  8 MB at most, stored under their hash, served only to the clan's members with `nosniff` and a sandboxing CSP.
- Reactions (one per member per kind), deleting one's own message (the text is gone, a tombstone stays),
  reporting (once per member; the third report hides a message until a moderator restores it).
- Moderation: the creator is the first moderator and names others among the founders; moderators delete, mute
  (up to 7 days; never the creator) and set a channel's slow mode. Everyone is told.
- Forever: with `--data <dir>`, the registry, every clan's log and the media are on disk; the log is replayed and
  compacted at start, so deleted text is not kept.
- App: live, a founder enters their clan from the launch; posts, reactions, delete, report and image upload go to
  the server. In the demo, delete and report work on the seeded clan.
- Checks: `clan-check.mjs` (access, posts, media, reactions, reports, moderation, a restart; the app live as a
  founder in Chromium).

## Left
- The creator's settings screen (naming moderators: the server and client support it).
- Wallet sign-in in the screens (as step 3).

# Step 6: voice: the lobby stage, the clan Campfire

## Done
- The server decides who may speak; the audio goes through an SFU (LiveKit, or anything taking its access tokens).
  `server/voice.mjs`: HS256 access tokens with a `video` grant (listeners subscribe only; speakers publish the
  microphone only), and LiveKit's admin API (`UpdateParticipant`) so a lost right takes effect at once.
- The lobby stage: the host (from the chain) speaks, up to 8 speakers; listeners raise hands in a queue; the host or
  a co-host brings a raised hand up (nobody is pulled up without asking); speakers step down, the host moves them
  back; leaving the lobby leaves the stage. Guests listen only.
- The clan Campfire: every member may talk; a moderator's mute silences them at the SFU at once.
- `POST /voice/token {lobby | clan}`; `--sfu wss://…` with `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`. Without an
  SFU the server answers 503 and the app says once that voice isn't connected; the stage itself still works.
- App, live: raise hand, the host's raised-hands list with "Bring up", step down, Campfire presence.
- Checks: `voice-check.mjs` (tokens, the stage's rules, the server and a fake SFU's admin API, the Campfire, the
  host and a listener in two Chromium pages).

## Left
- The audio transport in the app (LiveKit's client, connecting with the token the app already gets) and its
  speaking levels for the talking lights; it needs an SFU deployment to test against.
