// Simple mock entities backed by localStorage so the app works without Base44.
// Provides: StolenDevice, PurchaseCertificate, AppUser with methods:
// list(sort, limit), filter(query, sort), create(obj), update(id, updates)

function storageKey(name) {
    return `mock:${name}`;
}

function readStore(name) {
    try {
        const raw = localStorage.getItem(storageKey(name));
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
}

function writeStore(name, arr) {
    localStorage.setItem(storageKey(name), JSON.stringify(arr));
}

function matches(query, item) {
    if (!query) return true;
    return Object.keys(query).every((k) => {
        if (query[k] === undefined || query[k] === null) return true;
        // simple partial/string match for convenience
        const val = item[k];
        if (typeof query[k] === 'string') {
            return String(val).toLowerCase().includes(String(query[k]).toLowerCase());
        }
        return val === query[k];
    });
}

function makeEntity(name) {
    return {
        async list(sort, limit) {
            let items = readStore(name);
            if (sort && typeof sort === 'string') {
                const desc = sort.startsWith('-');
                const field = desc ? sort.slice(1) : sort;
                items = items.sort((a, b) => (a[field] > b[field] ? 1 : -1));
                if (desc) items = items.reverse();
            }
            if (limit) return items.slice(0, limit);
            return items;
        },
        async filter(query, sort) {
            const items = readStore(name).filter((it) => matches(query, it));
            if (sort && typeof sort === 'string') {
                const desc = sort.startsWith('-');
                const field = desc ? sort.slice(1) : sort;
                items.sort((a, b) => (a[field] > b[field] ? 1 : -1));
                if (desc) items.reverse();
            }
            return items;
        },
        async create(obj) {
            const items = readStore(name);
            const id = String(Date.now()) + Math.random().toString(36).slice(2, 8);
            const record = { id, ...obj };
            items.unshift(record);
            writeStore(name, items);
            return { data: record };
        },
        async update(id, updates) {
            const items = readStore(name);
            const idx = items.findIndex((i) => String(i.id) === String(id));
            if (idx === -1) return { data: null, error: 'not_found' };
            items[idx] = { ...items[idx], ...updates };
            writeStore(name, items);
            return { data: items[idx] };
        },
        async get(id) {
            const items = readStore(name);
            return items.find((i) => String(i.id) === String(id)) || null;
        },
    };
}

export const StolenDevice = makeEntity('stolen_devices');
export const PurchaseCertificate = makeEntity('purchase_certificates');
export const AppUser = makeEntity('app_users');

// auth shim: simple wrapper around AppUser for login-like behavior
export const User = {
    async getCurrent() {
        try {
            const raw = localStorage.getItem('mock:current_user');
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
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
 