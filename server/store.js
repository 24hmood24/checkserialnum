import db, { TABLES } from './db.js';
import { randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from './crypto.js';

const SENSITIVE_FIELDS = ['password', 'password_hash', 'password_salt'];

function sanitize(table, row) {
    if (!row) return row;
    const clean = { ...row };
    delete clean._id; // internal Mongo id — the app only ever uses `id` (same value)
    if (table !== 'app_users') return clean;
    for (const f of SENSITIVE_FIELDS) delete clean[f];
    return clean;
}

// exact match (case-insensitive for text)
function matches(query, item) {
    if (!query) return true;
    return Object.keys(query).every((k) => {
        if (query[k] === undefined || query[k] === null) return true;
        const val = item[k];
        if (typeof query[k] === 'string') {
            return String(val ?? '').trim().toLowerCase() === String(query[k]).trim().toLowerCase();
        }
        return val === query[k];
    });
}

function sortItems(items, sort) {
    if (!sort || typeof sort !== 'string') return items;
    const desc = sort.startsWith('-');
    const field = desc ? sort.slice(1) : sort;
    const sorted = [...items].sort((a, b) => ((a[field] ?? '') > (b[field] ?? '') ? 1 : -1));
    return desc ? sorted.reverse() : sorted;
}

// report id: 3 letters + 3 digits (e.g. XJQ482), unique
const REPORT_ID_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function randomReportId() {
    let letters = '';
    for (let i = 0; i < 3; i++) {
        letters += REPORT_ID_LETTERS[Math.floor(Math.random() * REPORT_ID_LETTERS.length)];
    }
    const digits = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    return `${letters}${digits}`;
}

async function generateUniqueReportId() {
    for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = randomReportId();
        const existing = await db.collection('stolen_devices').findOne({ reportId: candidate });
        if (!existing) return candidate;
    }
    // fallback so a report always has an id
    return `${randomReportId()}${Date.now().toString(36).slice(-3).toUpperCase()}`;
}

function assertTable(table) {
    if (!TABLES.includes(table)) {
        const err = new Error(`Unknown entity "${table}"`);
        err.status = 404;
        throw err;
    }
}

async function readAll(table) {
    assertTable(table);
    const docs = await db.collection(table).find({}).toArray();
    return docs.map((d) => ({ ...d, id: d._id }));
}

// internal: full rows including password hashes, never send to a client
export async function rawAll(table) {
    return readAll(table);
}

export async function list(table, sort, limit) {
    let items = sortItems(await readAll(table), sort);
    if (limit) items = items.slice(0, limit);
    return items.map((it) => sanitize(table, it));
}

export async function filter(table, query, sort) {
    const items = sortItems((await readAll(table)).filter((it) => matches(query, it)), sort);
    return items.map((it) => sanitize(table, it));
}

export async function get(table, id) {
    assertTable(table);
    const doc = await db.collection(table).findOne({ _id: id });
    if (!doc) return null;
    return sanitize(table, { ...doc, id: doc._id });
}

// trusted: internal callers only (bootstrap admin, admin routes)
export async function create(table, payload, { trusted = false } = {}) {
    assertTable(table);
    const id = String(Date.now()) + Math.random().toString(36).slice(2, 8);
    const record = { ...payload, id, _id: id };
    // id and created_date are set here
    record.created_date = new Date().toISOString();

    if (table === 'app_users') {
        // user_type is 'regular' unless trusted; the hash always comes from `password`
        record.user_type = trusted ? (record.user_type || 'regular') : 'regular';
        // trusted callers may pass an already hashed password
        const preHashed = trusted && record.password_hash && record.password_salt && !record.password;
        if (!preHashed) {
            delete record.password_hash;
            delete record.password_salt;
        }
        if (record.password) {
            const { password_hash, password_salt } = hashPassword(record.password);
            record.password_hash = password_hash;
            record.password_salt = password_salt;
            delete record.password;
        }
    }

    if (table === 'stolen_devices' && !record.reportId) {
        record.reportId = await generateUniqueReportId();
    }

    try {
        await db.collection(table).insertOne(record);
    } catch (err) {
        if (err.code === 11000) { // duplicate key -> national_id unique index
            const dup = new Error('user_exists');
            dup.status = 409;
            throw dup;
        }
        throw err;
    }
    return sanitize(table, record);
}

// trusted: internal or admin calls only; otherwise user_type and national_id can't be changed
export async function update(table, id, updates, { trusted = false } = {}) {
    assertTable(table);
    const current = await db.collection(table).findOne({ _id: id });
    if (!current) {
        const err = new Error('not_found');
        err.status = 404;
        throw err;
    }
    const patch = { ...updates };

    if (table === 'app_users') {
        if (!trusted) {
            delete patch.user_type;
            delete patch.national_id;
            delete patch.id;
            delete patch._id;
            delete patch.created_date;
        }
        // changing the password needs the current one
        if (patch.new_password) {
            const ok = verifyPassword(patch.current_password, current.password_hash, current.password_salt);
            if (!ok) {
                const err = new Error('Incorrect current password');
                err.status = 400;
                throw err;
            }
            const { password_hash, password_salt } = hashPassword(patch.new_password);
            patch.password_hash = password_hash;
            patch.password_salt = password_salt;
            delete patch.new_password;
            delete patch.current_password;
        } else if (patch.password) {
            // reset (forgot password): no current password
            const { password_hash, password_salt } = hashPassword(patch.password);
            patch.password_hash = password_hash;
            patch.password_salt = password_salt;
            delete patch.password;
        }
    }

    const next = { ...current, ...patch, id: current._id, _id: current._id };
    await db.collection(table).replaceOne({ _id: current._id }, next);
    return sanitize(table, next);
}

// login by national ID or phone number (phones are not unique, so try every match)
export async function login(identifier, password) {
    const id = String(identifier || '').trim();
    if (!id || !password) return null;
    const allUsers = await readAll('app_users');
    const candidates = [
        ...allUsers.filter((u) => String(u.national_id) === id),
        ...allUsers.filter((u) => String(u.national_id) !== id && String(u.phone_number) === id),
    ];
    for (const user of candidates) {
        if (verifyPassword(password, user.password_hash, user.password_salt)) {
            return sanitize('app_users', user);
        }
    }
    return null;
}

// default admin id
const FACTORY_DEFAULT_ADMIN_ID = '1000000001';
const FACTORY_DEFAULT_ADMIN_PASSWORD = 'adminpass';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function randomSecret(bytes = 12) {
    return randomBytes(bytes).toString('base64url');
}

// Creates the admin account from ADMIN_NATIONAL_ID / ADMIN_PASSWORD / ADMIN_PHONE.
// Without ADMIN_PASSWORD: development uses the demo password, production generates a random one
// and prints it once. An existing admin still using the demo password is replaced the same way.
// `password` is only returned when it was generated.
export async function ensureDefaultAdmin() {
    const admins = (await readAll('app_users')).filter((u) => u.user_type === 'admin');

    const nationalId = process.env.ADMIN_NATIONAL_ID || FACTORY_DEFAULT_ADMIN_ID;
    const configuredPassword = process.env.ADMIN_PASSWORD || '';
    const fullName = process.env.ADMIN_FULL_NAME || 'System Admin';
    const phone = process.env.ADMIN_PHONE
        || (IS_PRODUCTION ? `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` : '0500000000');

    const passwordToUse = () => {
        if (configuredPassword) return { password: configuredPassword, generated: false };
        if (IS_PRODUCTION) return { password: randomSecret(), generated: true };
        return { password: FACTORY_DEFAULT_ADMIN_PASSWORD, generated: false };
    };
    const shown = ({ password, generated }) => (generated ? password : undefined);

    if (admins.length === 0) {
        const pw = passwordToUse();
        try {
            const admin = await create('app_users', {
                national_id: nationalId,
                full_name: fullName,
                phone_number: phone,
                user_type: 'admin',
                password: pw.password,
            }, { trusted: true });
            return { created: true, nationalId, password: shown(pw), id: admin.id };
        } catch (err) {
            // national_id already used by a normal account
            return { created: false, error: err.message };
        }
    }

    const factoryDefault = admins.find((a) => a.national_id === FACTORY_DEFAULT_ADMIN_ID);
    if (!factoryDefault) return { created: false };

    // demo admin: replace the credentials if configured, or if it still has the demo password
    const stillDemoPassword = verifyPassword(
        FACTORY_DEFAULT_ADMIN_PASSWORD, factoryDefault.password_hash, factoryDefault.password_salt
    );
    const idChanged = nationalId !== FACTORY_DEFAULT_ADMIN_ID;
    const mustRotate = stillDemoPassword && (Boolean(configuredPassword) || IS_PRODUCTION);
    if (idChanged || mustRotate) {
        const pw = passwordToUse();
        try {
            await update('app_users', factoryDefault.id, {
                national_id: nationalId,
                full_name: fullName,
                phone_number: phone,
                password: pw.password,
            }, { trusted: true });
            return { replaced: true, nationalId, password: shown(pw), id: factoryDefault.id };
        } catch (err) {
            return { created: false, error: err.message };
        }
    }

    return { created: false };
}
