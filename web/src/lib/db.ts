import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), '..', 'data', 'chain-radar.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH, { readonly: false });
  _db.pragma('journal_mode = WAL');
  _db.exec(`
    CREATE TABLE IF NOT EXISTS wallet_names (
      address TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return _db;
}

export function getWalletNames(): Record<string, string> {
  const db = getDb();
  const rows = db.prepare('SELECT address, name FROM wallet_names').all() as { address: string; name: string }[];
  return Object.fromEntries(rows.map(r => [r.address, r.name]));
}

export function setWalletName(address: string, name: string) {
  const db = getDb();
  if (name.trim() === '') {
    db.prepare('DELETE FROM wallet_names WHERE address = ?').run(address.toLowerCase());
  } else {
    db.prepare('INSERT OR REPLACE INTO wallet_names (address, name) VALUES (?, ?)').run(address.toLowerCase(), name.trim());
  }
}
