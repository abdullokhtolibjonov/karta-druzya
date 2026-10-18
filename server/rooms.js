// Room manager: lobby, seats, host, turn timer, chat and socket handlers.
import { randomUUID } from 'node:crypto';
import * as E from './game/engine.js';
import { isCard, SUITS } from './game/cards.js';

export const EMOJIS = ['😂', '😎', '😡', '😭', '🔥', '👏', '🤔', '😱', '🙏', '💀', '🤡', '❤️'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TURN_OPTIONS = [0, 15, 30, 60];
const NEXT_ROUND_MS = 8000;
const LOBBY_GRACE_MS = 30_000;
const EMPTY_ROOM_MS = 10 * 60_000;
const CHAT_GAP_MS = 700;
const REACT_GAP_MS = 300;

const rooms = new Map();

function makeCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function cleanName(name) {
  if (typeof name !== 'string') return null;
  const n = name.replace(/\s+/g, ' ').trim().slice(0, 16);
  return n.length ? n : null;
}

const validClientId = (id) => typeof id === 'string' && id.length >= 8 && id.length <= 64;

export function createRoomManager(io, { now = () => Date.now() } = {}) {
  // ---------- room state ----------

  function createRoom() {
    const room = {
      code: makeCode(),
      game: E.createGame(),
      members: new Map(), // clientId -> member
      hostPid: null,
      settings: { turnSeconds: 30 },
      timer: null,
      timerKey: null,
      turnEndsAt: null,
      nextRoundTimer: null,
      nextRoundAt: null,
      chat: [],
      emptyTimer: null,
    };
    rooms.set(room.code, room);
    return room;
  }

  const memberByPid = (room, pid) => [...room.members.values()].find((m) => m.pid === pid);
  const isSeated = (room, pid) => room.game.players.some((p) => p.id === pid);

  function pickHost(room) {
    if (room.hostPid && memberByPid(room, room.hostPid)) return;
    const seated = room.game.players.map((p) => memberByPid(room, p.id)).find(Boolean);
    const any = seated ?? room.members.values().next().value;
    room.hostPid = any ? any.pid : null;
  }

  function addWaitingSpectators(room) {
    for (const m of room.members.values()) {
      if (!m.joinNext || isSeated(room, m.pid)) continue;
      if (E.aliveCount(room.game) >= E.MAX_PLAYERS) break;
      if (E.addPlayer(room.game, { id: m.pid, name: m.name }).ok) m.joinNext = false;
    }
  }

  function removeMember(room, member) {
    clearTimeout(member.graceTimer);
    if (isSeated(room, member.pid)) E.removePlayer(room.game, member.pid);
    room.members.delete(member.clientId);
    if (room.hostPid === member.pid) {
      room.hostPid = null;
      pickHost(room);
    }
    if (room.members.size === 0) destroyRoom(room);
  }

  function destroyRoom(room) {
    clearTimeout(room.timer);
    clearTimeout(room.nextRoundTimer);
    clearTimeout(room.emptyTimer);
    for (const m of room.members.values()) clearTimeout(m.graceTimer);
    rooms.delete(room.code);
  }

  function checkEmpty(room) {
    const anyConnected = [...room.members.values()].some((m) => m.sockets.size > 0);
    clearTimeout(room.emptyTimer);
    if (!anyConnected) room.emptyTimer = setTimeout(() => destroyRoom(room), EMPTY_ROOM_MS);
  }

  // ---------- timers ----------

  function armTimers(room) {
    const g = room.game;
    // R8 turn timer, re-armed whenever the game changed (seq) during play.
    if (g.phase === 'playing' && room.settings.turnSeconds > 0) {
      const key = `${g.turn}:${g.seq}`;
      if (key !== room.timerKey) {
        clearTimeout(room.timer);
        room.timerKey = key;
        const ms = room.settings.turnSeconds * 1000;
        room.turnEndsAt = now() + ms;
        room.timer = setTimeout(() => {
          room.timerKey = null;
          if (room.game.phase === 'playing') {
            E.timeout(room.game);
            sync(room);
          }
        }, ms);
      }
    } else {
      clearTimeout(room.timer);
      room.timer = null;
      room.timerKey = null;
      room.turnEndsAt = null;
    }
    // Auto next round.
    if (g.phase === 'roundOver') {
      if (!room.nextRoundTimer) {
        room.nextRoundAt = now() + NEXT_ROUND_MS;
        room.nextRoundTimer = setTimeout(() => startNextRound(room), NEXT_ROUND_MS);
      }
    } else {
      clearTimeout(room.nextRoundTimer);
      room.nextRoundTimer = null;
      room.nextRoundAt = null;
    }
  }

  function startNextRound(room) {
    clearTimeout(room.nextRoundTimer);
    room.nextRoundTimer = null;
    if (room.game.phase !== 'roundOver') return { ok: false, error: 'not_round_over' };
    addWaitingSpectators(room);
    const res = E.startRound(room.game);
    sync(room);
    return res;
  }

  // ---------- broadcasting ----------

  function viewFor(room, member) {
    const v = E.viewFor(room.game, member?.pid);
    const connected = (pid) => (memberByPid(room, pid)?.sockets.size ?? 0) > 0;
    v.players = v.players.map((p) => ({ ...p, connected: connected(p.id), isHost: p.id === room.hostPid }));
    v.spectators = [...room.members.values()]
      .filter((m) => !isSeated(room, m.pid))
      .map((m) => ({ id: m.pid, name: m.name, connected: m.sockets.size > 0, joinNext: m.joinNext }));
    v.myId = member?.pid ?? null;
    v.isHost = member?.pid === room.hostPid;
    v.code = room.code;
    v.settings = room.settings;
    v.turnEndsAt = room.turnEndsAt;
    v.nextRoundAt = room.nextRoundAt;
    v.serverNow = now();
    return v;
  }

  function sync(room) {
    if (!rooms.has(room.code)) return;
    armTimers(room);
    for (const m of room.members.values()) {
      const view = viewFor(room, m);
      for (const sid of m.sockets) io.to(sid).emit('state', view);
    }
  }

  // ---------- socket handlers ----------

  function attach(socket, room, member) {
    member.sockets.add(socket.id);
    clearTimeout(member.graceTimer);
    socket.data.code = room.code;
    socket.data.clientId = member.clientId;
    socket.join(room.code);
    clearTimeout(room.emptyTimer);
    socket.emit('chat:history', room.chat);
  }

  function detach(socket) {
    const room = rooms.get(socket.data.code);
    const member = room?.members.get(socket.data.clientId);
    socket.leave(socket.data.code);
    socket.data.code = null;
    if (!member) return { room, member: null };
    member.sockets.delete(socket.id);
    return { room, member };
  }

  function joinRoom(socket, room, { name, clientId }) {
    let member = room.members.get(clientId);
    if (member) {
      // R10.3 reconnect: take the same seat back.
      if (room.game.phase === 'lobby' && name !== member.name) {
        member.name = name;
        E.renamePlayer(room.game, member.pid, name);
      }
    } else {
      member = { pid: randomUUID().slice(0, 8), clientId, name, sockets: new Set(), joinNext: false, graceTimer: null, lastChat: 0, lastReact: 0 };
      room.members.set(clientId, member);
      const res = E.addPlayer(room.game, { id: member.pid, name });
      // R10.1: during a round (or when full) -> spectator, dealt in next round if possible.
      if (!res.ok) member.joinNext = res.error !== 'room_full' || room.game.phase !== 'lobby';
      pickHost(room);
    }
    attach(socket, room, member);
    sync(room);
    return member;
  }

  function ctx(socket) {
    const room = rooms.get(socket.data.code);
    const member = room?.members.get(socket.data.clientId);
    return room && member ? { room, member } : null;
  }

  const reply = (ack, res) => typeof ack === 'function' && ack(res);

  function onConnection(socket) {
    socket.data.code = null;

    socket.on('room:create', (payload = {}, ack) => {
      const name = cleanName(payload.name);
      if (!name) return reply(ack, { ok: false, error: 'bad_name' });
      if (!validClientId(payload.clientId)) return reply(ack, { ok: false, error: 'bad_request' });
      if (socket.data.code) leave(socket);
      const room = createRoom();
      joinRoom(socket, room, { name, clientId: payload.clientId });
      reply(ack, { ok: true, code: room.code });
    });

    socket.on('room:join', (payload = {}, ack) => {
      const name = cleanName(payload.name);
      if (!name) return reply(ack, { ok: false, error: 'bad_name' });
      if (!validClientId(payload.clientId)) return reply(ack, { ok: false, error: 'bad_request' });
      const code = typeof payload.code === 'string' ? payload.code.trim().toUpperCase() : '';
      const room = rooms.get(code);
      if (!room) return reply(ack, { ok: false, error: 'room_not_found' });
      if (socket.data.code && socket.data.code !== code) leave(socket);
      joinRoom(socket, room, { name, clientId: payload.clientId });
      reply(ack, { ok: true, code });
    });

    function leave(sock) {
      const { room, member } = detach(sock);
      if (room && member) {
        removeMember(room, member);
        sync(room);
      }
    }

    socket.on('room:leave', (_p, ack) => {
      leave(socket);
      reply(ack, { ok: true });
    });

    socket.on('disconnect', () => {
      const { room, member } = detach(socket);
      if (!room || !member) return;
      if (member.sockets.size === 0 && room.game.phase === 'lobby') {
        member.graceTimer = setTimeout(() => {
          if (member.sockets.size === 0 && rooms.has(room.code)) {
            removeMember(room, member);
            sync(room);
          }
        }, LOBBY_GRACE_MS);
      }
      checkEmpty(room);
      sync(room);
    });

    // Host-only and game actions share this wrapper.
    function on(event, { host = false } = {}, handler) {
      socket.on(event, (payload = {}, ack) => {
        const c = ctx(socket);
        if (!c) return reply(ack, { ok: false, error: 'not_in_room' });
        if (host && c.member.pid !== c.room.hostPid) return reply(ack, { ok: false, error: 'host_only' });
        const res = handler(c, payload ?? {}) ?? { ok: true };
        if (res.ok) sync(c.room);
        reply(ack, res);
      });
    }

    on('room:settings', { host: true }, ({ room }, p) => {
      if (!TURN_OPTIONS.includes(p.turnSeconds)) return { ok: false, error: 'bad_request' };
      room.settings.turnSeconds = p.turnSeconds;
      room.timerKey = null;
      return { ok: true };
    });

    on('room:kick', { host: true }, ({ room, member }, p) => {
      const target = memberByPid(room, p.playerId);
      if (!target || target === member) return { ok: false, error: 'not_found' };
      for (const sid of target.sockets) {
        const s = io.sockets.sockets.get(sid);
        if (s) {
          s.leave(room.code);
          s.data.code = null;
          s.emit('kicked');
        }
      }
      target.sockets.clear();
      removeMember(room, target);
      return { ok: true };
    });

    on('game:start', { host: true }, ({ room }) => {
      if (room.game.phase !== 'lobby') return { ok: false, error: 'game_in_progress' };
      addWaitingSpectators(room);
      return E.startRound(room.game);
    });

    on('game:next', { host: true }, ({ room }) => startNextRound(room));

    on('game:end', { host: true }, ({ room }) => E.endGame(room.game));

    on('game:new', { host: true }, ({ room }) => {
      if (room.game.phase !== 'gameOver') return { ok: false, error: 'game_in_progress' };
      E.resetGame(room.game);
      for (const m of room.members.values()) if (!isSeated(room, m.pid)) m.joinNext = true;
      addWaitingSpectators(room);
      return { ok: true };
    });

    on('game:play', {}, ({ room, member }, p) => {
      if (!isCard(p.cardId)) return { ok: false, error: 'bad_request' };
      if (p.suit != null && !SUITS.includes(p.suit)) return { ok: false, error: 'bad_request' };
      return E.play(room.game, member.pid, p.cardId, p.suit);
    });

    on('game:draw', {}, ({ room, member }) => E.draw(room.game, member.pid));

    on('game:pass', {}, ({ room, member }) => E.pass(room.game, member.pid));

    socket.on('chat:send', (p = {}, ack) => {
      const c = ctx(socket);
      if (!c) return reply(ack, { ok: false, error: 'not_in_room' });
      const text = typeof p?.text === 'string' ? p.text.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
      if (!text) return reply(ack, { ok: false, error: 'bad_request' });
      const t = now();
      if (t - c.member.lastChat < CHAT_GAP_MS) return reply(ack, { ok: false, error: 'too_fast' });
      c.member.lastChat = t;
      const msg = { id: randomUUID().slice(0, 8), playerId: c.member.pid, name: c.member.name, text, ts: t };
      c.room.chat.push(msg);
      if (c.room.chat.length > 50) c.room.chat.shift();
      io.to(c.room.code).emit('chat', msg);
      reply(ack, { ok: true });
    });

    socket.on('react:send', (p = {}, ack) => {
      const c = ctx(socket);
      if (!c) return reply(ack, { ok: false, error: 'not_in_room' });
      if (!EMOJIS.includes(p?.emoji)) return reply(ack, { ok: false, error: 'bad_request' });
      const t = now();
      if (t - c.member.lastReact < REACT_GAP_MS) return reply(ack, { ok: false, error: 'too_fast' });
      c.member.lastReact = t;
      io.to(c.room.code).emit('react', { playerId: c.member.pid, emoji: p.emoji, ts: t });
      reply(ack, { ok: true });
    });
  }

  io.on('connection', onConnection);
  return { rooms };
}
