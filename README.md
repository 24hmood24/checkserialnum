# CheckSerialNum

A Vite + React frontend with a real Express + SQLite backend (see [`server/`](./server)).
Device-check, theft reports, purchase certificates and user accounts are stored in a
real, persistent database — not in the browser.

## Running locally

```bash
npm install
npm run dev
```

This runs the Vite dev server **and** the API server together (`npm run dev` uses
`concurrently`). The frontend proxies `/api/*` requests to the API server. Open the
URL Vite prints (usually http://localhost:5173).

To run the pieces separately: `npm run dev:web` (Vite only) and `npm run dev:api`
(API only, http://localhost:3001).

## Building / running in production

```bash
npm run build
npm start
```

`npm start` runs a single Node process (`server/index.js`) that serves both the API
and the built frontend from `dist/` — one process, one port. Set `PORT` to change the
port (defaults to 3001), and `DB_PATH` to control where the SQLite file is written
(defaults to `server/data.sqlite`).

## Deploying to checkserialnum.com

⚠️ **This app now needs a real Node.js server — it can no longer run on GitHub Pages**
(GitHub Pages only serves static files; it can't run `server/index.js` or persist a
database). The `.github/workflows/deploy.yml` GitHub Pages workflow in this repo is
left over from before the real backend existed and is no longer the deployment path
for this app — either remove it or repoint the domain, but don't rely on it going
forward.

### Deploying to Render (recommended — free/cheap, simplest)

A `render.yaml` blueprint is included, so most of this is automatic once you connect
your account:

1. Sign up at [render.com](https://render.com) and connect your GitHub account.
2. **New → Blueprint**, pick this repository — Render reads `render.yaml` and creates
   the service automatically (build: `npm ci && npm run build`, start: `npm start`,
   with a small persistent disk mounted at `/var/data` for the SQLite database so
   data survives deploys and restarts).
3. Once it's live, Render gives you a URL like `checkserialnum.onrender.com` —
   confirm the site works there first.
4. In Render's dashboard → your service → **Settings → Custom Domains**, add
   `checkserialnum.com` (and `www.checkserialnum.com` if you use it). Render shows
   you the exact DNS records to set.
5. At your domain registrar, replace the current GitHub Pages DNS records (the
   `185.199.10x.x` A records / CNAME described below) with the records Render gave
   you in step 4.
6. DNS propagation can take up to a few hours (sometimes up to 48h).

Free-tier note: Render's free web services spin down after periods of inactivity and
take a few seconds to wake back up on the next request — fine for a demo/low-traffic
site, but worth knowing.

### Other options

- **A VPS you already control** (DigitalOcean, Hetzner, etc.): `git pull`,
  `npm ci && npm run build`, run `npm start` behind a process manager (pm2/systemd)
  and an Nginx reverse proxy with TLS.
- **Any other Node-capable PaaS** (Railway, Fly.io, etc.) — same idea as Render:
  build with `npm run build`, start with `npm start`, give it a persistent volume for
  the SQLite file via `DB_PATH`.

### Old GitHub Pages DNS records (for reference / cleanup)

The domain currently points at GitHub Pages via these A records — remove them once
you've switched to your new host:

```
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```