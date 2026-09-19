// MongoDB connection

// load .env if there is one (local development)
try {
    process.loadEnvFile();
} catch {
    // no .env file, environment variables come from the host
}

export const TABLES = ['app_users', 'stolen_devices', 'purchase_certificates'];

let db;
if (process.env.USE_MEMORY_DB === '1') {
    // development/tests only: in-memory database (memoryDb.js)
    console.warn('USE_MEMORY_DB=1 -- using a throwaway in-memory database.');
    const { createMemoryDb } = await import('./memoryDb.js');
    db = createMemoryDb();
} else {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        throw new Error(
            'MONGODB_URI environment variable is required. See the "Database (MongoDB)" ' +
            'section in README.md for how to get a connection string from MongoDB Atlas.'
        );
    }
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(uri);
    await client.connect();
    db = client.db(process.env.MONGODB_DB_NAME || 'checkserialnum');
}

// national_id must be unique
await db.collection('app_users').createIndex({ national_id: 1 }, { unique: true, sparse: true });

export default db;
