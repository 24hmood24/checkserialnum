import React from 'react';
import { Input } from '@/components/ui/input';

const FIELD_CLASS = 'bg-slate-200 px-3 py-2 text-base flex h-10 w-full rounded-md border border-input ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed md:text-sm';

// Phone field that follows the national ID: account found -> masked number (read-only), otherwise a normal input. hint: usePhoneHint()
export default function PhoneFromIdInput({ hint, name, value, onChange, placeholder, t }) {
    const found = hint.status === 'found';
    const loading = hint.status === 'loading';
    return (
        <div>
            <Input
                name={name}
                type="tel"
                inputMode="numeric"
                value={found ? hint.maskedPhone : loading ? '' : value}
                onChange={onChange}
                placeholder={loading ? t('phoneChecking') : placeholder}
                disabled={found || loading}
                dir="ltr"
                className={`${FIELD_CLASS} text-left ${found ? 'text-gray-700 font-semibold' : ''}`}
                required={!found}
            />
            {found && <p className="text-xs text-teal-700 mt-1">{t('phoneFromAccount')}</p>}
            {hint.status === 'none' && <p className="text-xs text-gray-500 mt-1">{t('phoneNoAccount')}</p>}
        </div>
    );
}
