import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { startServer } from '../server/index.js';

let server;
let url;
const clients = [];

before(async () => {
  server = await startServer(0);
  url = `http://localhost:${server.port}`;
});

after(() => {
  for (const c of clients) c.close();
  server.io.close();
  server.http.close();
});

function client() {
  const s = connect(url, { transports: ['websocket'], forceNew: true });
  s.last = null;
  s.on('state', (v) => { s.last = v; });
  clients.push(s);
  return s;
}

const call = (s, ev, payload) => new Promise((r) => s.emit(ev, payload, r));
const tick = (ms = 80) => new Promise((r) => setTimeout(r, ms));

test('create, join, start, play, chat, reconnect', async () => {
  const a = client();
  const b = client();
  const created = await call(a, 'room:create', { name: 'Ali', clientId: 'client-aaaa' });
  assert.ok(created.ok);
  assert.equal(created.code.length, 4);
  assert.equal((await call(b, 'room:join', { code: 'zzzz', name: 'Vali', clientId: 'client-bbbb' })).error, 'room_not_found');
  assert.ok((await call(b, 'room:join', { code: created.code.toLowerCase(), name: 'Vali', clientId: 'client-bbbb' })).ok);
  await tick();
  assert.equal(a.last.players.length, 2);
  assert.equal(a.last.isHost, true);
  assert.equal(b.last.isHost, false);

  assert.equal((await call(b, 'game:start')).error, 'host_only');
  assert.ok((await call(a, 'game:start')).ok);
  await tick();
  assert.equal(a.last.phase, 'playing');
  assert.ok(a.last.myHand.length >= 6);
  assert.ok(a.last.turnEndsAt > Date.now());
  // never leak the other hand
  for (const c of b.last.myHand) assert.equal(a.last.myHand.includes(c), false);

  const turnClient = a.last.turn === a.last.myId ? a : b;
  const other = turnClient === a ? b : a;
  assert.equal((await call(other, 'game:pass')).error, 'not_your_turn');
  const v = turnClient.last;
  const res = v.playable.length
    ? await call(turnClient, 'game:play', { cardId: v.playable[0], suit: 'H' })
    : await call(turnClient, 'game:draw');
  assert.ok(res.ok, JSON.stringify(res));

  const got = new Promise((r) => b.once('chat', r));
  assert.ok((await call(a, 'chat:send', { text: '  salom   hammaga ' })).ok);
  assert.equal((await got).text, 'salom hammaga');
  assert.equal((await call(a, 'chat:send', { text: 'tez' })).error, 'too_fast');
  assert.equal((await call(a, 'react:send', { emoji: '🍕' })).error, 'bad_request');
  assert.ok((await call(a, 'react:send', { emoji: '🔥' })).ok);

  // Reconnect with same clientId keeps the seat.
  const seat = b.last.myId;
  const hand = b.last.myHand;
  b.close();
  const b2 = client();
  assert.ok((await call(b2, 'room:join', { code: created.code, name: 'Vali', clientId: 'client-bbbb' })).ok);
  await tick();
  assert.equal(b2.last.myId, seat);
  assert.deepEqual(b2.last.myHand, hand);

  // Late joiner is a spectator waiting for next round.
  const c = client();
  assert.ok((await call(c, 'room:join', { code: created.code, name: 'Sardor', clientId: 'client-cccc' })).ok);
  await tick();
  assert.equal(c.last.me, null);
  assert.equal(c.last.spectators[0].joinNext, true);

  assert.ok((await call(a, 'game:end')).ok);
  await tick();
  assert.equal(c.last.phase, 'gameOver');
  assert.ok((await call(a, 'game:new')).ok);
  await tick();
  assert.equal(c.last.players.length, 3);
  assert.equal(c.last.phase, 'lobby');
});

test('public room list: live updates, hidden rooms, empty rooms', async () => {
  const watcher = client();
  let latest = null;
  watcher.on('rooms', (list) => { latest = list; });
  const sub = await call(watcher, 'rooms:subscribe');
  assert.ok(sub.ok);
  assert.ok(Array.isArray(sub.rooms));

  const h = client();
  const { code } = await call(h, 'room:create', { name: 'Malika', clientId: 'client-list-h' });
  await tick(400);
  const entry = latest.find((r) => r.code === code);
  assert.deepEqual(entry, { code, host: 'Malika', players: 1, max: 6, phase: 'lobby', round: 0 });

  const g = client();
  await call(g, 'room:join', { code, name: 'Jasur', clientId: 'client-list-g' });
  await tick(400);
  assert.equal(latest.find((r) => r.code === code).players, 2);

  // Only the host may hide; hidden rooms disappear from the list.
  assert.equal((await call(g, 'room:settings', { public: false })).error, 'host_only');
  assert.equal((await call(h, 'room:settings', { public: 'no' })).error, 'bad_request');
  assert.ok((await call(h, 'room:settings', { public: false })).ok);
  await tick(400);
  assert.equal(latest.some((r) => r.code === code), false);
  assert.equal(h.last.settings.public, false);
  // Still joinable by code.
  const k = client();
  assert.ok((await call(k, 'room:join', { code, name: 'Kamola', clientId: 'client-list-k' })).ok);

  assert.ok((await call(h, 'room:settings', { public: true })).ok);
  await tick(400);
  assert.ok(latest.some((r) => r.code === code));

  // A room with nobody connected is not listed.
  h.close(); g.close(); k.close();
  await tick(400);
  assert.equal(latest.some((r) => r.code === code), false);

  assert.ok((await call(watcher, 'rooms:unsubscribe')).ok);
});

test('voice: mic state, signal relay, ice servers', async () => {
  const a = client();
  const b = client();
  const { code } = await call(a, 'room:create', { name: 'Ali', clientId: 'client-voice-a' });
  await call(b, 'room:join', { code, name: 'Vali', clientId: 'client-voice-b' });
  await tick();
  const meA = a.last.players.find((p) => p.id === a.last.myId);
  const meB = b.last.players.find((p) => p.id === b.last.myId);
  assert.equal(meA.vid.length, 8);
  assert.equal(meA.mic, false);

  assert.equal((await call(a, 'voice:mic', { on: 'yes' })).error, 'bad_request');
  assert.ok((await call(a, 'voice:mic', { on: true })).ok);
  await tick();
  assert.equal(b.last.players.find((p) => p.id === meA.id).mic, true);

  // Relay to the target's current vid only.
  const got = new Promise((r) => b.once('voice:signal', r));
  assert.ok((await call(a, 'voice:signal', { to: meB.id, vid: meB.vid, data: { type: 'offer', sdp: 'x' } })).ok);
  assert.deepEqual(await got, { from: meA.id, vid: meA.vid, data: { type: 'offer', sdp: 'x' } });
  assert.equal((await call(a, 'voice:signal', { to: meB.id, vid: 'stale000', data: {} })).error, 'not_found');
  assert.equal((await call(a, 'voice:signal', { to: meA.id, vid: meA.vid, data: {} })).error, 'not_found');
  assert.equal((await call(a, 'voice:signal', { to: meB.id, vid: meB.vid, data: 'x' })).error, 'bad_request');
  assert.equal((await call(a, 'voice:signal', { to: meB.id, vid: meB.vid, data: { sdp: 'x'.repeat(30000) } })).error, 'bad_request');

  // Without TURN keys the server hands out STUN only.
  const ice = await call(a, 'voice:ice');
  assert.ok(ice.ok);
  assert.ok(ice.iceServers[0].urls.some((u) => u.startsWith('stun:')));

  // Reconnect: new vid, mic reset until the client says otherwise.
  b.close();
  await tick();
  assert.equal(a.last.players.find((p) => p.id === meB.id).vid, null);
  const b2 = client();
  await call(b2, 'room:join', { code, name: 'Vali', clientId: 'client-voice-b' });
  await tick();
  const vid2 = a.last.players.find((p) => p.id === meB.id).vid;
  assert.ok(vid2 && vid2 !== meB.vid);
});
