# Lobbies

The social launchpad: an hour-long lobby where a crowd proposes coin ideas, pledges SOL on them (the pledge is the
vote), launches the winner at one price for every backer, and keeps them together in a clan that never closes.

Step 1 of the plan in `PLAN.md`: the design system, the component library and every screen of the prototype, on a
demo store. No chain, no server yet.

```
npm run build:lobbies   # → web/dist/lobbies (open index.html)
npm run test:lobbies    # every scene at 390, 768, 1280 and 1440 px, then the whole hour by hand, in Chromium
```

- `src/tokens.js`, `src/styles.css`: the tokens ("Obsidian Glass"), kept equal by the test.
- `src/ui.js`, `src/icons.js`: Button, IconButton, Segmented, Chip, Coin, Avatar, Bar, GestationTimeline, Equalizer,
  Orbit, Sheet, Toast, Composer, and the stroke icon set.
- `src/screens/`: Discover, Lobby, Launch, Clan and the sheets. Each screen has a desktop and a phone layout
  (below 900 px).
- `src/demo/`: fixtures, the store (state, actions, the clock) and derived views. Later steps replace the store's
  actions with the lobby program and the realtime channel; the screens stay.
- URL parameters: `?scene=<name>` opens a seeded state (see `demo/store.js`), `?freeze` stops the clock.
