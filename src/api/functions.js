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
// The server also issues a signed session token, stored alongside the
// user, that protected requests (admin dashboard, editing your own
// profile, etc.) send back as Authorization: Bearer <token>.
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
        await User.setCurrent(body.data, body.token);
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

// Admin-only: the server checks the session token belongs to an admin
// (see server/index.js's requireAdmin) before returning the full
// reports + certificates dataset.
export async function getAdminDashboardData() {
    try {
        const token = localStorage.getItem('mock:session_token');
        const res = await fetch('/api/admin/dashboard', {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            return { data: null, error: body.error || `Request failed (${res.status})` };
        }
        const body = await res.json();
        return { data: body.data };
    } catch (err) {
        return { data: null, error: err && err.message ? err.message : String(err) };
    }
}

// Next certificate number, without exposing the previous buyer's full
// record (name/national ID/phone) the way listing purchase_certificates
// directly would.
export async function getNextCertificateNumber() {
    const res = await fetch('/api/certificates/next-number');
    const body = await res.json();
    return body.data.certificateNumber;
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

// Real reset happens server-side in one atomic call (national ID + phone
// re-checked there too) — see POST /api/auth/reset-password. This keeps
// the UI's existing two-step flow (validate, then set new password) but
// no longer trusts the client to have actually completed step one.
export async function resetPassword({ nationalId, phoneNumber, newPassword }) {
    try {
        const res = await fetch('/api/auth/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nationalId, phoneNumber, newPassword }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return { data: { success: false }, error: body.error || 'verification_failed' };
        return { data: body.data };
    } catch (err) {
        return { data: null, error: err && err.message ? err.message : String(err) };
    }
}
