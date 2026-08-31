// Real, persistent, shared storage for the app: MongoDB Atlas. Unlike the
// SQLite file this replaced, data here lives outside the app's own
// container/disk — it survives redeploys and free-tier instance restarts,
// and is naturally shared across every server instance.
import { MongoClient } from 'mongodb';

// Load a local .env file if one exists (e.g. for `MONGODB_URI` in local
// dev) — a no-op when there isn't one, as in production where the host
// (Render, etc.) sets real environment variables directly.
try {
    process.loadEnvFile();
} catch {
    // no .env file — fine, env vars are expected to be set some other way
}

const uri = process.env.MONGODB_URI;
if (!uri) {
    throw new Error(
        'MONGODB_URI environment variable is required. See the "Database (MongoDB)" ' +
        'section in README.md for how to get a connection string from MongoDB Atlas.'
    );
}

export const TABLES = ['app_users', 'stolen_devices', 'purchase_certificates'];

const client = new MongoClient(uri);
await client.connect();

const dbName = process.env.MONGODB_DB_NAME || 'checkserialnum';
const db = client.db(dbName);

// Enforce national_id uniqueness the same way application code used to —
// via a real unique index now, checked by the database itself.
await db.collection('app_users').createIndex({ national_id: 1 }, { unique: true, sparse: true });

export default db;
