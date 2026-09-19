import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MessageCircle } from 'lucide-react';

const digitsOnly = (v) => String(v || '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\D/g, '').slice(0, 6);

const formatTime = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

// Code form: one input per party that got a code (1 for registration/report, 2 for a sale).
// fields: [{ role, label, maskedPhone }]
// onConfirm(codes) -> { error? }; return { error: 'invalid_code' } to show the message and stay
// onResend() -> { error? }
export function OtpCodesForm({ t, fields, expiresInSeconds = 300, resendAfterSeconds = 60, onConfirm, onResend, onCancel }) {
    const [codes, setCodes] = useState({});
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [resendIn, setResendIn] = useState(resendAfterSeconds);
    const [expiresIn, setExpiresIn] = useState(expiresInSeconds);

    useEffect(() => {
        const timer = setInterval(() => {
            setResendIn((s) => (s > 0 ? s - 1 : 0));
            setExpiresIn((s) => (s > 0 ? s - 1 : 0));
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    const errorText = (code) => ({
        invalid_code: t('invalidOtpError'),
        rate_limited: t('tooManyAttemptsError'),
        network_error: t('otpNetworkError'),
        otp_unavailable: t('otpUnavailableError'),
        otp_rate_limited: t('otpRateLimitedError'),
        otp_send_failed: t('otpSendFailedError'),
        resend_cooldown: t('resendWaitError'),
        resend_limit: t('resendLimitError'),
        action_expired: t('otpExpiredError'),
    }[code] || t('otpGenericError'));

    const allFilled = fields.every((f) => (codes[f.role] || '').length === 6);

    const submit = async (e) => {
        e.preventDefault();
        if (!allFilled) {
            setError(t('invalidOtpFormat'));
            return;
        }
        setBusy(true);
        setError('');
        const result = await onConfirm(codes);
        setBusy(false);
        if (result && result.error) setError(errorText(result.error));
    };

    const resend = async () => {
        setBusy(true);
        setError('');
        const result = await onResend();
        setBusy(false);
        if (result && result.error) {
            setError(errorText(result.error));
        } else {
            setCodes({});
            setResendIn(resendAfterSeconds);
            setExpiresIn(expiresInSeconds);
        }
    };

    return (
        <form onSubmit={submit} className="space-y-4">
            <div className="flex items-start gap-2 text-sm text-teal-800 bg-teal-50 border border-teal-200 rounded-md p-3">
                <MessageCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{t('otpDialogDescription')}</span>
            </div>

            {fields.map((f) => (
                <div key={f.role}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{f.label}</label>
                    {f.maskedPhone && (
                        <p className="text-xs text-gray-500 mb-1" dir="ltr" style={{ textAlign: 'start' }}>
                            {t('otpSentTo').replace('{phone}', f.maskedPhone)}
                        </p>
                    )}
                    <Input
                        type="tel"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={codes[f.role] || ''}
                        onChange={(e) => setCodes((prev) => ({ ...prev, [f.role]: digitsOnly(e.target.value) }))}
                        placeholder="123456"
                        dir="ltr"
                        className="text-center tracking-[0.5em] text-lg"
                        required
                    />
                </div>
            ))}

            <p className={`text-xs text-center ${expiresIn === 0 ? 'text-red-600' : 'text-gray-500'}`}>
                {expiresIn === 0 ? t('otpExpired') : t('otpExpiresIn').replace('{time}', formatTime(expiresIn))}
            </p>

            {error && <p className="text-red-600 text-sm text-center">{error}</p>}

            <Button type="submit" disabled={busy || !allFilled} className="w-full">
                {busy ? t('confirming') : t('confirmOtpButton')}
            </Button>

            <div className="flex items-center justify-between text-sm">
                <button
                    type="button"
                    onClick={resend}
                    disabled={busy || resendIn > 0}
                    className="text-teal-600 hover:underline disabled:text-gray-400 disabled:no-underline"
                >
                    {resendIn > 0 ? t('resendOtpIn').replace('{seconds}', String(resendIn)) : t('resendOtp')}
                </button>
                {onCancel && (
                    <button type="button" onClick={onCancel} disabled={busy} className="text-gray-500 hover:underline">
                        {t('cancel')}
                    </button>
                )}
            </div>
        </form>
    );
}

// dialog wrapper; session = { title, fields, expiresInSeconds, resendAfterSeconds } or null
export default function OtpDialog({ session, t, lang = 'ar', onCancel, onConfirm, onResend }) {
    return (
        <Dialog open={Boolean(session)} onOpenChange={(open) => { if (!open) onCancel(); }}>
            <DialogContent className="sm:max-w-md" dir={lang === 'ar' ? 'rtl' : 'ltr'} onInteractOutside={(e) => e.preventDefault()}>
                <DialogHeader>
                    <DialogTitle className="text-center text-lg font-bold">{session?.title}</DialogTitle>
                    <DialogDescription className="sr-only">{t('otpDialogDescription')}</DialogDescription>
                </DialogHeader>
                {session && (
                    <div className="p-2">
                        <OtpCodesForm
                            key={session.actionId}
                            t={t}
                            fields={session.fields}
                            expiresInSeconds={session.expiresInSeconds}
                            resendAfterSeconds={session.resendAfterSeconds}
                            onConfirm={onConfirm}
                            onResend={onResend}
                            onCancel={onCancel}
                        />
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
