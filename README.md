# CheckSerialNum

A Vite + React frontend with a real Express + MongoDB backend (see [`server/`](./server)).
Device-check, theft reports, purchase certificates and user accounts are stored in a
real, persistent, shared database — not in the browser, and not on the server's own
disk (so it survives redeploys and restarts).

## Database (MongoDB)

The app needs a MongoDB connection string in `MONGODB_URI`. Any MongoDB works, but
[MongoDB Atlas](https://www.mongodb.com/cloud/atlas) has a free tier that's plenty for
this app:

1. Create a free cluster on Atlas.
2. **Network Access**: allow connections from `0.0.0.0/0` (anywhere) — your host's
   outbound IP isn't static, especially on a platform like Render.
3. **Database Access**: create a database user (username + password) — save the
   password immediately, Atlas only shows it once.
4. **Connect → Drivers**: copy the connection string. It looks like
   `mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/`.
5. Put that string (with the real password substituted in) in `MONGODB_URI`.

For local dev, put it in a `.env` file at the repo root (already gitignored):

```
MONGODB_URI=mongodb+srv://user:password@cluster0.xxxxx.mongodb.net/
```

`server/db.js` loads that `.env` file automatically on startup (via Node's built-in
`process.loadEnvFile()`) if one exists — nothing extra to configure.

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

On first boot with no admin account in the database, the server creates one
automatically and logs the credentials once — see the "Default admin account"
section below.

## Building / running in production

```bash
npm run build
npm start
```

`npm start` runs a single Node process (`server/index.js`) that serves both the API
and the built frontend from `dist/` — one process, one port. Set `PORT` to change the
port (defaults to 3001).

## Security

- **`SESSION_SECRET`** — set this to a long random string in production. It signs the
  session tokens issued on login; without it, the server falls back to an insecure
  built-in default (logs a warning on startup) that anyone reading the source could
  forge admin tokens with. Generate one with e.g. `openssl rand -hex 32`.
- Admin-only actions (the full reports/certificates dashboard, listing every
  registered user) and account actions (editing a profile, approving/rejecting a
  theft-report closure) require a valid session token now — checked server-side, not
  just hidden behind client-side UI. Checking a device, reporting theft, and buying a
  device stay usable without an account, matching the app's existing public tabs.
- There's no `/admin-seed` page anymore — the built-in admin bootstrap (below) is the
  only way an admin account gets created.

## Default admin account

The server checks on every boot whether any admin account exists in the database; if
not, it creates one and logs the credentials to the console **once**:

- National ID: `ADMIN_NATIONAL_ID` env var, default `1000000001`
- Password: `ADMIN_PASSWORD` env var, default `adminpass`

Set `ADMIN_NATIONAL_ID` / `ADMIN_PASSWORD` (and optionally `ADMIN_FULL_NAME`,
`ADMIN_PHONE`) before the **first** boot to choose your own instead of the default —
or just log in with the default and change the password from the account page
afterward.

If the database already has the untouched factory-default admin (national ID
`1000000001`) and you set `ADMIN_NATIONAL_ID` to something else afterward, the next
boot replaces that account's credentials with the configured ones (logged once, same
as a fresh create) — this covers "I just want real admin credentials instead of the
auto-created demo ones" without a manual DB edit. Any admin account that's already
been customized (a different national ID, or the same one but a changed password) is
never touched.

## Deploying to checkserialnum.com

⚠️ **This app needs a real Node.js server — it can no longer run on GitHub Pages**
(GitHub Pages only serves static files; it can't run `server/index.js`). The
`.github/workflows/deploy.yml` GitHub Pages workflow in this repo is left over from
before the real backend existed and is no longer the deployment path for this app —
either remove it or repoint the domain, but don't rely on it going forward.

### Deploying to Render (recommended — free/cheap, simplest)

A `render.yaml` blueprint is included:

1. Sign up at [render.com](https://render.com) and connect your GitHub account.
2. **New → Blueprint**, pick this repository (branch: whichever branch has this
   `render.yaml` — merge it to `main` first if you'd rather deploy from there).
3. Render will prompt for `MONGODB_URI` (marked `sync: false` in the blueprint, so
   it's never stored in the repo) — paste the connection string from the "Database"
   section above.
4. Once it's live, Render gives you a URL like `checkserialnum.onrender.com` —
   confirm the site works there first.
5. In Render's dashboard → your service → **Settings → Custom Domains**, add
   `checkserialnum.com` (and `www.checkserialnum.com` if you use it). Render shows
   you the exact DNS records to set.
6. At your domain registrar, replace the current GitHub Pages DNS records (the
   `185.199.10x.x` A records described below) with the records Render gave you.
7. DNS propagation can take up to a few hours (sometimes up to 48h).

Free-tier note: Render's free web services spin down after periods of inactivity and
take a few seconds to wake back up on the next request — this no longer affects your
*data* (that's in MongoDB now, not on this service's disk), just response time on the
first request after a spin-down.

### Other options

- **A VPS you already control** (DigitalOcean, Hetzner, etc.): `git pull`,
  `npm ci && npm run build`, run `npm start` (with `MONGODB_URI` set) behind a process
  manager (pm2/systemd) and an Nginx reverse proxy with TLS.
- **Any other Node-capable PaaS** (Railway, Fly.io, etc.) — same idea: build with
  `npm run build`, start with `npm start`, set `MONGODB_URI`.

### Old GitHub Pages DNS records (for reference / cleanup)

The domain currently points at GitHub Pages via these A records — remove them once
you've switched to your new host:

```
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```
