// localStorage wrapper. Storage can be missing (private mode), so every access is guarded.
const PREFIX = 'k108:';

export const prefs = {
  get(key) {
    try {
      return localStorage.getItem(PREFIX + key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, value);
    } catch {
      // ignore
    }
  },
};

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

const memoryId = uuid();
export function clientId() {
  let id = prefs.get('clientId');
  if (!id) {
    id = uuid();
    prefs.set('clientId', id);
  }
  return prefs.get('clientId') ?? memoryId;
}
