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
  rooms.js          Room manager: lobby, seats, host, timers, chat, voice signalling, socket handlers
  voice.js          ICE servers for voice chat: Cloudflare TURN credentials (env) or STUN fallback
  game/
    cards.js        Deck creation, shuffle (injectable rng), points, card parsing
    engine.js       Pure rules engine (docs/RULES.md). No I/O, no timers, no sockets.
test/
  engine.test.js    One or more tests per rule id (R1.1 …)
  rooms.test.js     Integration test with socket.io-client (create/join/start/play, list, voice)
  voice.test.js     ICE provider: Cloudflare fetch, caching, port-53 filter, fallback
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
  js/voice.js       Voice chat: WebRTC mesh, mic toggle, local mute, speaking detection
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
draw(game, playerId)                   // normal draw, accept a pending penalty, or start an R4.5 draw chain
drawStep(game)                         // R4.5 next card of a running draw chain (server step timer)
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
  mustPlay: false,                            // R4.5 turn came back to the same player
  drawChain: false, keepDrawing: false,       // R4.5 chain started / more steps to come
  autoPass: false,                            // R8.3 pass when the running chain ends
  lastChance: false,                          // R6.7 the other player's last turn (1v1)
  drawnCard: null | cardId,                   // last card drawn this turn (R4.2)
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
  drawing,                                // R4.5 draw chain running (no actions allowed)
  lastChance,                             // R6.7 last turn of the remaining player
  players: [{ id, name, seat, cardCount, score, status, connected, isHost, queenBonus, vid, mic }],
  spectators: [{ id, name }],
  lastRound, winnerId, standings?,        // standings when gameOver
  seq, events,
  hasDrawn, recent: [cardId x≤3],          // recent = top of discard pile, for rendering
  // added by rooms.js:
  myId,                                   // my public id (also set for spectators; `me` is null then)
  isHost, code, settings: { turnSeconds },
  turnEndsAt: epochMs | null, nextRoundAt: epochMs | null, serverNow,
  vote: null | { by, target, yes: [pid], no: [pid], need, endsAt },  // R10.4
  spectators: [{ id, name, connected, joinNext, vid, mic }]
}
```

`vid` is the member's current voice session id (`null` when not connected) and `mic` says
whether their mic is on. See "Voice chat" below.

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
- Spectator choice (R10.1): `room:watch { on }` sets `member.watch` (keep watching) and
  `joinNext = !on`. `addWaitingSpectators` seats only connected members with `joinNext`;
  `game:new` sets `joinNext = !watch`. In the lobby, `on: false` seats the member at once.
- A disconnected member is removed after `LOBBY_GRACE_MS` (30 s) in the lobby, and in any
  phase when they are not seated (spectators, R10.3). Seated players keep their seat.
- An empty room (no connected sockets) is deleted after 10 minutes.
- Timer: `rooms.js` owns one `setTimeout` per room. After every successful action it
  re-arms the timer if `turn` or `seq` changed (R8.2). When the timer fires it calls
  `engine.timeout`.
- Draw chain (R4.5): while `game.keepDrawing` is true, a second timer calls
  `engine.drawStep` every `DRAW_STEP_MS` (600 ms) and syncs. The turn timer is paused
  (`turnEndsAt: null`) and restarts in full when the chain ends.
- Vote kick (R10.4): `room.vote` holds one running vote. "Counted players" are the
  non-eliminated seated players; `need = floor(count / 2) + 1`. `checkVote` runs at the start
  of every `sync` and settles the vote as soon as the result is certain (kick, impossible,
  or target gone). A vote timer (`VOTE_MS`, 30 s; `startServer(port, { voteMs })` for tests)
  ends it as failed. A failed vote blocks its starter for `VOTE_COOLDOWN_MS` (30 s). Kicking
  uses the same `expel()` as the host ✕.
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
| `room:watch` | `{ on: boolean }` (true = keep watching, false = join next round) | spectator |
| `vote:start` | `{ playerId }` (R10.4 vote kick against that player) | counted player |
| `vote:cast` | `{ yes: boolean }` | counted player, not the target, once |
| `game:start` | – | host (≥ 2 players) |
| `game:next` | – | host, in roundOver |
| `game:end` | – | host (R7.7) |
| `game:new` | – | host, in gameOver: back to lobby, scores reset |
| `game:play` | `{ cardId, suit? }` | turn player |
| `game:draw` | – | turn player |
| `game:pass` | – | turn player |
| `chat:send` | `{ text }` (1–200 chars, trimmed, max 1 msg / 700 ms) | member |
| `react:send` | `{ emoji }` (must be in `EMOJIS`) | member |
| `voice:ice` | – → `{ ok, iceServers }` | member |
| `voice:mic` | `{ on: boolean }` | member (its current voice socket) |
| `voice:signal` | `{ to: pid, vid: target's vid, data }` (data ≤ 20 KB) | member (its current voice socket) |

Server → client:

| Event | Payload |
|---|---|
| `state` | PublicView, sent to every socket in the room after every change |
| `chat` | `{ id, playerId, name, text, ts }` |
| `react` | `{ playerId, emoji, ts }` |
| `chat:history` | last 50 chat messages (sent on join) |
| `rooms` | `RoomListItem[]` to subscribers, throttled (250 ms) after any room change |
| `voice:signal` | `{ from: pid, vid: sender's vid, data }`, only to the target's voice socket |
| `kicked` | `{ vote?: true }` to the removed member (host ✕ or vote kick) |
| `vote:end` | `{ name, kicked }` to the room when a vote is decided (not when it is dropped) |

`RoomListItem = { code, host, players, max, phase, round }`. Only rooms with
`settings.public === true` and at least one connected member are listed. They are sorted
lobby-first, then by player count. `players` counts non-eliminated seated players.

`EMOJIS = ['😂','😎','😡','😭','🔥','👏','🤔','😱','🙏','💀','🤡','❤️']`

## Voice chat

Everyone in the room (players, spectators, eliminated players) is in one WebRTC **mesh**:
each pair has one `RTCPeerConnection`. The server only relays signalling; audio goes peer to
peer, or through Cloudflare TURN when NAT blocks a direct path (common on mobile networks).

- **Voice endpoint.** A member's newest socket is its voice socket. Every (re)attach gives the
  member a new random `vid` and resets `mic` to `false`. When the last socket goes away, `vid`
  becomes `null`. A changed `vid` tells the other clients to drop the old connection.
- **Who offers.** For each pair, the member with the smaller `pid` sends the offer. Offers never
  collide, so there is no "perfect negotiation" logic.
- **One negotiation per connection.** The offer has one audio transceiver (`sendrecv`). The
  answerer sets its transceiver to `sendrecv`. Mic on/off only calls `sender.replaceTrack()`,
  so a live connection is never renegotiated. Everyone hears everyone as soon as they join.
- **Signal data:** `{ type: 'offer'|'answer', sdp, cid }` or `{ type: 'cand', c, cid }`. `cid` is
  a random id per connection attempt chosen by the offerer. Stale signals are ignored. Each
  peer applies signals through a promise chain, so candidates never arrive before the
  description.
- **Retry.** Only the offering side retries: on `connectionState === 'failed'` or after 25 s
  without connecting, it closes the connection and offers again (2 s, 4 s … up to 15 s).
- **Mic state.** The client sends `voice:mic` after toggling. After a reconnect (mic reset by
  the server), `syncVoice` sends it again if the mic is still on.
- **Local mute** is client-only (`audio.muted`), per tab.
- **Autoplay.** If `audio.play()` is blocked, a toast asks for one tap. Any `pointerdown` or
  `keydown` retries blocked audio and resumes the `AudioContext`.
- **Speaking ring.** An `AnalyserNode` per stream (remote and my mic). Every 120 ms, an RMS above
  0.03 adds `.speaking` to every `[data-pid] .avatar` of that player for 400 ms.
- **ICE servers** come from `voice:ice`. With `TURN_KEY_ID` and `TURN_KEY_API_TOKEN` set, the
  server calls Cloudflare
  `POST https://rtc.live.cloudflare.com/v1/turn/keys/{id}/credentials/generate-ice-servers`
  with `{ ttl: 86400 }`. It caches the result for 12 h and drops `:53` urls (browsers time
  out on them). On error it falls back to STUN and retries after 60 s. With no keys, it
  uses STUN only.

## Security notes

- Never send other players' hands. `viewFor` is the only serialiser.
- Escape chat text on the client (`textContent`, never `innerHTML`).
- Validate every payload type and length on the server.
- Voice signals are relayed only between members of the same room, only from and to the
  current voice socket, and only when the target `vid` matches. The TURN API token never
  leaves the server; clients get short-lived credentials.
