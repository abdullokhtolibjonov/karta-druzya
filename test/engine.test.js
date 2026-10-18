import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../server/game/engine.js';
import { seededRng, makeDeck, POINTS, parse } from '../server/game/cards.js';

// Build a game mid-round with hand-crafted hands.
// hands: { a: ['6S', ...], b: [...] }, top: '9H', deck: [...] (pop() takes from the end)
function setup({ hands, top, deck = ['6D', '7D', '10D', 'JD', 'KD', 'AD'], turn, activeSuit, pending = null, scores = {} }) {
  const g = E.createGame({ rng: seededRng(1) });
  for (const id of Object.keys(hands)) E.addPlayer(g, { id, name: id.toUpperCase() });
  g.phase = 'playing';
  g.round = 1;
  for (const p of g.players) {
    p.hand = [...hands[p.id]];
    p.status = 'active';
    p.score = scores[p.id] ?? 0;
  }
  g.discard = [top];
  g.deck = [...deck];
  g.activeSuit = activeSuit ?? parse(top).suit;
  g.turn = turn ?? g.players[0].id;
  g.pending = pending;
  return g;
}

const hand = (g, id) => g.players.find((p) => p.id === id).hand;
const pl = (g, id) => g.players.find((p) => p.id === id);

function lobby(n, seed = 7) {
  const g = E.createGame({ rng: seededRng(seed) });
  for (let i = 0; i < n; i++) E.addPlayer(g, { id: 'p' + i, name: 'P' + i });
  return g;
}

// ----- R1 -----
test('R1.1 deck has 36 unique cards with correct points', () => {
  const d = makeDeck();
  assert.equal(d.length, 36);
  assert.equal(new Set(d).size, 36);
  assert.equal(POINTS.J, 2);
  assert.equal(POINTS.A, 11);
  assert.equal(POINTS['6'], 6);
});

test('R1.2 max 6 players, min 2 to start', () => {
  const g = lobby(1);
  assert.equal(E.startRound(g).error, 'not_enough_players');
  const g6 = lobby(6);
  assert.equal(E.addPlayer(g6, { id: 'x', name: 'X' }).error, 'room_full');
});

test('R1.3 6 cards each, 5 with six players; R1.4 starter card', () => {
  for (const n of [2, 3, 4, 5, 6]) {
    const g = lobby(n);
    assert.ok(E.startRound(g).ok);
    const per = n === 6 ? 5 : 6;
    let total = g.deck.length + g.discard.length;
    for (const p of g.players) {
      total += p.hand.length;
      assert.ok(p.hand.length >= per); // may hold a starter penalty later, never fewer
    }
    assert.equal(g.discard.length, 1);
    assert.equal(total, 36);
  }
});

// ----- R2 -----
test('R2.1 turn order skips finished players', () => {
  const g = setup({ hands: { a: ['9H', '6C'], b: ['10C'], c: ['JC'], d: ['KC'] }, top: '10H', turn: 'a' });
  pl(g, 'b').status = 'finished';
  assert.ok(E.play(g, 'a', '9H').ok);
  assert.equal(g.turn, 'c');
});

test('R2.2 loser of previous round starts the next', () => {
  const g = lobby(3);
  g.lastLoserId = 'p2';
  for (let s = 0; s < 20; s++) {
    const h = lobby(3, s);
    h.lastLoserId = 'p2';
    E.startRound(h);
    const starter = parse(h.discard[0]).rank;
    if (starter !== 'A') assert.equal(h.events[0].playerId, 'p2');
  }
  pl(g, 'p2').status = 'eliminated';
  E.startRound(g);
  assert.equal(g.events[0].playerId, 'p0');
});

// ----- R3 -----
test('R3.1 suit or rank match', () => {
  const g = setup({ hands: { a: ['10S', 'JH', 'KC'], b: ['6C'] }, top: '10H' });
  assert.equal(E.play(g, 'a', 'KC').error, 'card_not_playable');
  assert.ok(E.play(g, 'a', '10S').ok);
  const g2 = setup({ hands: { a: ['JH', 'KC'], b: ['6C'] }, top: '10H' });
  assert.ok(E.play(g2, 'a', 'JH').ok);
});

test('R3.2 nine plays on anything, even after a queen; sets its suit', () => {
  const g = setup({ hands: { a: ['9S', 'KC'], b: ['6C', 'JC'] }, top: 'QH', activeSuit: 'D' });
  assert.ok(E.play(g, 'a', '9S').ok);
  assert.equal(g.activeSuit, 'S');
  const g2 = setup({ hands: { a: ['9C', 'KC'], b: ['6C'] }, top: '9D' });
  assert.ok(E.play(g2, 'a', '9C').ok);
});

test('R3.3 queen on anything, must choose suit', () => {
  const g = setup({ hands: { a: ['QS', 'KC'], b: ['6C', 'JD'] }, top: '10H' });
  assert.equal(E.play(g, 'a', 'QS').error, 'choose_suit');
  assert.ok(E.play(g, 'a', 'QS', 'D').ok);
  assert.equal(g.activeSuit, 'D');
  assert.equal(g.turn, 'b');
  // only D, Q or 9 now
  assert.equal(E.playError(g, pl(g, 'b'), '6C'), 'card_not_playable');
  assert.equal(E.playError(g, pl(g, 'b'), 'JD'), null);
});

test('R3.4 not in hand / not your turn', () => {
  const g = setup({ hands: { a: ['10H', 'KC'], b: ['6C'] }, top: '10S' });
  assert.equal(E.play(g, 'b', '6C').error, 'not_your_turn');
  assert.equal(E.play(g, 'a', 'AH').error, 'not_in_hand');
});

// ----- R4 -----
test('R4.1/R4.2 draw allowed with playable card; after draw only the drawn card', () => {
  const g = setup({ hands: { a: ['10H', 'KC'], b: ['6C'] }, top: '10S', deck: ['AS'] });
  assert.ok(E.draw(g, 'a').ok);
  assert.equal(g.drawnCard, 'AS');
  assert.equal(E.play(g, 'a', '10H').error, 'only_drawn_card');
  assert.equal(E.draw(g, 'a').error, 'already_drawn');
  assert.ok(E.play(g, 'a', 'AS').ok);
});

test('R4.2/R4.3 pass only after drawing', () => {
  const g = setup({ hands: { a: ['10H', 'KC'], b: ['6C'] }, top: '10S', deck: ['7D'] });
  assert.equal(E.pass(g, 'a').error, 'draw_first');
  E.draw(g, 'a');
  assert.ok(E.pass(g, 'a').ok);
  assert.equal(g.turn, 'b');
  assert.equal(g.hasDrawn, false);
});

test('R4.4 reshuffle discard when deck empty', () => {
  const g = setup({ hands: { a: ['KC'], b: ['6C'] }, top: '10S', deck: [] });
  g.discard = ['7H', '8H', '10S'];
  E.draw(g, 'a');
  assert.equal(g.discard.length, 1);
  assert.equal(g.discard[0], '10S');
  assert.equal(hand(g, 'a').length, 2);
  assert.equal(g.deck.length, 1);
  // nothing at all to draw
  const g2 = setup({ hands: { a: ['KC'], b: ['6C'] }, top: '10S', deck: [] });
  assert.ok(E.draw(g2, 'a').ok);
  assert.equal(hand(g2, 'a').length, 1);
  assert.ok(E.pass(g2, 'a').ok);
});

// ----- R5 penalties -----
test('R5.1 six / seven / K♠ create pending penalty on next player', () => {
  const g = setup({ hands: { a: ['6H', 'KC'], b: ['10C'], c: ['JC'] }, top: '10H' });
  E.play(g, 'a', '6H');
  assert.deepEqual(g.pending, { rank: '6', count: 1 });
  assert.equal(g.turn, 'b');
  const g2 = setup({ hands: { a: ['KS', 'KC'], b: ['10C'] }, top: '10S' });
  E.play(g2, 'a', 'KS');
  assert.deepEqual(g2.pending, { rank: 'K', count: 4 });
  const g3 = setup({ hands: { a: ['KH', 'KC'], b: ['10C'] }, top: '10H' });
  E.play(g3, 'a', 'KH');
  assert.equal(g3.pending, null);
});

test('R5.2 stacking same rank accumulates and passes on; nothing else allowed', () => {
  const g = setup({ hands: { a: ['7H', 'KC'], b: ['7C', '9C', 'QC'], c: ['JC', '10D'] }, top: '10H' });
  E.play(g, 'a', '7H');
  assert.equal(E.play(g, 'b', '9C').error, 'must_stack_or_draw');
  assert.equal(E.play(g, 'b', 'QC', 'H').error, 'must_stack_or_draw');
  assert.equal(E.pass(g, 'b').error, 'must_stack_or_draw');
  assert.ok(E.play(g, 'b', '7C').ok);
  assert.deepEqual(g.pending, { rank: '7', count: 4 });
  assert.equal(g.turn, 'c');
  const g2 = setup({ hands: { a: ['KC'], b: ['6C', 'KD'] }, top: 'KS', pending: { rank: 'K', count: 4 }, turn: 'b' });
  assert.equal(E.play(g2, 'b', 'KD').error, 'must_accept_penalty');
});

test('R5.3 accepting penalty draws count and skips turn', () => {
  const g = setup({ hands: { a: ['6H', 'KC'], b: ['10C'], c: ['JC'] }, top: '10H', deck: ['AD', 'JD', 'KD'] });
  E.play(g, 'a', '6H');
  assert.ok(E.draw(g, 'b').ok);
  assert.equal(hand(g, 'b').length, 2);
  assert.equal(g.pending, null);
  assert.equal(g.turn, 'c');
});

// ----- R5 eight -----
test('R5.4 eight: same player must cover', () => {
  const g = setup({ hands: { a: ['8H', '10H', 'KC'], b: ['10C'] }, top: '10H' });
  E.play(g, 'a', '8H');
  assert.equal(g.turn, 'a');
  assert.equal(g.mustCover, true);
  assert.equal(E.play(g, 'a', 'KC').error, 'card_not_playable');
  assert.ok(E.play(g, 'a', '10H').ok);
  assert.equal(g.turn, 'b');
});

test('R5.5 eight: draw 1, pass if it does not fit', () => {
  const g = setup({ hands: { a: ['8H', 'KC'], b: ['10C'] }, top: '10H', deck: ['JC'] });
  E.play(g, 'a', '8H');
  E.draw(g, 'a');
  assert.equal(E.play(g, 'a', 'JC').error, 'card_not_playable');
  assert.ok(E.pass(g, 'a').ok);
  assert.equal(g.turn, 'b');
});

test('R5.6 drawn eight must be covered again', () => {
  const g = setup({ hands: { a: ['8H', 'KC', 'JS'], b: ['10C'] }, top: '10H', deck: ['KD', '8C'] });
  E.play(g, 'a', '8H');
  E.draw(g, 'a');
  assert.ok(E.play(g, 'a', '8C').ok);
  assert.equal(g.turn, 'a');
  assert.equal(g.mustCover, true);
  assert.equal(g.hasDrawn, false);
  assert.ok(E.play(g, 'a', 'KC').ok);
  assert.equal(g.turn, 'b');
});

test('R5.7 cover with a seven gives penalty', () => {
  const g = setup({ hands: { a: ['8H', '7H', 'KC'], b: ['10C'] }, top: '10H' });
  E.play(g, 'a', '8H');
  E.play(g, 'a', '7H');
  assert.deepEqual(g.pending, { rank: '7', count: 2 });
  assert.equal(g.turn, 'b');
});

test('R5.8 eight as last card: auto-draw, not finished', () => {
  const g = setup({ hands: { a: ['8H'], b: ['10C'], c: ['JC'] }, top: '10H', deck: ['JD'] });
  E.play(g, 'a', '8H');
  assert.equal(pl(g, 'a').status, 'active');
  assert.deepEqual(hand(g, 'a'), ['JD']);
  assert.equal(g.drawnCard, 'JD');
  assert.equal(g.turn, 'a');
  assert.ok(E.pass(g, 'a').ok);
  // drawn card fits: plays and finishes
  const g2 = setup({ hands: { a: ['8H'], b: ['10C'], c: ['JC'] }, top: '10H', deck: ['JH'] });
  E.play(g2, 'a', '8H');
  assert.ok(E.play(g2, 'a', 'JH').ok);
  assert.equal(pl(g2, 'a').status, 'finished');
});

test('R5.9 ace skips next; with 2 players ace player goes again', () => {
  const g = setup({ hands: { a: ['AH', 'KC'], b: ['10C'], c: ['JC'] }, top: '10H' });
  E.play(g, 'a', 'AH');
  assert.equal(g.turn, 'c');
  const g2 = setup({ hands: { a: ['AH', 'KC'], b: ['10C'] }, top: '10H' });
  E.play(g2, 'a', 'AH');
  assert.equal(g2.turn, 'a');
});

// ----- R6 / R7 -----
test('R6.1 finishing player leaves round; last card effect still applies', () => {
  const g = setup({ hands: { a: ['7H'], b: ['10C', 'JD'], c: ['JC', 'KD'] }, top: '10H', deck: ['6D', '9D', 'AS'] });
  E.play(g, 'a', '7H');
  assert.equal(pl(g, 'a').status, 'finished');
  assert.deepEqual(g.pending, { rank: '7', count: 2 });
  assert.equal(g.turn, 'b');
});

test('R6.3 round ends with one player; pending penalty applied to loser first', () => {
  const g = setup({ hands: { a: ['7H'], b: ['10C'] }, top: '10H', deck: ['6D', 'JD'] });
  E.play(g, 'a', '7H');
  assert.equal(g.phase, 'roundOver');
  assert.equal(g.lastRound.loserId, 'b');
  assert.equal(g.lastRound.added, 10 + 2 + 6);
  assert.equal(pl(g, 'b').score, 18);
});

test('R7.2/R7.3 only loser scores; queen bonus −30 floored at 0', () => {
  const g = setup({ hands: { a: ['QH'], b: ['10C', 'AC'], c: ['9C', '10D'] }, top: '10H', scores: { a: 40, b: 0, c: 10 } });
  E.play(g, 'a', 'QH', 'C');
  assert.equal(pl(g, 'a').status, 'finished');
  E.play(g, 'b', '10C');
  E.play(g, 'c', '9C');
  E.play(g, 'b', 'AC');
  assert.equal(g.phase, 'roundOver');
  assert.equal(g.lastRound.loserId, 'c');
  assert.equal(pl(g, 'c').score, 20);
  assert.equal(pl(g, 'a').score, 10);
  assert.equal(pl(g, 'b').score, 0);
  assert.deepEqual(g.lastRound.bonuses, ['a']);
  const g2 = setup({ hands: { a: ['QH'], b: ['10C'] }, top: '10H', scores: { a: 12 } });
  E.play(g2, 'a', 'QH', 'C');
  assert.equal(pl(g2, 'a').score, 0);
});

test('R7.4 exactly 108 resets to 0', () => {
  const g2 = setup({ hands: { a: ['10H'], b: ['10C'] }, top: '10S', scores: { b: 98 } });
  E.play(g2, 'a', '10H');
  assert.equal(pl(g2, 'b').score, 0);
  assert.equal(g2.lastRound.reset, true);
  assert.equal(g2.phase, 'roundOver');
});

test('R7.5/R7.6 over 108 eliminated; game ends when one left', () => {
  const g = setup({ hands: { a: ['10H'], b: ['10C'] }, top: '10S', scores: { b: 99 } });
  E.play(g, 'a', '10H');
  assert.equal(pl(g, 'b').status, 'eliminated');
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.winnerId, 'a');
  const g3 = setup({ hands: { a: ['10H'], b: ['JH'], c: ['10C'] }, top: '10S', scores: { c: 99 } });
  E.play(g3, 'a', '10H');
  E.play(g3, 'b', 'JH');
  assert.equal(g3.phase, 'roundOver');
  assert.equal(pl(g3, 'c').status, 'eliminated');
  assert.ok(E.startRound(g3).ok);
  assert.equal(pl(g3, 'c').hand.length, 0);
  assert.equal(pl(g3, 'c').status, 'eliminated');
});

test('R7.7 host ends game anytime; standings sorted', () => {
  const g = setup({ hands: { a: ['10H', 'JC'], b: ['10C'], c: ['KD'] }, top: '10S', scores: { a: 50, b: 20, c: 30 } });
  pl(g, 'c').status = 'eliminated';
  assert.ok(E.endGame(g).ok);
  assert.equal(g.phase, 'gameOver');
  assert.deepEqual(g.standings.map((s) => s.id), ['b', 'a', 'c']);
  assert.equal(g.winnerId, 'b');
});

// ----- R8 -----
test('R8.3 timeout: penalty accepted / draw+pass / pass', () => {
  const g = setup({ hands: { a: ['KC'], b: ['10C'], c: ['JC'] }, top: '6H', pending: { rank: '6', count: 1 } });
  E.timeout(g);
  assert.equal(hand(g, 'a').length, 2);
  assert.equal(g.turn, 'b');
  E.timeout(g);
  assert.equal(hand(g, 'b').length, 2);
  assert.equal(g.turn, 'c');
  E.draw(g, 'c');
  E.timeout(g);
  assert.equal(hand(g, 'c').length, 2);
  assert.equal(g.turn, 'a');
});

// ----- R9 -----
test('R9 starter card effects apply to the starting player', () => {
  for (const [card, check] of [
    ['6C', (x) => assert.deepEqual(x.pending, { rank: '6', count: 1 })],
    ['7C', (x) => assert.deepEqual(x.pending, { rank: '7', count: 2 })],
    ['KS', (x) => assert.deepEqual(x.pending, { rank: 'K', count: 4 })],
    ['8C', (x) => assert.equal(x.mustCover, true)],
    ['QH', (x) => assert.equal(x.activeSuit, 'H')],
    ['KH', (x) => assert.equal(x.pending, null)],
  ]) {
    const x = riggedStart(card);
    check(x);
    assert.equal(x.turn, x.events[0].playerId);
  }
  const a = riggedStart('AC');
  assert.notEqual(a.turn, a.events[0].playerId);
  assert.equal(a.events[1].type, 'skip');
});

// Start a 3-player round where the starter card is `card`.
function riggedStart(card) {
  for (let seed = 1; seed < 5000; seed++) {
    const g = lobby(3, seed);
    E.startRound(g);
    if (g.discard[0] === card) return g;
  }
  throw new Error('no seed for ' + card);
}

// ----- R10 -----
test('R10.2 leaving mid-round: cards back to deck, turn moves, round aborts if one left', () => {
  const g = setup({ hands: { a: ['10H', 'KC'], b: ['10C'], c: ['JC'] }, top: '10S' });
  const before = g.deck.length;
  E.removePlayer(g, 'a');
  assert.equal(g.deck.length, before + 2);
  assert.equal(g.turn, 'b');
  E.removePlayer(g, 'c');
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.lastRound.aborted, true);
});

test('R10.1 add player between rounds joins next round', () => {
  const g = setup({ hands: { a: ['10H'], b: ['10C', 'JD'], c: ['JC'] }, top: '10S' });
  assert.equal(E.addPlayer(g, { id: 'z', name: 'Z' }).error, 'game_in_progress');
  E.play(g, 'a', '10H');
  E.play(g, 'b', '10C');
  E.play(g, 'c', 'JC');
  assert.equal(g.phase, 'roundOver');
  assert.ok(E.addPlayer(g, { id: 'z', name: 'Z' }).ok);
  E.startRound(g);
  assert.equal(pl(g, 'z').status, 'active');
  assert.equal(pl(g, 'z').hand.length, 6);
});

test('view hides other hands and lists playable cards', () => {
  const g = setup({ hands: { a: ['10H', 'KC'], b: ['10C'] }, top: '10S' });
  const v = E.viewFor(g, 'a');
  assert.deepEqual(v.myHand, ['10H', 'KC']);
  assert.deepEqual(v.playable, ['10H']);
  assert.equal(v.canDraw, true);
  assert.equal(v.canPass, false);
  const vb = E.viewFor(g, 'b');
  assert.deepEqual(vb.myHand, ['10C']);
  assert.equal(vb.players.find((p) => p.id === 'a').cardCount, 2);
  assert.equal(JSON.stringify(vb).includes('KC'), false);
});

test('fuzz: random games always terminate with consistent card count', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rng = seededRng(seed);
    const n = 2 + (seed % 5);
    const g = E.createGame({ rng });
    for (let i = 0; i < n; i++) E.addPlayer(g, { id: 'p' + i, name: 'P' + i });
    let steps = 0;
    while (g.phase !== 'gameOver' && steps < 20000) {
      if (g.phase !== 'playing') { assert.ok(E.startRound(g).ok); continue; }
      const cards = g.deck.length + g.discard.length + g.players.reduce((s, p) => s + p.hand.length, 0);
      assert.equal(cards, 36);
      const v = E.viewFor(g, g.turn);
      const r = rng();
      if (v.playable.length && r < 0.85) {
        const c = v.playable[Math.floor(rng() * v.playable.length)];
        assert.ok(E.play(g, g.turn, c, 'SCHD'[Math.floor(rng() * 4)]).ok);
      } else if (v.canDraw) {
        assert.ok(E.draw(g, g.turn).ok);
      } else if (v.canPass) {
        assert.ok(E.pass(g, g.turn).ok);
      } else {
        assert.fail('stuck: ' + JSON.stringify(v));
      }
      steps++;
    }
    assert.equal(g.phase, 'gameOver', 'seed ' + seed);
  }
});
