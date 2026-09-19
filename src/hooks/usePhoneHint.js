import { useEffect, useState } from 'react';
import { getPhoneHint } from '@/api/functions';

// Looks up the masked phone for a 10-digit national ID.
// status: idle | loading | found | none
export function usePhoneHint(nationalId) {
    const [hint, setHint] = useState({ status: 'idle', maskedPhone: null });

    useEffect(() => {
        const id = String(nationalId || '');
        if (id.length !== 10) {
            setHint({ status: 'idle', maskedPhone: null });
            return undefined;
        }
        let cancelled = false;
        setHint({ status: 'loading', maskedPhone: null });
        const timer = setTimeout(async () => {
            const { data } = await getPhoneHint(id);
            if (cancelled) return;
            if (data && data.exists && data.hasPhone) setHint({ status: 'found', maskedPhone: data.maskedPhone });
            else setHint({ status: 'none', maskedPhone: null });
        }, 300);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [nationalId]);

    return hint;
}
