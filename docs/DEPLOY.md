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

## Voice chat: Cloudflare TURN (free)

Phones on mobile data often can't connect to each other directly. TURN relays the audio.
Without it, voice still works on most Wi-Fi networks but may fail on 4G/5G.

1. Sign in at https://dash.cloudflare.com (a free account is enough).
2. Open **Realtime → TURN Server** (older dashboards: **Calls → TURN**), then click **Create**.
   Give it a name such as `karta-druzya`.
3. Copy the **Turn Token ID** and the **API Token**. The token is shown only once.
4. In Render: open the `karta-druzya` service, go to **Environment**, and add
   `TURN_KEY_ID` (the token id) and `TURN_KEY_API_TOKEN` (the API token). Save; Render redeploys.
5. Check: the server log no longer says `Voice: no TURN_KEY_ID`.

The free tier includes 1,000 GB of TURN traffic per month. One voice stream is about
40 kbit/s (~18 MB per hour), so friends' games use only a tiny fraction.

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
