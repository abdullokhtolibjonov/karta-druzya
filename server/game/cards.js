export const RANKS = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const SUITS = ['S', 'C', 'H', 'D'];

// R7.1
export const POINTS = { 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 2, Q: 3, K: 4, A: 11 };

export function parse(cardId) {
  return { rank: cardId.slice(0, -1), suit: cardId.slice(-1) };
}

export function isCard(cardId) {
  if (typeof cardId !== 'string') return false;
  const { rank, suit } = parse(cardId);
  return RANKS.includes(rank) && SUITS.includes(suit);
}

export function makeDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push(rank + suit);
  return deck;
}

// Fisher–Yates, in place.
export function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function handPoints(hand) {
  return hand.reduce((sum, id) => sum + POINTS[parse(id).rank], 0);
}

// Deterministic rng for tests (mulberry32).
export function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
