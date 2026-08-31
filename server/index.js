import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as store from './store.js';
import { TABLES } from './db.js';

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

// Generic entity CRUD — mirrors what the old localStorage mock exposed
// (list/filter/create/update/get), now backed by real MongoDB storage.
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
// server, never by shipping a hash to the client for comparison.
app.post('/api/auth/login', asyncRoute(async (req, res) => {
    const { nationalId, password } = req.body || {};
    const user = await store.login(nationalId, password);
    if (!user) return res.status(401).json({ error: 'invalid_credentials' });
    res.json({ data: user });
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
if (adminBootstrap.created) {
    console.log('==============================================');
    console.log('No admin account existed — created a default one:');
    console.log(`  National ID: ${adminBootstrap.nationalId}`);
    console.log(`  Password:    ${adminBootstrap.password}`);
    console.log('Log in and change this password, or set ADMIN_NATIONAL_ID /');
    console.log('ADMIN_PASSWORD env vars before first boot to use your own.');
    console.log('==============================================');
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`API server listening on http://localhost:${PORT}`);
});
