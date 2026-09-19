// Entities backed by the Express + MongoDB API (see /server)

const BASE = '/api/entities';

function authHeaders() {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
}

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
        // same error shape the components check (error.response.data.error)
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
            const res = await fetch(`${BASE}/${name}${qs ? `?${qs}` : ''}`, {
                headers: { ...authHeaders() },
            });
            const body = await parseOrThrow(res);
            return body.data;
        },
        async filter(query, sort) {
            const res = await fetch(`${BASE}/${name}/filter`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({ query, sort }),
            });
            const body = await parseOrThrow(res);
            return body.data;
        },
        async create(obj) {
            const res = await fetch(`${BASE}/${name}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify(obj),
            });
            const body = await parseOrThrow(res);
            return { data: body.data };
        },
        async update(id, updates) {
            const res = await fetch(`${BASE}/${name}/${encodeURIComponent(id)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify(updates),
            });
            const body = await parseOrThrow(res);
            return { data: body.data };
        },
        async get(id) {
            const res = await fetch(`${BASE}/${name}/${encodeURIComponent(id)}`, {
                headers: { ...authHeaders() },
            });
            const body = await parseOrThrow(res);
            return body.data;
        },
    };
}

export const StolenDevice = makeEntity('stolen_devices');
export const PurchaseCertificate = makeEntity('purchase_certificates');
export const AppUser = makeEntity('app_users');

// current user and session token, kept in localStorage
function getToken() {
    try {
        return localStorage.getItem('session_token');
    } catch {
        return null;
    }
}

export const User = {
    async getCurrent() {
        try {
            const raw = localStorage.getItem('current_user');
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    },
    async setCurrent(user, token) {
        localStorage.setItem('current_user', JSON.stringify(user));
        if (token) localStorage.setItem('session_token', token);
        return user;
    },
    async clear() {
        localStorage.removeItem('current_user');
        localStorage.removeItem('session_token');
    },
};
