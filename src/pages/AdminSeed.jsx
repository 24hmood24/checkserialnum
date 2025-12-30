import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { AppUser, PurchaseCertificate, StolenDevice } from '@/api/entities';

export default function AdminSeed() {
    const [output, setOutput] = useState('');

    const seed = async () => {
        // create demo users
        await AppUser.create({ national_id: '1000000001', full_name: 'Demo Admin', phone_number: '0500000001', user_type: 'admin', password: 'adminpass' });
        await AppUser.create({ national_id: '1000000002', full_name: 'Demo User', phone_number: '0500000002', user_type: 'regular', password: 'userpass' });

        // create demo certificate
        await PurchaseCertificate.create({ certificateNumber: '0000000001', buyerId: '1000000002', buyerName: 'Demo User', deviceType: 'phone', serialNumber: 'abc123', issueDate: new Date().toISOString(), status: 'active' });

        // create demo stolen report
        await StolenDevice.create({ serialNumber: 'stolen123', reporterNationalId: '1000000003', status: 'active', created_date: new Date().toISOString() });

        setOutput('Seeded demo users, certificate and stolen report.');
    };

    const exportData = async () => {
        const users = await AppUser.list();
        const certs = await PurchaseCertificate.list();
        const stolen = await StolenDevice.list();
        const data = { users, certs, stolen };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'site-export.json';
        a.click();
        URL.revokeObjectURL(url);
    };

    const importData = async (jsonText) => {
        try {
            const parsed = JSON.parse(jsonText);
            if (Array.isArray(parsed.users)) {
                for (const u of parsed.users) {
                    await AppUser.create(u);
                }
            }
            if (Array.isArray(parsed.certs)) {
                for (const c of parsed.certs) {
                    await PurchaseCertificate.create(c);
                }
            }
            if (Array.isArray(parsed.stolen)) {
                for (const s of parsed.stolen) {
                    await StolenDevice.create(s);
                }
            }
            setOutput('Import complete.');
        } catch (e) {
            setOutput('Invalid JSON');
        }
    };

    return (
        <div className="container mx-auto p-6">
            <h2 className="text-2xl font-bold mb-4">Admin: Seed / Import / Export</h2>
            <div className="space-x-2 mb-4">
                <Button onClick={seed}>Seed Demo Data</Button>
                <Button onClick={exportData} variant="outline">Export Data</Button>
            </div>
            <div className="mb-4">
                <label className="block mb-2">Paste JSON to import</label>
                <textarea id="importArea" className="w-full p-2 border rounded h-40" />
                <div className="mt-2">
                    <Button onClick={() => importData(document.getElementById('importArea').value)}>Import JSON</Button>
                </div>
            </div>
            {output && <div className="mt-4 p-3 bg-gray-100 rounded">{output}</div>}
        </div>
    );
}
