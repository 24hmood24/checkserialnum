// Real entities backed by the Express + SQLite API server (see /server).
// Same public shape as the old localStorage mock — list/filter/create/update/get —
// so every component that already imports these keeps working unchanged.

const BASE = '/api/entities';

async function parseOrThrow(res) {
    let body = null;
    try {
        body = await res.json();
    } catch {
        // no JSON body
    }
    if (!res.ok) {
        const message = (body && body.error) || `Request failed (${res.status})`;
        const err = new Error(message);
        // Mirror the shape UserProfileTab.jsx already checks
        // (apiError.response?.data?.error), so no UI code needs to change.
        err.response = { data: { error: message }, status: res.status };
        throw err;
    }
    return body;
}

function makeEntity(name) {
    return {
        async list(sort, limit) {
            const params = new URLSearchParams();
            if (sort) params.set('sort', sort);
            if (limit) params.set('limit', String(limit));
            const qs = params.toString();
            const res = await fetch(`${BASE}/${name}${qs ? `?${qs}` : ''}`);
            const body = await parseOrThrow(res);
            return body.data;
        },
        async filter(query, sort) {
            const res = await fetch(`${BASE}/${name}/filter`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, sort }),
            });
            const body = await parseOrThrow(res);
            return body.data;
        },
        async create(obj) {
            const res = await fetch(`${BASE}/${name}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(obj),
            });
            const body = await parseOrThrow(res);
            return { data: body.data };
        },
        async update(id, updates) {
            const res = await fetch(`${BASE}/${name}/${encodeURIComponent(id)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates),
            });
            const body = await parseOrThrow(res);
            return { data: body.data };
        },
        async get(id) {
            const res = await fetch(`${BASE}/${name}/${encodeURIComponent(id)}`);
            const body = await parseOrThrow(res);
            return body.data;
        },
    };
}

export const StolenDevice = makeEntity('stolen_devices');
export const PurchaseCertificate = makeEntity('purchase_certificates');
export const AppUser = makeEntity('app_users');

// Session shim: which user is currently logged in on THIS browser. This is
// purely a client-side convenience (like a cookie) — it doesn't need to hit
// the server, unlike the actual user records above.
export const User = {
    async getCurrent() {
        try {
            const raw = localStorage.getItem('mock:current_user');
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    },
    async setCurrent(user) {
        localStorage.setItem('mock:current_user', JSON.stringify(user));
        return user;
    },
    async clear() {
        localStorage.removeItem('mock:current_user');
    },
};
