# Deploy (Render.com, free)

The game is one Node process (Express + Socket.IO). All rooms live in memory, so:
- run **exactly one instance** (no horizontal scaling)
- a restart or redeploy ends all running games

## First time

1. Push the repo to GitHub (`main` branch).
2. Go to https://render.com, sign in with GitHub, then **New → Blueprint** and pick the
   `karta-druzya` repo. Render reads `render.yaml` and creates the web service.
   (Alternatively, **New → Web Service** with build `npm ci --omit=dev` and start `npm start`.)
3. After the build, the game is live at `https://karta-druzya-XXXX.onrender.com`.
   Share that link with friends.

## Updates

Every push to `main` redeploys automatically. Don't push while friends are mid-game,
because the redeploy ends running games.

## Free tier notes

- The service sleeps after ~15 min without traffic. The first visit after that takes
  ~30–60 s to wake up. Open the link a minute before playing.
- WebSockets are supported on the free tier.

## Local

```
npm install
npm run dev     # http://localhost:3000
npm test
```
