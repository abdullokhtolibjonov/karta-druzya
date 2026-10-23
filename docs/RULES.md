# Game rules — "108" (Karta Druzya)

This is the **single source of truth** for game logic. `server/game/engine.js` must
implement exactly this, and `test/engine.test.js` must have a test for every numbered rule.
When a rule changes, update this file first, then the tests, then the engine.

## 1. Deck and players

- R1.1 Deck: 36 cards. Ranks `6 7 8 9 10 J Q K A`, suits `S` ♠ (qarg'a), `C` ♣ (chillik),
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
- R4.2 After drawing, the player may play **any playable card** from their hand (the drawn one
  or another) or **pass**. Passing ends the turn.
- R4.3 A player may not pass without drawing first. The only exception is the timeout (R8).
- R4.4 If the deck is empty, the discard pile except its top card is shuffled into a new deck.
  If no cards are available at all, "draw" gives nothing and the player may pass.
- R4.5 **Turn comes back to the same player** — they must cover their own 8 (R5.4, R9.3)
  or their Ace skipped everyone else (R5.9).
  - If a card in their hand fits, they may still draw, but **only 1 card** (R4.1, R4.2).
  - If nothing in their hand fits, "draw" starts a **draw chain**: cards are drawn
    **one at a time** with a short pause between them (server side, ~0.6 s) until a
    playable card comes out. They **must play that card**; passing is not allowed.
    While the chain runs the turn timer is paused and the player cannot act.
  - Only when the deck and discard run out without a playable card may they pass.
  - A turn that comes back only because the other player took a penalty (R5.3, e.g. 2
    players and a 7) is **not** an R4.5 case: the normal 1-card draw applies (R4.1).

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
- R5.5 If they cannot or will not cover, they draw under R4.5.
- R5.6 If the drawn card is another 8 and they play it, they must cover again (R5.4).
- R5.7 A special card used as a cover has its normal effect, e.g. an 8 covered with a 7
  gives the next player a penalty of 2.
- R5.8 **8 as the last card:** the player does not finish. The draw chain (R4.5) starts
  automatically.

### Ace (skip)

- R5.9 The next active player loses their turn and play continues after them. With 2 active
  players, the Ace player plays again under R4.5 (an Ace as the last card: R6.6).

## 6. Finishing the round

- R6.1 A player whose hand becomes empty finishes the round and stops taking part in it,
  except when their last card was an 8 (R5.8) or an Ace in 1v1 (R6.6). Their last
  card's effect (penalty, skip) still applies to the next player.
- R6.2 If a player's **last card is the Queen of Hearts** (`QH`), they get a **Queen bonus**
  (R7.3). They still choose a suit for the next player. Other Queens give no bonus.
- R6.3 The round ends when **exactly one** player still has cards: the **loser**.
  If a penalty is pending against the loser at that moment, they draw those cards first.
  With 1v1 the end can be delayed by R6.6–R6.7.

### Last two players (1v1)

- R6.4 R6.5–R6.7 apply when a player plays their last card while exactly **one other** player
  is still active. Call them the **finisher** and the **other player**.
- R6.5 **Last card is a 6, 7 or K♠:** the finisher finishes at once. The other player
  cannot stack it back: they draw the penalty and the round ends (R6.3).
- R6.6 **Last card is an Ace:** the skip brings the turn back to the finisher (R5.9), so like
  an 8 (R5.8) they do **not** finish. The draw chain (R4.5) starts automatically. If no cards
  are left to draw at all, they finish.
- R6.7 **Last chance.** With any other last card (including a 9 or a Queen) the finisher
  finishes, and the other player gets **one last turn** before the round ends.
  - If nothing in their hand fits, the round ends at once.
  - They may play a fitting card or **pass**. They may **not** draw. A timeout is a pass.
  - After their card the round ends, except:
    - an **8** must be covered (R5.4); if nothing fits, the draw chain runs (R4.5) and they
      must play the first fitting card;
    - an **Ace** brings the turn back to them (R4.5);
    - while the turn stays with them this way, the round goes on.
  - A 6, 7 or K♠ played here has no penalty effect: nobody is left to take it.
  - Cards drawn here count toward their points. They are still the loser, even if their hand
    becomes empty (then 0 points are added). The Queen of Hearts as their last card gives the Queen bonus (R6.2).

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
  - not yet drawn → draw 1 card, then pass (except the R4.5 case below)
  - already drawn → pass
  - R4.5 with nothing in hand that fits and not yet drawn → the draw chain runs, then the
    turn passes (the drawn card stays in hand). With a fitting card in hand → draw 1, pass.
  - last chance (R6.7), before any 8 or Ace → pass, the round ends

## 9. Starter card effects (R1.4)

The starter card affects the **starting player** as if the previous player had played it:

- R9.1 6 / 7 / K♠ → pending penalty against the starting player (1 / 2 / 4). They may stack.
- R9.2 A → the starting player is skipped and the next player starts.
- R9.3 8 → the starting player must cover it (R5.4).
- R9.4 Q → `activeSuit` is the Queen's own suit.
- R9.5 Others (9, 10, J, K of ♣♥♦) → normal.

## 10. People joining and leaving

- R10.1 Someone who joins during a game becomes a spectator. By default they are dealt in at
  the **next round** with score 0, as long as there are fewer than 6 players.
  - A spectator may switch at any time between **"join next round"** and **"keep watching"**.
    The choice stays until they change it, also when the host starts a new game. Choosing
    "join" in the lobby seats them right away if there is room.
  - Only spectators who are **connected** when a round starts are dealt in.
- R10.2 A player who leaves or is kicked during a round has their hand shuffled into the
  deck and leaves the round. If this leaves one active player, the round ends without
  scoring (no loser).
- R10.3 A disconnected player keeps their seat. The turn timer plays for them.
  A disconnected spectator is removed from the room after 30 seconds.
- R10.4 **Vote kick.** Any player may start a vote to remove another player, in the lobby or
  during the game. Spectators cannot start or join a vote.
  - Counted players: all seated players except eliminated ones (R7.5), the target included.
    With fewer than 3 counted players there is no vote kick.
  - The starter votes "yes" automatically. Every other counted player except the target may
    vote "yes" or "no" once.
  - The target is removed when "yes" votes reach **more than half** of the counted players:
    3 players → 2, 4 → 3, 5 → 3, 6 → 4. Removal works like leaving (R10.2) and the game goes on.
  - The vote fails after **30 seconds**, or earlier once enough "yes" votes are no longer possible.
    After a failed vote its starter must wait 30 seconds before starting another one.
  - Only one vote runs in a room at a time. If the target leaves, the vote is dropped.
  - The removed player may come back with the room link. During a game they join as a
    spectator and are dealt in at the next round with score 0 (R10.1).
