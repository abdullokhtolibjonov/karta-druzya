// Vote kick (R10.4): the vote banner, starting a vote and the result toast.
// The server decides everything; this only mirrors `view.vote`.
import { socket, call } from './net.js';
import { t, tErr } from './i18n.js';
import { $, el, toast, confirmDialog } from './ui.js';
import { store, serverNow, nameOf } from './state.js';

// Counted players: seated and not eliminated (same as the server).
const countedPids = (v) => v.players.filter((p) => p.status !== 'eliminated').map((p) => p.id);

// Whether I may start a vote against `pid` right now. Only a hint; the server checks again.
export function canStartVote(v, pid) {
  const pids = countedPids(v);
  return !v.vote && pid !== v.myId && pids.length >= 3 && pids.includes(v.myId) && pids.includes(pid);
}

export async function startVote(pid) {
  const v = store.view;
  if (!v || !(await confirmDialog(t('vote_kick_confirm', { name: nameOf(v, pid) })))) return;
  const res = await call('vote:start', { playerId: pid });
  if (!res.ok) toast(tErr(res.error), { error: true });
}

async function cast(yes) {
  const res = await call('vote:cast', { yes });
  if (!res.ok) toast(tErr(res.error), { error: true });
}

export function renderVote(v) {
  const bar = $('#vote-bar');
  const vote = v?.vote;
  bar.classList.toggle('hidden', !vote);
  document.body.classList.toggle('voting', !!vote);
  if (!vote) {
    bar.replaceChildren();
    return;
  }
  const voted = vote.yes.includes(v.myId) || vote.no.includes(v.myId);
  const canVote = !voted && vote.target !== v.myId && countedPids(v).includes(v.myId);
  let note = null;
  if (vote.target === v.myId) note = t('vote_you_target');
  else if (voted) note = t('vote_voted');
  // replaceChildren turns a null child into the text "null", so drop the empty parts.
  bar.replaceChildren(...[
    el('div', { class: 'vote-text' }, [
      el('strong', { text: t('vote_title', { by: nameOf(v, vote.by), name: nameOf(v, vote.target) }) }),
      el('span', { class: 'vote-meta' }, [
        t('vote_count', { yes: vote.yes.length, need: vote.need }),
        ' · ',
        el('span', { class: 'vote-left' }),
      ]),
      note ? el('span', { class: 'vote-note', text: note }) : null,
    ]),
    canVote ? el('div', { class: 'vote-actions' }, [
      el('button', { class: 'btn btn-secondary', type: 'button', text: t('no'), onclick: () => cast(false) }),
      el('button', { class: 'btn btn-danger', type: 'button', text: t('yes'), onclick: () => cast(true) }),
    ]) : null,
  ].filter(Boolean));
  // The screens move down by the banner's height so it never covers the seats.
  document.body.style.setProperty('--vote-h', `${bar.offsetHeight + 8}px`);
  tickVote();
}

function tickVote() {
  const vote = store.view?.vote;
  const left = $('#vote-bar .vote-left');
  if (!vote || !left) return;
  left.textContent = t('sec', { n: Math.max(0, Math.ceil((vote.endsAt - serverNow()) / 1000)) });
}

export function initVote() {
  setInterval(tickVote, 500);
  socket.on('vote:end', ({ name, kicked }) => toast(t(kicked ? 'vote_kicked' : 'vote_failed', { name })));
}
