// SVG playing cards. viewBox 0 0 250 350. Shared defs live in a hidden sprite (spriteSVG).

export const SUIT_ORDER = ['S', 'H', 'C', 'D'];
export const RANK_ORDER = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const SUIT_GLYPH = { S: '♠', C: '♣', H: '♥', D: '♦' };

const RED = '#c8102e';
const BLACK = '#1a1a1e';
const PRIMARY = { S: '#1f3c88', C: '#1d6b45', H: '#c8102e', D: '#d4561c' };
const GOLD = '#e6b325';
const SKIN = '#f6d2b0';
const FONT = "Georgia, 'Times New Roman', serif";

export const parse = (id) => ({ rank: id.slice(0, -1), suit: id.slice(-1) });
export const isRed = (suit) => suit === 'H' || suit === 'D';
const color = (suit) => (isRed(suit) ? RED : BLACK);

export function sortHand(hand) {
  return [...hand].sort((a, b) => {
    const A = parse(a);
    const B = parse(b);
    return SUIT_ORDER.indexOf(A.suit) - SUIT_ORDER.indexOf(B.suit) || RANK_ORDER.indexOf(A.rank) - RANK_ORDER.indexOf(B.rank);
  });
}

// ---------- sprite ----------

const SUIT_PATHS = {
  H: '<path d="M50 90 C 22 68 3 50 8 28 C 12 10 36 4 50 24 C 64 4 88 10 92 28 C 97 50 78 68 50 90 Z"/>',
  D: '<path d="M50 3 Q 68 28 90 50 Q 68 72 50 97 Q 32 72 10 50 Q 32 28 50 3 Z"/>',
  S: '<path d="M50 4 C 60 24 93 38 92 62 C 91 80 70 85 57 73 C 58 84 63 92 72 97 L 28 97 C 37 92 42 84 43 73 C 30 85 9 80 8 62 C 7 38 40 24 50 4 Z"/>',
  C: '<circle cx="50" cy="27" r="19"/><circle cx="27" cy="59" r="19"/><circle cx="73" cy="59" r="19"/><path d="M44 50 L 56 50 C 56 72 61 88 71 97 L 29 97 C 39 88 44 72 44 50 Z"/>',
};

export function spriteSVG() {
  const symbols = Object.entries(SUIT_PATHS)
    .map(([s, p]) => `<symbol id="suit-${s}" viewBox="0 0 100 100">${p}</symbol>`)
    .join('');
  return `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
${symbols}
<linearGradient id="g-face" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffefb"/><stop offset="1" stop-color="#f4f0e6"/></linearGradient>
<linearGradient id="g-panel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff9ea"/><stop offset="1" stop-color="#f6e6c0"/></linearGradient>
<linearGradient id="g-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbe08a"/><stop offset=".5" stop-color="#e6b325"/><stop offset="1" stop-color="#b8860b"/></linearGradient>
<linearGradient id="g-steel" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e9eef3"/><stop offset="1" stop-color="#9aa6b2"/></linearGradient>
<pattern id="p-back" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
  <rect width="18" height="18" fill="#9e1830"/>
  <path d="M0 9 H18 M9 0 V18" stroke="#c23a50" stroke-width="2.2"/>
  <circle cx="9" cy="9" r="2.4" fill="#f2c45a"/>
  <circle cx="0" cy="0" r="1.6" fill="#f7d9a0"/><circle cx="18" cy="18" r="1.6" fill="#f7d9a0"/>
</pattern>
<radialGradient id="g-back-glow" cx=".5" cy=".5" r=".6"><stop offset="0" stop-color="#ffffff" stop-opacity=".18"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
</defs></svg>`;
}

const pip = (suit, cx, cy, size, flip = false) => {
  const h = size / 2;
  const t = flip ? ` transform="rotate(180 ${cx} ${cy})"` : '';
  return `<use href="#suit-${suit}" x="${cx - h}" y="${cy - h}" width="${size}" height="${size}" fill="${color(suit)}"${t}/>`;
};

// ---------- pieces ----------

function corner(rank, suit) {
  const c = color(suit);
  const ten = rank === '10';
  const one = `<g>
    <text x="27" y="52" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="${ten ? 36 : 44}" fill="${c}" ${ten ? 'letter-spacing="-3"' : ''}>${rank}</text>
    ${pip(suit, 27, 76, 28)}
  </g>`;
  return one + `<g transform="rotate(180 125 175)">${one}</g>`;
}

const L = 82;
const C = 125;
const R = 168;
const PIPS = {
  6: [[L, 80], [R, 80], [L, 175], [R, 175], [L, 270], [R, 270]],
  7: [[L, 80], [R, 80], [C, 128], [L, 175], [R, 175], [L, 270], [R, 270]],
  8: [[L, 80], [R, 80], [C, 128], [L, 175], [R, 175], [C, 222], [L, 270], [R, 270]],
  9: [[L, 80], [R, 80], [L, 143], [R, 143], [C, 175], [L, 207], [R, 207], [L, 270], [R, 270]],
  10: [[L, 80], [R, 80], [C, 112], [L, 143], [R, 143], [L, 207], [R, 207], [C, 238], [L, 270], [R, 270]],
};

function numberFace(rank, suit) {
  return PIPS[rank].map(([x, y]) => pip(suit, x, y, 50, y > 175)).join('');
}

function aceFace(suit) {
  if (suit !== 'S') return pip(suit, 125, 175, 120);
  return `
    <circle cx="125" cy="175" r="78" fill="none" stroke="url(#g-gold)" stroke-width="3"/>
    <circle cx="125" cy="175" r="70" fill="none" stroke="${GOLD}" stroke-width="1" stroke-dasharray="3 5"/>
    <path d="M125 88 q 8 10 0 18 q -8 -8 0 -18 Z M125 262 q 8 -10 0 -18 q -8 8 0 18 Z M38 175 q 10 -8 18 0 q -8 8 -18 0 Z M212 175 q -10 -8 -18 0 q 8 8 18 0 Z" fill="${GOLD}"/>
    ${pip('S', 125, 172, 104)}`;
}

// Top half of a court figure (mirrored for the bottom half). Box x 52..198, y 44..175.
function courtHalf(rank, suit) {
  const P = PRIMARY[suit];
  const hair = rank === 'Q' ? '#d79a2b' : rank === 'J' ? '#7a4a22' : '#4a3424';
  let head = '';
  let face = `
    <rect x="116" y="120" width="18" height="18" fill="${SKIN}"/>
    <ellipse cx="125" cy="106" rx="19" ry="22" fill="${SKIN}" stroke="#b98762" stroke-width=".8"/>
    <path d="M114 99 q4 -3 8 0 M128 99 q4 -3 8 0" stroke="#5a3a20" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <circle cx="118" cy="104" r="2.1" fill="#222"/><circle cx="132" cy="104" r="2.1" fill="#222"/>
    <path d="M125 106 q -3 7 1 8" stroke="#b98762" stroke-width="1.3" fill="none"/>
    <path d="M119 118 q6 4 12 0" stroke="#b3333b" stroke-width="2" fill="none" stroke-linecap="round"/>`;
  let item = '';
  if (rank === 'K') {
    face = `<path d="M100 104 C 98 80 152 80 150 104 L 152 116 C 140 110 110 110 98 116 Z" fill="${hair}"/>` + face +
      `<path d="M106 112 Q 110 140 125 142 Q 140 140 144 112 Q 138 124 125 124 Q 112 124 106 112 Z" fill="${hair}"/>
       <path d="M114 120 q 11 5 22 0" stroke="${hair}" stroke-width="3" fill="none"/>`;
    head = `<path d="M99 88 L101 60 L113 74 L125 54 L137 74 L149 60 L151 88 Z" fill="url(#g-gold)" stroke="#9c7208" stroke-width="1.2"/>
      <rect x="99" y="82" width="52" height="9" rx="2" fill="url(#g-gold)" stroke="#9c7208" stroke-width="1"/>
      <circle cx="113" cy="86.5" r="2.6" fill="${RED}"/><circle cx="125" cy="86.5" r="3" fill="#1f5fbf"/><circle cx="137" cy="86.5" r="2.6" fill="${RED}"/>
      <circle cx="101" cy="60" r="2.4" fill="#fff4c2"/><circle cx="125" cy="54" r="2.8" fill="#fff4c2"/><circle cx="149" cy="60" r="2.4" fill="#fff4c2"/>`;
    item = `<rect x="167" y="70" width="5" height="105" fill="url(#g-steel)" stroke="#6c7782" stroke-width=".8"/>
      <rect x="158" y="140" width="23" height="6" rx="2" fill="url(#g-gold)"/><circle cx="169.5" cy="66" r="4" fill="url(#g-gold)"/>`;
  } else if (rank === 'Q') {
    face = `<path d="M101 108 C 92 70 158 70 149 108 C 156 130 160 150 164 170 L 148 160 C 150 140 146 124 144 112 Q 125 92 106 112 C 104 124 100 140 102 160 L 86 170 C 90 150 94 130 101 108 Z" fill="${hair}"/>` + face;
    head = `<path d="M104 86 Q 107 68 114 76 Q 119 60 125 70 Q 131 60 136 76 Q 143 68 146 86 Z" fill="url(#g-gold)" stroke="#9c7208" stroke-width="1.1"/>
      <circle cx="114" cy="75" r="2.6" fill="#fff"/><circle cx="125" cy="66" r="3" fill="#fff"/><circle cx="136" cy="75" r="2.6" fill="#fff"/>
      <circle cx="125" cy="80" r="3.2" fill="${RED}"/>`;
    item = `<path d="M80 175 C 80 150 84 128 88 112" stroke="#2f7a3a" stroke-width="3" fill="none"/>
      <path d="M84 140 q -12 -4 -14 -14 q 12 2 14 14 Z" fill="#3b9147"/>
      <g fill="${RED}"><circle cx="88" cy="104" r="6"/><circle cx="96" cy="110" r="6"/><circle cx="80" cy="110" r="6"/><circle cx="84" cy="118" r="6"/><circle cx="92" cy="118" r="6"/></g>
      <circle cx="88" cy="112" r="4" fill="${GOLD}"/>`;
  } else {
    face = `<path d="M103 104 C 100 82 150 82 147 104 L 150 120 C 146 112 142 108 140 102 Q 125 94 110 102 C 108 108 104 112 100 120 Z" fill="${hair}"/>` + face;
    head = `<ellipse cx="125" cy="85" rx="31" ry="10" fill="${P}" stroke="#000" stroke-opacity=".25"/>
      <path d="M101 84 Q 125 64 149 84 Z" fill="${P}"/>
      <rect x="99" y="84" width="52" height="5" rx="2" fill="url(#g-gold)"/>
      <path d="M146 80 C 166 66 176 56 182 46 C 174 64 166 74 150 84 Z" fill="${GOLD}" stroke="#9c7208" stroke-width=".8"/>`;
    item = `<rect x="74" y="58" width="4" height="117" fill="#8a5a2b"/>
      <path d="M76 58 l -8 14 l 8 -4 l 8 4 Z" fill="url(#g-steel)"/>
      <path d="M78 76 q 18 8 0 26 Z" fill="url(#g-steel)" stroke="#6c7782" stroke-width=".8"/>`;
  }
  const robe = `
    <path d="M62 175 C 66 150 86 136 125 133 C 164 136 184 150 188 175 Z" fill="${P}"/>
    <path d="M62 175 C 66 150 86 136 125 133 C 164 136 184 150 188 175" fill="none" stroke="#000" stroke-opacity=".2" stroke-width="1"/>
    <path d="M98 138 Q 125 160 152 138" stroke="url(#g-gold)" stroke-width="6" fill="none"/>
    <rect x="118" y="146" width="14" height="29" fill="url(#g-gold)"/>
    <g fill="#fff4dc" opacity=".9"><circle cx="90" cy="160" r="3"/><circle cx="160" cy="160" r="3"/><circle cx="104" cy="168" r="2.4"/><circle cx="146" cy="168" r="2.4"/></g>
    <path d="M125 150 l 4 6 l -4 6 l -4 -6 Z" fill="${RED}"/>`;
  return `${item}${robe}${face}${head}${pip(suit, 176, 104, 22)}`;
}

function courtFace(rank, suit) {
  const P = PRIMARY[suit];
  const half = courtHalf(rank, suit);
  return `
    <rect x="52" y="44" width="146" height="262" rx="8" fill="url(#g-panel)" stroke="${P}" stroke-width="2"/>
    <svg x="52" y="44" width="146" height="262" viewBox="52 44 146 262" overflow="hidden">
      <g>${half}</g><g transform="rotate(180 125 175)">${half}</g>
    </svg>
    <line x1="52" y1="175" x2="198" y2="175" stroke="${P}" stroke-width="1.5"/>
    <rect x="52" y="44" width="146" height="262" rx="8" fill="none" stroke="${P}" stroke-width="2"/>`;
}

// ---------- public ----------

const cache = new Map();

export function cardSVG(id) {
  if (cache.has(id)) return cache.get(id);
  const { rank, suit } = parse(id);
  let body;
  if (PIPS[rank]) body = numberFace(rank, suit);
  else if (rank === 'A') body = aceFace(suit);
  else body = courtFace(rank, suit);
  const special = id === 'KS';
  const svg = `<svg class="card-svg" viewBox="0 0 250 350" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${rank}${SUIT_GLYPH[suit]}">
    <rect x="1.5" y="1.5" width="247" height="347" rx="16" fill="url(#g-face)" stroke="${special ? '#c9971c' : '#cfcac0'}" stroke-width="${special ? 4 : 1.5}"/>
    ${special ? '<rect x="7" y="7" width="236" height="336" rx="12" fill="none" stroke="url(#g-gold)" stroke-width="2"/>' : ''}
    ${body}
    ${corner(rank, suit)}
  </svg>`;
  cache.set(id, svg);
  return svg;
}

export function backSVG() {
  return `<svg class="card-svg" viewBox="0 0 250 350" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="1.5" y="1.5" width="247" height="347" rx="16" fill="#fdfbf6" stroke="#cfcac0" stroke-width="1.5"/>
    <rect x="12" y="12" width="226" height="326" rx="10" fill="url(#p-back)"/>
    <rect x="12" y="12" width="226" height="326" rx="10" fill="url(#g-back-glow)"/>
    <rect x="20" y="20" width="210" height="310" rx="7" fill="none" stroke="#f2c45a" stroke-width="2" opacity=".85"/>
    <ellipse cx="125" cy="175" rx="58" ry="44" fill="#fff4dc" stroke="url(#g-gold)" stroke-width="4"/>
    <ellipse cx="125" cy="175" rx="50" ry="36" fill="none" stroke="#9e1830" stroke-width="1.2" stroke-dasharray="2 4"/>
    <text x="125" y="188" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="38" fill="#9e1830">108</text>
  </svg>`;
}

// Small suit glyph as inline svg (for badges/pickers), avoids emoji rendering of ♥/♦.
export function suitIcon(suit, size = 24) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true"><use href="#suit-${suit}" fill="${color(suit)}"/></svg>`;
}
