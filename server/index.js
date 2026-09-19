import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as store from './store.js';
import { TABLES } from './db.js';
import { signToken, authFromRequest } from './auth.js';
import * as rules from './rules.js';
import * as otp from './otp.js';
import * as actions from './actions.js';
import * as whatsapp from './whatsapp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, '..', 'dist');

const app = express();
// running behind a proxy (Render): use X-Forwarded-For for the client IP
app.set('trust proxy', 1);
app.use(cors());
// small JSON bodies only
app.use(express.json({ limit: '200kb' }));

// basic security headers
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
        const status = err.status || 500;
        // hide internal errors from the client
        if (status >= 500) console.error(err);
        res.status(status).json({ error: status >= 500 ? 'Server error' : (err.message || 'Error') });
    }
};

// Rate limiting: in-memory, per IP (single instance)
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

// drop old entries
setInterval(() => {
    const now = Date.now();
    for (const [key, hits] of rateLimitHits) {
        const fresh = hits.filter((t) => now - t < 60 * 60 * 1000); // longest window in use is 1 h
        if (fresh.length === 0) rateLimitHits.delete(key);
        else rateLimitHits.set(key, fresh);
    }
}, 5 * 60 * 1000).unref();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }); // 10 tries / 15 min / IP
const resetPasswordLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
const checkLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });                // device checks: 60 / min / IP
const reportLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10 });          // theft reports: 10 / hour / IP
const certificateLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 60 });     // certificates: 60 / hour / IP
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10 });        // new accounts: 10 / hour / IP
const hintLimiter = rateLimit({ windowMs: 60 * 1000, max: 40 });                  // phone hints: 40 / min / IP
const confirmLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 40 });          // code confirmations: 40 / 15 min / IP
const resendLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20 });           // resends: 20 / hour / IP
const phoneChangeLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 6 });       // phone changes: 6 / hour / IP

// Auth middleware: authenticate (any user), requireAdmin, requireSelfOrAdmin(param)
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

// The public tabs use the endpoints below; /api/entities/* is for admins and for users reading their own records

// owner field of each table
const OWNER_FIELD = { stolen_devices: 'reporterNationalId', purchase_certificates: 'buyerId' };

async function currentUser(req) {
    return store.get('app_users', req.auth.id);
}

// --- Public endpoints ---

// exact-match device check
app.post('/api/check', checkLimiter, asyncRoute(async (req, res) => {
    res.json({ data: await rules.checkDevice((req.body || {}).serialNumber) });
}));

// Registration, theft reports and sales take two steps:
// /start sends the WhatsApp code(s), /api/actions/confirm saves (see actions.js)

// masked phone for a national ID (05****1234), used to pre-fill the forms
app.post('/api/lookup/phone-hint', hintLimiter, asyncRoute(async (req, res) => {
    res.json({ data: await rules.phoneHint((req.body || {}).nationalId) });
}));

const OTP_PURPOSE = {
    registrant: 'register',
    reporter: 'report',
    seller: 'purchase_seller',
    buyer: 'purchase_buyer',
    new_phone: 'phone_change',
};

async function sendActionCodes(codes) {
    const minutes = Math.max(1, Math.round(actions.actionTtlSeconds() / 60));
    for (const c of codes) {
        await whatsapp.sendOtp(rules.toWhatsAppNumber(c.phone), c.code, { minutes, purpose: OTP_PURPOSE[c.role] });
    }
}

const maskedTargets = (targets) => targets.map((t) => ({ role: t.role, maskedPhone: rules.maskPhone(t.phone) }));

function startAction(type, plan) {
    return asyncRoute(async (req, res) => {
        if (!whatsapp.isConfigured() || !(await whatsapp.ensureReady())) {
            return res.status(503).json({ error: 'otp_unavailable' });
        }
        const { payload, targets, boundUserId } = await plan(req.body || {}, req);
        // limit messages per phone
        for (const t of targets) {
            if (!actions.allowSendTo(t.phone)) return res.status(429).json({ error: 'otp_rate_limited' });
        }
        const { actionId, codes } = await actions.start({ type, payload, targets, boundUserId });
        try {
            await sendActionCodes(codes);
        } catch (err) {
            console.error('Failed to send WhatsApp code:', err.message);
            await actions.discard(actionId);
            return res.status(503).json({ error: 'otp_send_failed' });
        }
        res.status(201).json({
            data: {
                actionId,
                expiresInSeconds: actions.actionTtlSeconds(),
                resendAfterSeconds: actions.actionCooldownSeconds(),
                targets: maskedTargets(targets),
            },
        });
    });
}

app.post('/api/register/start', registerLimiter, startAction('register', rules.planRegistration));
app.post('/api/reports/start', reportLimiter, startAction('report', (body) => rules.startReport(body)));
app.post('/api/certificates/start', certificateLimiter, startAction('certificate', (body) => rules.startCertificate(body)));
// change own phone number (the code goes to the new number)
app.post('/api/profile/phone/start', authenticate, phoneChangeLimiter,
    startAction('phone_change', async (body, req) => rules.planPhoneChange(await currentUser(req), body)));

app.post('/api/actions/confirm', confirmLimiter, asyncRoute(async (req, res) => {
    const { actionId, codes } = req.body || {};
    // phone changes can only be confirmed by the same logged-in user
    const asker = authFromRequest(req);
    const result = await actions.confirm(actionId, codes, { userId: asker?.id });
    if (!result.ok) return res.status(400).json({ error: 'invalid_code' });
    if (result.type === 'phone_change') return res.json({ data: await rules.commitPhoneChange(result.payload), type: 'phone_change' });
    if (result.type === 'register') return res.status(201).json({ data: await rules.commitRegistration(result.payload), type: 'register' });
    if (result.type === 'report') return res.status(201).json({ data: await rules.commitReport(result.payload), type: 'report' });
    if (result.type === 'certificate') return res.status(201).json({ data: await rules.commitCertificate(result.payload), type: 'certificate' });
    return res.status(400).json({ error: 'invalid_code' });
}));

app.post('/api/actions/resend', resendLimiter, asyncRoute(async (req, res) => {
    if (!whatsapp.isConfigured() || !(await whatsapp.ensureReady())) return res.status(503).json({ error: 'otp_unavailable' });
    const result = await actions.resend((req.body || {}).actionId, { userId: authFromRequest(req)?.id });
    if (!result.ok) {
        const status = result.reason === 'not_found' ? 404 : 429;
        return res.status(status).json({ error: result.reason === 'not_found' ? 'action_expired' : `resend_${result.reason}` });
    }
    for (const c of result.codes) {
        if (!actions.allowSendTo(c.phone)) return res.status(429).json({ error: 'otp_rate_limited' });
    }
    try {
        await sendActionCodes(result.codes);
    } catch (err) {
        console.error('Failed to resend WhatsApp code:', err.message);
        return res.status(503).json({ error: 'otp_send_failed' });
    }
    res.json({ data: { expiresInSeconds: actions.actionTtlSeconds(), resendAfterSeconds: actions.actionCooldownSeconds() } });
}));

// report from the dashboard: logged-in owner, no code needed
app.post('/api/reports/mine', authenticate, reportLimiter, asyncRoute(async (req, res) => {
    const me = await currentUser(req);
    if (!me) return res.status(401).json({ error: 'Login required' });
    res.status(201).json({ data: await rules.reportTheftAsUser(me, req.body || {}) });
}));

// add own device
app.post('/api/certificates/register', authenticate, certificateLimiter, asyncRoute(async (req, res) => {
    res.status(201).json({ data: await rules.registerOwnDevice(req.auth.id, req.body || {}) });
}));

// admin only
app.get('/api/certificates/next-number', requireAdmin, asyncRoute(async (req, res) => {
    const latest = await store.list('purchase_certificates', '-certificateNumber', 1);
    const last = latest[0] ? parseInt(latest[0].certificateNumber, 10) : 0;
    const next = Number.isFinite(last) ? last + 1 : 1;
    res.json({ data: { certificateNumber: String(next).padStart(10, '0') } });
}));

// --- Accounts ---


app.get('/api/entities/app_users', requireAdmin, asyncRoute(async (req, res) => {
    const { sort, limit } = req.query;
    res.json({ data: await store.list('app_users', sort, limit ? Number(limit) : undefined) });
}));

// user search: admin only
app.post('/api/entities/app_users/filter', requireAdmin, asyncRoute(async (req, res) => {
    const { query, sort } = req.body || {};
    res.json({ data: await store.filter('app_users', query, sort) });
}));

// users can only edit their own name, phone and password
const SELF_SERVICE_PROFILE_KEYS = new Set(['full_name', 'phone_number', 'current_password', 'new_password']);

app.patch('/api/entities/app_users/:id', requireSelfOrAdmin('id'), asyncRoute(async (req, res) => {
    const body = { ...(req.body || {}) };
    const isAdmin = req.auth.user_type === 'admin';
    if (!isAdmin) {
        const onlyAllowedKeys = Object.keys(body).every((k) => SELF_SERVICE_PROFILE_KEYS.has(k));
        if (!onlyAllowedKeys) {
            return res.status(403).json({ error: 'Only admins can change that field' });
        }
    }
    if (body.phone_number !== undefined) {
        body.phone_number = rules.normalizePhone(body.phone_number);
        if (!rules.isValidPhone(body.phone_number)) return res.status(400).json({ error: 'invalid_phone' });
        if (!isAdmin) {
            // a new phone number has to be confirmed with a code (/api/profile/phone/start)
            const current = await store.get('app_users', req.params.id);
            if (!current || rules.normalizePhone(current.phone_number) !== body.phone_number) {
                return res.status(403).json({ error: 'phone_change_needs_code' });
            }
            delete body.phone_number;
        }
    }
    if (body.new_password !== undefined && !rules.isValidPassword(body.new_password)) {
        return res.status(400).json({ error: 'weak_password' });
    }
    res.json({ data: await store.update('app_users', req.params.id, body, { trusted: isAdmin }) });
}));

// own record or admin
app.get('/api/entities/app_users/:id', requireSelfOrAdmin('id'), asyncRoute(async (req, res) => {
    res.json({ data: await store.get('app_users', req.params.id) });
}));

// --- Reports & certificates ---

const SELF_SERVICE_CLOSURE_KEYS = new Set(['status', 'closureRequestReason', 'closureRequestDetails']);

app.patch('/api/entities/stolen_devices/:id', authenticate, asyncRoute(async (req, res) => {
    const body = req.body || {};
    if (req.auth.user_type !== 'admin') {
        // users can only ask to close their own report
        const onlyAllowedKeys = Object.keys(body).every((k) => SELF_SERVICE_CLOSURE_KEYS.has(k));
        if (!onlyAllowedKeys || body.status !== 'pending_closure') {
            return res.status(403).json({ error: 'Only admins can make this change' });
        }
        const [report, me] = await Promise.all([
            store.get('stolen_devices', req.params.id),
            currentUser(req),
        ]);
        if (!report || !me || String(report.reporterNationalId) !== String(me.national_id)) {
            return res.status(403).json({ error: 'Not authorized' });
        }
        if (report.status !== 'active') {
            return res.status(409).json({ error: 'Report is not open' });
        }
    }
    res.json({ data: await store.update('stolen_devices', req.params.id, body) });
}));

// certificate status: admin only
app.patch('/api/entities/purchase_certificates/:id', requireAdmin, asyncRoute(async (req, res) => {
    const body = req.body || {};
    const keys = Object.keys(body);
    if (keys.length !== 1 || keys[0] !== 'status' || !['active', 'transferred', 'stolen'].includes(body.status)) {
        return res.status(403).json({ error: 'Only a status update (active/transferred/stolen) is allowed here' });
    }
    res.json({ data: await store.update('purchase_certificates', req.params.id, body) });
}));

// admin dashboard data
app.get('/api/admin/dashboard', requireAdmin, asyncRoute(async (req, res) => {
    const stolenDevices = await store.list('stolen_devices', '-created_date');
    const certificates = await store.list('purchase_certificates', '-created_date');
    res.json({ data: { stolenDevices, certificates } });
}));

// --- WhatsApp linking (admin) ---
const requireBaileys = (req, res, next) => (
    whatsapp.describeProvider() === 'baileys' ? next() : res.status(400).json({ error: 'provider_is_not_baileys' })
);

app.get('/api/admin/whatsapp/status', requireAdmin, requireBaileys, asyncRoute(async (req, res) => {
    const baileys = await import('./baileys.js');
    const { default: QRCode } = await import('qrcode');
    const st = baileys.getStatus();
    res.json({
        data: {
            provider: 'baileys',
            state: st.state,
            me: st.me,
            lastError: st.lastError,
            qrDataUrl: st.qr ? await QRCode.toDataURL(st.qr, { margin: 1, width: 300 }) : null,
        },
    });
}));

app.post('/api/admin/whatsapp/pair', requireAdmin, requireBaileys, asyncRoute(async (req, res) => {
    const baileys = await import('./baileys.js');
    const digits = rules.normalizeDigits((req.body || {}).phoneNumber).replace(/\D/g, '');
    const international = /^05\d{8}$/.test(digits) ? rules.toWhatsAppNumber(digits) : digits;
    if (!/^\d{9,15}$/.test(international)) return res.status(400).json({ error: 'invalid_phone' });
    try {
        res.json({ data: { code: await baileys.requestPairingCode(international) } });
    } catch (err) {
        res.status(err.message === 'already_linked' ? 409 : 503).json({ error: err.message === 'already_linked' ? 'already_linked' : 'pairing_unavailable' });
    }
}));

app.post('/api/admin/whatsapp/logout', requireAdmin, requireBaileys, asyncRoute(async (req, res) => {
    const baileys = await import('./baileys.js');
    await baileys.logout();
    res.json({ data: { success: true } });
}));

// --- Generic CRUD ---

app.get('/api/entities/:table', requireAdmin, asyncRoute(async (req, res) => {
    const { sort, limit } = req.query;
    res.json({ data: await store.list(req.params.table, sort, limit ? Number(limit) : undefined) });
}));

app.post('/api/entities/:table/filter', authenticate, asyncRoute(async (req, res) => {
    const { query, sort } = req.body || {};
    const { table } = req.params;
    if (req.auth.user_type !== 'admin') {
        // non-admins can only list their own records
        const ownerField = OWNER_FIELD[table];
        const me = ownerField ? await currentUser(req) : null;
        if (!me || !query || String(query[ownerField]) !== String(me.national_id)) {
            return res.status(403).json({ error: 'Not authorized' });
        }
    }
    res.json({ data: await store.filter(table, query, sort) });
}));

app.get('/api/entities/:table/:id', authenticate, asyncRoute(async (req, res) => {
    const item = await store.get(req.params.table, req.params.id);
    if (req.auth.user_type !== 'admin') {
        const ownerField = OWNER_FIELD[req.params.table];
        const me = ownerField ? await currentUser(req) : null;
        if (!item || !me || String(item[ownerField]) !== String(me.national_id)) {
            return res.status(403).json({ error: 'Not authorized' });
        }
    }
    res.json({ data: item });
}));

// raw create/update: admin only
app.post('/api/entities/:table', requireAdmin, asyncRoute(async (req, res) => {
    res.status(201).json({ data: await store.create(req.params.table, req.body || {}) });
}));

app.patch('/api/entities/:table/:id', requireAdmin, asyncRoute(async (req, res) => {
    res.json({ data: await store.update(req.params.table, req.params.id, req.body || {}) });
}));

// login with a national ID or a phone number (the client sends it as `nationalId`)
app.post('/api/auth/login', loginLimiter, asyncRoute(async (req, res) => {
    const { identifier, nationalId, password } = req.body || {};
    const user = await store.login(rules.normalizeDigits(identifier ?? nationalId), password);
    if (!user) return res.status(401).json({ error: 'invalid_credentials' });
    const token = signToken({ id: user.id, user_type: user.user_type });
    res.json({ data: user, token });
}));

// forgot password 1/2: send a code to the registered phone
// (same answer whether or not the account exists)
const normalizedResetPhone = (user) => rules.normalizePhone(user.phone_number);

app.post('/api/auth/reset-otp/request', resetPasswordLimiter, asyncRoute(async (req, res) => {
    if (!whatsapp.isConfigured() || !(await whatsapp.ensureReady())) return res.status(503).json({ error: 'otp_unavailable' });
    const { nationalId, phoneNumber } = req.body || {};
    const user = await rules.findResettableUser(nationalId, phoneNumber);
    if (user) {
        const code = actions.allowSendTo(normalizedResetPhone(user)) ? await otp.issue(user) : null;
        if (code) {
            try {
                await whatsapp.sendOtp(rules.toWhatsAppNumber(user.phone_number), code, { minutes: Math.max(1, Math.round(otp.otpTtlSeconds() / 60)) });
            } catch (err) {
                // don't reveal whether the account exists
                console.error('Failed to send WhatsApp OTP:', err.message);
            }
        }
    }
    res.json({ data: { sent: true, expiresInSeconds: otp.otpTtlSeconds(), resendAfterSeconds: otp.otpCooldownSeconds() } });
}));

// forgot password 2/2: check the code and set the new password
app.post('/api/auth/reset-password', resetPasswordLimiter, asyncRoute(async (req, res) => {
    const { nationalId, phoneNumber, otp: code, newPassword } = req.body || {};
    if (!rules.isValidPassword(newPassword)) return res.status(400).json({ error: 'weak_password' });
    const user = await rules.findResettableUser(nationalId, phoneNumber);
    if (!user || !(await otp.verify(user, code))) return res.status(400).json({ error: 'invalid_code' });
    await store.update('app_users', user.id, { password: newPassword });
    res.json({ data: { success: true } });
}));

app.get('/api/health', (req, res) => res.json({ ok: true, tables: TABLES }));

// serve the built frontend in production
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
        ? 'No admin account existed — created one:'
        : 'Replaced the untouched/demo admin credentials:');
    console.log(`  National ID: ${adminBootstrap.nationalId}`);
    if (adminBootstrap.password) {
        // only shown when generated by the server
        console.log(`  Password:    ${adminBootstrap.password}   (generated -- shown once, save it now)`);
        console.log('Set ADMIN_PASSWORD to choose your own and it will never be logged.');
    } else {
        console.log('  Password:    (from ADMIN_PASSWORD / the local development default)');
    }
    console.log('==============================================');
}

await whatsapp.startProvider();
console.log(`Password-reset OTP via WhatsApp provider: ${whatsapp.describeProvider()}${whatsapp.isConfigured() ? '' : ' (NOT configured -- "forgot password" answers 503 until it is)'}`);
if (whatsapp.describeProvider() === 'console' && process.env.NODE_ENV === 'production') {
    console.warn('WHATSAPP_PROVIDER=console in production: codes are printed in this log, not sent. Testing only!');
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`API server listening on http://localhost:${PORT}`);
});
