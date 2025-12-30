import { StolenDevice, PurchaseCertificate, AppUser, User } from './entities';

// Local implementations that operate on the mock entities.
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
        if (users && users.length > 0) return { data: { exists: true, user: users[0] } };
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

export async function loginUser({ nationalId, password }) {
    try {
        const users = await AppUser.filter({ national_id: nationalId });
        const user = users && users[0];
        if (!user) return { data: null, error: 'not_found', status: 404 };
        // Very small mock check: if password field exists and matches
        if (user.password && password && String(user.password) === String(password)) {
            await User.setCurrent(user);
            return { data: user };
        }
        return { data: null, error: 'invalid_credentials', status: 401 };
    } catch (err) {
        return { data: null, error: err && err.message ? err.message : String(err) };
    }
}

export async function updateUserProfile(id, updates) {
    try {
        const res = await AppUser.update(id, updates);
        return { data: res.data };
    } catch (err) {
        return { data: null, error: err && err.message ? err.message : String(err) };
    }
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

export async function updateStolenDeviceReport(id, updates) {
    try {
        const res = await StolenDevice.update(id, updates);
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
        const user = users && users[0];
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


