// Sends the WhatsApp codes.
// WHATSAPP_PROVIDER: meta (WhatsApp Business Cloud API, needs an approved template),
// baileys (WhatsApp Web linked to one number, see baileys.js) or console (prints the code in the log, testing only).
// If unset: meta when its credentials exist, console in development, nothing in production (503).
const provider = () => {
    const explicit = (process.env.WHATSAPP_PROVIDER || '').trim().toLowerCase();
    if (explicit) return explicit;
    if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) return 'meta';
    return process.env.NODE_ENV === 'production' ? '' : 'console';
};

export function isConfigured() {
    const p = provider();
    if (p === 'console' || p === 'baileys') return true;
    if (p === 'meta') return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
    return false;
}

async function sendViaMeta(to, code) {
    const base = (process.env.WHATSAPP_API_BASE || 'https://graph.facebook.com/v21.0').replace(/\/$/, '');
    const template = {
        name: process.env.WHATSAPP_TEMPLATE_NAME || 'otp_code',
        language: { code: process.env.WHATSAPP_TEMPLATE_LANG || 'ar' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: code }] }],
    };
    // authentication templates have a copy-code button; set WHATSAPP_TEMPLATE_BUTTON=false if yours has none
    if ((process.env.WHATSAPP_TEMPLATE_BUTTON || 'true').toLowerCase() !== 'false') {
        template.components.push({
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: code }],
        });
    }
    const res = await fetch(`${base}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'template', template }),
        signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // log only the provider's message
        throw new Error(`WhatsApp API ${res.status}: ${body?.error?.message || 'request failed'}`);
    }
}

// what each code is for (Arabic, English)
const PURPOSES = {
    reset: ['لإعادة تعيين كلمة المرور', 'to reset your password'],
    register: ['لتأكيد رقم جوالك وتسجيل حساب جديد', 'to confirm your mobile number and create an account'],
    report: ['لتأكيد رفع بلاغ سرقة', 'to confirm filing a theft report'],
    phone_change: ['لتأكيد رقم الجوال الجديد لحسابك', 'to confirm the new mobile number for your account'],
    purchase_seller: ['لتأكيد عملية بيع جهاز (رمز البائع)', 'to confirm a device sale (seller code)'],
    purchase_buyer: ['لتأكيد عملية شراء جهاز (رمز المشتري)', 'to confirm a device purchase (buyer code)'],
};

const otpText = (code, minutes, purpose = 'reset') => {
    const [ar, en] = PURPOSES[purpose] || PURPOSES.reset;
    return `🔐 نظام فحص الأجهزة\n` +
        `رمز التحقق ${ar}: *${code}*\n` +
        `صالح لمدة ${minutes} دقائق ويُستخدم مرة واحدة. لا تشاركه مع أي شخص.\n\n` +
        `Your verification code ${en}: *${code}* (valid for ${minutes} minutes, single use). Do not share it with anyone.`;
};

// called at server start
export async function startProvider() {
    if (provider() === 'baileys') {
        const baileys = await import('./baileys.js');
        await baileys.start();
    }
}

// can a code be delivered right now?
export async function ensureReady() {
    if (provider() === 'baileys') {
        const baileys = await import('./baileys.js');
        return baileys.ensureReady();
    }
    return isConfigured();
}

// to: international number without + (9665XXXXXXXX)
export async function sendOtp(to, code, { minutes = 5, purpose = 'reset' } = {}) {
    const p = provider();
    if (p === 'meta') return sendViaMeta(to, code);
    if (p === 'baileys') {
        const baileys = await import('./baileys.js');
        return baileys.sendText(to, otpText(code, minutes, purpose));
    }
    if (p === 'console') {
        console.log(`[OTP:console] WhatsApp code for ${to}: ${code}`);
        return undefined;
    }
    throw new Error('No WhatsApp provider configured');
}

export function describeProvider() {
    return provider() || 'none';
}
