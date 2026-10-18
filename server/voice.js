// ICE servers for voice chat (WebRTC). With Cloudflare TURN keys in the environment it hands out
// short-lived TURN credentials; without them it falls back to public STUN only.

export const FALLBACK_ICE = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];

const TTL_S = 86400; // credential lifetime asked from Cloudflare
const RETRY_MS = 60_000; // after a failed fetch, serve STUN only for this long

// Browsers time out on port 53 TURN urls, so drop them (Cloudflare docs recommend this).
const usable = (url) => !/:53(\?|$)/.test(url);

export function normalizeIce(iceServers) {
  return [].concat(iceServers ?? [])
    .map((s) => ({ ...s, urls: [].concat(s.urls ?? []).filter(usable) }))
    .filter((s) => s.urls.length);
}

export function createIceProvider({ keyId, token, fetch = globalThis.fetch, now = () => Date.now() } = {}) {
  let cached = null; // { servers, expires }
  let failedAt = -Infinity;
  let pending = null;

  async function load() {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: TTL_S }),
    });
    if (!res.ok) throw new Error(`TURN credentials: HTTP ${res.status}`);
    const servers = normalizeIce((await res.json()).iceServers);
    if (!servers.length) throw new Error('TURN credentials: empty iceServers');
    // Refresh at half-life so clients never get nearly expired credentials.
    cached = { servers, expires: now() + (TTL_S * 1000) / 2 };
    return servers;
  }

  return {
    enabled: Boolean(keyId && token),
    async get() {
      if (!keyId || !token) return FALLBACK_ICE;
      if (cached && cached.expires > now()) return cached.servers;
      if (now() - failedAt < RETRY_MS) return cached?.servers ?? FALLBACK_ICE;
      pending ??= load().catch((e) => {
        failedAt = now();
        console.error(e.message);
        return cached?.servers ?? FALLBACK_ICE;
      }).finally(() => { pending = null; });
      return pending;
    },
  };
}
