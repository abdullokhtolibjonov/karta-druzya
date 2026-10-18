# Game rules — "108" (Karta Druzya)

This is the **single source of truth** for game logic. `server/game/engine.js` must
implement exactly this, and `test/engine.test.js` must have a test for every numbered rule.
When a rule changes, update this file first, then the tests, then the engine.

## 1. Deck and players

- R1.1 Deck: 36 cards. Ranks `6 7 8 9 10 J Q K A`, suits `S` ♠ (qarg'a), `C` ♣ (chillak),
  `H` ♥ (yurak), `D` ♦ (g'isht). Card id = rank + suit, e.g. `10H`, `QS`, `KS`.
- R1.2 2–6 players take part in a round. Extra people are spectators.
- R1.3 Each player gets **6 cards**. With 6 players: **5 cards** each, so the deck still has cards left.
- R1.4 After dealing, the top card of the deck goes face-up on the discard pile and
  becomes the **starter card**.

## 2. Turn order

- R2.1 Play goes clockwise (seat order) and skips players who have already finished the round.
- R2.2 Round 1: a random player starts. Later rounds: the **loser of the previous round**
  starts. If that player was eliminated, the next active player in seat order starts.

## 3. What can be played (no penalty pending)

The table state has `top` (top card of the discard pile) and `activeSuit`.
Normally `activeSuit = top.suit`. The exceptions are a Queen, where it is the chosen suit,
and a starter Queen, where it is the Queen's own suit.

- R3.1 Any card with `suit === activeSuit` **or** `rank === top.rank`.
- R3.2 Any **9** can be played on anything, including on a 9 and on a Queen's chosen suit.
  After a 9, `activeSuit` is that 9's suit.
- R3.3 Any **Queen** can be played on anything. The player **must choose a suit**, which
  becomes `activeSuit`. Queen on Queen is allowed.
- R3.4 One card per action. Playing several cards at once is not allowed.

## 4. Drawing and passing

- R4.1 Once per turn the player may draw 1 card instead of playing. This is allowed even
  when they have a playable card.
- R4.2 After drawing, the player may play **only the drawn card** (if it is playable) or **pass**.
  Passing ends the turn.
- R4.3 A player may not pass without drawing first. The only exception is the timeout (R8).
- R4.4 If the deck is empty, the discard pile except its top card is shuffled into a new deck.
  If no cards are available at all, "draw" gives nothing and the player may pass.

## 5. Special cards

| Card | Effect |
|---|---|
| **6** | Next player: penalty of **1** card |
| **7** | Next player: penalty of **2** cards |
| **K♠** (`KS`) | Next player: penalty of **4** cards. Other kings are normal cards. |
| **8** | The same player must **cover** it (R5.4) |
| **A** | Next player is **skipped** |
| **Q** | Wild card, choose suit (R3.3) |
| **9** | Wild card, no suit choice (R3.2) |

### Penalties (6, 7, K♠)

- R5.1 After a 6/7/K♠ is played, the next active player has a **pending penalty**
  `{rank, count}`.
- R5.2 The penalised player may **stack** a card of the **same rank** (6 on 6, 7 on 7).
  Suit doesn't matter. The count grows (+1 for a 6, +2 for a 7) and the penalty moves to the
  next active player. K♠ cannot be stacked because it is the only one.
  Nothing else (9, Q, other ranks) can be played while a penalty is pending.
- R5.3 Otherwise the player **accepts**: they draw `count` cards and their turn is
  **skipped**, so they do not play this turn. In the UI and protocol, accepting is the same
  "draw" action.

### Eight (cover)

- R5.4 After playing an 8, the **same player** keeps the turn and must cover it with a card
  playable under R3 (same suit, another 8, a 9 or a Queen). The turn timer restarts.
- R5.5 If they cannot or will not cover, they draw 1 (R4.1). They play it if it fits;
  otherwise they pass and the turn moves on.
- R5.6 If the drawn card is another 8 and they play it, they must cover again (R5.4).
- R5.7 A special card used as a cover has its normal effect, e.g. an 8 covered with a 7
  gives the next player a penalty of 2.
- R5.8 **8 as the last card:** the player does not finish. They automatically draw 1 card
  and continue under R5.5.

### Ace (skip)

- R5.9 The next active player loses their turn and play continues after them. With 2 active
  players, the Ace player plays again.

## 6. Finishing the round

- R6.1 A player whose hand becomes empty finishes the round and stops taking part in it,
  except when their last card was an 8 (R5.8). Their last card's effect (penalty, skip) still
  applies to the next player.
- R6.2 If a player's **last card is a Queen**, they get a **Queen bonus** (R7.3).
  They still choose a suit for the next player.
- R6.3 The round ends when **exactly one** player still has cards: the **loser**.
  If a penalty is pending against the loser at that moment, they draw those cards first.

## 7. Scoring

- R7.1 Card points: `6=6 7=7 8=8 9=9 10=10 J=2 Q=3 K=4 A=11`.
- R7.2 Only the **loser** adds the sum of their hand to their score.
- R7.3 Every player with a Queen bonus this round: `score = max(0, score − 30)`.
  Scores never go below 0.
- R7.4 After adding, if the score is **exactly 108**, it resets to **0**.
- R7.5 If the score is **greater than 108**, the player is **eliminated**. They stay in the
  room as a spectator and are not dealt in again.
- R7.6 The game ends when ≤ 1 non-eliminated player remains. That player is the **winner**.
- R7.7 The host can end the game at any time. Final standings: non-eliminated players
  first, sorted by score ascending, then eliminated players.

## 8. Turn timer

- R8.1 Every turn has a time limit (room setting: 15 / 30 / 60 s or off; default **30 s**).
- R8.2 The timer **restarts** after any action that keeps the turn with the same player
  (an 8 played, a card drawn).
- R8.3 On timeout:
  - pending penalty → accept it (R5.3)
  - not yet drawn → draw 1 card, then pass
  - already drawn → pass

## 9. Starter card effects (R1.4)

The starter card affects the **starting player** as if the previous player had played it:

- R9.1 6 / 7 / K♠ → pending penalty against the starting player (1 / 2 / 4). They may stack.
- R9.2 A → the starting player is skipped and the next player starts.
- R9.3 8 → the starting player must cover it (R5.4).
- R9.4 Q → `activeSuit` is the Queen's own suit.
- R9.5 Others (9, 10, J, K of ♣♥♦) → normal.

## 10. People joining and leaving

- R10.1 Someone who joins during a game becomes a spectator. They are dealt in at the
  **next round** with score 0, as long as there are fewer than 6 players.
- R10.2 A player who leaves or is kicked during a round has their hand shuffled into the
  deck and leaves the round. If this leaves one active player, the round ends without
  scoring (no loser).
- R10.3 A disconnected player keeps their seat. The turn timer plays for them.
