import db, { TABLES } from './db.js';
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

// Same "convenience" matching the old localStorage/SQLite mock used:
// partial (substring) match for strings, exact match otherwise. Kept as
// plain JS filtering (rather than translating to Mongo query operators)
// so behavior is identical to before — this is a small demo-scale
// dataset, not a case that needs query-level optimization.
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

// 3 letters + 3 digits (e.g. "XJQ482") — checked against existing
// reports so two theft reports never end up with the same public ID.
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
    // Astronomically unlikely (26^3 * 10^3 possible ids), but never leave
    // a report with no id at all.
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

// `trusted` is only ever passed by server-internal callers (currently just
// ensureDefaultAdmin(), to create the bootstrap admin account) -- never by
// an HTTP route handling a client request. It's what allows user_type to
// be anything other than 'regular'.
export async function create(table, payload, { trusted = false } = {}) {
    assertTable(table);
    const id = String(Date.now()) + Math.random().toString(36).slice(2, 8);
    const record = { ...payload, id, _id: id };
    // created_date and id/_id are always server-assigned -- never trust a
    // client-supplied value for them.
    record.created_date = new Date().toISOString();

    if (table === 'app_users') {
        // This is the only public account-creation path (self-registration
        // from the "create account" form, no login required). Every field
        // that controls trust must be server-assigned here, never taken
        // from the request body as-is:
        // - user_type: 'regular' unless this is a trusted internal call.
        //   Without this, POSTing { user_type: 'admin', ... } directly to
        //   the API would grant admin access instantly -- self-registration
        //   must never be able to create an admin.
        // - password_hash/password_salt: always derived from `password`
        //   here, never accepted verbatim -- otherwise a client could seed
        //   an account with a hash/salt pair it already knows the
        //   plaintext for, bypassing hashPassword() entirely (not a
        //   privilege issue for a brand-new account, but there's no reason
        //   to accept attacker-controlled hash material at all).
        record.user_type = trusted ? (record.user_type || 'regular') : 'regular';
        delete record.password_hash;
        delete record.password_salt;
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

// `trusted` -- like in create() -- is only ever passed by server-internal
// callers (ensureDefaultAdmin() replacing the factory-default admin's
// credentials) or by a route handler after it has already confirmed the
// caller is an admin. Everywhere else, user_type/national_id must never be
// settable through this generic update, or a logged-in regular user could
// PATCH their own account into an admin (or take over another national ID)
// simply by including those fields in the request body.
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

    const next = { ...current, ...patch, id: current._id, _id: current._id };
    await db.collection(table).replaceOne({ _id: current._id }, next);
    return sanitize(table, next);
}

export async function login(nationalId, password) {
    const users = (await readAll('app_users')).filter((it) => matches({ national_id: nationalId }, it));
    const user = users.find((u) => String(u.national_id) === String(nationalId));
    if (!user) return null;
    if (!verifyPassword(password, user.password_hash, user.password_salt)) return null;
    return sanitize('app_users', user);
}

// The factory-default admin id used when no ADMIN_NATIONAL_ID is
// configured — never changes, so a later boot can recognize "this is
// still the untouched demo admin" and safely replace it.
const FACTORY_DEFAULT_ADMIN_ID = '1000000001';

// Bootstraps a built-in admin account on first run so the system always
// has one, instead of relying on someone visiting /admin-seed by hand.
// Credentials come from env vars so they can be set for a real
// deployment; falls back to the same demo credentials AdminSeed.jsx uses
// so local/dev behavior is unchanged.
//
// - No admin exists yet -> create one.
// - An admin exists, but it's still exactly the untouched factory-default
//   account (national_id === '1000000001') and ADMIN_NATIONAL_ID now
//   configures a different id -> replace its credentials with the
//   configured ones (this is the "I just set real admin creds after the
//   demo account auto-created" case).
// - Any other existing admin (a real, already-customized one) -> never
//   touched.
export async function ensureDefaultAdmin() {
    const admins = (await readAll('app_users')).filter((u) => u.user_type === 'admin');

    const nationalId = process.env.ADMIN_NATIONAL_ID || FACTORY_DEFAULT_ADMIN_ID;
    const password = process.env.ADMIN_PASSWORD || 'adminpass';
    const fullName = process.env.ADMIN_FULL_NAME || 'System Admin';
    const phone = process.env.ADMIN_PHONE || '0500000000';

    if (admins.length === 0) {
        try {
            const admin = await create('app_users', {
                national_id: nationalId,
                full_name: fullName,
                phone_number: phone,
                user_type: 'admin',
                password,
            }, { trusted: true });
            return { created: true, nationalId, password, id: admin.id };
        } catch (err) {
            // national_id already taken by a non-admin account — don't
            // crash startup over it, just report bootstrap didn't happen.
            return { created: false, error: err.message };
        }
    }

    const factoryDefault = admins.find((a) => a.national_id === FACTORY_DEFAULT_ADMIN_ID);
    if (factoryDefault && nationalId !== FACTORY_DEFAULT_ADMIN_ID) {
        try {
            await update('app_users', factoryDefault.id, {
                national_id: nationalId,
                full_name: fullName,
                phone_number: phone,
                password,
            }, { trusted: true });
            return { replaced: true, nationalId, password, id: factoryDefault.id };
        } catch (err) {
            return { created: false, error: err.message };
        }
    }

    return { created: false };
}
