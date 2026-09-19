// Business rules (checks, reports, sales, accounts). They run on the server and return only the fields the caller may see.
import * as store from './store.js';
import { hashPassword } from './crypto.js';

export class RuleError extends Error {
    constructor(status, code) {
        super(code);
        this.status = status;
        this.code = code;
    }
}

export const DEVICE_TYPES = new Set(['phone', 'laptop', 'tablet', 'watch', 'camera', 'other']);
// a report waiting for closure approval still counts as stolen
const STOLEN_STATUSES = new Set(['active', 'pending_closure']);

// --- helpers ---

export function normalizeDigits(text) {
    const arabic = '٠١٢٣٤٥٦٧٨٩';
    return String(text ?? '').replace(/[٠-٩]/g, (d) => String(arabic.indexOf(d)));
}

export function normalizeSerial(text) {
    return normalizeDigits(text).trim().toLowerCase();
}

export function normalizePhone(phone) {
    let n = normalizeDigits(phone).replace(/\D/g, '');
    if (n.length === 9 && !n.startsWith('0')) n = `0${n}`;
    return n;
}

export const isValidPhone = (phone) => /^05\d{8}$/.test(phone);

// 05XXXXXXXX -> 9665XXXXXXXX (WhatsApp format)
export const toWhatsAppNumber = (phone) => `966${normalizePhone(phone).replace(/^0/, '')}`;

export function detectIdType(id) {
    const s = String(id || '');
    if (!/^\d{10}$/.test(s)) return null;
    if (s[0] === '1') return 'national_id';
    if (s[0] === '2') return 'resident_id';
    if (s[0] === '3' || s[0] === '7') return 'commercial_reg';
    return null;
}

export const isValidPassword = (pw) =>
    typeof pw === 'string' && pw.length >= 8 && /\d/.test(pw) && /[a-zA-Z]/.test(pw);

const cleanText = (v, max) => String(v ?? '').trim().slice(0, max);
const byCreatedDesc = (a, b) => (a.created_date < b.created_date ? 1 : a.created_date > b.created_date ? -1 : 0);
const today = () => new Date().toISOString().split('T')[0];

function requireSerial(raw) {
    const serial = normalizeSerial(raw);
    if (!serial) throw new RuleError(400, 'serial_required');
    if (serial.length > 64) throw new RuleError(400, 'invalid_serial');
    return serial;
}

// --- lookups ---

async function stolenReportsFor(serial) {
    const rows = await store.rawAll('stolen_devices');
    return rows.filter((r) => normalizeSerial(r.serialNumber) === serial && STOLEN_STATUSES.has(r.status));
}

async function certificatesFor(serial) {
    const rows = await store.rawAll('purchase_certificates');
    return rows.filter((r) => normalizeSerial(r.serialNumber) === serial).sort(byCreatedDesc);
}

// certificate of the current owner
function currentCertificate(certs) {
    return certs.find((c) => c.status === 'active') || certs.find((c) => c.status === 'stolen') || null;
}

async function userByNationalId(nationalId) {
    const users = await store.rawAll('app_users');
    return users.find((u) => String(u.national_id) === String(nationalId)) || null;
}

// run certificate changes one at a time (single instance)
let certificateLock = Promise.resolve();
function withCertificateLock(fn) {
    const run = certificateLock.then(() => fn());
    certificateLock = run.catch(() => {});
    return run;
}

async function nextCertificateNumber() {
    const certs = await store.rawAll('purchase_certificates');
    const max = certs.reduce((m, c) => {
        const n = parseInt(c.certificateNumber, 10);
        return Number.isFinite(n) && n > m ? n : m;
    }, 0);
    return String(max + 1).padStart(10, '0');
}

// --- device check ---

// only what the check screen shows, no owner data
export async function checkDevice(rawSerial) {
    const serial = requireSerial(rawSerial);
    const reports = await stolenReportsFor(serial);
    const certs = await certificatesFor(serial);
    const cert = currentCertificate(certs) || certs[0] || null;
    const publicCert = cert && {
        certificateNumber: cert.certificateNumber,
        deviceType: cert.deviceType,
        issueDate: cert.issueDate,
        status: cert.status,
    };

    if (reports.length > 0) {
        const r = [...reports].sort(byCreatedDesc)[0];
        return {
            status: 'stolen',
            device: {
                deviceType: r.deviceType,
                created_date: r.created_date,
                theftDate: r.theftDate,
                location: r.location,
            },
            certificate: publicCert || undefined,
        };
    }
    if (cert) return { status: 'safe', certificate: publicCert };
    return { status: 'unknown' };
}

// --- parties & phone numbers ---

// admin accounts are not treated as normal users here
async function publicUserByNationalId(nationalId) {
    const user = await userByNationalId(nationalId);
    return user && user.user_type !== 'admin' ? user : null;
}

export const maskPhone = (phone) => {
    const p = normalizePhone(phone);
    return isValidPhone(p) ? `${p.slice(0, 2)}****${p.slice(-4)}` : '';
};

// account lookup for a national ID; only a masked phone (05****1234) is returned
export async function phoneHint(nationalIdRaw) {
    const id = normalizeDigits(nationalIdRaw).trim();
    if (!detectIdType(id)) throw new RuleError(400, 'invalid_id');
    const user = await publicUserByNationalId(id);
    const phone = user ? normalizePhone(user.phone_number) : '';
    return { exists: Boolean(user), hasPhone: isValidPhone(phone), maskedPhone: isValidPhone(phone) ? maskPhone(phone) : null };
}

// which phone gets the code: the account's phone if there is one
// (what was typed is ignored), otherwise the typed number
async function resolveParty(idRaw, typedPhoneRaw) {
    const id = normalizeDigits(idRaw).trim();
    if (!detectIdType(id)) throw new RuleError(400, 'invalid_id');
    const user = await publicUserByNationalId(id);
    const accountPhone = user ? normalizePhone(user.phone_number) : '';
    if (user && isValidPhone(accountPhone)) return { id, user, phone: accountPhone, fromAccount: true };
    const typed = normalizePhone(typedPhoneRaw);
    if (!isValidPhone(typed)) throw new RuleError(400, 'invalid_phone');
    return { id, user, phone: typed, fromAccount: false };
}

// --- registration ---

export async function planRegistration(input = {}) {
    const nationalId = normalizeDigits(input.national_id).trim();
    const phone = normalizePhone(input.phone_number);
    const fullName = cleanText(input.full_name, 100);
    const idType = detectIdType(nationalId);
    if (!idType) throw new RuleError(400, 'invalid_id');
    if (!isValidPhone(phone)) throw new RuleError(400, 'invalid_phone');
    if (!fullName) throw new RuleError(400, 'name_required');
    if (!isValidPassword(input.password)) throw new RuleError(400, 'weak_password');
    if (await userByNationalId(nationalId)) throw new RuleError(409, 'user_exists');

    const { password_hash, password_salt } = hashPassword(input.password);
    return {
        payload: { national_id: nationalId, id_type: idType, full_name: fullName, phone_number: phone, password_hash, password_salt },
        targets: [{ role: 'registrant', phone }],
    };
}

export async function commitRegistration(payload) {
    if (await userByNationalId(payload.national_id)) throw new RuleError(409, 'user_exists');
    return store.create('app_users', { ...payload }, { trusted: true });
}

// --- phone change: the code goes to the new number ---

export async function planPhoneChange(user, input = {}) {
    if (!user) throw new RuleError(401, 'Login required');
    const phone = normalizePhone(input.phoneNumber ?? input.phone_number);
    if (!isValidPhone(phone)) throw new RuleError(400, 'invalid_phone');
    if (phone === normalizePhone(user.phone_number)) throw new RuleError(400, 'same_phone');
    return {
        payload: { userId: String(user.id), phone_number: phone },
        targets: [{ role: 'new_phone', phone }],
        boundUserId: String(user.id),
    };
}

export async function commitPhoneChange(payload) {
    return store.update('app_users', payload.userId, { phone_number: payload.phone_number });
}

// --- theft report ---

// validate the request and find who must confirm it (nothing is saved)
async function planReport(input, preResolved) {
    const serial = requireSerial(input.serialNumber);
    const deviceType = String(input.deviceType || '');
    const theftDate = String(input.theftDate || '').slice(0, 10);
    const location = cleanText(input.location, 200);
    const details = cleanText(input.theftDetails, 2000);

    if (serial.length < 5) throw new RuleError(400, 'invalid_serial');
    if (!DEVICE_TYPES.has(deviceType)) throw new RuleError(400, 'invalid_device_type');
    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(theftDate) ? new Date(`${theftDate}T00:00:00Z`) : null;
    if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.getTime() > Date.now() + 24 * 3600 * 1000) {
        throw new RuleError(400, 'invalid_date');
    }
    const parts = location.split(' - ');
    if (parts.length !== 3 || parts.some((p) => !p.trim())) throw new RuleError(400, 'invalid_location');

    const reporterId = normalizeDigits(input.reporterNationalId).trim();
    const reporter = preResolved
        ? { id: reporterId, phone: preResolved.phone, fromAccount: preResolved.fromAccount }
        : await resolveParty(reporterId, input.reporterPhone);

    if ((await stolenReportsFor(serial)).length > 0) throw new RuleError(409, 'already_reported');

    const cert = currentCertificate(await certificatesFor(serial));
    if (cert) {
        // registered device: only its owner can report it
        if (String(cert.buyerId) !== reporter.id) throw new RuleError(403, 'reporter_not_owner');
        if (cert.deviceType !== deviceType) throw new RuleError(400, 'device_type_mismatch');
        if (!reporter.fromAccount) {
            // no account: the phone must match the one on the certificate
            const known = normalizePhone(cert.buyerPhone);
            if (!isValidPhone(known)) throw new RuleError(403, 'reporter_not_owner');
            if (known !== reporter.phone) throw new RuleError(403, 'reporter_phone_mismatch');
        }
    }

    return {
        cert,
        payload: {
            serialNumber: serial,
            deviceType,
            reporterIdType: detectIdType(reporter.id),
            reporterNationalId: reporter.id,
            reporterPhone: reporter.phone,
            reporterFromAccount: reporter.fromAccount,
            theftDate,
            location,
            theftDetails: details,
        },
        targets: [{ role: 'reporter', phone: reporter.phone }],
    };
}

async function writeReport(plan) {
    if (plan.cert) await store.update('purchase_certificates', plan.cert.id, { status: 'stolen' });
    const p = plan.payload;
    // only known fields, status is set here
    const report = await store.create('stolen_devices', {
        serialNumber: p.serialNumber,
        deviceType: p.deviceType,
        reporterIdType: p.reporterIdType,
        reporterNationalId: p.reporterNationalId,
        reporterPhone: p.reporterPhone,
        theftDate: p.theftDate,
        location: p.location,
        theftDetails: p.theftDetails,
        status: 'active',
    });
    return { id: report.id, reportId: report.reportId, serialNumber: report.serialNumber, status: report.status, created_date: report.created_date };
}

export const startReport = (input) => withCertificateLock(async () => {
    const { payload, targets } = await planReport(input);
    return { payload, targets };
});

export const commitReport = (payload) => withCertificateLock(async () => {
    const plan = await planReport(payload, { phone: payload.reporterPhone, fromAccount: payload.reporterFromAccount });
    return writeReport(plan);
});

// logged-in owner: no code needed
export const reportTheftAsUser = (user, input) => withCertificateLock(async () => {
    const phone = normalizePhone(user.phone_number);
    const plan = await planReport(
        { ...input, reporterNationalId: user.national_id },
        { phone: isValidPhone(phone) ? phone : normalizePhone(input.reporterPhone), fromAccount: true },
    );
    return writeReport(plan);
});

// --- certificates ---

// sale / ownership transfer: validate and find the seller and buyer phones
async function planCertificate(input, preResolved) {
    const serial = requireSerial(input.serialNumber);
    const deviceType = String(input.deviceType || '');
    const buyerId = normalizeDigits(input.buyerId).trim();
    const sellerId = normalizeDigits(input.sellerId ?? input.sellerNationalId).trim();
    const typedBuyerName = cleanText(input.buyerName, 100);
    const price = Number(input.purchasePrice);

    if (!DEVICE_TYPES.has(deviceType)) throw new RuleError(400, 'invalid_device_type');
    if (!detectIdType(buyerId) || !detectIdType(sellerId)) throw new RuleError(400, 'invalid_id');
    if (buyerId === sellerId) throw new RuleError(400, 'same_buyer_seller');
    if (!Number.isFinite(price) || price <= 0 || price > 1e9) throw new RuleError(400, 'invalid_price');

    // a store (commercial registration) can sell to a customer without an account
    const sellerIsCommercial = detectIdType(sellerId) === 'commercial_reg';
    const sellerUser = await publicUserByNationalId(sellerId);
    const buyerUser = await publicUserByNationalId(buyerId);
    if (!sellerUser && !sellerIsCommercial) throw new RuleError(404, 'seller_not_found');
    if (!buyerUser && !sellerIsCommercial) throw new RuleError(404, 'buyer_not_found');
    if (!buyerUser && !typedBuyerName) throw new RuleError(400, 'buyer_name_required');

    const seller = preResolved ? { id: sellerId, phone: preResolved.sellerPhone } : await resolveParty(sellerId, input.sellerPhone);
    const buyer = preResolved ? { id: buyerId, phone: preResolved.buyerPhone } : await resolveParty(buyerId, input.buyerPhone);
    if (seller.phone === buyer.phone) throw new RuleError(400, 'same_phone_number'); // two people, two phones

    if ((await stolenReportsFor(serial)).length > 0) throw new RuleError(409, 'device_stolen');

    const cert = currentCertificate(await certificatesFor(serial));
    if (cert) {
        if (cert.status === 'stolen') throw new RuleError(409, 'device_stolen');
        if (cert.deviceType !== deviceType) throw new RuleError(400, 'device_type_mismatch');
        if (String(cert.buyerId) !== sellerId) throw new RuleError(403, 'seller_not_owner');
    }

    return {
        cert,
        buyerUser,
        payload: {
            serialNumber: serial,
            deviceType,
            buyerId,
            buyerName: typedBuyerName,
            buyerPhone: buyer.phone,
            sellerId,
            sellerPhone: seller.phone,
            purchasePrice: price,
        },
        targets: [
            { role: 'seller', phone: seller.phone },
            { role: 'buyer', phone: buyer.phone },
        ],
    };
}

async function writeCertificate(plan) {
    const p = plan.payload;
    if (plan.cert) await store.update('purchase_certificates', plan.cert.id, { status: 'transferred' });
    return store.create('purchase_certificates', {
        certificateNumber: await nextCertificateNumber(),
        buyerIdType: detectIdType(p.buyerId),
        buyerId: p.buyerId,
        buyerName: plan.buyerUser?.full_name || p.buyerName,
        buyerNameAtSale: p.buyerName || plan.buyerUser?.full_name || '',
        buyerPhone: p.buyerPhone,
        sellerIdType: detectIdType(p.sellerId),
        sellerNationalId: p.sellerId,
        sellerPhone: p.sellerPhone,
        deviceType: p.deviceType,
        serialNumber: p.serialNumber,
        purchasePrice: p.purchasePrice,
        issueDate: today(),
        status: 'active',
    });
}

export const startCertificate = (input) => withCertificateLock(async () => {
    const { payload, targets } = await planCertificate(input);
    return { payload, targets };
});

export const commitCertificate = (payload) => withCertificateLock(async () => {
    const plan = await planCertificate(payload, { sellerPhone: payload.sellerPhone, buyerPhone: payload.buyerPhone });
    return writeCertificate(plan);
});

// add a device the user already owns
export async function registerOwnDevice(userId, input = {}) {
    const serial = requireSerial(input.serialNumber);
    const deviceType = String(input.deviceType || '');
    if (serial.length < 5) throw new RuleError(400, 'invalid_serial');
    if (!DEVICE_TYPES.has(deviceType)) throw new RuleError(400, 'invalid_device_type');

    const users = await store.rawAll('app_users');
    const user = users.find((u) => String(u.id) === String(userId));
    if (!user) throw new RuleError(401, 'Login required');

    return withCertificateLock(async () => {
        if ((await stolenReportsFor(serial)).length > 0) throw new RuleError(409, 'device_stolen');
        const existing = currentCertificate(await certificatesFor(serial));
        if (existing) throw new RuleError(409, 'already_registered');

        return store.create('purchase_certificates', {
            certificateNumber: await nextCertificateNumber(),
            buyerIdType: detectIdType(user.national_id),
            buyerId: String(user.national_id),
            buyerName: user.full_name,
            deviceType,
            serialNumber: serial,
            issueDate: today(),
            status: 'active',
        });
    });
}

// --- accounts ---

// forgot password: national ID + registered phone (admins can't be reset this way)
export async function findResettableUser(nationalId, phoneNumber) {
    const id = normalizeDigits(nationalId).trim();
    const phone = normalizePhone(phoneNumber);
    if (!id || !phone) return null;
    const user = await userByNationalId(id);
    if (!user || user.user_type === 'admin') return null;
    return normalizePhone(user.phone_number) === phone ? user : null;
}
