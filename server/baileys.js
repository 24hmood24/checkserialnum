// WhatsApp through Baileys: links one number as a device and sends the codes from it.
// The session is kept in the database; run a single instance.
// Link the number from /whatsapp-link.html (QR or pairing code).
import db from './db.js';

const AUTH_COLLECTION = 'whatsapp_auth';

let baileysModule = null;
const loadBaileys = async () => {
    baileysModule ??= await import('@whiskeysockets/baileys');
    return baileysModule;
};

const status = { state: 'stopped', qr: null, me: null, lastError: null };
let sock = null;
let started = false;
let reconnectTimer = null;
let attempts = 0;
let openWaiters = [];
let reconnectBaseMs = 1000;

export const getStatus = () => ({ ...status });

function setOpen() {
    status.state = 'open';
    status.qr = null;
    status.lastError = null;
    attempts = 0;
    const waiters = openWaiters;
    openWaiters = [];
    waiters.forEach((w) => { clearTimeout(w.timer); w.resolve(); });
}

async function clearAuth() {
    const coll = db.collection(AUTH_COLLECTION);
    const docs = await coll.find({}).toArray();
    await Promise.all(docs.map((d) => coll.deleteOne({ _id: d._id })));
}

function scheduleReconnect(delayMs) {
    if (!started) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
        connect().catch((err) => {
            status.state = 'closed';
            status.lastError = err.message;
            console.error('WhatsApp (Baileys) reconnect failed:', err.message);
            attempts += 1;
            scheduleReconnect(Math.min(30_000, reconnectBaseMs * 2 ** attempts));
        });
    }, delayMs);
}

async function connect() {
    const baileys = await loadBaileys();
    const { useDbAuthState } = await import('./baileysAuthState.js');
    const { default: pino } = await import('pino');
    const { state, saveCreds } = await useDbAuthState(db.collection(AUTH_COLLECTION));

    let version;
    try {
        ({ version } = await baileys.fetchLatestBaileysVersion());
    } catch {
        // fall back to the bundled version
    }

    status.state = 'connecting';
    const makeSocket = baileys.makeWASocket || baileys.default;
    sock = makeSocket({
        auth: state,
        ...(version ? { version } : {}),
        logger: pino({ level: process.env.BAILEYS_LOG_LEVEL || 'warn' }),
        browser: baileys.Browsers?.appropriate ? baileys.Browsers.appropriate('CheckSerialNum') : ['CheckSerialNum', 'Chrome', '1.0'],
        markOnlineOnConnect: false,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
    });
    const current = sock;

    current.ev.on('creds.update', saveCreds);
    current.ev.on('connection.update', async (update) => {
        if (current !== sock) return; // event from an old, replaced socket
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            status.qr = qr;
            status.state = 'qr';
        }
        if (connection === 'connecting' && status.state !== 'qr') status.state = 'connecting';
        if (connection === 'open') {
            status.me = current.user?.id || null;
            setOpen();
            console.log('WhatsApp (Baileys) connected.');
        }
        if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode;
            status.qr = null;
            status.lastError = lastDisconnect?.error?.message || null;
            if (code === baileys.DisconnectReason.loggedOut) {
                // unlinked from the phone: clear the session and wait for a new QR
                console.warn('WhatsApp (Baileys) was logged out -- session cleared, waiting for a new link.');
                await clearAuth();
                status.state = 'logged_out';
                status.me = null;
                scheduleReconnect(1000);
            } else {
                status.state = 'closed';
                // 515 right after pairing: reconnect now
                const immediate = code === baileys.DisconnectReason.restartRequired;
                attempts += immediate ? 0 : 1;
                scheduleReconnect(immediate ? 0 : Math.min(30_000, reconnectBaseMs * 2 ** attempts));
            }
        }
    });
}

export async function start() {
    if (started) return;
    started = true;
    try {
        await connect();
    } catch (err) {
        status.state = 'closed';
        status.lastError = err.message;
        console.error('WhatsApp (Baileys) failed to start:', err.message);
        scheduleReconnect(5000);
    }
}

export async function stop() {
    started = false;
    clearTimeout(reconnectTimer);
    try { sock?.end?.(undefined); } catch { /* already closed */ }
    sock = null;
    status.state = 'stopped';
}

export function waitUntilOpen(timeoutMs = 20_000) {
    if (status.state === 'open') return Promise.resolve();
    return new Promise((resolve, reject) => {
        const waiter = { resolve };
        waiter.timer = setTimeout(() => {
            openWaiters = openWaiters.filter((w) => w !== waiter);
            reject(new Error('WhatsApp is not connected'));
        }, timeoutMs);
        openWaiters.push(waiter);
    });
}

// ready to send? (no point waiting while the number is not linked)
export async function ensureReady(timeoutMs = 20_000) {
    if (status.state === 'open') return true;
    if (status.state === 'qr' || status.state === 'logged_out' || status.state === 'stopped') return false;
    try {
        await waitUntilOpen(timeoutMs);
        return true;
    } catch {
        return false;
    }
}

// number: international digits, e.g. 9665XXXXXXXX
export async function sendText(number, text) {
    await waitUntilOpen();
    const [found] = (await sock.onWhatsApp(number)) || [];
    if (!found || !found.exists) throw new Error('The number is not registered on WhatsApp');
    await sock.sendMessage(found.jid, { text });
}

// link with a pairing code instead of the QR
export async function requestPairingCode(phoneDigits) {
    if (status.state === 'open') throw new Error('already_linked');
    for (let i = 0; i < 50 && !(status.state === 'qr' || status.state === 'connecting') ; i += 1) {
        await new Promise((r) => setTimeout(r, 200));
    }
    if (!sock) throw new Error('not_started');
    const code = await sock.requestPairingCode(String(phoneDigits).replace(/\D/g, ''));
    return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

// unlink and start over
export async function logout() {
    try { await sock?.logout?.(); } catch { /* may already be disconnected */ }
    await clearAuth();
    status.me = null;
    status.state = 'logged_out';
    scheduleReconnect(500);
}

// --- test hooks ---
export function _useBaileysModule(mod, { reconnectBase } = {}) {
    baileysModule = mod;
    if (reconnectBase !== undefined) reconnectBaseMs = reconnectBase;
}
export const _currentSocket = () => sock;
