// Client store: latest server view plus local UI state.
export const store = {
  view: null,
  prev: null,
  code: null,
  name: '',
  clockSkew: 0, // serverNow - Date.now()
  selected: null, // selected card id in hand (tap-to-select)
  seenSeq: 0,
};

export const serverNow = () => Date.now() + store.clockSkew;

export const nameOf = (view, pid) =>
  view?.players.find((p) => p.id === pid)?.name ?? view?.spectators?.find((s) => s.id === pid)?.name ?? '?';
