import { socket, call } from './net.js';
import { prefs, clientId } from './prefs.js';
import { t, tErr, getLang, setLang, applyStatic, LANGS } from './i18n.js';
import { spriteSVG } from './cards.js';
import { $, el, icons, toast, cardEl, avatarEl, openModal, closeModal, confirmDialog } from './ui.js';
import { store } from './state.js';
import { renderLobby, initLobby } from './lobby.js';
import { renderTable, initTable, renderOverlays } from './table.js';
import { initChat, resetChat } from './chat.js';

// ---------- static setup ----------

$('#sprite').innerHTML = spriteSVG();
$('#btn-menu').innerHTML = icons.menu;
setLang(getLang());

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('#btn-theme').innerHTML = theme === 'dark' ? icons.sun : icons.moon;
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#0f1514' : '#eef2ee';
}
applyTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

$('#btn-theme').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  prefs.set('theme', next);
  applyTheme(next);
});

$('#btn-lang').addEventListener('click', () => {
  setLang(LANGS[(LANGS.indexOf(getLang()) + 1) % LANGS.length]);
  refreshTexts();
});

function refreshTexts() {
  $('#lang-label').textContent = getLang().toUpperCase();
  applyStatic();
  $('#rules-list').replaceChildren(...t('rules_body').map((r) => el('li', { text: r })));
  if (store.view) render();
  else renderRooms();
}

// Hero fan on the home screen.
const fan = $('#hero-fan');
[['QH', -22], ['AS', 0], ['KS', 22]].forEach(([id, rot], i) => {
  const c = cardEl(id);
  c.style.transform = `translateX(-50%) rotate(${rot}deg)`;
  c.style.zIndex = i;
  fan.append(c);
});

// ---------- screens ----------

// ---------- open rooms list (home screen) ----------

let listening = false;

async function watchRooms(on) {
  if (on === listening) return;
  listening = on;
  if (!on) return void call('rooms:unsubscribe');
  const res = await call('rooms:subscribe');
  if (res.ok && listening) renderRooms(res.rooms);
}

function roomStatus(r) {
  if (r.phase === 'lobby') return r.players >= r.max ? t('st_full') : t('st_waiting');
  if (r.phase === 'gameOver') return t('st_over');
  return t('st_round', { n: r.round });
}

let lastRooms = [];
function renderRooms(rooms = lastRooms) {
  lastRooms = rooms;
  const list = $('#room-list');
  if (!rooms.length) return list.replaceChildren(el('li', { class: 'room-empty', text: t('no_rooms') }));
  list.replaceChildren(...rooms.map((r) => {
    // A full lobby or a running game can still be entered as a spectator (R10.1).
    const asPlayer = r.phase === 'lobby' && r.players < r.max;
    return el('li', { class: 'room-item' }, [
      avatarEl(r.host, { host: true }),
      el('div', { class: 'info' }, [
        el('div', { class: 'title', text: t('room_of', { name: r.host }) }),
        el('div', { class: 'meta' }, [
          el('span', { class: 'dot' + (r.phase === 'lobby' ? '' : ' busy') }),
          el('span', { text: `${r.players}/${r.max} · ${roomStatus(r)}` }),
        ]),
      ]),
      el('button', {
        type: 'button',
        class: 'btn ' + (asPlayer ? 'btn-primary' : 'btn-secondary'),
        text: asPlayer ? t('join') : t('watch'),
        onclick: () => {
          const name = readName();
          if (name) join(r.code, name);
        },
      }),
    ]);
  }));
}

socket.on('rooms', (rooms) => { if (listening) renderRooms(rooms); });

function show(screen) {
  watchRooms(screen === 'home');
  for (const s of ['home', 'lobby', 'game']) $('#screen-' + s).classList.toggle('hidden', s !== screen);
  $('#btn-menu').classList.toggle('hidden', screen === 'home');
  document.body.dataset.screen = screen;
}

function topbarInfo() {
  const info = $('#topbar-info');
  const v = store.view;
  if (!v) return info.replaceChildren();
  const items = [el('span', { class: 'chip code', text: v.code })];
  if (v.round > 0 && v.phase !== 'lobby') items.push(el('span', { class: 'chip', text: t('round_n', { n: v.round }) }));
  info.replaceChildren(...items);
}

function render() {
  const v = store.view;
  if (!v) {
    show('home');
    topbarInfo();
    return;
  }
  topbarInfo();
  if (v.phase === 'lobby') {
    show('lobby');
    renderLobby(v);
  } else {
    show('game');
    renderTable(v, store.prev);
  }
  renderOverlays(v, store.prev);
}

// ---------- room flow ----------

function setUrl(code) {
  const url = new URL(location.href);
  if (code) url.searchParams.set('r', code);
  else url.searchParams.delete('r');
  history.replaceState(null, '', url);
}

function enterRoom(code) {
  store.code = code;
  prefs.set('lastRoom', code);
  setUrl(code);
}

export function leaveRoomLocal(message) {
  store.view = null;
  store.prev = null;
  store.code = null;
  store.seenSeq = 0;
  prefs.set('lastRoom', '');
  setUrl(null);
  closeModal();
  resetChat();
  if (message) toast(message);
  render();
}

function readName() {
  const name = $('#input-name').value.replace(/\s+/g, ' ').trim();
  if (!name) {
    toast(tErr('bad_name'), { error: true });
    $('#input-name').focus();
    return null;
  }
  store.name = name;
  prefs.set('name', name);
  return name;
}

$('#form-name').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = readName();
  if (!name) return;
  const code = $('#input-code').value.trim().toUpperCase();
  if (code.length === 4 && new URL(location.href).searchParams.get('r') === code) return join(code, name);
  const res = await call('room:create', { name, clientId: clientId() });
  if (!res.ok) return toast(tErr(res.error), { error: true });
  enterRoom(res.code);
});

$('#form-join').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = readName();
  if (!name) return;
  const code = $('#input-code').value.trim().toUpperCase();
  if (code.length !== 4) return $('#input-code').focus();
  join(code, name);
});

async function join(code, name) {
  const res = await call('room:join', { code, name, clientId: clientId() });
  if (!res.ok) {
    toast(tErr(res.error), { error: true });
    if (res.error === 'room_not_found') leaveRoomLocal();
    return false;
  }
  enterRoom(res.code);
  return true;
}

$('#input-code').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

$('#btn-menu').addEventListener('click', () => {
  const v = store.view;
  const items = [];
  if (v?.isHost && v.phase !== 'lobby' && v.phase !== 'gameOver') {
    items.push(el('button', {
      class: 'btn btn-secondary btn-lg', text: t('end_game'),
      onclick: async () => {
        closeModal();
        if (await confirmDialog(t('confirm_end'))) {
          const res = await call('game:end');
          if (!res.ok) toast(tErr(res.error), { error: true });
        }
      },
    }));
  }
  items.push(el('button', {
    class: 'btn btn-danger btn-lg', text: t('leave'),
    onclick: async () => {
      closeModal();
      if (await confirmDialog(t('confirm_leave'))) {
        await call('room:leave');
        leaveRoomLocal();
      }
    },
  }));
  openModal([el('h2', { text: t('menu') }), el('div', { class: 'stack' }, items)]);
});

$('#brand').addEventListener('click', () => { if (!store.view) $('#input-name').focus(); });

// ---------- socket events ----------

socket.on('state', (v) => {
  store.clockSkew = v.serverNow - Date.now();
  store.prev = store.view;
  store.view = v;
  if (store.selected && !v.myHand.includes(store.selected)) store.selected = null;
  render();
});

socket.on('kicked', () => leaveRoomLocal(t('kicked')));

let everConnected = false;
socket.on('connect', async () => {
  $('#conn').classList.add('hidden');
  // The server forgets list subscriptions on reconnect; subscribe again if it is showing.
  if (listening) {
    listening = false;
    watchRooms(true);
  }
  if (everConnected && store.code && store.name) {
    await join(store.code, store.name);
  }
  everConnected = true;
});
socket.on('disconnect', () => {
  if (store.code) $('#conn').classList.remove('hidden');
});

// ---------- boot ----------

initLobby();
initTable();
initChat();
refreshTexts();

store.name = prefs.get('name') ?? '';
$('#input-name').value = store.name;
const urlCode = (new URL(location.href).searchParams.get('r') ?? '').toUpperCase();
if (urlCode) {
  $('#input-code').value = urlCode;
  $('#btn-create').dataset.i18n = 'join';
  applyStatic();
}
show('home');

(async () => {
  if (urlCode && store.name) {
    if (!socket.connected) await new Promise((r) => socket.once('connect', r));
    everConnected = true;
    await join(urlCode, store.name);
  } else if (urlCode) {
    $('#input-name').focus();
  }
})();
