// Small DOM helpers: icons, toasts, modals, avatars.
import { t } from './i18n.js';
import { cardSVG, backSVG } from './cards.js';

const path = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const icons = {
  sun: path('<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: path('<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"/>'),
  menu: path('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  chat: path('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.2-4.4A8 8 0 1 1 21 12Z"/>'),
  smile: path('<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><path d="M9 9.5h.01M15 9.5h.01" stroke-width="3"/>'),
  share: path('<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M12 3v12M7 8l5-5 5 5"/>'),
  close: path('<path d="M6 6l12 12M18 6 6 18"/>'),
  send: path('<path d="M4 12 20 4l-6 16-3-7-7-1Z"/>'),
  x: path('<path d="M7 7l10 10M17 7 7 17"/>'),
  mic: path('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>'),
  micOff: path('<path d="M15 9.5V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.6 2.5M5.5 11a6.5 6.5 0 0 0 10.3 5.3M18.5 11a6.4 6.4 0 0 1-.6 2.7M12 17.5V21M3 3l18 18"/>'),
  volume: path('<path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4Z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  volumeOff: path('<path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4Z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>'),
};

export const $ = (sel, root = document) => root.querySelector(sel);

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith('--')) node.style.setProperty(prop, val);
        else node.style[prop] = val;
      }
    }
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) if (c != null) node.append(c);
  return node;
}

export function cardEl(id, extraClass = '') {
  const node = el('div', { class: `card ${extraClass}`.trim(), html: id ? cardSVG(id) : backSVG() });
  if (id) node.dataset.card = id;
  else node.classList.add('back');
  return node;
}

function hue(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

export function avatarEl(name, { host = false, offline = false, size, mic = false, muted = false } = {}) {
  const a = el('div', { class: 'avatar', style: { '--h': hue(name) } }, [[...name][0] ?? '?']);
  if (size) a.style.setProperty('--size', size + 'px');
  if (host) a.append(el('span', { class: 'crown', text: '👑' }));
  if (offline) a.append(el('span', { class: 'off-dot' }));
  // Muted by me wins over "mic on": what matters to me is that I won't hear them.
  if (muted) a.append(el('span', { class: 'voice-dot muted', html: icons.volumeOff }));
  else if (mic) a.append(el('span', { class: 'voice-dot', html: icons.mic }));
  return a;
}

export function toast(text, { error = false, ms = 2400 } = {}) {
  const root = $('#toasts');
  // On the table, show toasts on the felt instead of over the opponents.
  const felt = document.body.dataset.screen === 'game' && !$('#modal-root').children.length ? $('#felt') : null;
  root.style.top = felt ? felt.getBoundingClientRect().top + 10 + 'px' : '';
  const node = el('div', { class: 'toast' + (error ? ' err' : ''), text });
  root.append(node);
  while (root.children.length > 3) root.firstChild.remove();
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 400);
  }, ms);
}

let current = null;

export function openModal(content, { dismissible = true, onClose } = {}) {
  closeModal();
  const modal = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, content);
  const backdrop = el('div', { class: 'modal-backdrop' }, modal);
  if (dismissible) backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
  $('#modal-root').append(backdrop);
  current = { backdrop, onClose, key: null, dismissible };
  return current;
}

addEventListener('keydown', (e) => { if (e.key === 'Escape' && current?.dismissible) closeModal(); });

export function closeModal() {
  if (!current) return;
  const { backdrop, onClose } = current;
  current = null;
  backdrop.remove();
  onClose?.();
}

export const modalKey = () => current?.key ?? null;
export const setModalKey = (key) => { if (current) current.key = key; };

export function confirmDialog(text) {
  return new Promise((resolve) => {
    let answered = false;
    const done = (v) => { answered = true; closeModal(); resolve(v); };
    openModal([
      el('h2', { text }),
      el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn btn-secondary', text: t('no'), onclick: () => done(false) }),
        el('button', { class: 'btn btn-primary', text: t('yes'), onclick: () => done(true) }),
      ]),
    ], { onClose: () => { if (!answered) resolve(false); } });
  });
}

export function confetti() {
  const colors = ['#f4b740', '#ef5b5b', '#49c27c', '#4aa3ff', '#c77dff', '#fff'];
  for (let i = 0; i < 70; i++) {
    const c = el('div', { class: 'confetti' });
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.animationDelay = Math.random() * 0.8 + 's';
    c.style.animationDuration = 2.2 + Math.random() * 1.6 + 's';
    c.style.borderRadius = i % 3 ? '2px' : '50%';
    document.body.append(c);
    setTimeout(() => c.remove(), 5000);
  }
}
