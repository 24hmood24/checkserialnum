import db, { TABLES } from './db.js';
import { hashPassword, verifyPassword } from './crypto.js';

const SENSITIVE_FIELDS = ['password', 'password_hash', 'password_salt'];

function sanitize(table, row) {
    if (table !== 'app_users' || !row) return row;
    const clean = { ...row };
    for (const f of SENSITIVE_FIELDS) delete clean[f];
    return clean;
}

// Same "convenience" matching the old localStorage mock used: partial
// (substring) match for strings, exact match otherwise.
function matches(query, item) {
    if (!query) return true;
    return Object.keys(query).every((k) => {
        if (query[k] === undefined || query[k] === null) return true;
        const val = item[k];
        if (typeof query[k] === 'string') {
            return String(val ?? '').toLowerCase().includes(String(query[k]).toLowerCase());
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

function assertTable(table) {
    if (!TABLES.includes(table)) {
        const err = new Error(`Unknown entity "${table}"`);
        err.status = 404;
        throw err;
    }
}

function readAll(table) {
    const rows = db.prepare(`SELECT id, data, created_at FROM ${table}`).all();
    return rows.map((r) => ({ ...JSON.parse(r.data), id: r.id, created_at: r.created_at }));
}

export function list(table, sort, limit) {
    assertTable(table);
    let items = sortItems(readAll(table), sort);
    if (limit) items = items.slice(0, limit);
    return items.map((it) => sanitize(table, it));
}

export function filter(table, query, sort) {
    assertTable(table);
    const items = sortItems(readAll(table).filter((it) => matches(query, it)), sort);
    return items.map((it) => sanitize(table, it));
}

export function get(table, id) {
    assertTable(table);
    const row = db.prepare(`SELECT id, data, created_at FROM ${table} WHERE id = ?`).get(id);
    if (!row) return null;
    return sanitize(table, { ...JSON.parse(row.data), id: row.id, created_at: row.created_at });
}

export function create(table, payload) {
    assertTable(table);
    const id = String(Date.now()) + Math.random().toString(36).slice(2, 8);
    const createdAt = new Date().toISOString();
    const record = { ...payload, id };
    if (!record.created_date) record.created_date = createdAt;

    if (table === 'app_users') {
        if (record.national_id) {
            const existing = filter('app_users', { national_id: record.national_id });
            const exact = existing.find((u) => String(u.national_id) === String(record.national_id));
            if (exact) {
                const err = new Error('user_exists');
                err.status = 409;
                throw err;
            }
        }
        if (record.password) {
            const { password_hash, password_salt } = hashPassword(record.password);
            record.password_hash = password_hash;
            record.password_salt = password_salt;
            delete record.password;
        }
        if (!record.user_type) record.user_type = 'regular';
    }

    db.prepare(`INSERT INTO ${table} (id, data, created_at) VALUES (?, ?, ?)`).run(
        id, JSON.stringify(record), createdAt
    );
    return sanitize(table, record);
}

export function update(table, id, updates) {
    assertTable(table);
    const row = db.prepare(`SELECT id, data, created_at FROM ${table} WHERE id = ?`).get(id);
    if (!row) {
        const err = new Error('not_found');
        err.status = 404;
        throw err;
    }
    const current = JSON.parse(row.data);
    const patch = { ...updates };

    if (table === 'app_users') {
        // Password change requires proving the current password first.
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
            // Direct password reset (e.g. "forgot password" flow) — no
            // current-password check.
            const { password_hash, password_salt } = hashPassword(patch.password);
            patch.password_hash = password_hash;
            patch.password_salt = password_salt;
            delete patch.password;
        }
    }

    const next = { ...current, ...patch, id: row.id };
    db.prepare(`UPDATE ${table} SET data = ? WHERE id = ?`).run(JSON.stringify(next), id);
    return sanitize(table, next);
}

export function login(nationalId, password) {
    const users = filter_raw('app_users', { national_id: nationalId });
    const user = users.find((u) => String(u.national_id) === String(nationalId));
    if (!user) return null;
    if (!verifyPassword(password, user.password_hash, user.password_salt)) return null;
    return sanitize('app_users', user);
}

// Internal variant of filter() that does NOT sanitize — used only for the
// login check, which needs the password hash to verify against.
function filter_raw(table, query) {
    return readAll(table).filter((it) => matches(query, it));
}

// Bootstraps a built-in admin account on first run so the system always
// has one, instead of relying on someone visiting /admin-seed by hand.
// Only acts when NO admin exists yet — it will never touch an existing
// admin account (e.g. one whose password was already changed).
// Credentials come from env vars so they can be set for a real
// deployment; falls back to the same demo credentials AdminSeed.jsx uses
// so local/dev behavior is unchanged.
export function ensureDefaultAdmin() {
    const hasAdmin = readAll('app_users').some((u) => u.user_type === 'admin');
    if (hasAdmin) return { created: false };

    const nationalId = process.env.ADMIN_NATIONAL_ID || '1000000001';
    const password = process.env.ADMIN_PASSWORD || 'adminpass';
    const fullName = process.env.ADMIN_FULL_NAME || 'System Admin';

    try {
        const admin = create('app_users', {
            national_id: nationalId,
            full_name: fullName,
            phone_number: process.env.ADMIN_PHONE || '0500000000',
            user_type: 'admin',
            password,
        });
        return { created: true, nationalId, password, id: admin.id };
    } catch (err) {
        // national_id already taken by a non-admin account — don't crash
        // startup over it, just report that bootstrap didn't happen.
        return { created: false, error: err.message };
    }
}
