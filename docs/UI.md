# UI specification

Goal: a warm, polished card table. It should feel like a real deck on green felt, be
**mobile-first** (360×640 portrait upwards) and also look good on desktop.

## Global

- Languages: Uzbek (Latin, default) and English. Toggle in the top bar. All strings live in `i18n.js`.
- Themes: `dark` (default) and `light`. Toggle in the top bar sets `data-theme` on `<html>`.
  Both are stored in localStorage.
- Font: "Nunito" (Google Fonts), with system-ui as fallback.
- No horizontal scroll. Respect `env(safe-area-inset-*)`. Use `100dvh` layout.
- Tap targets ≥ 44px. Buttons have `:active` scale feedback.

## Design tokens (CSS custom properties on `:root`)

| Token | Dark | Light |
|---|---|---|
| `--bg` | #0f1514 | #eef2ee |
| `--surface` | #1a2321 | #ffffff |
| `--text` | #eef3ef | #1b2420 |
| `--muted` | #93a39c | #5d6b65 |
| `--felt` | radial #1f6b4a → #0e3b29 | radial #3f9a6e → #24704d |
| `--accent` | #f4b740 (gold) | #d18b00 |
| `--danger` | #ef5b5b | #d23c3c |
| `--card-red` | #d0202f | #d0202f |
| `--card-black` | #1b1b1f | #1b1b1f |

The card faces stay white in both themes, like real cards.

## Screens

### 1. Home
- Logo "108" with fanned cards illustration (3 SVG cards rotated).
- Nickname input (1–16 chars, remembered).
- Button **Xona ochish / Create room**.
- Code input (4 chars, uppercase) + **Kirish / Join**.
- If the URL has `?r=CODE`, prefill the code and focus the nickname.
- **Open rooms** list below the join form, live while the home screen is shown
  (`rooms:subscribe` / `rooms:unsubscribe`). Each row has the host avatar, "{host} xonasi",
  `players/6 · status` (green dot = waiting, gold dot = playing), and a button:
  **Kirish** (primary) for a lobby with space, otherwise **Tomosha** (secondary), which joins as a
  spectator (R10.1). The button uses the nickname field. Empty list: "Hozircha ochiq xona yo'q".

### 2. Lobby
- Big room code + **Havolani ulashish / Share link** button. Uses the Web Share API, falls
  back to clipboard, and shows a toast.
- Player list: avatar circle (initial and a colour hashed from the name), name,
  👑 for the host, "(siz)" for me, and a dim style for disconnected players.
- **Voice chat** panel (everyone): title, hint and a mic button "Mikrofonni yoqish" /
  "Mikrofonni o'chirish" (green when on). Each other connected member's row has a 🔊/🔇
  button to mute them locally.
- Host only: timer setting (Off / 15 / 30 / 60), **Hammaga ko'rinsin** switch (on by default; off
  hides the room from the open rooms list), **Boshlash / Start** (disabled when < 2 players),
  and a kick ✕ on each player.
- Everyone sees "🔒 Yopiq xona" next to the player count when the room is hidden.
- Rules summary in a collapsible `<details>`.

### 3. Table (game)
Layout (portrait phone):
```
┌───────────────────────────────┐
│ top bar: code · round · ⚙ ☾ 🌐 │
│   opponents (row, scrollable)  │  avatar + name + card count + score + timer ring
│                                │
│     [deck]   [discard pile]    │  active-suit badge, pending-penalty badge (+4)
│   status line ("Sizning navbat")│
│                                │
│  my hand (overlapping fan)     │
│ [Ko'tarish] [O'tkazish] 🎤 😀 💬 │
└───────────────────────────────┘
```
- Desktop (≥ 900px): opponents sit along an arc on the felt, the hand is larger and the chat
  panel can stay open on the right.
- **Hand:** cards overlap with negative margin based on count and screen width. Legal
  cards (`view.playable`) are lifted slightly with a gold glow. Illegal ones are dimmed when
  it is my turn. **Tap selects** (lifts more); **tap again plays**. On desktop a
  single click plays. A Queen opens a suit picker sheet (4 large suit buttons) before sending.
- **Deck:** a stack of backs with a count. Tapping it = draw (or accept the penalty, then the
  label shows "+N ko'tarish").
- **Discard:** the top 3 cards with a slight random rotation (deterministic from the card id).
- Active-suit badge: shown when `activeSuit !== top.suit` (after a Queen), with a big suit symbol.
- Turn indicator: the active avatar has a glowing ring and a conic-gradient countdown from
  `turnEndsAt`. When it is my turn, the hand area pulses gently and the phone vibrates
  (`navigator.vibrate(40)`) if available.
- Toast/status messages for events: "Ali +2 ko'tardi", "Vali navbatni o'tkazib yubordi",
  "Ozoda chiqdi! 👑 Dama bonusi".

### 4. Round result (modal)
- Loser name, their hand shown as small cards, points added (`before → after`). Notes for
  "108 → 0!" or "chiqib ketdi ❌". Queen bonus winners: "−30".
- Scoreboard table. The host sees **Keyingi raund**, others see "kutilmoqda…" with an 8 s countdown.

### 5. Game over (modal)
- Winner with a trophy and confetti (simple CSS particles), plus final standings.
  The host gets **Yangi o'yin** (back to the lobby with scores reset).

## Cards (`public/js/cards.js`)

- Pure SVG with viewBox `0 0 250 350` and rounded corners (r=16), white face, thin grey border.
- Corners: rank text and a small suit symbol, top-left and rotated 180° bottom-right.
- Number cards 6–10: classic pip layouts (positions table in code). The bottom half's pips
  are rotated 180°.
- J/Q/K: a framed panel with a stylised figure. Use a mirrored half-figure (crown or helmet
  shape, face circle, robe in suit colour with gold trims) with the letter in a medallion.
  K♠ gets a special gold border because it is the "+4" card.
- Ace: one large central pip. A♠ is ornate.
- Back: deep red with a lattice pattern and a white inner border, plus a "108" monogram in the centre.
- Suit colours: ♥♦ `--card-red`, ♠♣ `--card-black`.
- The SVG string is cached per card id.

## Animations

- Play: FLIP. Measure the card's rect in the hand (or the opponent avatar for others) and
  animate a clone to the discard pile with rotation, over 350 ms `cubic-bezier(.2,.8,.2,1)`.
- Draw: a back flies from the deck to my hand or to the opponent's avatar.
- Penalty/skip: a short shake or badge pop on the target avatar.
- Respect `prefers-reduced-motion` (disable flights, keep fades).

## Voice chat

- 🎤 button (actions row in the game, a labelled button in the lobby). It starts **off**. Tapping
  asks for mic permission the first time. When on, it turns green (`--voice`).
- Everyone hears everyone right away. No separate "join voice" step.
- Avatar badges: a small green mic dot (bottom left) when that person's mic is on, or a red 🔇
  dot when I muted them. The red dot wins.
- Speaking: a green outline ring (`.avatar.speaking`) on every avatar of the person talking,
  including me.
- In the game, tapping an opponent's seat mutes or unmutes them (with a toast). Spectators
  sit at the end of the opponents row as small "👁 tomoshabin" seats, so their bubbles and
  rings show too.
- If the browser blocks audio, a toast asks: "🔊 Ovozni eshitish uchun ekranga bir marta bosing".
- Errors: permission denied, no mic, or unsupported browser each have a toast (`mic_*` keys).
- If `RTCPeerConnection` is missing, all voice UI stays hidden.

## Chat and emoji

- 😀 button opens a small emoji bar (12 emojis). Tapping one sends a reaction and closes it.
- 💬 button opens a chat drawer (bottom sheet on mobile, side panel on desktop) with the
  last 50 messages and an input. An unread badge shows on 💬.
- **Floating bubbles:** each chat message and reaction appears as a bubble above the
  sender's avatar (or above my hand for me). It stays ~3 s, then fades/floats up
  over 0.8 s and is removed. Emoji bubbles are bigger and do a small pop/float.
  Maximum 3 bubbles per player (the oldest is removed).
