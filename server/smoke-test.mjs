// API smoke test: starts the server with the in-memory database and runs the main flows.
// Run: node server/smoke-test.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
let failed = 0;

const denied = (r) => r.status === 401 || r.status === 403;

function ok(cond, name, extra) {
    if (cond) { passed += 1; console.log(`  ok   ${name}`); }
    else { failed += 1; console.log(`  FAIL ${name}${extra !== undefined ? `  -> ${JSON.stringify(extra)}` : ''}`); }
}

async function startServer(port, env) {
    const child = spawn(process.execPath, [SERVER], {
        env: { ...process.env, USE_MEMORY_DB: '1', PORT: String(port), ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let logs = '';
    child.stdout.on('data', (d) => { logs += d; });
    child.stderr.on('data', (d) => { logs += d; });
    for (let i = 0; i < 100; i += 1) {
        try { if ((await fetch(`http://localhost:${port}/api/health`)).ok) break; } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 100));
    }
    return { logs: () => logs, stop: () => child.kill() };
}

let ipCounter = 1;
const newIp = () => `10.0.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

function client(port) {
    return async function call(method, url, { body, token, ip } = {}) {
        const res = await fetch(`http://localhost:${port}${url}`, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'X-Forwarded-For': ip || newIp(),
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        let json = null;
        try { json = await res.json(); } catch { /* empty body */ }
        return { status: res.status, body: json, data: json && json.data, error: json && json.error, token: json && json.token };
    };
}

// ---------------------------------------------------------------- run A ---
console.log('\n[A] production boot without ADMIN_PASSWORD: demo credentials must not work');
{
    const srv = await startServer(3411, { NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(32) });
    const api = client(3411);
    const demo = await api('POST', '/api/auth/login', { body: { nationalId: '1000000001', password: 'adminpass' } });
    ok(demo.status === 401, 'admin/adminpass is rejected in production', demo.status);
    const m = srv.logs().match(/Password:\s+(\S+)\s+\(generated/);
    ok(Boolean(m), 'a random admin password is generated and logged once');
    if (m) {
        const good = await api('POST', '/api/auth/login', { body: { nationalId: '1000000001', password: m[1] } });
        ok(good.status === 200 && good.data.user_type === 'admin', 'the generated password logs in as admin');
    }
    const otpReq = await api('POST', '/api/auth/reset-otp/request', { body: { nationalId: '1000000001', phoneNumber: '0500000000' } });
    ok(otpReq.status === 503 && otpReq.error === 'otp_unavailable', 'production without a WhatsApp provider: reset answers 503 (no weaker fallback)', otpReq.body);
    const noProviderStart = await api('POST', '/api/register/start', { body: { national_id: '1222222222', full_name: 'X', phone_number: '0522222222', password: 'Passw0rd1' } });
    ok(noProviderStart.status === 503 && noProviderStart.error === 'otp_unavailable', 'production without a WhatsApp provider: registration cannot be started (no bypass)', noProviderStart.body);
    const noOtpReset = await api('POST', '/api/auth/reset-password', { body: { nationalId: '1000000001', phoneNumber: '0500000000', otp: '123456', newPassword: 'Hacked1234' } });
    ok(noOtpReset.status === 400, 'reset without a valid code is refused');
    srv.stop();
}

// ---------------------------------------------------------------- run B ---
console.log('\n[B] functional + access-control scenarios');
const ADMIN = { id: '1999999999', pw: 'Adm1nPass!x' };

// fake WhatsApp API: records every message
const whatsappInbox = [];
const mockWhatsApp = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
        whatsappInbox.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(raw || '{}') });
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ messages: [{ id: 'wamid.test' }] }));
    });
});
await new Promise((r) => mockWhatsApp.listen(3499, r));
const lastCode = () => whatsappInbox.at(-1)?.body?.template?.components?.[0]?.parameters?.[0]?.text;

const srv = await startServer(3412, {
    NODE_ENV: 'development', SESSION_SECRET: 'y'.repeat(32), ADMIN_NATIONAL_ID: ADMIN.id, ADMIN_PASSWORD: ADMIN.pw, ADMIN_PHONE: '0599999999',
    WHATSAPP_PROVIDER: 'meta', WHATSAPP_TOKEN: 'test-token', WHATSAPP_PHONE_NUMBER_ID: '555', WHATSAPP_API_BASE: 'http://localhost:3499',
    WHATSAPP_TEMPLATE_NAME: 'otp_ar', OTP_TTL_SECONDS: '3', OTP_RESEND_COOLDOWN_SECONDS: '2', OTP_MAX_SENDS_PER_PHONE_PER_HOUR: '500',
});
const api = client(3412);
ok(!srv.logs().includes(ADMIN.pw), 'operator-chosen ADMIN_PASSWORD is never written to the log');

// the API never returns a code, read it from the fake WhatsApp
const toWa = (phone) => `966${phone.replace(/^0/, '')}`;
const codeSentTo = (phone) => [...whatsappInbox].reverse().find((m) => m.body.to === toWa(phone))?.body.template.components[0].parameters[0].text;
// start, then confirm with the codes read from WhatsApp (phones: role -> phone)
async function viaOtp(startUrl, body, phones) {
    const started = await api('POST', startUrl, { body });
    if (started.status !== 201) return started;
    const codes = Object.fromEntries(Object.entries(phones).map(([role, phone]) => [role, codeSentTo(phone)]));
    return api('POST', '/api/actions/confirm', { body: { actionId: started.data.actionId, codes } });
}
const register = (id, name, phone, pw = 'Passw0rd1') =>
    viaOtp('/api/register/start', { national_id: id, id_type: 'national_id', full_name: name, phone_number: phone, password: pw }, { registrant: phone });
const report = (body, phone) => viaOtp('/api/reports/start', body, { reporter: phone });
const issue = (body, sellerPhone, buyerPhone) => viaOtp('/api/certificates/start', body, { seller: sellerPhone, buyer: buyerPhone });
const login = async (identifier, pw = 'Passw0rd1') => (await api('POST', '/api/auth/login', { body: { nationalId: identifier, password: pw } }));

// accounts ------------------------------------------------------------
console.log('accounts');
const A = { id: '1111111111', phone: '0511111111' };
const B = { id: '1222222222', phone: '0522222222' };
ok((await register(A.id, 'Ali', A.phone)).status === 201, 'register A');
ok((await register(B.id, 'Bader', B.phone)).status === 201, 'register B');
ok((await register(A.id, 'Dup', '0533333333')).error === 'user_exists', 'duplicate national id -> user_exists');
ok((await register('1333333333', 'Weak', '0533333333', 'short')).error === 'weak_password', 'weak password rejected server-side');
ok((await register('1333333333', 'BadPhone', '12345')).error === 'invalid_phone', 'bad phone rejected server-side');
ok((await register('9333333333', 'BadId', '0533333333')).error === 'invalid_id', 'bad national id rejected server-side');
const adminTry = await viaOtp('/api/register/start', { national_id: '1444444444', full_name: 'x', phone_number: '0544444444', password: 'Passw0rd1', user_type: 'admin' }, { registrant: '0544444444' });
ok(adminTry.status === 201 && adminTry.data.user_type === 'regular', 'self-registration can never create an admin');
ok(adminTry.data && !('password_hash' in adminTry.data), 'registration response has no password hash');
ok((await api('POST', '/api/entities/app_users', { body: { national_id: '1888888888', full_name: 'Bypass', phone_number: '0588888888', password: 'Passw0rd1' } })).status === 403, 'no registration without a code');
{
    const inboxBefore = whatsappInbox.length;
    const started = await api('POST', '/api/register/start', { body: { national_id: '1999000111', full_name: 'Otp Test', phone_number: '0555000111', password: 'Passw0rd1' } });
    ok(started.status === 201 && started.data.targets[0].maskedPhone === '05****0111', 'register/start answers with a MASKED phone only', started.body);
    ok(whatsappInbox.length === inboxBefore + 1 && whatsappInbox.at(-1).body.to === '966555000111', 'the code was WhatsApped to the number typed at registration');
    const noUserYet = await login('1999000111');
    ok(noUserYet.status === 401, 'nothing is created before the code is confirmed');
    const wrong = await api('POST', '/api/actions/confirm', { body: { actionId: started.data.actionId, codes: { registrant: '000000' } } });
    ok(wrong.status === 400 && wrong.error === 'invalid_code', 'a wrong code does not create the account');
    const right = await api('POST', '/api/actions/confirm', { body: { actionId: started.data.actionId, codes: { registrant: codeSentTo('0555000111') } } });
    ok(right.status === 201 && right.data.national_id === '1999000111', 'the right code creates the account');
    ok((await api('POST', '/api/actions/confirm', { body: { actionId: started.data.actionId, codes: { registrant: codeSentTo('0555000111') } } })).status === 400, 'a used action cannot be confirmed twice');
    ok((await api('POST', '/api/actions/confirm', { body: { actionId: 'nope', codes: {} } })).status === 400, 'unknown action id rejected');
}

const la = await login(A.id);
ok(la.status === 200 && la.token, 'login by national id');
const lp = await login(A.phone);
ok(lp.status === 200 && lp.data.national_id === A.id, 'login by mobile number');
ok((await login(A.id, 'wrongpass1')).status === 401, 'wrong password -> 401');
// two accounts with the same phone can both log in by phone
await register('1555555555', 'Sharer', A.phone, 'Other1234');
ok((await login(A.phone, 'Passw0rd1')).data?.national_id === A.id, 'shared phone: first account still logs in by phone');
ok((await login(A.phone, 'Other1234')).data?.national_id === '1555555555', 'shared phone: second account can log in by phone too');
const tokA = la.token;
const upd = await api('PATCH', `/api/entities/app_users/${la.data.id}`, { token: la.token, body: { full_name: 'Ali Updated', phone_number: '0511111111' } });
ok(upd.status === 200 && upd.data.full_name === 'Ali Updated' && !('password_hash' in upd.data), 'profile edit returns the saved user (the UI now shows it immediately)', upd.body);
ok((await api('PATCH', `/api/entities/app_users/${la.data.id}`, { token: la.token, body: { user_type: 'admin' } })).status === 403, 'a user cannot promote themselves to admin');
await api('PATCH', `/api/entities/app_users/${la.data.id}`, { token: la.token, body: { full_name: 'Ali' } });
const tokB = (await login(B.id)).token;
const tokAdmin = (await login(ADMIN.id, ADMIN.pw)).token;
ok(Boolean(tokAdmin), 'admin logs in with the configured credentials');

// phone hint ---------------------------------------------------------
console.log('phone hint (fills the mobile field from the national ID)');
{
    const h1 = await api('POST', '/api/lookup/phone-hint', { body: { nationalId: A.id } });
    ok(h1.data.exists === true && h1.data.hasPhone === true && h1.data.maskedPhone === '05****1111', 'registered ID -> exists + masked phone', h1.body);
    ok(!JSON.stringify(h1.body).includes('0511111111'), 'the real phone number never leaves the server');
    const h2 = await api('POST', '/api/lookup/phone-hint', { body: { nationalId: '1444999999' } });
    ok(h2.data.exists === false && h2.data.maskedPhone === null, 'unknown ID -> not found (type the phone by hand)');
    ok((await api('POST', '/api/lookup/phone-hint', { body: { nationalId: ADMIN.id } })).data.exists === false, 'admin accounts are never revealed');
    ok((await api('POST', '/api/lookup/phone-hint', { body: { nationalId: '123' } })).status === 400, 'malformed ID -> 400');
    let last = 0;
    for (let i = 0; i < 42; i += 1) last = (await api('POST', '/api/lookup/phone-hint', { ip: '198.51.100.7', body: { nationalId: A.id } })).status;
    ok(last === 429, 'phone-hint lookups are rate limited', last);
}

// public lookups are closed ------------------------------------------
console.log('no anonymous access to private data');
ok(denied((await api('GET', '/api/entities/stolen_devices'))), 'anonymous GET stolen_devices is denied');
ok(denied((await api('GET', '/api/entities/purchase_certificates'))), 'anonymous GET certificates is denied');
ok(denied((await api('POST', '/api/entities/stolen_devices/filter', { body: { query: {} } }))), 'anonymous filter stolen_devices is denied');
ok(denied((await api('POST', '/api/entities/app_users/filter', { body: { query: { national_id: A.id } } }))), 'anonymous user lookup is denied');
ok(denied((await api('POST', '/api/entities/stolen_devices', { body: { serialNumber: 'x', status: 'active' } }))), 'anonymous raw create of a report is denied');
ok(denied((await api('POST', '/api/entities/purchase_certificates', { body: { serialNumber: 'x' } }))), 'anonymous raw create of a certificate is denied');
ok(denied((await api('PATCH', '/api/entities/purchase_certificates/whatever', { body: { status: 'transferred' } }))), 'anonymous certificate PATCH is denied');
ok((await api('GET', '/api/admin/dashboard', { token: tokA })).status === 403, 'regular user cannot open the admin dashboard');
ok((await api('POST', '/api/entities/app_users/filter', { token: tokA, body: { query: { national_id: B.id } } })).status === 403, 'regular user cannot look up other users');

// device registration + public check -----------------------------------
console.log('device registration and check');
const SERIAL = 'ABC12345XYZ';
ok((await api('POST', '/api/check', { body: { serialNumber: SERIAL } })).data.status === 'unknown', 'unknown serial -> unknown');
ok((await api('POST', '/api/check', { body: {} })).status === 400, 'empty serial -> 400');
ok((await api('POST', '/api/certificates/register', { body: { serialNumber: SERIAL, deviceType: 'phone' } })).status === 401, 'registering a device needs login');
const reg = await api('POST', '/api/certificates/register', { token: tokA, body: { serialNumber: SERIAL, deviceType: 'phone' } });
ok(reg.status === 201 && reg.data.buyerId === A.id && reg.data.status === 'active', 'A registers a device');
ok((await api('POST', '/api/certificates/register', { token: tokB, body: { serialNumber: SERIAL.toLowerCase(), deviceType: 'phone' } })).error === 'already_registered', 'same serial (any case) cannot be registered twice');
const chk = await api('POST', '/api/check', { body: { serialNumber: ` ${SERIAL.toLowerCase()} ` } });
ok(chk.data.status === 'safe' && chk.data.certificate.certificateNumber, 'check is case/space-insensitive and returns safe');
ok(!JSON.stringify(chk.data).match(/1111111111|0511111111|Ali|buyerId|buyerName|sellerPhone|reporter/), 'check response contains no owner data');
ok((await api('POST', '/api/check', { body: { serialNumber: 'abc12' } })).data.status === 'unknown', 'a partial serial does not match');
const mine = await api('POST', '/api/entities/purchase_certificates/filter', { token: tokA, body: { query: { buyerId: A.id, status: 'active' } } });
ok(mine.status === 200 && mine.data.length === 1, 'user can list their own certificates');
ok((await api('POST', '/api/entities/purchase_certificates/filter', { token: tokB, body: { query: { buyerId: A.id } } })).status === 403, "user cannot list someone else's certificates");
ok((await api('POST', '/api/entities/purchase_certificates/filter', { token: tokB, body: { query: {} } })).status === 403, 'user cannot dump all certificates');
ok((await api('PATCH', `/api/entities/purchase_certificates/${reg.data.id}`, { token: tokB, body: { status: 'transferred' } })).status === 403, "user cannot change someone else's certificate");

// theft report ------------------------------------------------------
console.log('theft reports');
const rep = (over = {}) => ({ serialNumber: SERIAL, deviceType: 'phone', reporterNationalId: A.id, reporterPhone: A.phone, theftDate: '2026-09-10', location: 'الشرقية - الدمام - الفيصلية', theftDetails: 'x', ...over });
ok((await report(rep({ reporterNationalId: B.id, reporterPhone: B.phone }), B.phone)).error === 'reporter_not_owner', 'someone else cannot report a registered device');
{
    const before = whatsappInbox.length;
    const typedWrong = await api('POST', '/api/reports/start', { body: rep({ reporterPhone: '0500000001' }) });
    ok(typedWrong.status === 201 && whatsappInbox.length === before + 1 && whatsappInbox.at(-1).body.to === toWa(A.phone), 'a registered reporter\'s typed phone is ignored: the code goes to the phone on the account');
    ok(typedWrong.data.targets[0].maskedPhone === '05****1111', 'and only the masked number is shown');
}
ok((await report(rep({ deviceType: 'laptop' }), A.phone)).error === 'device_type_mismatch', 'wrong device type is rejected');
ok((await report(rep({ location: 'الشرقية' }), A.phone)).error === 'invalid_location', 'bad location rejected');
ok((await report(rep({ theftDate: '2999-01-01' }), A.phone)).error === 'invalid_date', 'future date rejected');
const reportRes = await report({ ...rep(), status: 'closed', reportId: 'HACK1' }, A.phone);
ok(reportRes.status === 201 && reportRes.data.status === 'active' && reportRes.data.reportId !== 'HACK1', 'report created; client-supplied status/reportId ignored', reportRes.data);
ok(!('reporterNationalId' in (reportRes.data || {})), 'report response has no reporter ID/phone');
ok((await report(rep(), A.phone)).error === 'already_reported', 'second report for the same device -> already_reported');
const stolen = await api('POST', '/api/check', { body: { serialNumber: SERIAL } });
ok(stolen.data.status === 'stolen' && stolen.data.device.theftDate === '2026-09-10', 'check now says stolen');
ok(!JSON.stringify(stolen.data).match(/1111111111|0511111111|Ali|reporter|Phone|buyerId/), 'stolen result contains no reporter data');
ok((await issue({ serialNumber: SERIAL, deviceType: 'phone', sellerId: A.id, buyerId: B.id, buyerName: 'Bader', purchasePrice: 100 }, A.phone, B.phone)).error === 'device_stolen', 'a stolen device cannot be sold');
const anonRep = await report(rep({ serialNumber: 'UNREGISTERED-0001', reporterNationalId: B.id, reporterPhone: B.phone }), B.phone);
ok(anonRep.status === 201, 'unregistered devices can still be reported (existing behavior)');

// closure -----------------------------------------------------------------
console.log('closure requests');
ok((await api('PATCH', `/api/entities/stolen_devices/${reportRes.data.id}`, { token: tokB, body: { status: 'pending_closure' } })).status === 403, "user cannot request closure of someone else's report");
ok((await api('PATCH', `/api/entities/stolen_devices/${reportRes.data.id}`, { token: tokA, body: { status: 'closed' } })).status === 403, 'user cannot close a report directly');
ok((await api('PATCH', `/api/entities/stolen_devices/${reportRes.data.id}`, { token: tokA, body: { status: 'pending_closure', closureRequestReason: 'found' } })).status === 200, 'owner can request closure');
ok((await api('POST', '/api/check', { body: { serialNumber: SERIAL } })).data.status === 'stolen', 'still reported stolen while closure is pending admin approval');
const dash = await api('GET', '/api/admin/dashboard', { token: tokAdmin });
ok(dash.status === 200 && dash.data.stolenDevices.length === 2, 'admin sees all reports');
const cert = dash.data.certificates.find((c) => c.serialNumber === SERIAL.toLowerCase());
ok(cert.status === 'stolen', 'certificate was flagged stolen by the report');
await api('PATCH', `/api/entities/stolen_devices/${reportRes.data.id}`, { token: tokAdmin, body: { status: 'closed' } });
await api('PATCH', `/api/entities/purchase_certificates/${cert.id}`, { token: tokAdmin, body: { status: 'active' } });
ok((await api('POST', '/api/check', { body: { serialNumber: SERIAL } })).data.status === 'safe', 'after admin approval the device is safe again');

// sales chain -----------------------------------------------------------
console.log('sales / ownership transfer');
const sale = (over = {}) => ({ serialNumber: SERIAL, deviceType: 'phone', sellerId: A.id, buyerId: B.id, buyerName: 'Bader', purchasePrice: 500, ...over });
const AB = [A.phone, B.phone]; // seller A, buyer B
ok((await issue(sale({ sellerId: B.id, buyerId: A.id }), B.phone, A.phone)).error === 'seller_not_owner', 'only the current owner can sell');
ok((await issue(sale({ buyerId: A.id }), A.phone, A.phone)).error === 'same_buyer_seller', 'cannot sell to yourself');
ok((await issue(sale({ buyerId: '1666666666' }), A.phone, B.phone)).error === 'buyer_not_found', 'unknown buyer rejected');
ok((await issue(sale({ deviceType: 'laptop' }), ...AB)).error === 'device_type_mismatch', 'device type must match the certificate');
ok((await issue(sale({ purchasePrice: -5 }), ...AB)).error === 'invalid_price', 'bad price rejected');

// two parties, two different codes, both required
{
    const before = whatsappInbox.length;
    const started = await api('POST', '/api/certificates/start', { body: sale({ sellerPhone: '0500000009', buyerPhone: '0500000008' }) });
    ok(started.status === 201, 'sale started', started.body);
    const msgs = whatsappInbox.slice(before);
    ok(msgs.length === 2, 'exactly two WhatsApp messages: one per party');
    ok(msgs.some((m) => m.body.to === toWa(A.phone)) && msgs.some((m) => m.body.to === toWa(B.phone)), 'seller and buyer each get a code on the phone registered to their account (typed phones ignored)');
    const codeSeller = codeSentTo(A.phone);
    const codeBuyer = codeSentTo(B.phone);
    ok(codeSeller !== codeBuyer, 'the seller\'s code and the buyer\'s code are different');
    ok(JSON.stringify(started.data.targets) === JSON.stringify([{ role: 'seller', maskedPhone: '05****1111' }, { role: 'buyer', maskedPhone: '05****2222' }]), 'the response only carries masked numbers');
    const confirm = (codes) => api('POST', '/api/actions/confirm', { body: { actionId: started.data.actionId, codes } });
    ok((await confirm({ seller: codeSeller })).status === 400, 'the seller\'s code alone is not enough');
    ok((await confirm({ seller: codeBuyer, buyer: codeSeller })).status === 400, 'codes swapped between the parties are rejected');
    const dashMid = await api('GET', '/api/admin/dashboard', { token: tokAdmin });
    ok(dashMid.data.certificates.filter((c) => c.serialNumber === SERIAL.toLowerCase() && c.status === 'active').length === 1 && !dashMid.data.certificates.some((c) => c.buyerId === B.id && c.serialNumber === SERIAL.toLowerCase()), 'nothing was transferred by the failed attempts');
    const good = await confirm({ seller: codeSeller, buyer: codeBuyer });
    ok(good.status === 201 && good.data.buyerId === B.id && good.data.status === 'active' && good.data.buyerPhone === B.phone, 'both correct codes complete the purchase (buyer phone recorded on the certificate)', good.body);
}
const s1 = { status: 201 };
void s1;

// expiry / attempts / resend
{
    const start1 = await api('POST', '/api/certificates/start', { body: sale({ sellerId: B.id, buyerId: A.id, buyerName: 'Ali' }) });
    ok(start1.status === 201, 'B -> A sale started');
    const actionId = start1.data.actionId;
    const oldSeller = codeSentTo(B.phone);
    const oldBuyer = codeSentTo(A.phone);
    ok((await api('POST', '/api/actions/resend', { body: { actionId } })).error === 'resend_cooldown', 'resend is throttled inside the cooldown');
    await sleep(2100);
    const before = whatsappInbox.length;
    const rs = await api('POST', '/api/actions/resend', { body: { actionId } });
    ok(rs.status === 200 && whatsappInbox.length === before + 2, 'resend after the cooldown sends fresh codes to both parties', rs.body);
    const newSeller = codeSentTo(B.phone);
    const newBuyer = codeSentTo(A.phone);
    ok(newSeller !== newBuyer, 'the resent codes are also different from each other');
    const oldOnes = await api('POST', '/api/actions/confirm', { body: { actionId, codes: { seller: oldSeller, buyer: oldBuyer } } });
    ok(oldOnes.status === 400 || (oldSeller === newSeller && oldBuyer === newBuyer), 'old codes stop working after a resend');
    const s2 = await api('POST', '/api/actions/confirm', { body: { actionId, codes: { seller: newSeller, buyer: newBuyer } } });
    ok(s2.status === 201 && s2.data.buyerId === A.id, 'B -> A resale works with the new codes', s2.body);
}
{
    // 5 wrong tries cancel the request
    const st = await api('POST', '/api/certificates/start', { body: sale({ serialNumber: 'STORE-ITEM-99', sellerId: '7000000001', buyerId: '1777777777', buyerName: 'Walk In', sellerPhone: '0570000001', buyerPhone: '0570000002', deviceType: 'laptop', purchasePrice: 10 }) });
    ok(st.status === 201, 'commercial sale started');
    for (let i = 0; i < 5; i += 1) await api('POST', '/api/actions/confirm', { body: { actionId: st.data.actionId, codes: { seller: '111111', buyer: '222222' } } });
    const late = await api('POST', '/api/actions/confirm', { body: { actionId: st.data.actionId, codes: { seller: codeSentTo('0570000001'), buyer: codeSentTo('0570000002') } } });
    ok(late.status === 400, 'after 5 wrong tries the right codes no longer work');
}
await sleep(3300); // let the actions above expire
const dash2 = await api('GET', '/api/admin/dashboard', { token: tokAdmin });
const forSerial = dash2.data.certificates.filter((c) => c.serialNumber === SERIAL.toLowerCase());
ok(forSerial.filter((c) => c.status === 'active').length === 1, 'exactly one active certificate per device after transfers');
ok(forSerial.length === 3, 'ownership history kept: original + two transfers');

// walk-in parties (no accounts) type their own phone
const storeSale = { serialNumber: 'STORE-ITEM-77', deviceType: 'laptop', sellerId: '7000000001', sellerPhone: '0570000001', buyerId: '1777777777', buyerName: 'Walk In', buyerPhone: '0570000002', purchasePrice: 3000 };
ok((await api('POST', '/api/certificates/start', { body: { ...storeSale, buyerPhone: '' } })).error === 'invalid_phone', 'a buyer with no account must give a phone number');
ok((await api('POST', '/api/certificates/start', { body: { ...storeSale, buyerPhone: '0570000001' } })).error === 'same_phone_number', 'seller and buyer cannot share one phone (two people, two codes)');
ok((await api('POST', '/api/certificates/start', { body: { ...storeSale, buyerName: '' } })).error === 'buyer_name_required', 'walk-in buyer needs a name');
const store = await issue(storeSale, '0570000001', '0570000002');
ok(store.status === 201, 'commercial-registration seller can sell to a buyer with no account (codes go to the typed phones)', store.body);

// a buyer with no account can still report, proving the phone recorded on the certificate
const walkInReport = (phone) => ({ serialNumber: 'STORE-ITEM-77', deviceType: 'laptop', reporterNationalId: '1777777777', reporterPhone: phone, theftDate: '2026-09-10', location: 'الشرقية - الدمام - الفيصلية' });
ok((await api('POST', '/api/reports/start', { body: walkInReport('0570009999') })).error === 'reporter_phone_mismatch', 'no-account owner: a different phone than the one on the certificate is refused');
ok((await report(walkInReport('0570000002'), '0570000002')).status === 201, 'no-account owner reports with the phone recorded at purchase');

// report from the dashboard (logged in, no code)
console.log('dashboard report (logged in)');
{
    const body = { serialNumber: SERIAL, deviceType: 'phone', theftDate: '2026-09-11', location: 'الشرقية - الدمام - الفيصلية', reporterNationalId: B.id };
    ok((await api('POST', '/api/reports/mine', { body })).status === 401, 'needs a login');
    ok((await api('POST', '/api/reports/mine', { token: tokB, body })).error === 'reporter_not_owner', 'the reporter is taken from the session: B cannot report A\'s device even when claiming to be A');
    const mineRes = await api('POST', '/api/reports/mine', { token: tokA, body });
    ok(mineRes.status === 201 && mineRes.data.reportId, 'owner reports their own device without a code');
}
ok((await api('POST', '/api/reports', { body: {} })).status === 404, 'no direct report route');
ok((await api('POST', '/api/certificates', { body: {} })).status === 404, 'no direct certificate route');

// password reset (WhatsApp one-time code) ------------------------------
console.log('password reset with WhatsApp OTP');
const requestOtp = (id, phone) => api('POST', '/api/auth/reset-otp/request', { body: { nationalId: id, phoneNumber: phone } });
const doReset = (id, phone, otp, pw = 'NewPassw0rd') => api('POST', '/api/auth/reset-password', { body: { nationalId: id, phoneNumber: phone, otp, newPassword: pw } });
const inbox0 = whatsappInbox.length;
const wrongPhone = await requestOtp(A.id, '0500000000');
ok(wrongPhone.status === 200 && wrongPhone.data.sent === true, 'wrong phone: same generic answer (no account enumeration)');
ok(whatsappInbox.length === inbox0, 'wrong phone: nothing is sent');
const adminOtp = await requestOtp(ADMIN.id, '0599999999');
ok(adminOtp.status === 200 && whatsappInbox.length === inbox0, 'admin accounts never receive a reset code');
ok((await doReset(ADMIN.id, '0599999999', '123456', 'Hacked1234')).status === 400, 'admin password cannot be reset');

const first = await requestOtp(A.id, A.phone);
ok(first.status === 200 && first.data.expiresInSeconds === 3, 'code requested', first.body);
ok(whatsappInbox.length === inbox0 + 1, 'exactly one WhatsApp message was sent');
const msg = whatsappInbox[inbox0];
ok(msg.url === '/555/messages' && msg.auth === 'Bearer test-token', 'sent through the configured phone-number id with the bearer token');
ok(msg.body.to === '966511111111' && msg.body.type === 'template' && msg.body.template.name === 'otp_ar', 'addressed to 9665XXXXXXXX using the approved template');
const code1 = lastCode();
ok(/^\d{6}$/.test(code1), '6-digit code', code1);
ok(msg.body.template.components[1]?.parameters?.[0]?.text === code1, 'code also passed to the copy-code button');
await requestOtp(A.id, A.phone);
ok(whatsappInbox.length === inbox0 + 1, 'asking again within the cooldown does not send another message');

ok((await doReset(A.id, A.phone, '000000')).error === 'invalid_code' || code1 === '000000', 'wrong code rejected');
ok((await doReset(A.id, A.phone, code1, 'short')).error === 'weak_password', 'weak new password rejected (code not consumed)');
ok((await doReset(A.id, A.phone, code1)).status === 200, 'correct code + strong password resets it');
ok((await login(A.id, 'NewPassw0rd')).status === 200, 'login with the new password');
ok((await doReset(A.id, A.phone, code1, 'AnotherPassw0rd')).status === 400, 'a code cannot be used twice');

// expiry
await sleep(2100); // past the 2s cooldown
await requestOtp(A.id, A.phone);
const code2 = lastCode();
ok(whatsappInbox.length === inbox0 + 2 && /^\d{6}$/.test(code2), 'new code after the cooldown');
await sleep(3200); // past the 3s lifetime
ok((await doReset(A.id, A.phone, code2, 'ExpiredPassw0rd')).status === 400, 'an expired code is rejected');

// too many wrong guesses kills the code
await sleep(2100);
await requestOtp(A.id, A.phone);
const code3 = lastCode();
const wrong = code3 === '111111' ? '222222' : '111111';
for (let i = 0; i < 5; i += 1) await doReset(A.id, A.phone, wrong);
ok((await doReset(A.id, A.phone, code3, 'TooManyPassw0rd')).status === 400, 'after 5 wrong guesses even the right code no longer works');
ok((await login(A.id, 'NewPassw0rd')).status === 200, 'password was not changed by any failed attempt');
ok((await api('POST', '/api/auth/validate-reset', { body: { nationalId: A.id, phoneNumber: A.phone } })).status === 404, 'no ID+phone-only check endpoint');
const tokA2 = (await login(A.id, 'NewPassw0rd')).token;
void tokA2;

// phone change (code to the new number)
console.log('phone change (code to the new number)');
{
    const D = { id: '1444555666', phone: '0544555666', newPhone: '0544777888' };
    const E = { id: '1444555777', phone: '0544555777' };
    ok((await register(D.id, 'Dana', D.phone)).status === 201 && (await register(E.id, 'Eman', E.phone)).status === 201, 'two fresh users');
    const tokD = (await login(D.id)).token;
    const tokE = (await login(E.id)).token;
    const idD = (await login(D.id)).data.id;
    const patch = (body, token = tokD) => api('PATCH', `/api/entities/app_users/${idD}`, { token, body });

    ok((await patch({ full_name: 'Dana K', phone_number: D.newPhone })).error === 'phone_change_needs_code', 'a new phone cannot be set by a plain profile edit');
    ok((await patch({ full_name: 'Dana K', phone_number: D.phone })).status === 200, 'sending the unchanged phone with other edits is fine');
    ok((await login(D.id)).data.phone_number === D.phone, 'the phone did not change');

    ok((await api('POST', '/api/profile/phone/start', { body: { phoneNumber: D.newPhone } })).status === 401, 'starting a phone change needs a login');
    ok((await api('POST', '/api/profile/phone/start', { token: tokD, body: { phoneNumber: D.phone } })).error === 'same_phone', 'the same number is refused');
    ok((await api('POST', '/api/profile/phone/start', { token: tokD, body: { phoneNumber: '12345' } })).error === 'invalid_phone', 'a malformed number is refused');

    const before = whatsappInbox.length;
    const started = await api('POST', '/api/profile/phone/start', { token: tokD, body: { phoneNumber: D.newPhone } });
    ok(started.status === 201 && started.data.targets[0].role === 'new_phone' && started.data.targets[0].maskedPhone === '05****7888', 'code started, only the masked new number is shown', started.body);
    ok(whatsappInbox.length === before + 1 && whatsappInbox.at(-1).body.to === toWa(D.newPhone), 'the code went to the new number, not the old one');
    ok((await login(D.id)).data.phone_number === D.phone, 'nothing changes before the code is confirmed');

    const confirm = (codes, token) => api('POST', '/api/actions/confirm', { token, body: { actionId: started.data.actionId, codes } });
    const code = codeSentTo(D.newPhone);
    ok((await confirm({ new_phone: code })).status === 400, 'confirming without being logged in fails');
    ok((await confirm({ new_phone: code }, tokE)).status === 400, "another user cannot confirm someone else's phone change");
    ok((await confirm({ new_phone: '000000' }, tokD)).status === 400, 'a wrong code fails');
    ok((await api('POST', '/api/actions/resend', { token: tokE, body: { actionId: started.data.actionId } })).status === 404, "another user cannot trigger a resend for it either");
    const done = await confirm({ new_phone: code }, tokD);
    ok(done.status === 200 && done.data.phone_number === D.newPhone && !('password_hash' in done.data), 'the right code, from the owner, changes the phone', done.body);
    ok((await login(D.newPhone)).status === 200 && (await login(D.phone)).status === 401, 'login by phone now uses the new number');
    const hint = await api('POST', '/api/lookup/phone-hint', { body: { nationalId: D.id } });
    ok(hint.data.maskedPhone === '05****7888', 'the phone hint (used to fill forms) now shows the new number');
    ok((await confirm({ new_phone: code }, tokD)).status === 400, 'a used code cannot be reused');
}

// rate limiting ---------------------------------------------------------
console.log('rate limiting');
{
    const ip = '203.0.113.9';
    let last = 0;
    for (let i = 0; i < 12; i += 1) last = (await api('POST', '/api/auth/login', { ip, body: { nationalId: A.id, password: 'nope' } })).status;
    ok(last === 429, 'brute-force login attempts get 429', last);
    let lastReport = 0;
    for (let i = 0; i < 12; i += 1) lastReport = (await api('POST', '/api/reports/start', { ip: '203.0.113.10', body: rep({ serialNumber: `SPAM-${i}-00000`, reporterNationalId: B.id, reporterPhone: B.phone }) })).status;
    ok(lastReport === 429, 'report spam from one IP gets 429', lastReport);
}

// run C: cap on messages per phone --------------------------------------
console.log('\n[C] per-phone message cap (protects the sending WhatsApp number)');
{
    const srvC = await startServer(3413, {
        NODE_ENV: 'development', SESSION_SECRET: 'z'.repeat(32), ADMIN_PASSWORD: 'Adm1nPass!x',
        WHATSAPP_PROVIDER: 'meta', WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '555', WHATSAPP_API_BASE: 'http://localhost:3499',
        OTP_MAX_SENDS_PER_PHONE_PER_HOUR: '2',
    });
    const apiC = client(3413);
    const start = () => apiC('POST', '/api/register/start', { body: { national_id: '1234500000', full_name: 'Cap', phone_number: '0544400000', password: 'Passw0rd1' } });
    const before = whatsappInbox.length;
    const r1 = await start();
    const r2 = await start();
    const r3 = await start();
    ok(r1.status === 201 && r2.status === 201, 'two messages to a phone within the hour are fine');
    ok(r3.status === 429 && r3.error === 'otp_rate_limited', 'a third one is refused', r3.body);
    ok(whatsappInbox.length === before + 2, 'and nothing was sent for it');
    srvC.stop();
}

srv.stop();
mockWhatsApp.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
