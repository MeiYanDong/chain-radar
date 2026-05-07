import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import path from 'path';
import { DECIMALS } from './config.js';
import type { ClassifiedTx, HolderPosition } from './types.js';
import type { SelectionAgentRow } from './selection.js';

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'chain-radar.db');

function toFloat(amount: bigint): number {
  return Number(amount) / 10 ** DECIMALS;
}

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  initBaseTables(_db);
  migrateAddTokenColumn(_db);
  migrateBuybackEventColumns(_db);
  migratePotMarketSnapshotColumns(_db);
  createIndexes(_db);
  return _db;
}

function initBaseTables(db: Database.Database) {
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

    CREATE TABLE IF NOT EXISTS pot_pnl_snapshots (
      agent_name TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      live_pnl REAL NOT NULL,
      season_id TEXT NOT NULL,
      PRIMARY KEY (agent_name, timestamp)
    );

    CREATE TABLE IF NOT EXISTS pot_agent_snapshots (
      season_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      official_rank INTEGER NOT NULL,
      pot_id TEXT,
      pot_name TEXT NOT NULL,
      pot_status TEXT,
      season_entry_id TEXT,
      copy_trade_agent_id TEXT,
      copy_trade_agent_wallet TEXT,
      token_symbol TEXT NOT NULL,
      virtual_id INTEGER,
      starting_capital REAL NOT NULL,
      current_value REAL NOT NULL,
      live_pnl REAL NOT NULL,
      realized_pnl REAL NOT NULL,
      unrealized_pnl REAL NOT NULL,
      season_status TEXT NOT NULL,
      subscriber_count INTEGER,
      positions_json TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      PRIMARY KEY (season_id, agent_name, timestamp)
    );

    CREATE TABLE IF NOT EXISTS pot_agent_raw_snapshots (
      season_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      official_rank INTEGER NOT NULL,
      pot_id TEXT,
      pot_name TEXT NOT NULL,
      token_symbol TEXT NOT NULL,
      virtual_id INTEGER,
      starting_capital REAL,
      current_value REAL,
      live_pnl REAL,
      realized_pnl REAL,
      unrealized_pnl REAL,
      season_status TEXT NOT NULL,
      valid INTEGER NOT NULL,
      invalid_reason TEXT,
      raw_json TEXT NOT NULL,
      PRIMARY KEY (season_id, agent_name, timestamp)
    );

    CREATE TABLE IF NOT EXISTS pot_market_snapshots (
      season_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      official_rank INTEGER NOT NULL,
      token_symbol TEXT NOT NULL,
      virtual_id INTEGER,
      starting_capital REAL NOT NULL,
      current_value REAL NOT NULL,
      live_pnl REAL NOT NULL,
      realized_pnl REAL NOT NULL,
      unrealized_pnl REAL NOT NULL,
      token_price_virtual REAL,
      virtual_usd REAL,
      token_price_usd REAL,
      market_cap_usd REAL,
      fdv_usd REAL,
      liquidity_usd REAL,
      volume_24h_usd REAL,
      data_source TEXT NOT NULL,
      PRIMARY KEY (season_id, agent_name, timestamp)
    );

    CREATE TABLE IF NOT EXISTS selection_score_snapshots (
      agent_key TEXT NOT NULL,
      token TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      search_name TEXT NOT NULL,
      virtual_id INTEGER,
      timestamp INTEGER NOT NULL,
      selected_now INTEGER NOT NULL,
      selection_rank INTEGER NOT NULL,
      selection_level TEXT NOT NULL,
      selection_score REAL NOT NULL,
      target_position_u REAL NOT NULL,
      selection_parts_json TEXT NOT NULL,
      PRIMARY KEY (agent_key, timestamp)
    );

    CREATE TABLE IF NOT EXISTS position_advice_snapshots (
      agent_key TEXT NOT NULL,
      token TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      target_position_u REAL NOT NULL,
      position_stage TEXT NOT NULL,
      reason TEXT NOT NULL,
      metrics_json TEXT NOT NULL,
      PRIMARY KEY (agent_key, timestamp)
    );

	    CREATE TABLE IF NOT EXISTS buyback_events (
	      tx_hash TEXT NOT NULL,
	      token_address TEXT NOT NULL,
	      token_symbol TEXT NOT NULL,
	      timestamp INTEGER NOT NULL,
      token_amount REAL NOT NULL,
      virtual_spent REAL NOT NULL,
	      market_address TEXT,
	      approval_spender_address TEXT,
	      detected_at_ms INTEGER,
	      trigger_source TEXT,
	      buyer_address TEXT,
	      virtual_spent_usd REAL,
	      threshold_virtual REAL,
	      threshold_usd REAL,
	      PRIMARY KEY (tx_hash, token_address)
	    );

	    CREATE TABLE IF NOT EXISTS auto_sell_executions (
	      trigger_tx_hash TEXT NOT NULL,
	      token_address TEXT NOT NULL,
	      token_symbol TEXT NOT NULL,
	      buyback_timestamp INTEGER NOT NULL,
	      detected_at_ms INTEGER,
	      wallet_address TEXT,
	      market_address TEXT,
	      approval_spender_address TEXT,
	      status TEXT NOT NULL,
	      token_amount TEXT,
	      amount_out_min TEXT,
	      approve_tx_hash TEXT,
	      sell_tx_hash TEXT,
	      detected_to_submit_ms INTEGER,
	      error TEXT,
	      sell_receipt_status TEXT,
	      created_at INTEGER NOT NULL,
	      updated_at INTEGER NOT NULL,
	      PRIMARY KEY (trigger_tx_hash, token_address)
	    );

	    CREATE TABLE IF NOT EXISTS notification_outbox (
	      id INTEGER PRIMARY KEY AUTOINCREMENT,
	      dedupe_key TEXT NOT NULL UNIQUE,
      channel TEXT NOT NULL DEFAULT 'feishu',
      status TEXT NOT NULL DEFAULT 'pending',
      title TEXT NOT NULL,
      template TEXT NOT NULL,
      token_url TEXT,
      fields_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      next_attempt_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      sent_at INTEGER,
      last_error TEXT
    );
  `);
}

function createIndexes(db: Database.Database) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_addr);
    CREATE INDEX IF NOT EXISTS idx_tx_block ON transactions(block_number);
    CREATE INDEX IF NOT EXISTS idx_tx_token ON transactions(token);
    CREATE INDEX IF NOT EXISTS idx_pot_agent_snapshots_time ON pot_agent_snapshots(timestamp);
    CREATE INDEX IF NOT EXISTS idx_pot_agent_snapshots_season_time ON pot_agent_snapshots(season_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_pot_agent_snapshots_agent_time ON pot_agent_snapshots(agent_name, timestamp);
    CREATE INDEX IF NOT EXISTS idx_pot_agent_raw_snapshots_time ON pot_agent_raw_snapshots(timestamp);
    CREATE INDEX IF NOT EXISTS idx_pot_agent_raw_snapshots_valid_time ON pot_agent_raw_snapshots(valid, timestamp);
    CREATE INDEX IF NOT EXISTS idx_pot_market_snapshots_time ON pot_market_snapshots(timestamp);
    CREATE INDEX IF NOT EXISTS idx_pot_market_snapshots_agent_time ON pot_market_snapshots(agent_name, timestamp);
    CREATE INDEX IF NOT EXISTS idx_pot_market_snapshots_token_time ON pot_market_snapshots(token_symbol, timestamp);
    CREATE INDEX IF NOT EXISTS idx_selection_snapshots_time ON selection_score_snapshots(timestamp);
    CREATE INDEX IF NOT EXISTS idx_selection_snapshots_agent_time ON selection_score_snapshots(agent_key, timestamp);
    CREATE INDEX IF NOT EXISTS idx_position_advice_time ON position_advice_snapshots(timestamp);
	    CREATE INDEX IF NOT EXISTS idx_position_advice_agent_time ON position_advice_snapshots(agent_key, timestamp);
	    CREATE INDEX IF NOT EXISTS idx_buyback_events_time ON buyback_events(timestamp);
	    CREATE INDEX IF NOT EXISTS idx_auto_sell_executions_time ON auto_sell_executions(buyback_timestamp);
	    CREATE INDEX IF NOT EXISTS idx_auto_sell_executions_status ON auto_sell_executions(status, updated_at);
	    CREATE INDEX IF NOT EXISTS idx_notification_outbox_status_due ON notification_outbox(status, next_attempt_at);
	  `);
}

function migrateAddTokenColumn(db: Database.Database) {
  const cols = db.prepare("PRAGMA table_info(transactions)").all() as { name: string }[];
  const hasToken = cols.some(c => c.name === 'token');
  if (hasToken) return;

  // Recreate transactions with token column and new primary key
  db.exec(`
    ALTER TABLE transactions RENAME TO transactions_old;
    CREATE TABLE transactions (
      tx_hash TEXT NOT NULL,
      block_number INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      type TEXT NOT NULL,
      user_addr TEXT NOT NULL,
      counterparty TEXT NOT NULL,
      fat_amount REAL NOT NULL,
      virtual_amount REAL NOT NULL,
      usd_amount REAL NOT NULL,
      token TEXT NOT NULL DEFAULT 'FAT',
      PRIMARY KEY (tx_hash, user_addr, type, token)
    );
    INSERT INTO transactions SELECT *, 'FAT' FROM transactions_old;
    DROP TABLE transactions_old;

    ALTER TABLE holders RENAME TO holders_old;
    CREATE TABLE holders (
      address TEXT NOT NULL,
      token TEXT NOT NULL DEFAULT 'FAT',
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
      last_tx_timestamp INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (address, token)
    );
    INSERT INTO holders SELECT address, 'FAT', rank, balance, total_bought, total_sold, total_cost_virtual, total_cost_usd, avg_cost_usd, current_value_usd, unrealized_pnl, realized_pnl, buy_market_cap, last_tx_timestamp FROM holders_old;
    DROP TABLE holders_old;

    UPDATE meta SET key = 'last_scanned_block_FAT' WHERE key = 'last_scanned_block';
    UPDATE meta SET key = 'FAT_last_updated' WHERE key = 'last_updated';
  `);
}

function addColumnIfMissing(db: Database.Database, table: string, column: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((col) => col.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migrateBuybackEventColumns(db: Database.Database) {
  addColumnIfMissing(db, 'buyback_events', 'market_address', 'TEXT');
  addColumnIfMissing(db, 'buyback_events', 'approval_spender_address', 'TEXT');
  addColumnIfMissing(db, 'buyback_events', 'detected_at_ms', 'INTEGER');
  addColumnIfMissing(db, 'buyback_events', 'trigger_source', 'TEXT');
  addColumnIfMissing(db, 'buyback_events', 'buyer_address', 'TEXT');
  addColumnIfMissing(db, 'buyback_events', 'virtual_spent_usd', 'REAL');
  addColumnIfMissing(db, 'buyback_events', 'threshold_virtual', 'REAL');
  addColumnIfMissing(db, 'buyback_events', 'threshold_usd', 'REAL');
}

function migratePotMarketSnapshotColumns(db: Database.Database) {
  addColumnIfMissing(db, 'pot_market_snapshots', 'token_price_virtual', 'REAL');
  addColumnIfMissing(db, 'pot_market_snapshots', 'virtual_usd', 'REAL');
}

export function getLastScannedBlock(tokenId: string): bigint | null {
  const db = getDb();
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(`last_scanned_block_${tokenId}`) as
    | { value: string }
    | undefined;
  return row ? BigInt(row.value) : null;
}

export function setLastScannedBlock(tokenId: string, block: bigint) {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
    `last_scanned_block_${tokenId}`,
    block.toString()
  );
}

export function saveTransactions(txs: ClassifiedTx[], tokenId: string) {
  const db = getDb();
  const insert = db.prepare(`
    INSERT OR REPLACE INTO transactions
    (tx_hash, block_number, timestamp, type, user_addr, counterparty, fat_amount, virtual_amount, usd_amount, token)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const batch = db.transaction((items: ClassifiedTx[]) => {
    for (const tx of items) {
      insert.run(
        tx.txHash, Number(tx.blockNumber), tx.timestamp, tx.type,
        tx.user, tx.counterparty, toFloat(tx.fatAmount),
        tx.virtualAmount, tx.usdAmount, tokenId
      );
    }
  });
  batch(txs);
}

export function saveHolders(
  holders: Map<string, HolderPosition>,
  currentTokenPriceUsd: number,
  tokenId: string
) {
  const db = getDb();
  db.prepare('DELETE FROM holders WHERE token = ?').run(tokenId);

  const insert = db.prepare(`
    INSERT INTO holders
    (address, token, rank, balance, total_bought, total_sold, total_cost_virtual,
     total_cost_usd, avg_cost_usd, current_value_usd, unrealized_pnl,
     realized_pnl, buy_market_cap, last_tx_timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const sorted = [...holders.values()]
    .filter((h) => h.balance > 0n)
    .sort((a, b) => (a.balance > b.balance ? -1 : a.balance < b.balance ? 1 : 0));

  const batch = db.transaction(() => {
    for (let i = 0; i < sorted.length; i++) {
      const h = sorted[i];
      const balance = toFloat(h.balance);
      const currentValue = balance * currentTokenPriceUsd;
      const avgCostPerToken = balance > 0 ? h.totalCostUsd / balance : 0;
      const buyMarketCap = avgCostPerToken * 1_000_000_000;
      insert.run(
        h.address, tokenId, i + 1, balance,
        toFloat(h.totalBought), toFloat(h.totalSold),
        h.totalCostVirtual, h.totalCostUsd, avgCostPerToken,
        currentValue, currentValue - h.totalCostUsd,
        h.realizedPnl, buyMarketCap, h.lastTxTimestamp
      );
    }
  });
  batch();
}

export function saveSummary(summary: Record<string, any>, tokenId: string) {
  const db = getDb();
  const upsert = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  const batch = db.transaction(() => {
    for (const [key, value] of Object.entries(summary)) {
      upsert.run(`${tokenId}_summary_${key}`, String(value));
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

// --- Pot P&L Snapshots ---

export interface PotAgentSnapshotRecord {
  season_id: string;
  agent_name: string;
  official_rank: number;
  pot_id: string | null;
  pot_name: string;
  pot_status: string | null;
  season_entry_id: string | null;
  copy_trade_agent_id: string | null;
  copy_trade_agent_wallet: string | null;
  token_symbol: string;
  virtual_id: number | null;
  starting_capital: number;
  current_value: number;
  live_pnl: number;
  realized_pnl: number;
  unrealized_pnl: number;
  season_status: string;
  subscriber_count: number | null;
  positions: unknown[];
  raw: unknown;
}

export type StoredPotAgentSnapshotRecord = PotAgentSnapshotRecord & {
  timestamp: number;
};

export interface PotAgentRawSnapshotRecord {
  season_id: string;
  agent_name: string;
  official_rank: number;
  pot_id: string | null;
  pot_name: string;
  token_symbol: string;
  virtual_id: number | null;
  starting_capital: number | null;
  current_value: number | null;
  live_pnl: number | null;
  realized_pnl: number | null;
  unrealized_pnl: number | null;
  season_status: string;
  valid: boolean;
  invalid_reason: string | null;
  raw: unknown;
}

export interface PotMarketSnapshotRecord {
  season_id: string;
  agent_name: string;
  timestamp: number;
  official_rank: number;
  token_symbol: string;
  virtual_id: number | null;
  starting_capital: number;
  current_value: number;
  live_pnl: number;
  realized_pnl: number;
  unrealized_pnl: number;
  token_price_virtual: number | null;
  virtual_usd: number | null;
  token_price_usd: number | null;
  market_cap_usd: number | null;
  fdv_usd: number | null;
  liquidity_usd: number | null;
  volume_24h_usd: number | null;
  data_source: string;
}

export function savePnlSnapshot(agentName: string, timestamp: number, livePnl: number, seasonId: string) {
  const db = getDb();
  db.prepare(
    'INSERT OR REPLACE INTO pot_pnl_snapshots (agent_name, timestamp, live_pnl, season_id) VALUES (?, ?, ?, ?)'
  ).run(agentName, timestamp, livePnl, seasonId);
}

export function savePotAgentSnapshots(rows: PotAgentSnapshotRecord[], timestamp: number) {
  if (rows.length === 0) return;
  const db = getDb();
  const insert = db.prepare(`
    INSERT OR REPLACE INTO pot_agent_snapshots
    (season_id, agent_name, timestamp, official_rank, pot_id, pot_name, pot_status,
     season_entry_id, copy_trade_agent_id, copy_trade_agent_wallet, token_symbol, virtual_id,
     starting_capital, current_value, live_pnl, realized_pnl, unrealized_pnl, season_status,
     subscriber_count, positions_json, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const batch = db.transaction((items: PotAgentSnapshotRecord[]) => {
    for (const row of items) {
      insert.run(
        row.season_id,
        row.agent_name,
        timestamp,
        row.official_rank,
        row.pot_id,
        row.pot_name,
        row.pot_status,
        row.season_entry_id,
        row.copy_trade_agent_id,
        row.copy_trade_agent_wallet?.toLowerCase() ?? null,
        row.token_symbol.toUpperCase(),
        row.virtual_id,
        row.starting_capital,
        row.current_value,
        row.live_pnl,
        row.realized_pnl,
        row.unrealized_pnl,
        row.season_status,
        row.subscriber_count,
        JSON.stringify(row.positions),
        JSON.stringify(row.raw),
      );
    }
  });

  batch(rows);
}

export function savePotAgentRawSnapshots(rows: PotAgentRawSnapshotRecord[], timestamp: number) {
  if (rows.length === 0) return;
  const db = getDb();
  const insert = db.prepare(`
    INSERT OR REPLACE INTO pot_agent_raw_snapshots
    (season_id, agent_name, timestamp, official_rank, pot_id, pot_name, token_symbol,
     virtual_id, starting_capital, current_value, live_pnl, realized_pnl, unrealized_pnl,
     season_status, valid, invalid_reason, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const batch = db.transaction((items: PotAgentRawSnapshotRecord[]) => {
    for (const row of items) {
      insert.run(
        row.season_id,
        row.agent_name,
        timestamp,
        row.official_rank,
        row.pot_id,
        row.pot_name,
        row.token_symbol.toUpperCase(),
        row.virtual_id,
        row.starting_capital,
        row.current_value,
        row.live_pnl,
        row.realized_pnl,
        row.unrealized_pnl,
        row.season_status,
        row.valid ? 1 : 0,
        row.invalid_reason,
        JSON.stringify(row.raw),
      );
    }
  });

  batch(rows);
}

export function savePotMarketSnapshots(rows: PotMarketSnapshotRecord[]) {
  if (rows.length === 0) return;
  const db = getDb();
  const insert = db.prepare(`
    INSERT OR REPLACE INTO pot_market_snapshots
    (season_id, agent_name, timestamp, official_rank, token_symbol, virtual_id,
     starting_capital, current_value, live_pnl, realized_pnl, unrealized_pnl,
     token_price_virtual, virtual_usd, token_price_usd, market_cap_usd, fdv_usd,
     liquidity_usd, volume_24h_usd, data_source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const batch = db.transaction((items: PotMarketSnapshotRecord[]) => {
    for (const row of items) {
      insert.run(
        row.season_id,
        row.agent_name,
        row.timestamp,
        row.official_rank,
        row.token_symbol.toUpperCase(),
        row.virtual_id,
        row.starting_capital,
        row.current_value,
        row.live_pnl,
        row.realized_pnl,
        row.unrealized_pnl,
        row.token_price_virtual,
        row.virtual_usd,
        row.token_price_usd,
        row.market_cap_usd,
        row.fdv_usd,
        row.liquidity_usd,
        row.volume_24h_usd,
        row.data_source,
      );
    }
  });

  batch(rows);
}

export function getPnlSnapshotAt(
  agentName: string,
  targetTimestamp: number,
  maxDistanceSeconds = 300,
): { live_pnl: number; timestamp: number } | null {
  const db = getDb();
  const candidates: { live_pnl: number; timestamp: number }[] = [];
  const pnlRow = db.prepare(
    `SELECT live_pnl, timestamp FROM pot_pnl_snapshots
     WHERE agent_name = ? AND ABS(timestamp - ?) <= ?
     ORDER BY ABS(timestamp - ?) ASC, timestamp DESC LIMIT 1`
  ).get(agentName, targetTimestamp, maxDistanceSeconds, targetTimestamp) as { live_pnl: number; timestamp: number } | undefined;
  if (pnlRow) candidates.push(pnlRow);

  const potAgentRow = db.prepare(
    `SELECT live_pnl, timestamp FROM pot_agent_snapshots
     WHERE agent_name = ? AND ABS(timestamp - ?) <= ?
     ORDER BY ABS(timestamp - ?) ASC, timestamp DESC LIMIT 1`
  ).get(agentName, targetTimestamp, maxDistanceSeconds, targetTimestamp) as { live_pnl: number; timestamp: number } | undefined;
  if (potAgentRow) candidates.push(potAgentRow);

  const adviceRow = db.prepare(
    `SELECT metrics_json, timestamp FROM position_advice_snapshots
     WHERE agent_name = ? AND ABS(timestamp - ?) <= ?
     ORDER BY ABS(timestamp - ?) ASC, timestamp DESC LIMIT 1`
  ).get(agentName, targetTimestamp, maxDistanceSeconds, targetTimestamp) as { metrics_json: string; timestamp: number } | undefined;
  if (adviceRow) {
    try {
      const metrics = JSON.parse(adviceRow.metrics_json) as { livePnl?: unknown };
      const livePnl = typeof metrics.livePnl === 'number' ? metrics.livePnl : Number(metrics.livePnl);
      if (Number.isFinite(livePnl)) {
        candidates.push({ live_pnl: livePnl, timestamp: adviceRow.timestamp });
      }
    } catch {
      // Ignore malformed historical advice metrics; primary Pot snapshots remain the source of truth.
    }
  }

  return candidates
    .sort((a, b) => Math.abs(a.timestamp - targetTimestamp) - Math.abs(b.timestamp - targetTimestamp) || b.timestamp - a.timestamp)[0] ?? null;
}

export function pruneOldSnapshots(maxAgeSeconds = 7200) {
  const db = getDb();
  const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;
  db.prepare('DELETE FROM pot_pnl_snapshots WHERE timestamp < ?').run(cutoff);
}

export function pruneOldPotAgentSnapshots(maxAgeSeconds = 604_800) {
  const db = getDb();
  const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;
  db.prepare('DELETE FROM pot_agent_snapshots WHERE timestamp < ?').run(cutoff);
}

export function pruneOldPotAgentRawSnapshots(maxAgeSeconds = 604_800) {
  const db = getDb();
  const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;
  db.prepare('DELETE FROM pot_agent_raw_snapshots WHERE timestamp < ?').run(cutoff);
}

export function pruneOldPotMarketSnapshots(maxAgeSeconds = 2_592_000) {
  const db = getDb();
  const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;
  db.prepare('DELETE FROM pot_market_snapshots WHERE timestamp < ?').run(cutoff);
}

export function getLatestCompletePotAgentSnapshots(
  minRows = 10,
  maxAgeSeconds = 1800,
): StoredPotAgentSnapshotRecord[] {
  const db = getDb();
  const latest = db.prepare(`
    SELECT timestamp
    FROM pot_agent_snapshots
    GROUP BY timestamp
    HAVING COUNT(*) >= ?
    ORDER BY timestamp DESC
    LIMIT 1
  `).get(minRows) as { timestamp: number } | undefined;
  if (!latest) return [];
  const now = Math.floor(Date.now() / 1000);
  if (now - latest.timestamp > maxAgeSeconds) return [];
  const rows = db.prepare(`
    SELECT *
    FROM pot_agent_snapshots
    WHERE timestamp = ?
    ORDER BY official_rank ASC
  `).all(latest.timestamp) as Array<Omit<StoredPotAgentSnapshotRecord, 'positions' | 'raw'> & {
    positions_json: string;
    raw_json: string;
  }>;

  return rows.map((row) => {
    let positions: unknown[] = [];
    let raw: unknown = {};
    try {
      positions = JSON.parse(row.positions_json) as unknown[];
    } catch {
      positions = [];
    }
    try {
      raw = JSON.parse(row.raw_json) as unknown;
    } catch {
      raw = {};
    }
    const { positions_json: _positionsJson, raw_json: _rawJson, ...rest } = row;
    return { ...rest, positions, raw };
  });
}

export function clearAllSnapshots() {
  const db = getDb();
  db.prepare('DELETE FROM pot_pnl_snapshots').run();
}

export function getLatestSnapshots(): { agent_name: string; live_pnl: number; timestamp: number; season_id: string }[] {
  const db = getDb();
  return db.prepare(`
    WITH candidates AS (
      SELECT agent_name, live_pnl, timestamp, season_id FROM pot_pnl_snapshots
      UNION ALL
      SELECT agent_name, live_pnl, timestamp, season_id FROM pot_agent_snapshots
    )
    SELECT agent_name, live_pnl, timestamp, season_id FROM candidates
    WHERE (agent_name, timestamp) IN (
      SELECT agent_name, MAX(timestamp) FROM candidates GROUP BY agent_name
    )
  `).all() as { agent_name: string; live_pnl: number; timestamp: number; season_id: string }[];
}

// --- Selection Score Snapshots ---

export interface SelectionSnapshot {
  agent_key: string;
  token: string;
  agent_name: string;
  search_name: string;
  virtual_id: number | null;
  timestamp: number;
  selected_now: boolean;
  selection_rank: number;
  selection_level: string;
  selection_score: number;
  target_position_u: number;
  selection_parts: Record<string, number>;
}

type SelectionSnapshotDbRow = Omit<SelectionSnapshot, 'selected_now' | 'selection_parts'> & {
  selected_now: number;
  selection_parts_json: string;
};

function parseSelectionSnapshot(row: SelectionSnapshotDbRow | undefined): SelectionSnapshot | null {
  if (!row) return null;
  let selectionParts: Record<string, number> = {};
  try {
    selectionParts = JSON.parse(row.selection_parts_json) as Record<string, number>;
  } catch {
    selectionParts = {};
  }
  return {
    ...row,
    selected_now: row.selected_now === 1,
    selection_parts: selectionParts,
  };
}

export function saveSelectionSnapshot(row: SelectionAgentRow, timestamp: number) {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO selection_score_snapshots
    (agent_key, token, agent_name, search_name, virtual_id, timestamp, selected_now,
     selection_rank, selection_level, selection_score, target_position_u, selection_parts_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.agent_key,
    row.token,
    row.agent,
    row.search_name,
    row.virtual_id,
    timestamp,
    row.selected_now ? 1 : 0,
    row.selection_rank,
    row.selection_level,
    row.selection_score,
    row.target_position_u,
    JSON.stringify(row.selection_parts),
  );
}

export function getSelectionSnapshotAt(agentKey: string, targetTimestamp: number): SelectionSnapshot | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT * FROM selection_score_snapshots
     WHERE agent_key = ? AND timestamp <= ?
     ORDER BY timestamp DESC LIMIT 1`,
  ).get(agentKey, targetTimestamp) as SelectionSnapshotDbRow | undefined;
  return parseSelectionSnapshot(row);
}

export function getLatestSelectionSnapshots(): SelectionSnapshot[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM selection_score_snapshots
    WHERE (agent_key, timestamp) IN (
      SELECT agent_key, MAX(timestamp) FROM selection_score_snapshots GROUP BY agent_key
    )
  `).all() as SelectionSnapshotDbRow[];
  return rows
    .map((row) => parseSelectionSnapshot(row))
    .filter((row): row is SelectionSnapshot => Boolean(row));
}

export function pruneOldSelectionSnapshots(maxAgeSeconds = 86_400) {
  const db = getDb();
  const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;
  db.prepare('DELETE FROM selection_score_snapshots WHERE timestamp < ?').run(cutoff);
}

// --- Position Advice Snapshots ---

export interface PositionAdviceSnapshot {
  agent_key: string;
  token: string;
  agent_name: string;
  timestamp: number;
  target_position_u: number;
  position_stage: string;
  reason: string;
  metrics: Record<string, number | string | null>;
}

type PositionAdviceSnapshotDbRow = Omit<PositionAdviceSnapshot, 'metrics'> & {
  metrics_json: string;
};

function parsePositionAdviceSnapshot(row: PositionAdviceSnapshotDbRow | undefined): PositionAdviceSnapshot | null {
  if (!row) return null;
  let metrics: Record<string, number | string | null> = {};
  try {
    metrics = JSON.parse(row.metrics_json) as Record<string, number | string | null>;
  } catch {
    metrics = {};
  }
  return { ...row, metrics };
}

export function savePositionAdviceSnapshot(row: PositionAdviceSnapshot) {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO position_advice_snapshots
    (agent_key, token, agent_name, timestamp, target_position_u, position_stage, reason, metrics_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.agent_key,
    row.token,
    row.agent_name,
    row.timestamp,
    row.target_position_u,
    row.position_stage,
    row.reason,
    JSON.stringify(row.metrics),
  );
}

export function getLatestPositionAdviceSnapshots(): PositionAdviceSnapshot[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM position_advice_snapshots
    WHERE (agent_key, timestamp) IN (
      SELECT agent_key, MAX(timestamp) FROM position_advice_snapshots GROUP BY agent_key
    )
  `).all() as PositionAdviceSnapshotDbRow[];
  return rows
    .map((row) => parsePositionAdviceSnapshot(row))
    .filter((row): row is PositionAdviceSnapshot => Boolean(row));
}

export function pruneOldPositionAdviceSnapshots(maxAgeSeconds = 86_400) {
  const db = getDb();
  const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;
  db.prepare('DELETE FROM position_advice_snapshots WHERE timestamp < ?').run(cutoff);
}

// --- Buyback Events ---

export interface BuybackEventRecord {
  tx_hash: string;
  token_address: string;
  token_symbol: string;
  timestamp: number;
  token_amount: number;
  virtual_spent: number;
  market_address?: string;
  approval_spender_address?: string;
  detected_at_ms?: number;
  trigger_source?: 'official_buyback_address' | 'large_buy_fallback';
  buyer_address?: string;
  virtual_spent_usd?: number;
  threshold_virtual?: number;
  threshold_usd?: number;
}

export function hasBuybackEvent(txHash: string, tokenAddress: string): boolean {
  const db = getDb();
  const row = db.prepare(
    'SELECT 1 FROM buyback_events WHERE tx_hash = ? AND token_address = ? LIMIT 1',
  ).get(txHash, tokenAddress.toLowerCase());
  return Boolean(row);
}

export function saveBuybackEvent(event: BuybackEventRecord) {
	  const db = getDb();
		  db.prepare(`
		    INSERT OR IGNORE INTO buyback_events
		    (tx_hash, token_address, token_symbol, timestamp, token_amount, virtual_spent,
		     market_address, approval_spender_address, detected_at_ms, trigger_source,
		     buyer_address, virtual_spent_usd, threshold_virtual, threshold_usd)
		    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		  `).run(
	    event.tx_hash,
	    event.token_address.toLowerCase(),
    event.token_symbol.toUpperCase(),
    event.timestamp,
    event.token_amount,
	    event.virtual_spent,
	    event.market_address?.toLowerCase() ?? null,
	    event.approval_spender_address?.toLowerCase() ?? null,
	    event.detected_at_ms ?? null,
		    event.trigger_source ?? 'official_buyback_address',
		    event.buyer_address?.toLowerCase() ?? null,
		    event.virtual_spent_usd ?? null,
		    event.threshold_virtual ?? null,
		    event.threshold_usd ?? null,
		  );
	}

export function getBuybackEventCount(): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) AS count FROM buyback_events').get() as { count: number };
  return row.count;
}

// --- Auto Sell Executions ---

export interface AutoSellExecutionRecord {
  trigger_tx_hash: string;
  token_address: string;
  token_symbol: string;
  buyback_timestamp: number;
  detected_at_ms?: number | null;
  wallet_address?: string | null;
  market_address?: string | null;
  approval_spender_address?: string | null;
  status: string;
  token_amount?: string | null;
  amount_out_min?: string | null;
  approve_tx_hash?: string | null;
  sell_tx_hash?: string | null;
  detected_to_submit_ms?: number | null;
  error?: string | null;
  sell_receipt_status?: string | null;
  created_at?: number;
  updated_at?: number;
}

export function saveAutoSellExecution(record: AutoSellExecutionRecord, nowMs = Date.now()) {
  const db = getDb();
  const existing = db.prepare(`
    SELECT created_at FROM auto_sell_executions
    WHERE trigger_tx_hash = ? AND token_address = ?
    LIMIT 1
  `).get(record.trigger_tx_hash, record.token_address.toLowerCase()) as { created_at: number } | undefined;
  db.prepare(`
    INSERT INTO auto_sell_executions
    (trigger_tx_hash, token_address, token_symbol, buyback_timestamp, detected_at_ms,
     wallet_address, market_address, approval_spender_address, status, token_amount,
     amount_out_min, approve_tx_hash, sell_tx_hash, detected_to_submit_ms, error,
     sell_receipt_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(trigger_tx_hash, token_address) DO UPDATE SET
      token_symbol = excluded.token_symbol,
      buyback_timestamp = excluded.buyback_timestamp,
      detected_at_ms = excluded.detected_at_ms,
      wallet_address = excluded.wallet_address,
      market_address = excluded.market_address,
      approval_spender_address = excluded.approval_spender_address,
      status = excluded.status,
      token_amount = excluded.token_amount,
      amount_out_min = excluded.amount_out_min,
      approve_tx_hash = excluded.approve_tx_hash,
      sell_tx_hash = excluded.sell_tx_hash,
      detected_to_submit_ms = excluded.detected_to_submit_ms,
      error = excluded.error,
      sell_receipt_status = excluded.sell_receipt_status,
      updated_at = excluded.updated_at
  `).run(
    record.trigger_tx_hash,
    record.token_address.toLowerCase(),
    record.token_symbol.toUpperCase(),
    record.buyback_timestamp,
    record.detected_at_ms ?? null,
    record.wallet_address?.toLowerCase() ?? null,
    record.market_address?.toLowerCase() ?? null,
    record.approval_spender_address?.toLowerCase() ?? null,
    record.status,
    record.token_amount ?? null,
    record.amount_out_min ?? null,
    record.approve_tx_hash ?? null,
    record.sell_tx_hash ?? null,
    record.detected_to_submit_ms ?? null,
    record.error?.slice(0, 500) ?? null,
    record.sell_receipt_status ?? null,
    existing?.created_at ?? record.created_at ?? nowMs,
    record.updated_at ?? nowMs,
  );
}

export function updateAutoSellExecutionReceipt(
  triggerTxHash: string,
  tokenAddress: string,
  receiptStatus: string,
  update?: { status?: string; error?: string | null },
  nowMs = Date.now(),
): number {
  const db = getDb();
  const result = db.prepare(`
    UPDATE auto_sell_executions
    SET sell_receipt_status = ?,
        status = COALESCE(?, status),
        error = COALESCE(?, error),
        updated_at = ?
    WHERE trigger_tx_hash = ? AND token_address = ?
  `).run(
    receiptStatus,
    update?.status ?? null,
    update?.error === undefined ? null : update.error?.slice(0, 500) ?? null,
    nowMs,
    triggerTxHash,
    tokenAddress.toLowerCase(),
  );
  return result.changes;
}

export function getLatestAutoSellExecutions(limit = 20): AutoSellExecutionRecord[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM auto_sell_executions
    ORDER BY buyback_timestamp DESC, updated_at DESC
    LIMIT ?
  `).all(limit) as AutoSellExecutionRecord[];
}

// --- Notification Outbox ---

export type NotificationTemplate = 'green' | 'red' | 'blue' | 'turquoise' | 'yellow' | 'orange';

export interface NotificationField {
  label: string;
  value: string;
  wide?: boolean;
}

export interface NotificationOutboxInput {
  dedupe_key: string;
  channel?: string;
  title: string;
  template: NotificationTemplate;
  token_url?: string | null;
  fields: NotificationField[];
}

export interface NotificationOutboxRecord extends NotificationOutboxInput {
  id: number;
  channel: string;
  status: 'pending' | 'sending' | 'sent' | 'failed';
  created_at: number;
  updated_at: number;
  next_attempt_at: number;
  attempts: number;
  sent_at: number | null;
  last_error: string | null;
}

type NotificationOutboxDbRow = Omit<NotificationOutboxRecord, 'fields' | 'status'> & {
  status: string;
  fields_json: string;
};

function parseNotificationOutboxRow(row: NotificationOutboxDbRow): NotificationOutboxRecord {
  let fields: NotificationField[] = [];
  try {
    fields = JSON.parse(row.fields_json) as NotificationField[];
  } catch {
    fields = [{ label: '通知内容', value: '卡片字段解析失败，请查看服务端日志。', wide: true }];
  }
  return {
    ...row,
    status: row.status === 'sending' || row.status === 'sent' || row.status === 'failed' ? row.status : 'pending',
    fields,
  };
}

export function enqueueNotification(
  input: NotificationOutboxInput,
  nowMs = Date.now(),
): { inserted: boolean; id: number | null; status: string | null } {
  const db = getDb();
  const existing = db.prepare(
    'SELECT id, status FROM notification_outbox WHERE dedupe_key = ? LIMIT 1',
  ).get(input.dedupe_key) as { id: number; status: string } | undefined;
  if (existing) return { inserted: false, id: existing.id, status: existing.status };

  const result = db.prepare(`
    INSERT INTO notification_outbox
    (dedupe_key, channel, status, title, template, token_url, fields_json,
     created_at, updated_at, next_attempt_at, attempts, sent_at, last_error)
    VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL)
  `).run(
    input.dedupe_key,
    input.channel ?? 'feishu',
    input.title,
    input.template,
    input.token_url ?? null,
    JSON.stringify(input.fields),
    nowMs,
    nowMs,
    nowMs,
  );

  return { inserted: true, id: Number(result.lastInsertRowid), status: 'pending' };
}

export function getDueNotifications(nowMs = Date.now(), limit = 20): NotificationOutboxRecord[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM notification_outbox
    WHERE status = 'pending' AND next_attempt_at <= ?
    ORDER BY created_at ASC, id ASC
    LIMIT ?
  `).all(nowMs, limit) as NotificationOutboxDbRow[];
  return rows.map(parseNotificationOutboxRow);
}

export function hasRecentNotificationWithPrefix(prefix: string, sinceMs: number): boolean {
  const db = getDb();
  const row = db.prepare(`
    SELECT 1 FROM notification_outbox
    WHERE substr(dedupe_key, 1, ?) = ? AND created_at >= ?
    LIMIT 1
  `).get(prefix.length, prefix, sinceMs);
  return Boolean(row);
}

export function claimDueNotifications(
  nowMs = Date.now(),
  limit = 20,
  staleSendingMs = 60_000,
): NotificationOutboxRecord[] {
  const db = getDb();
  const claim = db.transaction(() => {
    db.prepare(`
      UPDATE notification_outbox
      SET status = 'pending',
          updated_at = ?,
          next_attempt_at = ?
      WHERE status = 'sending' AND updated_at < ?
    `).run(nowMs, nowMs, nowMs - staleSendingMs);

    const rows = db.prepare(`
      SELECT * FROM notification_outbox
      WHERE status = 'pending' AND next_attempt_at <= ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `).all(nowMs, limit) as NotificationOutboxDbRow[];
    if (rows.length === 0) return [] as NotificationOutboxDbRow[];

    const ids = rows.map((row) => row.id);
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`
      UPDATE notification_outbox
      SET status = 'sending',
          updated_at = ?
      WHERE id IN (${placeholders})
    `).run(nowMs, ...ids);
    return rows;
  });

  return claim().map((row) => parseNotificationOutboxRow({ ...row, status: 'sending' }));
}

export function markNotificationSent(id: number, nowMs = Date.now()) {
  const db = getDb();
  db.prepare(`
    UPDATE notification_outbox
    SET status = 'sent',
        attempts = attempts + 1,
        updated_at = ?,
        sent_at = ?,
        last_error = NULL
    WHERE id = ?
  `).run(nowMs, nowMs, id);
}

export function markNotificationDeliveryFailed(
  id: number,
  error: string,
  retryDelayMs: number,
  maxAttempts: number,
  nowMs = Date.now(),
) {
  const db = getDb();
  const row = db.prepare(
    'SELECT attempts FROM notification_outbox WHERE id = ? LIMIT 1',
  ).get(id) as { attempts: number } | undefined;
  if (!row) return;
  const attempts = row.attempts + 1;
  const finalStatus = attempts >= maxAttempts ? 'failed' : 'pending';
  db.prepare(`
    UPDATE notification_outbox
    SET status = ?,
        attempts = ?,
        updated_at = ?,
        next_attempt_at = ?,
        last_error = ?
    WHERE id = ?
  `).run(
    finalStatus,
    attempts,
    nowMs,
    finalStatus === 'pending' ? nowMs + retryDelayMs : nowMs,
    error.slice(0, 500),
    id,
  );
}

export function pruneOldNotifications(maxAgeSeconds = 604_800) {
  const db = getDb();
  const cutoffMs = Date.now() - maxAgeSeconds * 1000;
  db.prepare("DELETE FROM notification_outbox WHERE status IN ('sent', 'failed') AND updated_at < ?").run(cutoffMs);
}
