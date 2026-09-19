// One-time codes for "forgot password": 6 digits, valid OTP_TTL_SECONDS, single use,
// limited attempts, resend cooldown. Only an HMAC of the code is stored.
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import db from './db.js';

const COLLECTION = 'password_reset_otps';
const MAX_ATTEMPTS = 5;

const ttlMs = () => Number(process.env.OTP_TTL_SECONDS || 300) * 1000;
const cooldownMs = () => Number(process.env.OTP_RESEND_COOLDOWN_SECONDS || 60) * 1000;
export const otpTtlSeconds = () => ttlMs() / 1000;
export const otpCooldownSeconds = () => cooldownMs() / 1000;

const coll = () => db.collection(COLLECTION);
const secret = () => process.env.SESSION_SECRET || 'dev-insecure-secret-change-me';
const digest = (userId, code) => createHmac('sha256', secret()).update(`${userId}:${code}`).digest('hex');

// expired rows are removed by MongoDB
try {
    await coll().createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 });
} catch {
    // optional
}

// new code, or null while the previous one is still in its cooldown
export async function issue(user) {
    const _id = String(user.id);
    const now = Date.now();
    const existing = await coll().findOne({ _id });
    if (existing && existing.expires_at > now && now - existing.sent_at < cooldownMs()) return null;

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await coll().replaceOne({ _id }, {
        _id,
        code_hash: digest(_id, code),
        sent_at: now,
        expires_at: now + ttlMs(),
        expireAt: new Date(now + ttlMs()),
        attempts: 0,
    }, { upsert: true });
    return code;
}

// true only for a correct, unexpired, unused code (wrong guesses are counted)
export async function verify(user, codeInput) {
    const _id = String(user.id);
    const code = String(codeInput ?? '').replace(/\D/g, '');
    const doc = await coll().findOne({ _id });
    if (!doc) return false;
    if (doc.expires_at <= Date.now() || doc.attempts >= MAX_ATTEMPTS) {
        await coll().deleteOne({ _id });
        return false;
    }
    const a = Buffer.from(digest(_id, code), 'hex');
    const b = Buffer.from(doc.code_hash, 'hex');
    if (code.length === 6 && a.length === b.length && timingSafeEqual(a, b)) {
        await coll().deleteOne({ _id }); // single use
        return true;
    }
    if (doc.attempts + 1 >= MAX_ATTEMPTS) await coll().deleteOne({ _id });
    else await coll().replaceOne({ _id }, { ...doc, attempts: doc.attempts + 1 });
    return false;
}

export async function clear(user) {
    await coll().deleteOne({ _id: String(user.id) });
}
