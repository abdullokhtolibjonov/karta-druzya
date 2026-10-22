// Game table: opponents, piles, hand, actions, animations, round/game modals.
import { call } from './net.js';
import { t, tErr } from './i18n.js';
import { sortHand, suitIcon, parse, SUIT_ORDER } from './cards.js';
import { $, el, toast, cardEl, avatarEl, openModal, closeModal, modalKey, setModalKey, confetti } from './ui.js';
import { store, serverNow, nameOf } from './state.js';
import { leaveRoomLocal } from './main.js';
import { voiceSupported, isMuted, toggleMute } from './voice.js';
import { canStartVote, startVote } from './vote.js';

const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// ---------- actions ----------

async function act(event, payload) {
  const res = await call(event, payload);
  if (!res.ok) toast(tErr(res.error), { error: true });
  return res;
}

function pickSuit() {
  return new Promise((resolve) => {
    let done = false;
    const choose = (s) => { done = true; closeModal(); resolve(s); };
    openModal([
      el('h2', { text: t('choose_suit') }),
      el('div', { class: 'suit-grid' }, SUIT_ORDER.map((s) => el('button', {
        type: 'button', onclick: () => choose(s),
        html: `${suitIcon(s, 40)}<span>${t('suit_' + s)}</span>`,
      }))),
    ], { onClose: () => { if (!done) resolve(null); } });
    setModalKey('suit');
  });
}

async function playCard(id) {
  const v = store.view;
  let suit;
  if (parse(id).rank === 'Q' && !v.pending) {
    suit = await pickSuit();
    if (!suit) return;
    if (store.view.turn !== store.view.me) return;
  }
  store.selected = null;
  await act('game:play', { cardId: id, suit });
}

function select(id) {
  store.selected = id;
  for (const c of $('#hand').children) c.classList.toggle('selected', !!id && c.dataset.card === id);
  if (store.view) renderStatus(store.view);
  tickTimer();
}

export function initTable() {
  $('#hand').addEventListener('click', (e) => {
    const node = e.target.closest('.card');
    const v = store.view;
    if (!node || !v || v.turn !== v.me) return;
    const id = node.dataset.card;
    if (finePointer.matches || store.selected === id) return playCard(id);
    select(id);
  });
  // Tapping anywhere else on the table puts a selected card back.
  $('#screen-game').addEventListener('click', (e) => {
    if (store.selected && !e.target.closest('#hand .card')) select(null);
  });
  $('#deck').addEventListener('click', () => { if (store.view?.canDraw) act('game:draw'); });
  $('#btn-draw').addEventListener('click', () => act('game:draw'));
  $('#btn-pass').addEventListener('click', () => act('game:pass'));
  // Tapping someone's seat opens their menu: mute (only for me) and vote kick (R10.4).
  $('#opponents').addEventListener('click', (e) => {
    const pid = e.target.closest('.seat')?.dataset.pid;
    const v = store.view;
    if (!pid || !v || pid === v.myId) return;
    seatMenu(v, pid);
  });
  addEventListener('resize', () => layoutHand());
  setInterval(tickTimer, 200);
}

function seatMenu(v, pid) {
  const name = nameOf(v, pid);
  const items = [];
  if (voiceSupported) {
    items.push(el('button', {
      class: 'btn btn-secondary btn-lg', type: 'button', text: t(isMuted(pid) ? 'unmute' : 'mute'),
      onclick: () => {
        closeModal();
        toast(t(toggleMute(pid) ? 'muted_name' : 'unmuted_name', { name }));
      },
    }));
  }
  if (canStartVote(v, pid)) {
    items.push(el('button', {
      class: 'btn btn-danger btn-lg', type: 'button', text: t('vote_kick'),
      onclick: () => { closeModal(); startVote(pid); },
    }));
  }
  if (!items.length) return;
  items.push(el('button', { class: 'btn btn-secondary btn-lg', type: 'button', text: t('close'), onclick: () => closeModal() }));
  openModal([el('h2', { text: name }), el('div', { class: 'stack' }, items)]);
}

// ---------- render ----------

function seatOrder(v) {
  const i = v.players.findIndex((p) => p.id === v.me);
  if (i === -1) return v.players;
  return [...v.players.slice(i + 1), ...v.players.slice(0, i)];
}

function seatEl(p, v) {
  const isTurn = v.phase === 'playing' && v.turn === p.id;
  const out = p.status === 'finished' || p.status === 'eliminated';
  const av = avatarEl(p.name, { host: p.isHost, offline: !p.connected, mic: p.mic, muted: isMuted(p.id) });
  if (isTurn) av.classList.add('turn');
  const cards = p.cardCount || v.phase === 'playing'
    ? el('span', { class: 'cards-chip' }, [el('i', { class: 'card-glyph' }), String(p.cardCount)])
    : null;
  let tag = null;
  if (p.status === 'eliminated') tag = '❌';
  else if (p.status === 'finished') tag = '✓';
  return el('div', { class: `seat${isTurn ? ' is-turn' : ''}${out ? ' out' : ''}`, 'data-pid': p.id }, [
    av,
    el('div', { class: 'seat-info' }, [
      el('div', { class: 'seat-name', text: p.name }),
      el('div', { class: 'seat-meta' }, [
        cards,
        el('span', { class: 'score-pill' + (p.score >= 90 ? ' hot' : ''), text: p.score }),
        tag ? el('span', { class: 'seat-tag', text: tag }) : null,
      ]),
    ]),
  ]);
}

// Spectators sit at the end of the row, small, so their chat bubbles and voice rings show.
function watcherEl(s) {
  return el('div', { class: 'seat watcher', 'data-pid': s.id }, [
    avatarEl(s.name, { mic: s.mic, muted: isMuted(s.id) }),
    el('div', { class: 'seat-info' }, [
      el('div', { class: 'seat-name', text: s.name }),
      el('div', { class: 'seat-tag', text: '👁 ' + t('watching') }),
    ]),
  ]);
}

function hashRot(id, i) {
  let h = 0;
  for (const ch of id) h = (h * 33 + ch.charCodeAt(0)) % 997;
  return { rot: (h % 19) - 9, dx: ((h >> 2) % 9) - 4 + i, dy: ((h >> 3) % 7) - 3 };
}

function renderPiles(v) {
  const stack = $('#deck-stack');
  const layers = v.deckCount === 0 ? 0 : Math.min(3, Math.ceil(v.deckCount / 8));
  if (stack.children.length !== layers) {
    stack.replaceChildren(...Array.from({ length: layers }, (_, i) => {
      const c = cardEl(null);
      c.style.transform = `translate(${-i * 2}px, ${-i * 2}px)`;
      return c;
    }));
  }
  $('#deck-count').textContent = v.deckCount;
  $('#deck').classList.toggle('can', !!v.canDraw);

  const discard = $('#discard');
  const recent = v.recent ?? [];
  const key = recent.join(',');
  if (discard.dataset.key !== key) {
    discard.dataset.key = key;
    discard.replaceChildren(...recent.map((id, i) => {
      const c = cardEl(id);
      const { rot, dx, dy } = hashRot(id, i);
      c.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg)`;
      return c;
    }));
  }

  const showSuit = v.top && v.activeSuit && parse(v.top).suit !== v.activeSuit;
  const sb = $('#suit-badge');
  sb.classList.toggle('hidden', !showSuit);
  if (showSuit && sb.dataset.suit !== v.activeSuit) {
    sb.dataset.suit = v.activeSuit;
    sb.innerHTML = suitIcon(v.activeSuit, 30);
  }
  if (!showSuit) sb.dataset.suit = '';
  const pb = $('#penalty-badge');
  pb.classList.toggle('hidden', !v.pending);
  if (v.pending) pb.textContent = '+' + v.pending.count;
}

function statusText(v) {
  if (v.phase !== 'playing') return { text: '', mine: false };
  const meP = v.players.find((p) => p.id === v.me);
  if (v.turn === v.me) {
    let text = t('your_turn');
    if (store.selected) text = t('tap_again');
    else if (v.drawing) text = t('your_turn_drawing');
    else if (v.pending) {
      text = v.pending.rank === 'K'
        ? t('your_turn_penalty_k', { n: v.pending.count })
        : t('your_turn_penalty', { n: v.pending.count, rank: v.pending.rank });
    } else if (v.hasDrawn) text = t(v.canPass ? 'your_turn_drawn' : 'your_turn_play_drawn');
    else if (v.mustCover) text = t('your_turn_cover');
    return { text, mine: true };
  }
  if (meP?.status === 'finished') return { text: t('finished_you') + ' · ' + t('their_turn', { name: nameOf(v, v.turn) }), mine: false };
  if (v.drawing) return { text: t('their_drawing', { name: nameOf(v, v.turn) }), mine: false };
  return { text: t('their_turn', { name: nameOf(v, v.turn) }), mine: false };
}

function renderStatus(v) {
  const { text, mine } = statusText(v);
  const s = $('#status');
  s.classList.toggle('hidden', !text);
  s.classList.toggle('mine', mine);
  s.replaceChildren(el('span', { text }), el('span', { class: 'secs', id: 'status-secs' }));
}

function renderMe(v) {
  const meP = v.players.find((p) => p.id === v.me);
  const bar = $('#me-bar');
  if (!meP) {
    bar.replaceChildren();
    return;
  }
  const av = avatarEl(meP.name, { host: meP.isHost, mic: meP.mic });
  if (v.phase === 'playing' && v.turn === v.me) av.classList.add('turn');
  bar.replaceChildren(
    el('div', { 'data-pid': meP.id, style: { display: 'contents' } }, av),
    el('span', { text: meP.name }),
    el('span', { class: 'score-pill' + (meP.score >= 90 ? ' hot' : ''), text: meP.score }),
  );
  bar.dataset.pid = meP.id;
}

function renderHand(v) {
  const hand = $('#hand');
  const meP = v.players.find((p) => p.id === v.me);
  hand.classList.toggle('my-turn', v.phase === 'playing' && v.turn === v.me);
  if (!meP || meP.status === 'eliminated' || (meP.status !== 'active' && v.myHand.length === 0)) {
    let note = t('spectating');
    if (!meP) note = v.spectators.find((s) => s.id === v.myId)?.joinNext ? t('spectating_next') : t('spectating');
    else if (meP.status === 'eliminated') note = t('eliminated_you');
    else if (meP.status === 'finished') note = t('finished_you');
    else note = '';
    hand.replaceChildren(el('div', { class: 'hand-note', text: note }));
    hand.classList.remove('two-rows');
    return;
  }
  const playable = new Set(v.playable);
  const myTurn = v.turn === v.me;
  const cards = sortHand(v.myHand).map((id) => {
    const cls = [];
    if (myTurn) cls.push(playable.has(id) ? 'playable' : 'dim');
    if (store.selected === id) cls.push('selected');
    if (v.drawnCard === id) cls.push('drawn');
    return cardEl(id, cls.join(' '));
  });
  hand.replaceChildren(...cards);
  layoutHand();
}

function layoutHand() {
  const hand = $('#hand');
  hand.querySelectorAll('.row-break').forEach((b) => b.remove());
  const cards = [...hand.querySelectorAll('.card')];
  const n = cards.length;
  if (n === 0) return;
  hand.style.removeProperty('--cw-hand');
  const W = hand.clientWidth - 16;
  let cw = cards[0].offsetWidth || 70;
  // A big hand first shrinks (down to 52px) to stay in one readable row; two rows are the last resort.
  const fitCw = W / (1 + 0.26 * (n - 1));
  if (fitCw < cw) {
    cw = Math.max(52, fitCw);
    hand.style.setProperty('--cw-hand', `${cw}px`);
  }
  const stepFor = (k) => (k <= 1 ? cw : Math.min(cw * 0.66, (W - cw) / (k - 1)));
  const twoRows = stepFor(n) < cw * 0.24;
  const perRow = twoRows ? Math.ceil(n / 2) : n;
  const ov = Math.min(0, stepFor(perRow) - cw);
  hand.classList.toggle('two-rows', twoRows);
  // A single row is held as a gentle fan: edge cards tilt out and sit a little lower.
  const fan = !twoRows && n > 1;
  cards.forEach((c, i) => {
    const d = fan ? (2 * i) / (n - 1) - 1 : 0; // -1 … 1 across the row
    c.style.marginLeft = i % perRow === 0 ? '0px' : `${ov}px`;
    c.style.setProperty('--rot', `${(d * Math.min(6, n * 1.2)).toFixed(2)}deg`);
    c.style.setProperty('--arc', `${(d * d * 8).toFixed(1)}px`);
  });
  if (twoRows) cards[perRow - 1].after(el('div', { class: 'row-break', style: { flexBasis: '100%', height: '0' } }));
}

function renderActions(v) {
  const meP = v.players.find((p) => p.id === v.me);
  const inRound = v.phase === 'playing' && meP?.status === 'active';
  $('#btn-draw').classList.toggle('hidden', !inRound);
  $('#btn-pass').classList.toggle('hidden', !inRound);
  $('#btn-draw').textContent = v.pending && v.turn === v.me ? t('take_n', { n: v.pending.count }) : t('draw');
  $('#btn-draw').disabled = !v.canDraw;
  $('#btn-pass').disabled = !v.canPass;
}

// Capture positions before DOM changes, for FLIP flights.
function snapshot() {
  const rect = (n) => n?.getBoundingClientRect();
  const cards = new Map();
  $('#hand').querySelectorAll('.card').forEach((c) => cards.set(c.dataset.card, rect(c)));
  return { cards, deck: rect($('#deck-stack')), discard: rect($('#discard')) };
}

export function renderTable(v, prev) {
  const snap = snapshot();
  const seats = seatOrder(v);
  // Up to three opponents fit as wide capsules; more switch to compact stacked tokens.
  $('#opponents').classList.toggle('many', seats.length > 3);
  $('#opponents').replaceChildren(
    ...seats.map((p) => seatEl(p, v)),
    ...v.spectators.filter((s) => s.id !== v.myId && s.connected).map((s) => watcherEl(s)),
  );
  renderPiles(v);
  renderStatus(v);
  renderMe(v);
  renderHand(v);
  renderActions(v);
  tickTimer();

  if (prev && prev.turn !== v.me && v.turn === v.me && v.phase === 'playing') {
    navigator.vibrate?.(40);
  }
  if (store.seenSeq && v.seq > store.seenSeq && $('#screen-game').offsetParent !== null) {
    playEvents(v, snap);
  }
  store.seenSeq = v.seq;
  if (modalKey() === 'suit' && v.turn !== v.me) closeModal();
}

// ---------- animations ----------

function anchorRect(pid) {
  const v = store.view;
  if (pid === v.me) return $('#hand').getBoundingClientRect();
  const seat = document.querySelector(`#opponents [data-pid="${pid}"] .avatar`);
  return seat?.getBoundingClientRect();
}

function fly(node, from, to, { delay = 0, rotate = 0, duration = 420 } = {}) {
  if (!from || !to || reducedMotion.matches) return Promise.resolve();
  node.classList.add('fly');
  Object.assign(node.style, { left: from.left + 'px', top: from.top + 'px', width: from.width + 'px', transformOrigin: '0 0' });
  node.style.setProperty('--cw', from.width + 'px');
  $('#fx').append(node);
  const scale = to.width / from.width;
  const anim = node.animate([
    { transform: 'translate(0, 0) rotate(0deg) scale(1)', opacity: 1 },
    { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) rotate(${rotate}deg) scale(${scale})`, opacity: 1 },
  ], { duration, delay, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
  return anim.finished.then(() => node.remove(), () => node.remove());
}

function smallRect(r, w = 46) {
  if (!r) return null;
  return { left: r.left + r.width / 2 - w / 2, top: r.top + r.height / 2 - w * 0.7, width: w, height: w * 1.4 };
}

function flyBacks(pid, count, snap) {
  const to = pid === store.view.me ? smallRect($('#hand').getBoundingClientRect(), 70) : smallRect(anchorRect(pid), 30);
  for (let i = 0; i < Math.min(count, 5); i++) {
    fly(cardEl(null), snap.deck, to, { delay: i * 90, rotate: 8 });
  }
}

function shakeSeat(pid) {
  const seat = document.querySelector(`#opponents [data-pid="${pid}"]`);
  if (!seat) return;
  seat.classList.remove('shake');
  void seat.offsetWidth;
  seat.classList.add('shake');
}

function playEvents(v, snap) {
  const name = (pid) => nameOf(v, pid);
  for (const ev of v.events) {
    switch (ev.type) {
      case 'play': {
        const top = $('#discard').lastElementChild;
        const toRect = $('#discard').getBoundingClientRect();
        const from = ev.playerId === v.me ? snap.cards.get(ev.card) : smallRect(anchorRect(ev.playerId), 40);
        if (top && from && !reducedMotion.matches) {
          top.style.visibility = 'hidden';
          fly(cardEl(ev.card), from, toRect, { rotate: hashRot(ev.card, 0).rot }).then(() => { top.style.visibility = ''; });
        }
        if (parse(ev.card).rank === 'Q') toast(t('ev_suit', { name: name(ev.playerId), suit: t('suit_' + ev.suit) }));
        break;
      }
      case 'draw':
        if (ev.count) flyBacks(ev.playerId, ev.count, snap);
        break;
      case 'penalty':
        flyBacks(ev.playerId, ev.count, snap);
        toast(t('ev_penalty', { name: name(ev.playerId), n: ev.count }));
        shakeSeat(ev.playerId);
        break;
      case 'skip':
        toast(t('ev_skip', { name: name(ev.playerId) }));
        shakeSeat(ev.playerId);
        break;
      case 'finish':
        toast(t(ev.queen ? 'ev_finish_q' : 'ev_finish', { name: name(ev.playerId) }));
        break;
      case 'timeout':
        toast(t('ev_timeout', { name: name(ev.playerId) }));
        break;
      case 'reshuffle':
        toast(t('ev_reshuffle'));
        break;
      case 'leave':
        toast(t('ev_leave', { name: ev.name }));
        break;
      case 'roundStart':
        for (const p of v.players) if (p.status === 'active') flyBacks(p.id, 3, snap);
        break;
      default:
    }
  }
}

// ---------- timer ----------

function tickTimer() {
  const v = store.view;
  if (!v || v.phase !== 'playing') return;
  const total = (v.settings?.turnSeconds ?? 0) * 1000;
  const left = v.turnEndsAt ? Math.max(0, v.turnEndsAt - serverNow()) : null;
  const p = left == null || !total ? 1 : left / total;
  document.querySelectorAll('.avatar.turn').forEach((a) => {
    a.style.setProperty('--p', p.toFixed(3));
    a.classList.toggle('urgent', left != null && left < 6000);
  });
  const secs = $('#status-secs');
  if (secs) secs.textContent = left == null ? '' : Math.ceil(left / 1000) + 's';
}

// ---------- round / game modals ----------

function scoreTable(v, rows) {
  return el('table', { class: 'scores' }, rows.map((r) => el('tr', { class: r.eliminated ? 'out' : '' }, [
    el('td', {}, el('div', { class: 'who' }, [avatarEl(r.name), el('span', { text: r.name + (r.id === v.me ? ` (${t('you')})` : '') })])),
    el('td', { text: r.score }),
  ])));
}

function standingsFrom(v) {
  const alive = v.players.filter((p) => p.status !== 'eliminated').sort((a, b) => a.score - b.score);
  const out = v.players.filter((p) => p.status === 'eliminated');
  return [...alive, ...out].map((p) => ({ id: p.id, name: p.name, score: p.score, eliminated: p.status === 'eliminated' }));
}

let countdownTimer = null;

function openRoundModal(v) {
  const lr = v.lastRound;
  const parts = [];
  if (lr?.aborted || !lr?.loserId) {
    parts.push(el('h2', { text: t('round_aborted') }));
  } else {
    parts.push(el('h2', { text: t('round_over', { n: v.round }) }));
    const loserName = nameOf(v, lr.loserId);
    const box = el('div', { class: 'loser-box' }, [
      el('div', { style: { display: 'flex', justifyContent: 'center', gap: '10px', alignItems: 'center' } }, [
        avatarEl(loserName), el('strong', { text: t('loser_line', { name: loserName }) }),
      ]),
      el('div', { class: 'mini-hand' }, lr.hand.map((id) => cardEl(id))),
      el('div', { class: 'big', text: t('points_added', { n: lr.added }) }),
      el('div', { class: 'muted', text: `${lr.before} → ${lr.before + lr.added}` }),
    ]);
    if (lr.reset) box.append(el('div', { class: 'note good', text: t('reset_108') }));
    if (lr.eliminated) box.append(el('div', { class: 'note bad', text: `${loserName} ${t('eliminated')} ❌` }));
    parts.push(box);
    for (const id of lr.bonuses ?? []) {
      parts.push(el('p', { class: 'sub', text: `👑 ${nameOf(v, id)}: ${t('queen_bonus')}` }));
    }
  }
  parts.push(scoreTable(v, standingsFrom(v)));
  const countdown = el('p', { class: 'sub', style: { marginTop: '12px' } });
  parts.push(countdown);
  if (v.isHost) {
    parts.push(el('div', { class: 'modal-actions' }, el('button', {
      class: 'btn btn-primary btn-lg', text: t('next_round'), onclick: () => act('game:next'),
    })));
  }
  openModal(parts, { dismissible: false });
  setModalKey('round-' + v.round);
  clearInterval(countdownTimer);
  const tick = () => {
    const at = store.view?.nextRoundAt;
    countdown.textContent = at ? t('next_in', { n: Math.max(0, Math.ceil((at - serverNow()) / 1000)) }) : '';
  };
  tick();
  countdownTimer = setInterval(tick, 250);
}

function openGameOverModal(v) {
  const winner = v.winnerId ? nameOf(v, v.winnerId) : null;
  const parts = [
    el('div', { class: 'trophy', text: '🏆' }),
    el('h2', { text: t('game_over') }),
  ];
  if (winner) parts.push(el('p', { class: 'sub', text: `${t('winner')}: ${winner}` }));
  parts.push(scoreTable(v, v.standings ?? standingsFrom(v)));
  const actions = [el('button', {
    class: 'btn btn-secondary btn-lg', text: t('to_home'),
    onclick: async () => { await call('room:leave'); leaveRoomLocal(); },
  })];
  if (v.isHost) actions.push(el('button', { class: 'btn btn-primary btn-lg', text: t('new_game'), onclick: () => act('game:new') }));
  parts.push(el('div', { class: 'modal-actions' }, actions));
  openModal(parts, { dismissible: false });
  setModalKey('gameover');
  confetti();
}

export function renderOverlays(v) {
  const key = modalKey();
  if (v.phase === 'roundOver') {
    if (key !== 'round-' + v.round) openRoundModal(v);
  } else if (v.phase === 'gameOver') {
    if (key !== 'gameover') openGameOverModal(v);
  } else if (key && (key.startsWith('round-') || key === 'gameover')) {
    clearInterval(countdownTimer);
    closeModal();
  }
}
