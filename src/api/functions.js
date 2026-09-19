import { StolenDevice, PurchaseCertificate, AppUser, User } from './entities';

// POST helper: returns { data } or { data: null, error: <code from the server> }
async function postJson(url, body, { auth = false } = {}) {
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (auth) {
            const token = localStorage.getItem('session_token');
            if (token) headers.Authorization = `Bearer ${token}`;
        }
        const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            // rate limiter answers with a sentence, the OTP limits with a code
            const specific = json.error && /^(otp_|resend_)/.test(json.error);
            const code = specific ? json.error : (res.status === 429 ? 'rate_limited' : (json.error || `http_${res.status}`));
            return { data: null, error: code, status: res.status };
        }
        return { data: json.data };
    } catch {
        return { data: null, error: 'network_error', status: 0 };
    }
}

// public device check (exact match, only what the screen needs)
export async function checkDevice({ serialNumber }) {
    return postJson('/api/check', { serialNumber });
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

// no try/catch on purpose: callers read error.response.data.error
export async function updateUserProfile({ userId, updates }) {
    const res = await AppUser.update(userId, updates);
    return { data: res.data };
}

// admin only (e.g. restoring a certificate when a closure is approved)
export async function createPurchaseCertificate(payload) {
    try {
        const res = await PurchaseCertificate.create(payload);
        return { data: res.data };
    } catch (err) {
        return { data: null, error: err && err.message ? err.message : String(err) };
    }
}

// --- WhatsApp-confirmed actions ---
// start* sends the code(s), confirmAction saves. `error` is a code such as invalid_code, otp_unavailable, already_reported...

// masked phone for a national ID: { exists, hasPhone, maskedPhone }
export async function getPhoneHint(nationalId) {
    return postJson('/api/lookup/phone-hint', { nationalId });
}

export async function startRegistration(payload) {
    return postJson('/api/register/start', payload);
}

export async function startReport(payload) {
    return postJson('/api/reports/start', payload);
}

export async function startCertificate(payload) {
    return postJson('/api/certificates/start', payload);
}

// codes: { registrant } | { reporter } | { seller, buyer } | { new_phone }
// the session token is sent too (a phone change is confirmed by the same user)
export async function confirmAction({ actionId, codes }) {
    return postJson('/api/actions/confirm', { actionId, codes }, { auth: true });
}

export async function resendAction(actionId) {
    return postJson('/api/actions/resend', { actionId }, { auth: true });
}

// change own phone number: the code goes to the new number
export async function startPhoneChange({ phoneNumber }) {
    return postJson('/api/profile/phone/start', { phoneNumber }, { auth: true });
}

// logged-in owner reporting a device: no code needed
export async function reportTheftAsUser(payload) {
    return postJson('/api/reports/mine', payload, { auth: true });
}

// add a device the user owns
export async function registerOwnDevice(payload) {
    return postJson('/api/certificates/register', payload, { auth: true });
}

// admin only
export async function getAdminDashboardData() {
    try {
        const token = localStorage.getItem('session_token');
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

// next certificate number
export async function getNextCertificateNumber() {
    const res = await fetch('/api/certificates/next-number');
    const body = await res.json();
    return body.data.certificateNumber;
}

export async function updateStolenDeviceReport({ reportId, updates }) {
    try {
        const res = await StolenDevice.update(reportId, updates);
        return { data: res.data };
    } catch (err) {
        return { data: null, error: err && err.message ? err.message : String(err) };
    }
}

// forgot password 1/2: a code is sent by WhatsApp to the registered phone
// data: { expiresInSeconds, resendAfterSeconds }; errors: otp_unavailable, rate_limited
export async function requestResetOtp({ nationalId, phoneNumber }) {
    return postJson('/api/auth/reset-otp/request', { nationalId, phoneNumber });
}

// forgot password 2/2; errors: invalid_code, weak_password, rate_limited
export async function resetPassword({ nationalId, phoneNumber, otp, newPassword }) {
    const res = await postJson('/api/auth/reset-password', { nationalId, phoneNumber, otp, newPassword });
    if (res.error) return { data: { success: false }, error: res.error };
    return { data: res.data };
}
