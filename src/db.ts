import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import path from 'path';
import { DECIMALS } from './config.js';
import type { ClassifiedTx, HolderPosition } from './types.js';

const DB_PATH = path.join(process.cwd(), 'data', 'chain-radar.db');

function toFloat(amount: bigint): number {
  return Number(amount) / 10 ** DECIMALS;
}

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  initSchema(_db);
  return _db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      tx_hash TEXT NOT NULL,
      block_number INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      type TEXT NOT NULL,
      user_addr TEXT NOT NULL,
      counterparty TEXT NOT NULL,
      fat_amount REAL NOT NULL,
      virtual_amount REAL NOT NULL,
      usd_amount REAL NOT NULL,
      PRIMARY KEY (tx_hash, user_addr, type)
    );

    CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_addr);
    CREATE INDEX IF NOT EXISTS idx_tx_block ON transactions(block_number);

    CREATE TABLE IF NOT EXISTS holders (
      address TEXT PRIMARY KEY,
      rank INTEGER NOT NULL,
      balance REAL NOT NULL,
      total_bought REAL NOT NULL,
      total_sold REAL NOT NULL,
      total_cost_virtual REAL NOT NULL,
      total_cost_usd REAL NOT NULL,
      avg_cost_usd REAL NOT NULL,
      current_value_usd REAL NOT NULL,
      unrealized_pnl REAL NOT NULL,
      realized_pnl REAL NOT NULL DEFAULT 0,
      buy_market_cap REAL NOT NULL DEFAULT 0,
      last_tx_timestamp INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS wallet_names (
      address TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
  `);
}

export function getLastScannedBlock(): bigint | null {
  const db = getDb();
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('last_scanned_block') as
    | { value: string }
    | undefined;
  return row ? BigInt(row.value) : null;
}

export function setLastScannedBlock(block: bigint) {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
    'last_scanned_block',
    block.toString()
  );
}

export function saveTransactions(txs: ClassifiedTx[]) {
  const db = getDb();
  const insert = db.prepare(`
    INSERT OR REPLACE INTO transactions
    (tx_hash, block_number, timestamp, type, user_addr, counterparty, fat_amount, virtual_amount, usd_amount)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const batch = db.transaction((items: ClassifiedTx[]) => {
    for (const tx of items) {
      insert.run(
        tx.txHash,
        Number(tx.blockNumber),
        tx.timestamp,
        tx.type,
        tx.user,
        tx.counterparty,
        toFloat(tx.fatAmount),
        tx.virtualAmount,
        tx.usdAmount
      );
    }
  });

  batch(txs);
}

export function saveHolders(
  holders: Map<string, HolderPosition>,
  currentFatPriceUsd: number
) {
  const db = getDb();
  db.exec('DELETE FROM holders');

  const insert = db.prepare(`
    INSERT INTO holders
    (address, rank, balance, total_bought, total_sold, total_cost_virtual, total_cost_usd, avg_cost_usd, current_value_usd, unrealized_pnl, realized_pnl, buy_market_cap, last_tx_timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const sorted = [...holders.values()]
    .filter((h) => h.balance > 0n)
    .sort((a, b) => (a.balance > b.balance ? -1 : a.balance < b.balance ? 1 : 0));

  const batch = db.transaction(() => {
    for (let i = 0; i < sorted.length; i++) {
      const h = sorted[i];
      const balance = toFloat(h.balance);
      const currentValue = balance * currentFatPriceUsd;
      const avgCostPerToken = balance > 0 ? h.totalCostUsd / balance : 0;
      const buyMarketCap = avgCostPerToken * 1_000_000_000;
      insert.run(
        h.address,
        i + 1,
        balance,
        toFloat(h.totalBought),
        toFloat(h.totalSold),
        h.totalCostVirtual,
        h.totalCostUsd,
        avgCostPerToken,
        currentValue,
        currentValue - h.totalCostUsd,
        h.realizedPnl,
        buyMarketCap,
        h.lastTxTimestamp
      );
    }
  });

  batch();
}

export function saveSummary(summary: Record<string, any>) {
  const db = getDb();
  const upsert = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  const batch = db.transaction(() => {
    for (const [key, value] of Object.entries(summary)) {
      upsert.run(`summary_${key}`, String(value));
    }
  });
  batch();
}

export function getWalletNames(): Map<string, string> {
  const db = getDb();
  const rows = db.prepare('SELECT address, name FROM wallet_names').all() as { address: string; name: string }[];
  return new Map(rows.map(r => [r.address, r.name]));
}

export function setWalletName(address: string, name: string) {
  const db = getDb();
  if (name.trim() === '') {
    db.prepare('DELETE FROM wallet_names WHERE address = ?').run(address.toLowerCase());
  } else {
    db.prepare('INSERT OR REPLACE INTO wallet_names (address, name) VALUES (?, ?)').run(address.toLowerCase(), name.trim());
  }
}
