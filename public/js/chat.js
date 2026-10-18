// Chat drawer, emoji reactions and floating bubbles above avatars.
import { socket, call } from './net.js';
import { t, tErr } from './i18n.js';
import { $, el, icons, toast, avatarEl } from './ui.js';
import { store } from './state.js';

const EMOJIS = ['😂', '😎', '😡', '😭', '🔥', '👏', '🤔', '😱', '🙏', '💀', '🤡', '❤️'];
const BUBBLE_MS = 3000;
const FADE_MS = 800;
const MAX_PER_PLAYER = 3;

let unread = 0;
const bubbles = new Map(); // pid -> [node]

const isOpen = () => $('#chat-panel').classList.contains('open');

function setUnread(n) {
  unread = n;
  const b = $('#chat-unread');
  b.textContent = n > 9 ? '9+' : n;
  b.classList.toggle('hidden', n === 0);
}

function openChat(open) {
  const panel = $('#chat-panel');
  panel.classList.toggle('open', open);
  panel.setAttribute('aria-hidden', String(!open));
  if (open) {
    setUnread(0);
    const list = $('#chat-list');
    list.scrollTop = list.scrollHeight;
    if (finePointer()) $('#chat-input').focus();
  }
}

const finePointer = () => matchMedia('(hover: hover) and (pointer: fine)').matches;

function msgEl(m) {
  const mine = m.playerId === store.view?.myId;
  return el('div', { class: 'chat-msg' + (mine ? ' mine' : '') }, [
    avatarEl(m.name),
    el('div', { class: 'body' }, [el('div', { class: 'who', text: m.name }), el('div', { text: m.text })]),
  ]);
}

function addMessage(m) {
  const list = $('#chat-list');
  list.querySelector('.chat-empty')?.remove();
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  list.append(msgEl(m));
  while (list.children.length > 60) list.firstChild.remove();
  if (atBottom || m.playerId === store.view?.myId) list.scrollTop = list.scrollHeight;
}

function anchorFor(pid) {
  const candidates = [
    `#opponents [data-pid="${pid}"] .avatar`,
    `#me-bar[data-pid="${pid}"] .avatar`,
    `#lobby-players [data-pid="${pid}"] .avatar`,
    `#lobby-spectators [data-pid="${pid}"] .avatar`,
  ];
  for (const sel of candidates) {
    const node = document.querySelector(sel);
    if (node && node.offsetParent !== null) return node.getBoundingClientRect();
  }
  return null;
}

function showBubble(pid, content, emoji = false) {
  const r = anchorFor(pid);
  if (!r) return;
  const node = el('div', { class: 'bubble' + (emoji ? ' emoji' : ''), text: content });
  const x = Math.min(Math.max(r.left + r.width / 2, 70), innerWidth - 70);
  node.style.left = x + 'px';
  // Not enough room above (top row of seats): show the bubble under the avatar.
  const below = r.top < 120;
  node.classList.toggle('below', below);
  node.style.top = (below ? r.bottom + 8 : r.top - 6) + 'px';
  $('#fx').append(node);
  const list = bubbles.get(pid) ?? [];
  list.push(node);
  // Stack older bubbles upward so they don't overlap.
  const gap = (emoji ? 44 : 38) * (below ? 1 : -1);
  list.forEach((b, i) => { b.style.marginTop = (list.length - 1 - i) * gap + 'px'; });
  while (list.length > MAX_PER_PLAYER) list.shift().remove();
  bubbles.set(pid, list);
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => {
      node.remove();
      const l = bubbles.get(pid);
      if (l) bubbles.set(pid, l.filter((b) => b !== node));
    }, FADE_MS);
  }, BUBBLE_MS);
}

export function resetChat() {
  $('#chat-list').replaceChildren(el('div', { class: 'chat-empty', text: t('no_messages') }));
  setUnread(0);
  openChat(false);
  $('#emoji-bar').classList.add('hidden');
}

export function initChat() {
  $('#btn-chat').insertAdjacentHTML('afterbegin', icons.chat);
  $('#btn-emoji').innerHTML = icons.smile;
  $('#chat-close').innerHTML = icons.close;
  $('#chat-send').innerHTML = icons.send;
  resetChat();

  const bar = $('#emoji-bar');
  bar.replaceChildren(...EMOJIS.map((e) => el('button', {
    type: 'button', text: e,
    onclick: async () => {
      bar.classList.add('hidden');
      const res = await call('react:send', { emoji: e });
      if (!res.ok) toast(tErr(res.error), { error: true });
    },
  })));
  $('#btn-emoji').addEventListener('click', (e) => {
    e.stopPropagation();
    bar.classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!bar.contains(e.target)) bar.classList.add('hidden');
  });

  $('#btn-chat').addEventListener('click', () => openChat(!isOpen()));
  $('#chat-close').addEventListener('click', () => openChat(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openChat(false); });

  $('#chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    const res = await call('chat:send', { text });
    if (res.ok) input.value = '';
    else toast(tErr(res.error), { error: true });
  });

  socket.on('chat:history', (list) => {
    $('#chat-list').replaceChildren();
    if (!list.length) resetChat();
    list.forEach(addMessage);
  });

  socket.on('chat', (m) => {
    addMessage(m);
    showBubble(m.playerId, m.text.length > 70 ? m.text.slice(0, 68) + '…' : m.text);
    if (!isOpen() && m.playerId !== store.view?.myId) setUnread(unread + 1);
  });

  socket.on('react', (r) => showBubble(r.playerId, r.emoji, true));
}
