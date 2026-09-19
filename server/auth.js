// Minimal signed session tokens (HMAC-SHA256, JWT-shaped: body.signature,
// both base64url) — no extra dependency, easy to audit. Issued on login,
// required by the admin/self-only routes in index.js.
import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
    console.warn(
        '==============================================\n' +
        'WARNING: SESSION_SECRET is not set. Falling back to an insecure\n' +
        'built-in default — anyone who reads this source can forge admin\n' +
        'session tokens. Set a real SESSION_SECRET before going live.\n' +
        '=============================================='
    );
}
const EFFECTIVE_SECRET = SECRET || 'dev-insecure-secret-change-me';

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function sign(data) {
    return createHmac('sha256', EFFECTIVE_SECRET).update(data).digest('base64url');
}

export function signToken(payload) {
    const body = { ...payload, exp: Date.now() + TOKEN_TTL_MS };
    const bodyB64 = Buffer.from(JSON.stringify(body)).toString('base64url');
    return `${bodyB64}.${sign(bodyB64)}`;
}

export function verifyToken(token) {
    if (!token || typeof token !== 'string' || !token.includes('.')) return null;
    const [bodyB64, sig] = token.split('.');
    const expected = sign(bodyB64);
    const a = Buffer.from(sig || '');
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    let body;
    try {
        body = JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf8'));
    } catch {
        return null;
    }
    if (!body.exp || Date.now() > body.exp) return null;
    return body;
}

export function authFromRequest(req) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    return verifyToken(token);
}
