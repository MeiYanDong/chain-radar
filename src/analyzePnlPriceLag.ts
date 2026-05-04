import Database from 'better-sqlite3';
import path from 'path';
import { existsSync } from 'fs';
import { analyzeLagSeries, type PnlPricePoint } from './pnlPriceLag.js';

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'chain-radar.db');
const DEFAULT_LAGS = [-60, -30, -15, -10, -5, 0, 5, 10, 15, 30, 60];
const LAG_MINUTES = (process.env.LAG_MINUTES ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => Number(value))
  .filter((value) => Number.isFinite(value));
const lagMinutes = LAG_MINUTES.length > 0 ? LAG_MINUTES : DEFAULT_LAGS;
const baseWindowMinutes = Number(process.env.LAG_BASE_WINDOW_MINUTES ?? 5);
const maxAgeDays = Number(process.env.LAG_MAX_AGE_DAYS ?? 30);
const minSamples = Number(process.env.LAG_MIN_SAMPLES ?? 12);
const priceUnit = (process.env.LAG_PRICE_UNIT ?? 'usd').toLowerCase() === 'virtual' ? 'virtual' : 'usd';

function hasTable(db: Database.Database, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").get(table));
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
    .some((row) => row.name === column);
}

function loadMarketRows(db: Database.Database, sinceTimestamp: number) {
  if (!hasTable(db, 'pot_market_snapshots')) return [];
  const preferredColumn = priceUnit === 'virtual' && hasColumn(db, 'pot_market_snapshots', 'token_price_virtual')
    ? 'token_price_virtual'
    : 'token_price_usd';
  return db.prepare(`
    SELECT token_symbol, timestamp, live_pnl, ${preferredColumn} AS token_price
    FROM pot_market_snapshots
    WHERE timestamp >= ?
      AND ${preferredColumn} IS NOT NULL
      AND ${preferredColumn} > 0
    ORDER BY token_symbol ASC, timestamp ASC
  `).all(sinceTimestamp) as Array<{
    token_symbol: string;
    timestamp: number;
    live_pnl: number;
    token_price: number;
  }>;
}

function loadAdviceRows(db: Database.Database, sinceTimestamp: number) {
  if (!hasTable(db, 'position_advice_snapshots')) return [];
  return db.prepare(`
    SELECT token, timestamp, metrics_json
    FROM position_advice_snapshots
    WHERE timestamp >= ?
    ORDER BY token ASC, timestamp ASC
  `).all(sinceTimestamp) as Array<{
    token: string;
    timestamp: number;
    metrics_json: string;
  }>;
}

function groupMarketRows(rows: ReturnType<typeof loadMarketRows>): Map<string, PnlPricePoint[]> {
  const grouped = new Map<string, PnlPricePoint[]>();
  for (const row of rows) {
    const token = row.token_symbol.toUpperCase();
    const list = grouped.get(token) ?? [];
    list.push({
      timestamp: row.timestamp,
      livePnl: row.live_pnl,
      tokenPriceUsd: row.token_price,
    });
    grouped.set(token, list);
  }
  return grouped;
}

function groupAdviceRows(rows: ReturnType<typeof loadAdviceRows>): Map<string, PnlPricePoint[]> {
  const grouped = new Map<string, PnlPricePoint[]>();
  for (const row of rows) {
    try {
      const metrics = JSON.parse(row.metrics_json) as { livePnl?: unknown; tokenPriceUsd?: unknown };
      const livePnl = Number(metrics.livePnl);
      const tokenPriceUsd = Number(metrics.tokenPriceUsd);
      if (!Number.isFinite(livePnl) || !Number.isFinite(tokenPriceUsd) || tokenPriceUsd <= 0) continue;
      const token = row.token.toUpperCase();
      const list = grouped.get(token) ?? [];
      list.push({ timestamp: row.timestamp, livePnl, tokenPriceUsd });
      grouped.set(token, list);
    } catch {
      // Ignore malformed historical metrics.
    }
  }
  return grouped;
}

function formatTime(timestamp: number | null): string {
  if (!timestamp) return '-';
  return new Date(timestamp * 1000).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}

function printResultTable(
  label: string,
  grouped: Map<string, PnlPricePoint[]>,
  effectivePriceUnit = priceUnit,
) {
  const results = [...grouped.entries()]
    .map(([token, points]) => analyzeLagSeries({
      token,
      points,
      lagMinutes,
      baseWindowMinutes,
      minSamples,
    }))
    .sort((a, b) => (b.best?.correlation !== null && b.best?.correlation !== undefined ? Math.abs(b.best.correlation) : -1) -
      (a.best?.correlation !== null && a.best?.correlation !== undefined ? Math.abs(a.best.correlation) : -1));

  console.log(`\n=== ${label} ===`);
  console.log(`DB=${DB_PATH}`);
  console.log(`priceUnit=${effectivePriceUnit} baseWindow=${baseWindowMinutes}m lags=${lagMinutes.join(',')} minSamples=${minSamples}`);
  console.table(results.map((result) => ({
    token: result.token,
    points: result.points,
    priced: result.pricedPoints,
    start: formatTime(result.startTimestamp),
    end: formatTime(result.endTimestamp),
    bestLagMin: result.best?.lagMinutes ?? null,
    corr: result.best?.correlation === null || result.best?.correlation === undefined ? null : Number(result.best.correlation.toFixed(3)),
    samples: result.best?.samples ?? 0,
    verdict: result.verdict,
  })));

  const evaluable = results.filter((result) => result.best && result.best.correlation !== null);
  const leading = evaluable.filter((result) => result.best && result.best.lagMinutes > 0 && result.best.correlation !== null && result.best.correlation > 0);
  if (leading.length > 0) {
    console.log('\nPotential P&L-leading tokens:');
    for (const result of leading.slice(0, 5)) {
      console.log(`- ${result.token}: ${result.verdict}`);
    }
  } else if (evaluable.length === 0) {
    console.log(`\nSample is still insufficient for lag judgment. Need at least ${minSamples} aligned samples per token after the ${baseWindowMinutes}m base-window calculation.`);
  } else {
    console.log('\nNo positive P&L-leading relationship found with current sample.');
  }

  return { results, evaluable, leading };
}

if (!existsSync(DB_PATH)) {
  throw new Error(`DB not found: ${DB_PATH}`);
}

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
try {
  const sinceTimestamp = Math.floor(Date.now() / 1000) - Math.max(1, maxAgeDays) * 86_400;
  const marketRows = loadMarketRows(db, sinceTimestamp);
  if (marketRows.length > 0) {
    const market = printResultTable('pot_market_snapshots', groupMarketRows(marketRows));
    if (market.evaluable.length === 0) {
      console.log('\npot_market_snapshots is priced but too short; checking position_advice_snapshots as a rough historical fallback. Historical fallback only has USD price.');
      printResultTable('position_advice_snapshots fallback', groupAdviceRows(loadAdviceRows(db, sinceTimestamp)), 'usd');
    }
  } else {
    console.log('pot_market_snapshots has no priced rows in range; falling back to position_advice_snapshots.');
    printResultTable('position_advice_snapshots fallback', groupAdviceRows(loadAdviceRows(db, sinceTimestamp)), 'usd');
  }
} finally {
  db.close();
}
