import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Server } from 'socket.io';
import { createRoomManager } from './rooms.js';
import { createIceProvider } from './voice.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function startServer(port = process.env.PORT || 3000) {
  const app = express();
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use(express.static(join(root, 'public'), { extensions: ['html'] }));

  const http = createServer(app);
  const io = new Server(http, { pingInterval: 10_000, pingTimeout: 20_000 });
  const ice = createIceProvider({ keyId: process.env.TURN_KEY_ID, token: process.env.TURN_KEY_API_TOKEN });
  createRoomManager(io, { ice });

  return new Promise((resolve) => {
    http.listen(port, () => resolve({ http, io, port: http.address().port }));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { port } = await startServer();
  console.log(`108 server: http://localhost:${port}`);
  if (!process.env.TURN_KEY_ID) console.log('Voice: no TURN_KEY_ID, using STUN only');
}
