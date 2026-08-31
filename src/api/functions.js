import { StolenDevice, PurchaseCertificate, AppUser, User } from './entities';

export async function checkDevice({ serialNumber }) {
    try {
        const normalized = String(serialNumber || '').toLowerCase();
        const certs = await PurchaseCertificate.filter({ serialNumber: normalized });
        const stolen = await StolenDevice.filter({ serialNumber: normalized, status: 'active' });

        if (stolen && stolen.length > 0) {
            return { data: { status: 'stolen', device: stolen[0], certificate: certs && certs[0] } };
        }

        if (certs && certs.length > 0) {
            return { data: { status: 'safe', certificate: certs[0] } };
        }

        return { data: { status: 'unknown' } };
    } catch (err) {
        return { data: null, error: err && err.message ? err.message : String(err) };
    }
}

export async function findUserByNationalId({ nationalId }) {
    try {
        const users = await AppUser.filter({ national_id: nationalId });
        const exact = users && users.find((u) => String(u.national_id) === String(nationalId));
        if (exact) return { data: { exists: true, user: exact } };
        return { data: { exists: false } };
    } catch (err) {
        return { data: null, error: err && err.message ? err.message : String(err) };
    }
}

export async function registerUser(payload) {
    try {
        const { data } = await AppUser.create(payload);
        return { data };
    } catch (err) {
        return { data: null, error: err && err.message ? err.message : String(err) };
    }
}

// Real login: password verification happens server-side (server/store.js),
// this just relays the result. Never compare passwords in the browser.
export async function loginUser({ nationalId, password }) {
    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nationalId, password }),
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            return { data: null, error: body.error || 'invalid_credentials', status: res.status };
        }
        const body = await res.json();
        await User.setCurrent(body.data);
        return { data: body.data };
    } catch (err) {
        return { data: null, error: err && err.message ? err.message : String(err) };
    }
}

// Note: intentionally does NOT catch — callers (UserProfileTab.jsx,
// UserDashboard.jsx) rely on the axios-like error shape entities.js
// already attaches (apiError.response?.data?.error) to show a friendly
// "wrong current password" message.
export async function updateUserProfile({ userId, updates }) {
    const res = await AppUser.update(userId, updates);
    return { data: res.data };
}

export async function createStolenDeviceReport(payload) {
    try {
        const res = await StolenDevice.create(payload);
        return { data: res.data };
    } catch (err) {
        return { data: null, error: err && err.message ? err.message : String(err) };
    }
}

export async function createPurchaseCertificate(payload) {
    try {
        const res = await PurchaseCertificate.create(payload);
        return { data: res.data };
    } catch (err) {
        return { data: null, error: err && err.message ? err.message : String(err) };
    }
}

export async function getAdminDashboardData() {
    try {
        const stolen = await StolenDevice.list('-created_date');
        const certificates = await PurchaseCertificate.list('-created_date');
        return { data: { stolenDevices: stolen, certificates } };
    } catch (err) {
        return { data: null, error: err && err.message ? err.message : String(err) };
    }
}

// NOTE: this used to take (id, updates) positionally, but every call site
// passes a single { reportId, updates } object — the mismatch meant report
// status updates (approve/reject closure, edits) always silently failed.
export async function updateStolenDeviceReport({ reportId, updates }) {
    try {
        const res = await StolenDevice.update(reportId, updates);
        return { data: res.data };
    } catch (err) {
        return { data: null, error: err && err.message ? err.message : String(err) };
    }
}

// Debug helpers
export async function debugUsers() {
    const all = await AppUser.list();
    return { data: all };
}

export async function repairMyAccount() {
    return { data: null, error: 'not_supported' };
}

export async function validateResetRequest({ nationalId, phoneNumber }) {
    try {
        const users = await AppUser.filter({ national_id: nationalId });
        const user = users && users.find((u) => String(u.national_id) === String(nationalId));
        if (!user) return { data: { success: false } };
        const normalizedInputPhone = String(phoneNumber || '').replace(/\D/g, '');
        const normalizedUserPhone = String(user.phone_number || '').replace(/\D/g, '');
        if (normalizedInputPhone === normalizedUserPhone) {
            return { data: { success: true, userId: user.id } };
        }
        return { data: { success: false } };
    } catch (err) {
        return { data: null, error: err && err.message ? err.message : String(err) };
    }
}

export async function resetPassword({ userId, newPassword }) {
    try {
        const res = await AppUser.update(userId, { password: newPassword });
        return { data: { success: !!res.data } };
    } catch (err) {
        return { data: null, error: err && err.message ? err.message : String(err) };
    }
}
