// Voice chat: a WebRTC mesh between everyone in the room (players and spectators).
// The server only relays signalling (`voice:signal`); audio goes peer to peer, or through
// Cloudflare TURN when phones can't reach each other directly.
//
// Every pair has exactly one RTCPeerConnection with one audio transceiver. The member with the
// smaller pid sends the offer, so offers never collide. Turning the mic on or off only swaps the
// sender's track (replaceTrack), so there is never a second negotiation on a live connection.
import { socket, call } from './net.js';
import { t } from './i18n.js';
import { toast } from './ui.js';
import { store } from './state.js';

const FALLBACK_ICE = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
const ICE_MAX_AGE_MS = 6 * 3600_000;
const CONNECT_TIMEOUT_MS = 25_000;
const SPEAK_LEVEL = 0.03; // RMS of the waveform that counts as talking
const SPEAK_HOLD_MS = 400;
const AUDIO = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

export const voiceSupported = typeof RTCPeerConnection === 'function';

const peers = new Map(); // pid -> peer
const muted = new Set(); // pids muted locally
const levels = new Map(); // pid -> { src, analyser, buf, until }
const retries = new Map(); // pid -> failed attempts in a row
const listeners = [];
let myVid = null;
let micStream = null;
let micTrack = null;
let micPid = null; // my pid while my mic level is watched
let micBusy = false;
let micSyncing = false;
let ice = null; // { promise, at }
let audioCtx = null;
let locked = false; // autoplay was blocked; waiting for a tap
let sink = null;

export const micOn = () => Boolean(micTrack);
export const isMuted = (pid) => muted.has(pid);
export const onVoiceChange = (fn) => listeners.push(fn);
const changed = () => listeners.forEach((fn) => fn());

// ---------- helpers ----------

function getIce() {
  if (!ice || Date.now() - ice.at > ICE_MAX_AGE_MS) {
    ice = {
      at: Date.now(),
      promise: call('voice:ice').then((r) => (r.ok && r.iceServers?.length ? r.iceServers : FALLBACK_ICE)),
    };
  }
  return ice.promise;
}

function ctx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  return audioCtx;
}

function play(audio) {
  audio.play().catch(() => {
    if (locked) return;
    locked = true;
    toast(t('voice_tap'), { ms: 4000 });
  });
}

// Browsers only start audio after a user gesture. Any tap retries everything that was blocked.
function unlock() {
  if (audioCtx?.state === 'suspended') audioCtx.resume().catch(() => {});
  if (!locked) return;
  locked = false;
  for (const p of peers.values()) if (p.audio.srcObject && p.audio.paused) play(p.audio);
}

function watchLevel(pid, stream) {
  unwatchLevel(pid);
  const ac = ctx();
  if (!ac) return;
  try {
    const src = ac.createMediaStreamSource(stream);
    const analyser = ac.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    levels.set(pid, { src, analyser, buf: new Float32Array(analyser.fftSize), until: 0 });
  } catch {
    // Speaking rings are a nicety; audio still works without them.
  }
}

function unwatchLevel(pid) {
  const l = levels.get(pid);
  if (!l) return;
  l.src.disconnect();
  levels.delete(pid);
}

// Toggles `.speaking` on every avatar of that player (seats, lobby rows, my bar).
function tickLevels() {
  const now = performance.now();
  for (const [pid, l] of levels) {
    l.analyser.getFloatTimeDomainData(l.buf);
    let sum = 0;
    for (const x of l.buf) sum += x * x;
    if (Math.sqrt(sum / l.buf.length) > SPEAK_LEVEL) l.until = now + SPEAK_HOLD_MS;
  }
  document.querySelectorAll('.avatar.speaking').forEach((a) => {
    const pid = a.closest('[data-pid]')?.dataset.pid;
    if (!(levels.get(pid)?.until > now)) a.classList.remove('speaking');
  });
  for (const [pid, l] of levels) {
    if (l.until > now) document.querySelectorAll(`[data-pid="${pid}"] .avatar`).forEach((a) => a.classList.add('speaking'));
  }
}

// ---------- peers ----------

const send = (peer, data) => socket.emit('voice:signal', { to: peer.pid, vid: peer.vid, data: { ...data, cid: peer.cid } });

function createPeer(pid, vid, cid, initiator) {
  const audio = document.createElement('audio');
  audio.autoplay = true;
  audio.setAttribute('playsinline', '');
  audio.muted = muted.has(pid);
  sink.append(audio);
  const peer = { pid, vid, cid, initiator, pc: null, tr: null, audio, timer: null, chain: Promise.resolve() };
  peers.set(pid, peer);

  peer.chain = getIce().then((iceServers) => {
    if (peers.get(pid) !== peer) return;
    const pc = new RTCPeerConnection({ iceServers });
    peer.pc = pc;
    pc.onicecandidate = (e) => { if (e.candidate) send(peer, { type: 'cand', c: e.candidate.toJSON() }); };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      audio.srcObject = stream;
      play(audio);
      watchLevel(pid, stream);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        clearTimeout(peer.timer);
        retries.delete(pid);
      } else if (pc.connectionState === 'failed') {
        retry(peer);
      }
    };
    if (initiator) peer.timer = setTimeout(() => retry(peer), CONNECT_TIMEOUT_MS);
  });
  return peer;
}

function closePeer(pid) {
  const peer = peers.get(pid);
  if (!peer) return;
  peers.delete(pid);
  clearTimeout(peer.timer);
  peer.pc?.close();
  peer.audio.srcObject = null;
  peer.audio.remove();
  unwatchLevel(pid);
}

// Only the offering side retries: it drops the connection and offers again with backoff.
function retry(peer) {
  if (!peer.initiator || peers.get(peer.pid) !== peer) return;
  const n = (retries.get(peer.pid) ?? 0) + 1;
  retries.set(peer.pid, n);
  closePeer(peer.pid);
  setTimeout(() => {
    const target = voiceMembers(store.view).get(peer.pid);
    if (target === peer.vid && !peers.has(peer.pid)) offer(peer.pid, peer.vid);
  }, Math.min(2000 * n, 15_000));
}

function offer(pid, vid) {
  const peer = createPeer(pid, vid, Math.random().toString(36).slice(2, 10), true);
  peer.chain = peer.chain.then(async () => {
    if (!peer.pc) return;
    peer.tr = peer.pc.addTransceiver(micTrack ?? 'audio', { direction: 'sendrecv' });
    await peer.pc.setLocalDescription(await peer.pc.createOffer());
    send(peer, { type: 'offer', sdp: peer.pc.localDescription.sdp });
  }).catch((e) => console.warn('voice offer', e));
}

async function handle(peer, data) {
  const pc = peer.pc;
  if (!pc) return;
  if (data.type === 'offer') {
    await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
    peer.tr = pc.getTransceivers()[0];
    peer.tr.direction = 'sendrecv';
    if (micTrack) await peer.tr.sender.replaceTrack(micTrack);
    await pc.setLocalDescription(await pc.createAnswer());
    send(peer, { type: 'answer', sdp: pc.localDescription.sdp });
  } else if (data.type === 'answer') {
    await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
  } else if (data.type === 'cand') {
    await pc.addIceCandidate(data.c).catch(() => {});
  }
}

function onSignal({ from, vid, data }) {
  if (!store.view || !myVid || !data) return;
  let peer = peers.get(from);
  if (data.type === 'offer') {
    if (store.view.myId < from) return; // I am the offering side for this pair
    closePeer(from);
    peer = createPeer(from, vid, data.cid, false);
  }
  if (!peer || peer.vid !== vid || peer.cid !== data.cid) return;
  // Signals must be applied in order (candidates only after the description).
  peer.chain = peer.chain.then(() => handle(peer, data)).catch((e) => console.warn('voice signal', e));
}

// pid -> vid of everyone else currently connected in the room.
function voiceMembers(v) {
  const out = new Map();
  if (!v) return out;
  for (const m of [...v.players, ...(v.spectators ?? [])]) if (m.id !== v.myId && m.vid) out.set(m.id, m.vid);
  return out;
}

const meIn = (v) => v.players.find((p) => p.id === v.myId) ?? v.spectators?.find((s) => s.id === v.myId);

// Called on every server state.
export function syncVoice(v) {
  if (!voiceSupported) return;
  if (!v) return stopVoice();
  const me = meIn(v);
  if (me?.vid !== myVid) {
    // I reconnected (or left): every old connection is dead.
    for (const pid of [...peers.keys()]) closePeer(pid);
    myVid = me?.vid ?? null;
  }
  if (!myVid) return;
  const others = voiceMembers(v);
  for (const [pid, peer] of [...peers]) if (others.get(pid) !== peer.vid) closePeer(pid);
  for (const [pid, vid] of others) if (!peers.has(pid) && v.myId < pid) offer(pid, vid);
  for (const pid of [...retries.keys()]) if (!others.has(pid)) retries.delete(pid);
  for (const pid of [...muted]) if (!others.has(pid) && !v.players.some((p) => p.id === pid)) muted.delete(pid);

  // The server resets mic=false on every (re)join; tell it again if mine is on.
  if (Boolean(me?.mic) !== micOn() && !micBusy && !micSyncing) {
    micSyncing = true;
    call('voice:mic', { on: micOn() }).finally(() => { micSyncing = false; });
  }
}

export function stopVoice() {
  for (const pid of [...peers.keys()]) closePeer(pid);
  stopMic();
  myVid = null;
  ice = null;
  retries.clear();
  muted.clear();
  for (const pid of [...levels.keys()]) unwatchLevel(pid);
}

// ---------- mic and mute ----------

function stopMic() {
  if (!micStream) return;
  micStream.getTracks().forEach((tr) => tr.stop());
  micStream = null;
  micTrack = null;
  for (const p of peers.values()) p.tr?.sender.replaceTrack(null).catch(() => {});
  unwatchLevel(micPid);
  micPid = null;
  changed();
}

export async function toggleMic() {
  if (micBusy || !store.view) return;
  micBusy = true;
  try {
    if (micTrack) {
      stopMic();
      await call('voice:mic', { on: false });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) return toast(t('mic_unsupported'), { error: true });
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO });
    } catch (e) {
      return toast(t(e?.name === 'NotAllowedError' ? 'mic_denied' : 'mic_error'), { error: true });
    }
    if (!store.view) return stream.getTracks().forEach((tr) => tr.stop());
    micStream = stream;
    micTrack = stream.getAudioTracks()[0];
    micTrack.addEventListener('ended', () => {
      if (!micTrack) return;
      stopMic();
      call('voice:mic', { on: false });
    });
    for (const p of peers.values()) p.tr?.sender.replaceTrack(micTrack).catch(() => {});
    micPid = store.view.myId;
    watchLevel(micPid, stream);
    await call('voice:mic', { on: true });
  } finally {
    micBusy = false;
    changed();
  }
}

export function toggleMute(pid) {
  if (muted.has(pid)) muted.delete(pid);
  else muted.add(pid);
  const peer = peers.get(pid);
  if (peer) peer.audio.muted = muted.has(pid);
  changed();
  return muted.has(pid);
}

export function initVoice() {
  if (!voiceSupported) return;
  sink = document.createElement('div');
  sink.hidden = true;
  document.body.append(sink);
  socket.on('voice:signal', onSignal);
  for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, unlock, true);
  setInterval(tickLevels, 120);
}
