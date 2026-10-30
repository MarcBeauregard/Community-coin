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
