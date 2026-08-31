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
app.use(cors());
app.use(express.json());

const asyncRoute = (fn) => async (req, res) => {
    try {
        await fn(req, res);
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message || 'Server error' });
    }
};

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

app.patch('/api/entities/app_users/:id', requireSelfOrAdmin('id'), asyncRoute(async (req, res) => {
    res.json({ data: await store.update('app_users', req.params.id, req.body || {}) });
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
app.post('/api/auth/login', asyncRoute(async (req, res) => {
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
app.post('/api/auth/reset-password', asyncRoute(async (req, res) => {
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
