// Real, persistent storage for the app: SQLite via Node's built-in
// node:sqlite module (no native module to compile, no external service).
// Each table stores its rows as a JSON blob (same shape the old
// localStorage mock used) plus an id/created_at for indexing — this keeps
// every field the frontend already sends/reads working without needing a
// rigid column-per-field schema.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.sqlite');

export const TABLES = ['app_users', 'stolen_devices', 'purchase_certificates'];

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');

for (const table of TABLES) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS ${table} (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

export default db;
