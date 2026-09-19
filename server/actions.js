// Confirm an action with a WhatsApp code (registration, theft report, sale, phone change).
// start() stores the request and sends the code(s); confirm() checks them and returns the stored request.
// A sale has two codes, one for the seller and one for the buyer (always different).
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import db from './db.js';

const COLLECTION = 'pending_actions';
const MAX_ATTEMPTS = 5;
const MAX_RESENDS = 3;

const ttlMs = () => Number(process.env.OTP_TTL_SECONDS || 300) * 1000;
const cooldownMs = () => Number(process.env.OTP_RESEND_COOLDOWN_SECONDS || 60) * 1000;
export const actionTtlSeconds = () => ttlMs() / 1000;
export const actionCooldownSeconds = () => cooldownMs() / 1000;

const coll = () => db.collection(COLLECTION);
const secret = () => process.env.SESSION_SECRET || 'dev-insecure-secret-change-me';
const digest = (actionId, role, code) => createHmac('sha256', secret()).update(`${actionId}:${role}:${code}`).digest('hex');

try {
    await coll().createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 });
} catch {
    // optional cleanup index
}

// --- limit messages per phone ---
const sendLog = new Map(); // phone -> [timestamps]
export function allowSendTo(phone) {
    const max = Number(process.env.OTP_MAX_SENDS_PER_PHONE_PER_HOUR || 5);
    const now = Date.now();
    const recent = (sendLog.get(phone) || []).filter((t) => now - t < 3600_000);
    if (recent.length >= max) {
        sendLog.set(phone, recent);
        return false;
    }
    recent.push(now);
    sendLog.set(phone, recent);
    return true;
}

// --- codes ---
function distinctCodes(n) {
    const codes = [];
    while (codes.length < n) {
        const c = String(randomInt(0, 1_000_000)).padStart(6, '0');
        if (!codes.includes(c)) codes.push(c); // seller's and buyer's code always differ
    }
    return codes;
}

export async function start({ type, payload, targets, boundUserId }) {
    const actionId = randomBytes(24).toString('base64url');
    const codes = distinctCodes(targets.length);
    const now = Date.now();
    await coll().insertOne({
        _id: actionId,
        type,
        payload,
        // only this logged-in user can finish it (phone change)
        ...(boundUserId ? { boundUserId: String(boundUserId) } : {}),
        targets: targets.map((t, i) => ({ role: t.role, phone: t.phone, code_hash: digest(actionId, t.role, codes[i]) })),
        attempts: 0,
        resends: 0,
        sent_at: now,
        expires_at: now + ttlMs(),
        expireAt: new Date(now + ttlMs()),
    });
    return { actionId, codes: targets.map((t, i) => ({ role: t.role, phone: t.phone, code: codes[i] })) };
}

export async function discard(actionId) {
    await coll().deleteOne({ _id: String(actionId) });
}

// send new codes for a pending action (the old ones stop working)
export async function resend(actionId, { userId } = {}) {
    const _id = String(actionId || '');
    const doc = await coll().findOne({ _id });
    const now = Date.now();
    if (!doc || doc.expires_at <= now) return { ok: false, reason: 'not_found' };
    if (doc.boundUserId && doc.boundUserId !== String(userId ?? '')) return { ok: false, reason: 'not_found' };
    if (now - doc.sent_at < cooldownMs()) return { ok: false, reason: 'cooldown' };
    if (doc.resends >= MAX_RESENDS) return { ok: false, reason: 'limit' };

    const codes = distinctCodes(doc.targets.length);
    await coll().replaceOne({ _id }, {
        ...doc,
        targets: doc.targets.map((t, i) => ({ ...t, code_hash: digest(_id, t.role, codes[i]) })),
        resends: doc.resends + 1,
        sent_at: now,
        expires_at: now + ttlMs(),
        expireAt: new Date(now + ttlMs()),
    });
    return { ok: true, type: doc.type, codes: doc.targets.map((t, i) => ({ role: t.role, phone: t.phone, code: codes[i] })) };
}

export async function publicInfo(actionId) {
    const doc = await coll().findOne({ _id: String(actionId || '') });
    return doc ? { type: doc.type, targets: doc.targets.map((t) => ({ role: t.role, phone: t.phone })) } : null;
}

export async function confirm(actionId, submitted, { userId } = {}) {
    const _id = String(actionId || '');
    const doc = await coll().findOne({ _id });
    if (!doc) return { ok: false };
    // not this user's action
    if (doc.boundUserId && doc.boundUserId !== String(userId ?? '')) return { ok: false };
    if (doc.expires_at <= Date.now() || doc.attempts >= MAX_ATTEMPTS) {
        await coll().deleteOne({ _id });
        return { ok: false };
    }

    let allMatch = true;
    for (const target of doc.targets) {
        const code = String((submitted || {})[target.role] ?? '').replace(/\D/g, '');
        const a = Buffer.from(digest(_id, target.role, code), 'hex');
        const b = Buffer.from(target.code_hash, 'hex');
        if (!(code.length === 6 && a.length === b.length && timingSafeEqual(a, b))) allMatch = false;
    }

    if (allMatch) {
        await coll().deleteOne({ _id }); // single use
        return { ok: true, type: doc.type, payload: doc.payload };
    }
    if (doc.attempts + 1 >= MAX_ATTEMPTS) await coll().deleteOne({ _id });
    else await coll().replaceOne({ _id }, { ...doc, attempts: doc.attempts + 1 });
    return { ok: false };
}
