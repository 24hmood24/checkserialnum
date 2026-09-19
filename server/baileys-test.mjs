// Baileys tests with a fake socket (no WhatsApp needed): auth state, connection handling, sending.
// Run: node server/baileys-test.mjs
process.env.USE_MEMORY_DB = '1';
process.env.NODE_ENV = 'development';

import { EventEmitter } from 'node:events';
import { BufferJSON, initAuthCreds } from '@whiskeysockets/baileys';

let passed = 0;
let failed = 0;
const ok = (cond, name, extra) => {
    if (cond) { passed += 1; console.log(`  ok   ${name}`); }
    else { failed += 1; console.log(`  FAIL ${name}${extra !== undefined ? `  -> ${JSON.stringify(extra)}` : ''}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
void BufferJSON;

const { default: db } = await import('./db.js');
const { useDbAuthState } = await import('./baileysAuthState.js');

// -------------------------------------------------------------- auth state
console.log('\ndatabase-backed auth state');
{
    const coll = db.collection('test_auth');
    const first = await useDbAuthState(coll);
    ok(Buffer.isBuffer(first.state.creds.noiseKey.private), 'fresh credentials are generated');
    const originalNoise = Buffer.from(first.state.creds.noiseKey.private);
    await first.saveCreds();
    await first.state.keys.set({
        'pre-key': { 7: { public: Buffer.from([1, 2, 3]), private: Buffer.from([4, 5, 6]) } },
        'app-state-sync-key': { abc: { keyData: Buffer.from([9, 9, 9]) } },
    });

    const second = await useDbAuthState(coll);
    ok(second.state.creds.noiseKey.private.equals(originalNoise), 'credentials survive a restart (Buffers round-trip)');
    const keys = await second.state.keys.get('pre-key', ['7', '8']);
    ok(keys['7'].public.equals(Buffer.from([1, 2, 3])) && keys['7'].private.equals(Buffer.from([4, 5, 6])), 'signal keys round-trip as Buffers');
    ok(keys['8'] === null, 'missing keys come back as null');
    const sync = await second.state.keys.get('app-state-sync-key', ['abc']);
    ok(Buffer.from(sync.abc.keyData).equals(Buffer.from([9, 9, 9])), 'app-state-sync keys are rebuilt as protobuf objects');
    await second.state.keys.set({ 'pre-key': { 7: null } });
    const third = await useDbAuthState(coll);
    ok((await third.state.keys.get('pre-key', ['7']))['7'] === null, 'setting a key to null deletes it');
    void initAuthCreds;
}

// ------------------------------------------------------- connection manager
console.log('\nconnection manager (fake socket)');
const baileys = await import('./baileys.js');
const sockets = [];
const sent = [];
let registered = new Set(['966511111111']);

function fakeMakeSocket() {
    const ev = new EventEmitter();
    const sock = {
        ev: { on: (n, f) => ev.on(n, f), emit: (n, p) => ev.emit(n, p) },
        user: { id: '966599999999:3@s.whatsapp.net' },
        onWhatsApp: async (number) => [{ jid: `${number}@s.whatsapp.net`, exists: registered.has(number) }],
        sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'x' } }; },
        requestPairingCode: async (phone) => { sock.pairedPhone = phone; return 'ABCD1234'; },
        logout: async () => { sock.loggedOut = true; },
        end: () => {},
    };
    sockets.push(sock);
    return sock;
}
baileys._useBaileysModule({
    makeWASocket: fakeMakeSocket,
    fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 1] }),
    DisconnectReason: { loggedOut: 401, restartRequired: 515 },
    Browsers: { appropriate: () => ['CheckSerialNum', 'Chrome', '1'] },
}, { reconnectBase: 10 });

await baileys.start();
ok(sockets.length === 1 && baileys.getStatus().state === 'connecting', 'starts and begins connecting');
ok((await baileys.ensureReady(50)) === false, 'not ready while connecting (times out quickly)');

sockets[0].ev.emit('connection.update', { qr: 'QR-DATA-1' });
ok(baileys.getStatus().state === 'qr' && baileys.getStatus().qr === 'QR-DATA-1', 'exposes the QR to link the number');
ok((await baileys.ensureReady()) === false, 'while waiting for a scan: not ready and answers immediately');
ok((await baileys.requestPairingCode('0511111111'.replace(/^0/, '966'))) === 'ABCD-1234' && sockets[0].pairedPhone === '966511111111', 'pairing code is requested for the phone and formatted XXXX-XXXX');

sockets[0].ev.emit('connection.update', { connection: 'open' });
const st = baileys.getStatus();
ok(st.state === 'open' && st.qr === null && st.me === '966599999999:3@s.whatsapp.net', 'open: QR cleared, linked number known');
ok((await baileys.ensureReady()) === true, 'ready once open');
ok((await baileys.requestPairingCode('966511111111').catch((e) => e.message)) === 'already_linked', 'cannot pair again while linked');

await baileys.sendText('966511111111', 'hello 123456');
ok(sent.length === 1 && sent[0].jid === '966511111111@s.whatsapp.net' && sent[0].content.text === 'hello 123456', 'message goes to the WhatsApp JID with the text');
ok((await baileys.sendText('966500000000', 'x').catch((e) => e.message)).includes('not registered on WhatsApp'), 'a number without WhatsApp is rejected before sending');
ok(sent.length === 1, 'nothing was sent to the unregistered number');

// dropped connection -> reconnect with a new socket
sockets[0].ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 408 }, message: 'timeout' } } });
ok(baileys.getStatus().state === 'closed', 'connection drop is reflected');
await sleep(80);
ok(sockets.length === 2, 'it reconnects with a fresh socket by itself');
sockets[1].ev.emit('connection.update', { connection: 'open' });
ok(baileys.getStatus().state === 'open', 'open again after the reconnect');
sockets[0].ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } });
ok(baileys.getStatus().state === 'open', 'events from the old socket are ignored');

// a message sent while reconnecting waits for the connection
sockets[1].ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 428 } } } });
const pending = baileys.sendText('966511111111', 'queued');
await sleep(80);
sockets.at(-1).ev.emit('connection.update', { connection: 'open' });
await pending;
ok(sent.at(-1).content.text === 'queued', 'a send issued during a reconnect waits for the connection, then goes out');

// logged out from the phone -> session wiped, new QR flow
const authColl = db.collection('whatsapp_auth');
await authColl.replaceOne({ _id: 'creds' }, { _id: 'creds', value: '{}' }, { upsert: true });
const before = sockets.length;
sockets.at(-1).ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } });
await sleep(1200);
ok(baileys.getStatus().state !== 'open' && sockets.length === before + 1, 'logged out: it starts a brand-new link flow');
ok((await authColl.findOne({ _id: 'creds' })) === null || (await authColl.findOne({ _id: 'creds' })).value !== '{}', 'logged out: the old session was wiped from the database');
ok((await baileys.ensureReady()) === false, 'logged out: not ready');

// --------------------------------------------------- whatsapp.js integration
console.log('\nwhatsapp.js with WHATSAPP_PROVIDER=baileys');
process.env.WHATSAPP_PROVIDER = 'baileys';
const whatsapp = await import('./whatsapp.js');
ok(whatsapp.isConfigured() && whatsapp.describeProvider() === 'baileys', 'provider selected');
sockets.at(-1).ev.emit('connection.update', { connection: 'open' });
ok((await whatsapp.ensureReady()) === true, 'ensureReady follows the connection');
await whatsapp.sendOtp('966511111111', '482913', { minutes: 5 });
const msg = sent.at(-1).content.text;
ok(msg.includes('482913') && msg.includes('5') && msg.includes('كلمة المرور'), 'OTP text contains the code, the validity and Arabic wording', msg);
ok(sent.at(-1).jid === '966511111111@s.whatsapp.net', 'delivered to the right number');

await whatsapp.sendOtp('966511111111', '111222', { minutes: 5, purpose: 'purchase_seller' });
ok(sent.at(-1).content.text.includes('رمز البائع') && sent.at(-1).content.text.includes('111222'), 'purchase codes say who they are for: seller');
await whatsapp.sendOtp('966511111111', '333444', { minutes: 5, purpose: 'purchase_buyer' });
ok(sent.at(-1).content.text.includes('رمز المشتري'), 'purchase codes say who they are for: buyer');
await whatsapp.sendOtp('966511111111', '555666', { minutes: 5, purpose: 'report' });
ok(sent.at(-1).content.text.includes('بلاغ'), 'report code says what it confirms');
await whatsapp.sendOtp('966511111111', '777888', { minutes: 5, purpose: 'register' });
ok(sent.at(-1).content.text.includes('تسجيل حساب'), 'registration code says what it confirms');

await baileys.stop();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
