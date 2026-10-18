import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIceProvider, normalizeIce, FALLBACK_ICE } from '../server/voice.js';

const turnReply = {
  iceServers: [
    { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
    {
      urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'],
      username: 'u', credential: 'c',
    },
  ],
};

test('normalizeIce drops port 53 urls and accepts a single object', () => {
  const out = normalizeIce(turnReply.iceServers);
  assert.deepEqual(out[0].urls, ['stun:stun.cloudflare.com:3478']);
  assert.equal(out[1].urls.length, 2);
  assert.equal(out[1].username, 'u');
  assert.equal(normalizeIce({ urls: 'turn:x:3478', username: 'a', credential: 'b' }).length, 1);
});

test('no keys: STUN fallback without fetching', async () => {
  let calls = 0;
  const p = createIceProvider({ fetch: () => { calls++; } });
  assert.equal(p.enabled, false);
  assert.equal(await p.get(), FALLBACK_ICE);
  assert.equal(calls, 0);
});

test('fetches Cloudflare credentials once and caches them', async () => {
  let t = 0;
  const seen = [];
  const fetch = async (url, opts) => {
    seen.push({ url, opts });
    return { ok: true, json: async () => turnReply };
  };
  const p = createIceProvider({ keyId: 'KEY', token: 'TOK', fetch, now: () => t });
  const [x, y] = await Promise.all([p.get(), p.get()]);
  assert.equal(seen.length, 1);
  assert.equal(x, y);
  assert.match(seen[0].url, /\/turn\/keys\/KEY\/credentials\/generate-ice-servers$/);
  assert.equal(seen[0].opts.headers.Authorization, 'Bearer TOK');
  assert.ok(x.some((s) => s.username === 'u'));
  t += 13 * 3600_000; // past half-life
  await p.get();
  assert.equal(seen.length, 2);
});

test('fetch failure falls back to STUN and backs off', async () => {
  let calls = 0;
  let t = 0;
  const orig = console.error;
  console.error = () => {};
  try {
    const p = createIceProvider({ keyId: 'K', token: 'T', fetch: async () => { calls++; return { ok: false, status: 401 }; }, now: () => t });
    assert.equal(await p.get(), FALLBACK_ICE);
    assert.equal(await p.get(), FALLBACK_ICE);
    assert.equal(calls, 1);
    t += 61_000;
    await p.get();
    assert.equal(calls, 2);
  } finally {
    console.error = orig;
  }
});
