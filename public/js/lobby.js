import { call } from './net.js';
import { t, tErr } from './i18n.js';
import { $, el, icons, toast, avatarEl } from './ui.js';
import { voiceSupported, isMuted, toggleMute } from './voice.js';
import { canStartVote, startVote } from './vote.js';

const TIMER_OPTIONS = [0, 15, 30, 60];

export function initLobby() {
  $('#btn-start').addEventListener('click', async () => {
    const res = await call('game:start');
    if (!res.ok) toast(tErr(res.error), { error: true });
  });

  $('#public-toggle').addEventListener('change', async (e) => {
    const res = await call('room:settings', { public: e.target.checked });
    if (!res.ok) {
      e.target.checked = !e.target.checked;
      toast(tErr(res.error), { error: true });
    }
  });

  $('#btn-share').addEventListener('click', async () => {
    const url = location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: '108', text: t('share_text', { url }), url });
        return;
      } catch (e) {
        if (e?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast(t('copied'));
    } catch {
      prompt('', url);
    }
  });
}

function playerRow(p, v, { spectator = false } = {}) {
  const tags = [];
  if (p.id === v.myId) tags.push(t('you'));
  if (p.isHost) tags.push(t('host'));
  if (!p.connected) tags.push(t('offline'));
  if (spectator && p.joinNext) tags.push('⏳');
  const row = el('li', { class: 'player-row' + (p.connected ? '' : ' offline'), 'data-pid': p.id }, [
    avatarEl(p.name, { host: p.isHost, offline: !p.connected, mic: p.mic, muted: isMuted(p.id) }),
    el('span', { class: 'name', text: p.name }),
    el('span', { class: 'tag', text: tags.join(' · ') }),
  ]);
  if (voiceSupported && p.id !== v.myId && p.vid) {
    row.append(el('button', {
      class: 'icon-btn mute' + (isMuted(p.id) ? ' on' : ''),
      html: isMuted(p.id) ? icons.volumeOff : icons.volume,
      title: t('mute'), 'aria-label': t('mute'), 'aria-pressed': String(isMuted(p.id)),
      onclick: () => toggleMute(p.id),
    }));
  }
  if (v.isHost && p.id !== v.myId) {
    row.append(el('button', {
      class: 'icon-btn kick', html: icons.x, title: t('kick_name', { name: p.name }), 'aria-label': t('kick_name', { name: p.name }),
      onclick: async () => {
        const res = await call('room:kick', { playerId: p.id });
        if (!res.ok) toast(tErr(res.error), { error: true });
      },
    }));
  } else if (!spectator && canStartVote(v, p.id)) {
    // R10.4 – the host has the direct ✕ instead
    row.append(el('button', {
      class: 'icon-btn kick', html: icons.userX, title: t('vote_kick_name', { name: p.name }), 'aria-label': t('vote_kick_name', { name: p.name }),
      onclick: () => startVote(p.id),
    }));
  }
  return row;
}

export function renderLobby(v) {
  $('#lobby-code').textContent = v.code;
  $('#btn-share').replaceChildren(el('span', { html: icons.share }), t('share_link'));
  $('#lobby-count').textContent = `${v.players.length}/6` + (v.settings.public ? '' : ` · ${t('private_room')}`);
  $('#lobby-players').replaceChildren(...v.players.map((p) => playerRow(p, v)));

  const specs = $('#lobby-spectators');
  if (v.spectators.length) {
    // R10.1 – a spectator who chose to keep watching can take a free seat.
    const iWatch = !v.me && v.players.length < 6;
    specs.replaceChildren(
      el('h2', { class: 'panel-title', style: { marginTop: '14px' }, text: t('spectators') }),
      el('ul', { class: 'player-list' }, v.spectators.map((s) => playerRow(s, v, { spectator: true }))),
      iWatch ? el('button', {
        class: 'btn btn-secondary', type: 'button', style: { marginTop: '10px', width: '100%' }, text: t('join_game'),
        onclick: async () => {
          const res = await call('room:watch', { on: false });
          if (!res.ok) toast(tErr(res.error), { error: true });
        },
      }) : null,
    );
  } else {
    specs.replaceChildren();
  }

  $('#lobby-voice').classList.toggle('hidden', !voiceSupported);
  $('#lobby-host').classList.toggle('hidden', !v.isHost);
  $('#public-toggle').checked = v.settings.public;
  $('#timer-options').replaceChildren(...TIMER_OPTIONS.map((n) => el('button', {
    type: 'button',
    class: v.settings.turnSeconds === n ? 'on' : '',
    text: n ? t('sec', { n }) : t('timer_off'),
    onclick: async () => {
      const res = await call('room:settings', { turnSeconds: n });
      if (!res.ok) toast(tErr(res.error), { error: true });
    },
  })));

  const startBtn = $('#btn-start');
  startBtn.classList.toggle('hidden', !v.isHost);
  startBtn.disabled = v.players.length < 2;
  $('#lobby-wait').textContent = v.isHost ? (v.players.length < 2 ? t('need_two') : '') : t('waiting_host');
}
