// Pure rules engine for "108". Implements docs/RULES.md — rule ids in comments.
import { makeDeck, shuffle, parse, handPoints, SUITS } from './cards.js';

export const LIMIT = 108;
export const QUEEN_BONUS = 30;
export const MAX_PLAYERS = 6;
const PENALTY = { 6: 1, 7: 2, K: 4 };

const ok = (extra = {}) => ({ ok: true, ...extra });
const fail = (error) => ({ ok: false, error });

export function createGame({ rng = Math.random } = {}) {
  return {
    rng,
    phase: 'lobby',
    round: 0,
    players: [],
    deck: [],
    discard: [],
    activeSuit: null,
    turn: null,
    pending: null,
    mustCover: false,
    mustPlay: false,
    drawChain: false,
    keepDrawing: false,
    autoPass: false,
    hasDrawn: false,
    drawnCard: null,
    lastChance: false,
    lastLoserId: null,
    winnerId: null,
    lastRound: null,
    standings: null,
    seq: 0,
    events: [],
  };
}

// ---------- helpers ----------

const findPlayer = (game, id) => game.players.find((p) => p.id === id);
const activePlayers = (game) => game.players.filter((p) => p.status === 'active');
const alivePlayers = (game) => game.players.filter((p) => p.status !== 'eliminated');
const topCard = (game) => game.discard.at(-1) ?? null;

// R6.2 – only the Queen of Hearts as the last card
const isQueenBonus = (c) => c.rank === 'Q' && c.suit === 'H';

function penaltyRank(cardId) {
  if (cardId === 'KS') return 'K';
  const { rank } = parse(cardId);
  return rank === '6' || rank === '7' ? rank : null;
}

// Next active player after `fromId` in seat order (R2.1). May return fromId itself.
function nextActive(game, fromId) {
  const n = game.players.length;
  const idx = game.players.findIndex((p) => p.id === fromId);
  for (let i = 1; i <= n; i++) {
    const p = game.players[(idx + i) % n];
    if (p.status === 'active') return p.id;
  }
  return null;
}

function begin(game) {
  game.seq++;
  game.events = [];
}

function emit(game, type, data = {}) {
  game.events.push({ seq: game.seq, type, ...data });
}

function resetTurnFlags(game) {
  game.hasDrawn = false;
  game.drawnCard = null;
  game.mustCover = false;
  game.mustPlay = false;
  game.drawChain = false;
  game.keepDrawing = false;
  game.autoPass = false;
}

function setTurn(game, playerId) {
  game.turn = playerId;
  resetTurnFlags(game);
}

// R4.4
function reshuffle(game) {
  if (game.discard.length <= 1) return false;
  const top = game.discard.pop();
  game.deck = shuffle(game.discard, game.rng);
  game.discard = [top];
  emit(game, 'reshuffle');
  return true;
}

function drawCards(game, player, n) {
  const got = [];
  for (let i = 0; i < n; i++) {
    if (game.deck.length === 0 && !reshuffle(game)) break;
    const card = game.deck.pop();
    player.hand.push(card);
    got.push(card);
  }
  return got;
}

const cardsLeft = (game) => game.deck.length > 0 || game.discard.length > 1;

// R4.5 – nothing in hand fits, so drawing becomes a chain of single draws.
const startsChain = (game, player) =>
  game.mustPlay && !game.hasDrawn && player.hand.every((c) => playError(game, player, c));

// R4.5 – one step of the draw chain. The server spaces the steps out in time.
function chainStep(game, player) {
  game.drawChain = true;
  game.hasDrawn = true;
  const [card] = drawCards(game, player, 1);
  emit(game, 'draw', { playerId: player.id, count: card ? 1 : 0 });
  if (card) game.drawnCard = card;
  game.keepDrawing = !!card && !!playError(game, player, card) && cardsLeft(game);
  if (!game.keepDrawing && game.autoPass) doPass(game, player.id); // R8.3
  return card;
}

// R6.7 – the last chance turn before any 8 or Ace: play or pass, no draw.
const lastChanceOpen = (game) => game.lastChance && !game.mustPlay;

const canPlayAny = (game, player) => player.hand.some((c) => !playError(game, player, c));

const mustPlayDrawn = (game, player) =>
  game.drawChain && game.hasDrawn && !!game.drawnCard && !playError(game, player, game.drawnCard);

// Returns null when legal, otherwise an error code.
export function playError(game, player, cardId) {
  if (!player.hand.includes(cardId)) return 'not_in_hand';
  const c = parse(cardId);
  if (game.pending) {
    // R5.2
    if (game.pending.rank === 'K') return 'must_accept_penalty';
    return c.rank === game.pending.rank ? null : 'must_stack_or_draw';
  }
  if (c.rank === '9' || c.rank === 'Q') return null; // R3.2, R3.3
  const top = parse(topCard(game));
  if (c.suit === game.activeSuit || c.rank === top.rank) return null; // R3.1
  return 'card_not_playable';
}

function checkTurn(game, playerId) {
  if (game.phase !== 'playing') return 'not_playing';
  if (game.turn !== playerId) return 'not_your_turn';
  return null;
}

// ---------- lobby ----------

export function addPlayer(game, { id, name }) {
  if (findPlayer(game, id)) return fail('already_joined');
  if (game.phase === 'playing') return fail('game_in_progress');
  if (alivePlayers(game).length >= MAX_PLAYERS) return fail('room_full');
  game.players.push({ id, name, hand: [], score: 0, status: 'waiting', queenBonus: false });
  game.seq++;
  return ok();
}

export function renamePlayer(game, id, name) {
  const p = findPlayer(game, id);
  if (p) p.name = name;
}

// R10.2
export function removePlayer(game, id) {
  const p = findPlayer(game, id);
  if (!p) return fail('not_found');
  begin(game);
  const inRound = game.phase === 'playing' && p.status === 'active';
  const wasTurn = inRound && game.turn === id;
  const next = wasTurn ? nextActive(game, id) : null;
  if (inRound) {
    game.deck.push(...p.hand);
    shuffle(game.deck, game.rng);
  }
  game.players.splice(game.players.indexOf(p), 1);
  emit(game, 'leave', { playerId: id, name: p.name });

  if (inRound) {
    if (activePlayers(game).length <= 1) {
      endRound(game, { aborted: true });
    } else if (wasTurn) {
      game.pending = null;
      setTurn(game, next);
    }
  } else if (game.phase === 'playing' && activePlayers(game).length <= 1 && !game.lastChance) {
    endRound(game, { aborted: true });
  } else if (game.phase === 'roundOver' && alivePlayers(game).length <= 1) {
    finishGame(game);
  }
  return ok();
}

// ---------- round flow ----------

export function startRound(game) {
  if (game.phase === 'playing') return fail('game_in_progress');
  if (game.phase === 'gameOver') return fail('game_over');
  const participants = alivePlayers(game);
  if (participants.length < 2) return fail('not_enough_players');

  begin(game);
  game.round++;
  game.phase = 'playing';
  game.deck = shuffle(makeDeck(), game.rng);
  game.discard = [];
  game.pending = null;
  game.lastChance = false;
  game.lastRound = null;
  resetTurnFlags(game);

  // R1.3
  const perPlayer = participants.length >= 6 ? 5 : 6;
  for (const p of participants) {
    p.hand = game.deck.splice(-perPlayer, perPlayer);
    p.status = 'active';
    p.queenBonus = false;
  }

  // R1.4
  const starter = game.deck.pop();
  game.discard.push(starter);
  game.activeSuit = parse(starter).suit; // R9.4 included

  // R2.2
  let startId;
  const loserIdx = game.players.findIndex((p) => p.id === game.lastLoserId);
  if (loserIdx === -1) {
    startId = participants[Math.floor(game.rng() * participants.length)].id;
  } else if (game.players[loserIdx].status === 'active') {
    startId = game.lastLoserId;
  } else {
    startId = nextActive(game, game.lastLoserId);
  }
  setTurn(game, startId);
  emit(game, 'roundStart', { round: game.round, card: starter, playerId: startId });

  // R9
  const { rank } = parse(starter);
  const pr = penaltyRank(starter);
  if (pr) {
    game.pending = { rank: pr, count: PENALTY[pr] }; // R9.1
  } else if (rank === 'A') {
    emit(game, 'skip', { playerId: startId }); // R9.2
    setTurn(game, nextActive(game, startId));
  } else if (rank === '8') {
    game.mustCover = true; // R9.3
    game.mustPlay = true; // R4.5
  }
  return ok();
}

export function play(game, playerId, cardId, suit) {
  const err = checkTurn(game, playerId);
  if (err) return fail(err);
  const p = findPlayer(game, playerId);
  const perr = playError(game, p, cardId);
  if (perr) return fail(perr);
  const c = parse(cardId);
  if (c.rank === 'Q' && !SUITS.includes(suit)) return fail('choose_suit');

  begin(game);
  p.hand.splice(p.hand.indexOf(cardId), 1);
  game.discard.push(cardId);
  game.activeSuit = c.rank === 'Q' ? suit : c.suit;
  resetTurnFlags(game);
  emit(game, 'play', { playerId, card: cardId, suit: game.activeSuit });

  // R5.4 – same player keeps the turn and must cover
  if (c.rank === '8') {
    game.mustCover = true;
    game.mustPlay = true; // R4.5
    if (p.hand.length === 0) {
      // R5.8
      if (!cardsLeft(game)) return finishPlayerAndAdvance(game, p, c, cardId);
      chainStep(game, p);
    }
    return ok();
  }

  // R5.1, R5.2
  const pr = penaltyRank(cardId);
  if (pr) {
    const count = (game.pending?.count ?? 0) + PENALTY[pr];
    game.pending = { rank: pr, count };
  }
  return finishPlayerAndAdvance(game, p, c, cardId);
}

function finishPlayerAndAdvance(game, p, c) {
  if (game.lastChance) return lastChancePlayed(game, p, c);
  if (p.hand.length === 0) {
    const others = activePlayers(game).filter((q) => q !== p);
    const opp = others.length === 1 ? others[0] : null; // R6.4
    if (opp && c.rank === 'A' && cardsLeft(game)) {
      // R6.6 – the skip brings the turn back to an empty hand
      emit(game, 'skip', { playerId: opp.id });
      setTurn(game, p.id);
      game.mustPlay = true;
      chainStep(game, p);
      return ok();
    }
    // R6.1, R6.2, R6.5
    p.status = 'finished';
    if (isQueenBonus(c)) p.queenBonus = true;
    emit(game, 'finish', { playerId: p.id, queen: p.queenBonus });
  }
  const left = activePlayers(game);
  if (left.length <= 1) {
    if (left.length === 1 && !game.pending && c.rank !== 'A' && canPlayAny(game, left[0])) {
      // R6.7
      game.lastChance = true;
      setTurn(game, left[0].id);
      return ok();
    }
    endRound(game);
    return ok();
  }
  let next = nextActive(game, p.id);
  if (c.rank === 'A') {
    // R5.9
    emit(game, 'skip', { playerId: next });
    next = nextActive(game, next);
  }
  setTurn(game, next);
  if (next === p.id) game.mustPlay = true; // R4.5
  return ok();
}

// R6.7 – a card played in the last chance. The round ends unless the turn stays here.
function lastChancePlayed(game, p, c) {
  game.pending = null; // nobody is left to take a penalty
  if (c.rank === 'A' && (p.hand.length > 0 || cardsLeft(game))) {
    setTurn(game, p.id);
    game.mustPlay = true; // R4.5
    if (p.hand.length === 0) chainStep(game, p);
    return ok();
  }
  if (p.hand.length === 0 && isQueenBonus(c)) p.queenBonus = true; // R6.2
  endRound(game);
  return ok();
}

export function draw(game, playerId) {
  const err = checkTurn(game, playerId);
  if (err) return fail(err);
  if (game.keepDrawing) return fail('drawing');
  if (lastChanceOpen(game)) return fail('no_draw_last_chance'); // R6.7
  if (!game.pending && game.hasDrawn) return fail('already_drawn');
  begin(game);
  doDraw(game, playerId);
  return ok();
}

// R4.5 – next step of a running draw chain; called by the server's step timer.
export function drawStep(game) {
  if (game.phase !== 'playing' || !game.keepDrawing) return fail('not_drawing');
  begin(game);
  chainStep(game, findPlayer(game, game.turn));
  return ok();
}

function doDraw(game, playerId) {
  const p = findPlayer(game, playerId);
  if (game.pending) {
    // R5.3 – accept the penalty and lose the turn
    const got = drawCards(game, p, game.pending.count);
    emit(game, 'penalty', { playerId, count: got.length });
    game.pending = null;
    setTurn(game, nextActive(game, playerId));
    return;
  }
  if (startsChain(game, p)) {
    chainStep(game, p); // R4.5
    return;
  }
  // R4.1
  const got = drawCards(game, p, 1);
  game.hasDrawn = true;
  game.drawnCard = got[0] ?? null;
  emit(game, 'draw', { playerId, count: got.length });
}

export function pass(game, playerId) {
  const err = checkTurn(game, playerId);
  if (err) return fail(err);
  if (game.pending) return fail('must_stack_or_draw');
  if (game.keepDrawing) return fail('drawing'); // R4.5
  if (!game.hasDrawn && !lastChanceOpen(game)) return fail('draw_first'); // R4.3, R6.7
  if (mustPlayDrawn(game, findPlayer(game, playerId))) return fail('must_play_drawn'); // R4.5
  begin(game);
  doPass(game, playerId);
  return ok();
}

function doPass(game, playerId) {
  emit(game, 'pass', { playerId });
  if (game.lastChance) return endRound(game); // R6.7
  setTurn(game, nextActive(game, playerId));
}

// R8.3
export function timeout(game) {
  if (game.phase !== 'playing') return fail('not_playing');
  const playerId = game.turn;
  begin(game);
  emit(game, 'timeout', { playerId });
  const p = findPlayer(game, playerId);
  if (game.pending) {
    doDraw(game, playerId);
  } else if (game.keepDrawing) {
    game.autoPass = true; // the running chain passes when it ends
  } else if (startsChain(game, p)) {
    // R4.5 – run the chain, then pass
    game.autoPass = true;
    chainStep(game, p);
  } else {
    if (!game.hasDrawn && !lastChanceOpen(game)) doDraw(game, playerId); // R6.7 – pass only
    doPass(game, playerId);
  }
  return ok();
}

function endRound(game, { aborted = false } = {}) {
  const remaining = activePlayers(game);
  game.phase = 'roundOver';
  game.turn = null;
  resetTurnFlags(game);

  const bonuses = game.players.filter((p) => p.queenBonus).map((p) => p.id);
  if (!aborted && remaining.length === 1) {
    const loser = remaining[0];
    // R6.3
    if (game.pending) {
      const got = drawCards(game, loser, game.pending.count);
      emit(game, 'penalty', { playerId: loser.id, count: got.length });
    }
    const added = handPoints(loser.hand); // R7.2
    const before = loser.score;
    let after = before + added;
    const reset = after === LIMIT; // R7.4
    const eliminated = after > LIMIT; // R7.5
    if (reset) after = 0;
    loser.score = after;
    if (eliminated) loser.status = 'eliminated';
    game.lastLoserId = loser.id;
    // R7.3
    for (const p of game.players) {
      if (p.queenBonus) p.score = Math.max(0, p.score - QUEEN_BONUS);
    }
    game.lastRound = {
      loserId: loser.id, hand: [...loser.hand], added, before, after, reset, eliminated, bonuses,
    };
  } else {
    game.lastRound = { loserId: null, aborted: true, hand: [], bonuses: [] };
  }
  game.pending = null;
  game.lastChance = false;

  for (const p of game.players) {
    p.hand = [];
    p.queenBonus = false;
    if (p.status !== 'eliminated') p.status = 'waiting';
  }
  emit(game, 'roundEnd', { loserId: game.lastRound.loserId });

  // R7.6
  if (alivePlayers(game).length <= 1) finishGame(game);
}

function computeStandings(game) {
  const alive = alivePlayers(game).sort((a, b) => a.score - b.score);
  const out = game.players.filter((p) => p.status === 'eliminated');
  return [...alive, ...out].map((p) => ({
    id: p.id, name: p.name, score: p.score, eliminated: p.status === 'eliminated',
  }));
}

function finishGame(game) {
  game.phase = 'gameOver';
  game.turn = null;
  game.standings = computeStandings(game);
  const alive = alivePlayers(game);
  game.winnerId = alive.length === 1 ? alive[0].id : (game.standings[0] && !game.standings[0].eliminated ? game.standings[0].id : null);
  emit(game, 'gameEnd', { winnerId: game.winnerId });
}

// R7.7
export function endGame(game) {
  if (game.phase === 'lobby') return fail('not_playing');
  if (game.phase === 'gameOver') return ok();
  begin(game);
  for (const p of game.players) {
    p.hand = [];
    if (p.status !== 'eliminated') p.status = 'waiting';
  }
  game.deck = [];
  game.discard = [];
  game.pending = null;
  resetTurnFlags(game);
  finishGame(game);
  return ok();
}

// Back to lobby with scores reset ("new game").
export function resetGame(game) {
  begin(game);
  Object.assign(game, {
    phase: 'lobby', round: 0, deck: [], discard: [], activeSuit: null, turn: null,
    pending: null, lastChance: false, lastLoserId: null, winnerId: null, lastRound: null, standings: null,
  });
  resetTurnFlags(game);
  for (const p of game.players) Object.assign(p, { hand: [], score: 0, status: 'waiting', queenBonus: false });
  return ok();
}

export function aliveCount(game) {
  return alivePlayers(game).length;
}

// ---------- view ----------

export function viewFor(game, playerId) {
  const me = findPlayer(game, playerId);
  const myTurn = !!me && game.phase === 'playing' && game.turn === playerId;
  return {
    me: me ? playerId : null,
    phase: game.phase,
    round: game.round,
    turn: game.turn,
    activeSuit: game.activeSuit,
    pending: game.pending,
    mustCover: game.mustCover,
    hasDrawn: game.hasDrawn,
    top: topCard(game),
    recent: game.discard.slice(-3),
    deckCount: game.deck.length,
    discardCount: game.discard.length,
    myHand: me ? [...me.hand] : [],
    drawnCard: myTurn ? game.drawnCard : null,
    playable: myTurn ? me.hand.filter((c) => !playError(game, me, c)) : [],
    drawing: game.keepDrawing,
    lastChance: game.lastChance,
    canDraw: myTurn && !game.keepDrawing && !lastChanceOpen(game) && (!!game.pending || !game.hasDrawn),
    canPass: myTurn && !game.pending && !game.keepDrawing &&
      (lastChanceOpen(game) || (game.hasDrawn && !mustPlayDrawn(game, me))),
    players: game.players.map((p) => ({
      id: p.id, name: p.name, cardCount: p.hand.length, score: p.score, status: p.status,
    })),
    lastRound: game.lastRound,
    winnerId: game.winnerId,
    standings: game.standings,
    seq: game.seq,
    events: game.events,
  };
}
