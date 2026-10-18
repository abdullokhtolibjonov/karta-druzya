# Architecture

## Stack

- **Node.js ≥ 20**, ES modules (`"type": "module"`), no TypeScript, no build step.
- **Server:** Express (static files) + Socket.IO (realtime). The server is **authoritative**:
  it holds the deck and every hand, validates every move and sends each client only
  what that client may see.
- **Client:** plain HTML/CSS/JS ES modules in `public/`. No framework, no bundler.
  The Socket.IO client is loaded from `/socket.io/socket.io.js`, which the server serves.
- **Tests:** built-in `node:test` (`npm test`).

## Folder layout

```
server/
  index.js          Express + Socket.IO bootstrap, PORT env, static public/
  rooms.js          Room manager: lobby, seats, host, timers, chat, socket handlers
  game/
    cards.js        Deck creation, shuffle (injectable rng), points, card parsing
    engine.js       Pure rules engine (docs/RULES.md). No I/O, no timers, no sockets.
test/
  engine.test.js    One or more tests per rule id (R1.1 …)
  rooms.test.js     Integration test with socket.io-client (create/join/start/play)
public/
  index.html        Single page; screens are <section>s toggled by JS
  css/style.css     Design tokens, light/dark themes, layout, animations
  js/main.js        Bootstrap, screen router, home form, menu, socket state handling
  js/ui.js          DOM helpers: el(), icons, toast, modal, avatar, confetti
  js/net.js         Socket wrapper with ack→Promise helpers
  js/state.js       Client store (latest server view + local UI state, clock skew)
  js/i18n.js        uz / en dictionaries + t(key, params)
  js/cards.js       SVG card faces + back (pure functions returning SVG strings)
  js/table.js       Renders the game table from the view
  js/lobby.js       Home + lobby screens
  js/chat.js        Chat drawer, emoji bar, floating bubbles
  js/prefs.js       localStorage (theme, lang, name, clientId) with try/catch
scripts/bots.mjs    Dev helper: bot players that join a room and play random legal moves
docs/               RULES.md, ARCHITECTURE.md, UI.md, PLAN.md, DEPLOY.md
```

## Engine API (`server/game/engine.js`)

All functions mutate the passed `game` object and return `{ ok: true }` or
`{ ok: false, error: '<code>' }`. Error codes are short snake_case strings, translated on
the client (`err_<code>` in i18n).

```js
createGame({ rng = Math.random, cardsPerPlayer }) → game
addPlayer(game, { id, name })          // seat; status 'waiting' until a round starts
removePlayer(game, id)                 // R10.2
startRound(game)                       // deals, starter card, R2.2, R9
play(game, playerId, cardId, suit?)    // suit required for Q
draw(game, playerId)                   // normal draw, or accept a pending penalty
pass(game, playerId)
timeout(game)                          // R8.3 for the current player
viewFor(game, playerId) → PublicView   // hides other hands
```

### Game object (server-only)

```js
{
  phase: 'lobby' | 'playing' | 'roundOver' | 'gameOver',
  round: 0,
  players: [{ id, name, seat, hand: [cardId], score,
              status: 'waiting'|'active'|'finished'|'eliminated',
              queenBonus: false }],
  deck: [cardId], discard: [cardId],          // discard top = discard.at(-1)
  activeSuit: 'S'|'C'|'H'|'D',
  turn: playerId | null,
  pending: null | { rank: '6'|'7'|'K', count },
  mustCover: false,                           // R5.4
  drawnCard: null | cardId,                   // set after a draw this turn (R4.2)
  lastLoserId, winnerId,
  lastRound: null | { loserId, added, before, after, eliminated, reset, bonuses:[ids] },
  seq: 0,                                     // incremented on every change
  events: [{ seq, type, playerId, card?, count?, suit? }]  // recent events for animations
}
```

`events` types: `play`, `draw` (count; the card itself only goes to its owner),
`penalty` (count), `skip`, `finish`, `roundEnd`, `gameEnd`, `reshuffle`, `timeout`.
Only events from the latest action are kept (`events` is reset per action). The client
animates events whose `seq` it has not seen yet.

### PublicView (sent to each socket)

```js
{
  me: playerId | null,
  phase, round, turn, activeSuit, pending, mustCover,
  top: cardId | null, deckCount, discardCount,
  myHand: [cardId], drawnCard,            // only for `me`
  playable: [cardId],                     // server-computed legal cards for me (UI hints)
  canDraw, canPass,
  players: [{ id, name, seat, cardCount, score, status, connected, isHost, queenBonus }],
  spectators: [{ id, name }],
  lastRound, winnerId, standings?,        // standings when gameOver
  seq, events,
  hasDrawn, recent: [cardId x≤3],          // recent = top of discard pile, for rendering
  // added by rooms.js:
  myId,                                   // my public id (also set for spectators; `me` is null then)
  isHost, code, settings: { turnSeconds },
  turnEndsAt: epochMs | null, nextRoundAt: epochMs | null, serverNow,
  spectators: [{ id, name, connected, joinNext }]
}
```

## Rooms (`server/rooms.js`)

- Room code: 4 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. URL form: `/?r=CODE`.
- Identity: the client generates `clientId` (UUID, localStorage) and sends it on join.
  The same clientId reconnecting takes back the same seat (R10.3). The clientId is private;
  other clients only see a random public id (`pid`, used as the engine player id).
- In the lobby, a member with no connected sockets is removed after a 30 s grace period
  (so a page refresh keeps the seat).
- Visibility: `settings.public` (default `true`). The host can hide the room from the public list;
  a hidden room can still be joined by link or code.
- Host: the first person who joins. If the host leaves, the next seated player becomes host.
- Max 6 seated players. Others are spectators. Joining while `phase` is `playing` or
  `roundOver` makes the person a spectator with `joinNext: true` (R10.1).
- An empty room (no connected sockets) is deleted after 10 minutes.
- Timer: `rooms.js` owns one `setTimeout` per room. After every successful action it
  re-arms the timer if `turn` or `seq` changed (R8.2). When the timer fires it calls
  `engine.timeout`.
- Between rounds: phase `roundOver` shows results. The host clicks "next round", or it
  starts automatically after 8 s.

## Socket protocol

Client → server (all with an ack callback `(res) => …`, `res = { ok, error?, ... }`):

| Event | Payload | Who |
|---|---|---|
| `room:create` | `{ name, clientId }` → `{ ok, code }` | anyone |
| `room:join` | `{ code, name, clientId }` | anyone |
| `room:leave` | – | member |
| `room:settings` | `{ turnSeconds?: 0\|15\|30\|60, public?: boolean }` (at least one) | host |
| `rooms:subscribe` | – → `{ ok, rooms: RoomListItem[] }`, then live `rooms` events | anyone (home screen) |
| `rooms:unsubscribe` | – | anyone |
| `room:kick` | `{ playerId }` | host |
| `game:start` | – | host (≥ 2 players) |
| `game:next` | – | host, in roundOver |
| `game:end` | – | host (R7.7) |
| `game:new` | – | host, in gameOver: back to lobby, scores reset |
| `game:play` | `{ cardId, suit? }` | turn player |
| `game:draw` | – | turn player |
| `game:pass` | – | turn player |
| `chat:send` | `{ text }` (1–200 chars, trimmed, max 1 msg / 700 ms) | member |
| `react:send` | `{ emoji }` (must be in `EMOJIS`) | member |

Server → client:

| Event | Payload |
|---|---|
| `state` | PublicView, sent to every socket in the room after every change |
| `chat` | `{ id, playerId, name, text, ts }` |
| `react` | `{ playerId, emoji, ts }` |
| `chat:history` | last 50 chat messages (sent on join) |
| `rooms` | `RoomListItem[]` to subscribers, throttled (250 ms) after any room change |

`RoomListItem = { code, host, players, max, phase, round }`. Only rooms with
`settings.public === true` and at least one connected member are listed. They are sorted
lobby-first, then by player count. `players` counts non-eliminated seated players.

`EMOJIS = ['😂','😎','😡','😭','🔥','👏','🤔','😱','🙏','💀','🤡','❤️']`

## Security notes

- Never send other players' hands. `viewFor` is the only serialiser.
- Escape chat text on the client (`textContent`, never `innerHTML`).
- Validate every payload type and length on the server.
