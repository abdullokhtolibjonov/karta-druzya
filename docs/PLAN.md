# Implementation plan

Work phase by phase. At the end of each phase run `npm test` and tick the boxes.

## Phase 1 — Engine
- [x] `server/game/cards.js`: RANKS, SUITS, POINTS, makeDeck, shuffle(rng), parse(cardId)
- [x] `server/game/engine.js`: full RULES.md
- [x] `test/engine.test.js`: tests per rule (use a seeded rng and hand-crafted states)

## Phase 2 — Server
- [x] `server/index.js` + `server/rooms.js` (protocol in ARCHITECTURE.md)
- [x] Reconnect by clientId, host transfer, kick, spectators, join-next-round
- [x] Turn timer + auto next round + empty-room cleanup
- [x] Chat + reactions with validation and rate limit
- [x] `test/rooms.test.js` integration test

## Phase 3 — Client shell
- [x] index.html, style.css tokens, themes, i18n, prefs
- [x] Home + Lobby screens, share link

## Phase 4 — Table
- [x] SVG cards (faces + back)
- [x] Table render, hand interactions, Queen suit picker, deck/discard
- [x] Timer ring, status messages, animations
- [x] Round result + game over modals

## Phase 5 — Social
- [x] Emoji bar, chat drawer, floating bubbles

## Phase 6 — Verify and deploy
- [x] Manual test with several browser windows (incl. mobile viewport)
- [x] `render.yaml`, docs/DEPLOY.md
- [ ] Push to GitHub, deploy on Render

## Backlog / ideas
- Sound effects (play, draw, your turn) with a mute toggle
- Persist rooms across restarts (currently in memory)
- Drag-to-play on touch devices
