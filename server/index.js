import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as store from './store.js';
import { TABLES } from './db.js';
import { signToken, authFromRequest } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, '..', 'dist');

const app = express();
// Render (and most hosts) put this behind a reverse proxy -- without this,
// req.ip resolves to the proxy's own address for every request, which
// would make the per-IP rate limiter below apply to all visitors combined
// instead of each one individually.
app.set('trust proxy', 1);
app.use(cors());
// A request body has no legitimate reason to be large here (the biggest
// thing this API accepts is a certificate/report form) -- capping it
// blocks a trivial memory-exhaustion request before it reaches any route.
app.use(express.json({ limit: '200kb' }));

// A few basic hardening headers. No templated HTML is ever rendered from
// user input here (React does its own escaping, and the API only ever
// returns JSON) so this is defense in depth, not a fix for a known gap.
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

const asyncRoute = (fn) => async (req, res) => {
    try {
        await fn(req, res);
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message || 'Server error' });
    }
};

// --- Rate limiting -----------------------------------------------------
// Hand-rolled, in-memory, per-IP sliding window -- no extra dependency,
// and fine for a single free-tier instance (no shared store needed).
// Protects the endpoints that matter most against brute force: guessing
// an admin/user password, or hammering the "forgot password" phone-number
// check to enumerate accounts. A restart clears all counters, which is an
// acceptable trade-off here (Render free tier redeploys/restarts already
// happen for other reasons).
const rateLimitHits = new Map(); // key -> array of timestamps (ms)

function rateLimit({ windowMs, max }) {
    return (req, res, next) => {
        const key = `${req.ip}:${req.path}`;
        const now = Date.now();
        const hits = (rateLimitHits.get(key) || []).filter((t) => now - t < windowMs);
        if (hits.length >= max) {
            return res.status(429).json({ error: 'Too many attempts, please try again later' });
        }
        hits.push(now);
        rateLimitHits.set(key, hits);
        next();
    };
}

// Occasionally sweep old entries so this map can't grow unbounded across
// many distinct IPs/paths over a long-running process.
setInterval(() => {
    const now = Date.now();
    for (const [key, hits] of rateLimitHits) {
        const fresh = hits.filter((t) => now - t < 15 * 60 * 1000);
        if (fresh.length === 0) rateLimitHits.delete(key);
        else rateLimitHits.set(key, fresh);
    }
}, 5 * 60 * 1000).unref();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }); // 10 tries / 15 min / IP
const resetPasswordLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

// --- Auth middleware -------------------------------------------------
// authenticate: requires *some* logged-in user (any role).
// requireAdmin: requires a logged-in admin.
// requireSelfOrAdmin(param): requires the token's user id to match
// req.params[param], or an admin.
function authenticate(req, res, next) {
    const auth = authFromRequest(req);
    if (!auth) return res.status(401).json({ error: 'Login required' });
    req.auth = auth;
    next();
}

function requireAdmin(req, res, next) {
    const auth = authFromRequest(req);
    if (!auth || auth.user_type !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    req.auth = auth;
    next();
}

function requireSelfOrAdmin(param) {
    return (req, res, next) => {
        const auth = authFromRequest(req);
        if (!auth) return res.status(401).json({ error: 'Login required' });
        if (auth.user_type !== 'admin' && String(auth.id) !== String(req.params[param])) {
            return res.status(403).json({ error: 'Not authorized' });
        }
        req.auth = auth;
        next();
    };
}

// --- Generic entity CRUD ----------------------------------------------
// Mirrors what the old localStorage mock exposed (list/filter/create/
// update/get), now backed by real MongoDB storage. list/filter/create/get
// stay open here — checking a device, reporting theft, and buying a
// device are all meant to work without an account, matching the app's
// existing public-facing tabs. The few operations that touch account
// takeover, PII dumps, or a safety-critical status get real
// authorization below, ahead of these generic routes (Express matches
// the first route registered).

app.get('/api/entities/app_users', requireAdmin, asyncRoute(async (req, res) => {
    const { sort, limit } = req.query;
    res.json({ data: await store.list('app_users', sort, limit ? Number(limit) : undefined) });
}));

// A regular user editing their own profile may only touch their own name/
// phone/password -- never user_type or national_id (store.update() also
// refuses those unless called with {trusted: true}, so this is defense in
// depth, not the only thing stopping a self-promote-to-admin attempt).
const SELF_SERVICE_PROFILE_KEYS = new Set(['full_name', 'phone_number', 'current_password', 'new_password']);

app.patch('/api/entities/app_users/:id', requireSelfOrAdmin('id'), asyncRoute(async (req, res) => {
    const body = req.body || {};
    const isAdmin = req.auth.user_type === 'admin';
    if (!isAdmin) {
        const onlyAllowedKeys = Object.keys(body).every((k) => SELF_SERVICE_PROFILE_KEYS.has(k));
        if (!onlyAllowedKeys) {
            return res.status(403).json({ error: 'Only admins can change that field' });
        }
    }
    res.json({ data: await store.update('app_users', req.params.id, body, { trusted: isAdmin }) });
}));

// Reading a single user's full record (name/national ID/phone) is the
// same PII exposure as the admin-only list above -- must not be reachable
// by an unauthenticated request just because it knows/guesses an id.
app.get('/api/entities/app_users/:id', requireSelfOrAdmin('id'), asyncRoute(async (req, res) => {
    res.json({ data: await store.get('app_users', req.params.id) });
}));

const SELF_SERVICE_CLOSURE_KEYS = new Set(['status', 'closureRequestReason', 'closureRequestDetails']);

app.patch('/api/entities/stolen_devices/:id', authenticate, asyncRoute(async (req, res) => {
    const body = req.body || {};
    if (req.auth.user_type !== 'admin') {
        // A regular (logged-in) user may only request closure of a
        // report — never close/reopen it directly or edit its details.
        const onlyAllowedKeys = Object.keys(body).every((k) => SELF_SERVICE_CLOSURE_KEYS.has(k));
        if (!onlyAllowedKeys || body.status !== 'pending_closure') {
            return res.status(403).json({ error: 'Only admins can make this change' });
        }
    }
    res.json({ data: await store.update('stolen_devices', req.params.id, body) });
}));

// Certificates are meant to be updatable without an account (the public
// buy-device and report-theft flows mark one 'transferred' or 'stolen' as
// part of their own no-login process) -- but the generic, unauthenticated
// PATCH /api/entities/:table/:id below would otherwise let anyone rewrite
// ANY field on ANY certificate with no check at all: forge a different
// buyerId onto an existing ownership record, change the price, swap the
// serial number, etc. This route stands in front of that generic one and
// only ever allows a status transition to one of these three values --
// never a change to who owns what.
const ALLOWED_CERTIFICATE_STATUSES = new Set(['active', 'transferred', 'stolen']);

app.patch('/api/entities/purchase_certificates/:id', asyncRoute(async (req, res) => {
    const body = req.body || {};
    const keys = Object.keys(body);
    if (keys.length !== 1 || keys[0] !== 'status' || !ALLOWED_CERTIFICATE_STATUSES.has(body.status)) {
        return res.status(403).json({ error: 'Only a status update (active/transferred/stolen) is allowed here' });
    }
    res.json({ data: await store.update('purchase_certificates', req.params.id, body) });
}));

// Public: certificate-number generation needs only the next number, not
// a full record (which would leak the previous buyer's name/national
// ID/phone to anyone).
app.get('/api/certificates/next-number', asyncRoute(async (req, res) => {
    const latest = await store.list('purchase_certificates', '-certificateNumber', 1);
    const last = latest[0] ? parseInt(latest[0].certificateNumber, 10) : 0;
    const next = Number.isFinite(last) ? last + 1 : 1;
    res.json({ data: { certificateNumber: String(next).padStart(10, '0') } });
}));

// Admin-only: the full reports + certificates dashboard. (The generic
// GET /api/entities/:table below stays open for the public flows that
// use it — device check, etc. — this is a separate, explicitly
// protected route for the "give me everything" admin view.)
app.get('/api/admin/dashboard', requireAdmin, asyncRoute(async (req, res) => {
    const stolenDevices = await store.list('stolen_devices', '-created_date');
    const certificates = await store.list('purchase_certificates', '-created_date');
    res.json({ data: { stolenDevices, certificates } });
}));

app.get('/api/entities/:table', asyncRoute(async (req, res) => {
    const { sort, limit } = req.query;
    res.json({ data: await store.list(req.params.table, sort, limit ? Number(limit) : undefined) });
}));

app.post('/api/entities/:table/filter', asyncRoute(async (req, res) => {
    const { query, sort } = req.body || {};

    // app_users is the one table this generic, unauthenticated filter must
    // never expose wholesale -- store.filter()'s substring matching means
    // { national_id: "1" } (or {} entirely) would otherwise return
    // name/phone for every user whose id contains a "1", or literally
    // everyone. The public flows that legitimately need this (does this
    // buyer/seller have an account?) only ever look up one exact,
    // fully-typed national ID, so that's the only shape allowed through.
    if (req.params.table === 'app_users') {
        const keys = Object.keys(query || {});
        const nationalId = query && query.national_id;
        if (keys.length !== 1 || keys[0] !== 'national_id' || !nationalId || String(nationalId).length < 10) {
            return res.status(400).json({ error: 'Only a full national_id lookup is allowed here' });
        }
        const users = await store.filter('app_users', { national_id: nationalId });
        const exact = users.filter((u) => String(u.national_id) === String(nationalId));
        return res.json({ data: exact });
    }

    res.json({ data: await store.filter(req.params.table, query, sort) });
}));

app.get('/api/entities/:table/:id', asyncRoute(async (req, res) => {
    const item = await store.get(req.params.table, req.params.id);
    res.json({ data: item });
}));

app.post('/api/entities/:table', asyncRoute(async (req, res) => {
    res.status(201).json({ data: await store.create(req.params.table, req.body || {}) });
}));

app.patch('/api/entities/:table/:id', asyncRoute(async (req, res) => {
    res.json({ data: await store.update(req.params.table, req.params.id, req.body || {}) });
}));

// Dedicated login endpoint — password verification must happen on the
// server, never by shipping a hash to the client for comparison. Issues
// a signed session token the client must send back as
// `Authorization: Bearer <token>` for the protected routes above.
app.post('/api/auth/login', loginLimiter, asyncRoute(async (req, res) => {
    const { nationalId, password } = req.body || {};
    const user = await store.login(nationalId, password);
    if (!user) return res.status(401).json({ error: 'invalid_credentials' });
    const token = signToken({ id: user.id, user_type: user.user_type });
    res.json({ data: user, token });
}));

// "Forgot password" — atomic and server-verified: the old design let a
// client call the equivalent of AppUser.update(anyUserId, {password})
// directly with nothing checking the phone number actually matched
// (the "verify" step was a separate, skippable client-side call). This
// verifies national ID + phone together, in one step, before touching
// anything.
app.post('/api/auth/reset-password', resetPasswordLimiter, asyncRoute(async (req, res) => {
    const { nationalId, phoneNumber, newPassword } = req.body || {};
    const users = await store.filter('app_users', { national_id: nationalId });
    const user = users.find((u) => String(u.national_id) === String(nationalId));
    const normInput = String(phoneNumber || '').replace(/\D/g, '');
    const normStored = user ? String(user.phone_number || '').replace(/\D/g, '') : '';
    if (!user || !normInput || normInput !== normStored) {
        return res.status(400).json({ error: 'verification_failed' });
    }
    await store.update('app_users', user.id, { password: newPassword });
    res.json({ data: { success: true } });
}));

app.get('/api/health', (req, res) => res.json({ ok: true, tables: TABLES }));

// In production (after `npm run build`), serve the built frontend from the
// same server/port as the API — no separate static host or proxy needed.
if (fs.existsSync(DIST_DIR)) {
    app.use(express.static(DIST_DIR));
    app.get(/^(?!\/api\/).*/, (req, res) => {
        res.sendFile(path.join(DIST_DIR, 'index.html'));
    });
}

const adminBootstrap = await store.ensureDefaultAdmin();
if (adminBootstrap.created || adminBootstrap.replaced) {
    console.log('==============================================');
    console.log(adminBootstrap.created
        ? 'No admin account existed — created a default one:'
        : 'Replaced the untouched factory-default admin with configured credentials:');
    console.log(`  National ID: ${adminBootstrap.nationalId}`);
    console.log(`  Password:    ${adminBootstrap.password}`);
    if (adminBootstrap.created) {
        console.log('Log in and change this password, or set ADMIN_NATIONAL_ID /');
        console.log('ADMIN_PASSWORD env vars before first boot to use your own.');
    }
    console.log('==============================================');
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`API server listening on http://localhost:${PORT}`);
});
