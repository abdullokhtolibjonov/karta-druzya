# Karta Druzya — "108" card game

A browser multiplayer card game for friends ("108" / "101" family) that is played mostly on phones.
The owner speaks Uzbek. Reply to them in Uzbek, but keep code, comments and docs in English.

## Read first
- `docs/RULES.md` — the game rules (rule ids R1.1…). This is the source of truth.
- `docs/ARCHITECTURE.md` — stack, folders, engine API, socket protocol, view shape.
- `docs/UI.md` — screens, design tokens, cards, animations, chat/emoji.
- `docs/PLAN.md` — phased checklist.
- `docs/DEPLOY.md` — deploying to Render.

## Commands
- `npm install`
- `npm run dev` — server with auto-reload (node --watch) on http://localhost:3000
- `npm start` — production server (uses `PORT`)
- `npm test` — node:test suite
- `node scripts/bots.mjs CODE 3` — 3 bot players join room CODE and play (manual testing)

## Conventions
- ES modules, 2-space indent, single quotes, semicolons. No framework, no build step.
- The engine (`server/game/engine.js`) is pure: no timers, sockets or `Date.now()`, and the
  rng is injected. All randomness goes through `game.rng`.
- The server is authoritative. The client never decides legality; it only shows hints from
  `view.playable`.
- Every rule change goes RULES.md → test → engine, in that order.
- Error codes are snake_case. Every code must have `err_<code>` in both languages in
  `public/js/i18n.js`.
- Every user-visible string goes through `t()`. No hard-coded UI text.
- Chat text is always rendered with `textContent`.
- localStorage access is always wrapped in try/catch (`public/js/prefs.js`).
