// Dev helper: N bot players join a room and play random legal moves.
// Usage: node scripts/bots.mjs CODE [N=2] [delayMs=1200] [url=http://localhost:3000]

import { io } from 'socket.io-client';

const [code, n = '2', delay = '1200', url = 'http://localhost:3000'] = process.argv.slice(2);
const names = ['Vali', 'Ozoda', 'Sardor', 'Malika', 'Jasur'];
const emojis = ['😂', '🔥', '😎', '😱'];
const chats = ['salom!', 'ha-ha', 'tezroq yur 😄', 'omading kelmadi', 'zo\'r'];

for (let i = 0; i < Number(n); i++) {
  const s = io(url, { transports: ['websocket'] });
  const name = names[i];
  let busy = false;
  s.on('connect', () => s.emit('room:join', { code, name, clientId: 'bot-client-' + i }, (r) => console.log(name, 'join', r)));
  s.on('state', (v) => {
    if (v.phase !== 'playing' || v.turn !== v.me || busy) return;
    busy = true;
    setTimeout(() => {
      busy = false;
      if (Math.random() < 0.08) s.emit('react:send', { emoji: emojis[Math.floor(Math.random() * emojis.length)] }, () => {});
      if (Math.random() < 0.05) s.emit('chat:send', { text: chats[Math.floor(Math.random() * chats.length)] }, () => {});
      const done = (r) => { if (!r.ok) console.log(name, r); };
      if (v.playable.length) {
        const c = v.playable[Math.floor(Math.random() * v.playable.length)];
        s.emit('game:play', { cardId: c, suit: 'SCHD'[Math.floor(Math.random() * 4)] }, done);
      } else if (v.canDraw) s.emit('game:draw', {}, done);
      else if (v.canPass) s.emit('game:pass', {}, done);
    }, Number(delay));
  });
}
