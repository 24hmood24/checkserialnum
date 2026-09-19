// Baileys auth state stored in the database (the file-based one is lost when the disk is reset).
// This data is the linked WhatsApp session, keep database access private.
import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';

export async function useDbAuthState(collection) {
    const write = (id, value) => collection.replaceOne(
        { _id: id },
        { _id: id, value: JSON.stringify(value, BufferJSON.replacer) },
        { upsert: true },
    );
    const read = async (id) => {
        const doc = await collection.findOne({ _id: id });
        return doc ? JSON.parse(doc.value, BufferJSON.reviver) : null;
    };
    const remove = (id) => collection.deleteOne({ _id: id });

    const creds = (await read('creds')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(ids.map(async (id) => {
                        let value = await read(`${type}-${id}`);
                        if (type === 'app-state-sync-key' && value) {
                            value = proto.Message.AppStateSyncKeyData.fromObject(value);
                        }
                        data[id] = value;
                    }));
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category of Object.keys(data)) {
                        for (const id of Object.keys(data[category])) {
                            const value = data[category][id];
                            tasks.push(value ? write(`${category}-${id}`, value) : remove(`${category}-${id}`));
                        }
                    }
                    await Promise.all(tasks);
                },
            },
        },
        saveCreds: () => write('creds', creds),
    };
}
