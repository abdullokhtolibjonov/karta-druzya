// Socket.IO wrapper. `io` is the global from /socket.io/socket.io.js.
/* global io */

export const socket = io({ autoConnect: true, reconnectionDelayMax: 3000 });

export function call(event, payload = {}, timeoutMs = 8000) {
  return new Promise((resolve) => {
    socket.timeout(timeoutMs).emit(event, payload, (err, res) => {
      resolve(err ? { ok: false, error: 'timeout' } : res);
    });
  });
}
