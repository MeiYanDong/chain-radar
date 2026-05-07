import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import path from 'path';
import { buildPositionModel } from './positionModel.js';
import { potBurnQualityScore, potEdgeScore } from './potScoring.js';

type BurnCase = {
  name: string;
  allocationUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  delta15mUsd: number | null;
  delta1hUsd: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  selectionScore?: number;
  allocationScore?: number;
};

const cases: BurnCase[] = [
  {
    name: 'unrealized +10k, full expectation',
    allocationUsd: 40_000,
    realizedPnlUsd: 0,
    unrealizedPnlUsd: 10_000,
    delta15mUsd: 2_000,
    delta1hUsd: 5_000,
    marketCapUsd: 120_000,
    liquidityUsd: 40_000,
  },
  {
    name: 'realized +10k, extra quality',
    allocationUsd: 40_000,
    realizedPnlUsd: 10_000,
    unrealizedPnlUsd: 0,
    delta15mUsd: 2_000,
    delta1hUsd: 5_000,
    marketCapUsd: 120_000,
    liquidityUsd: 40_000,
  },
  {
    name: 'mixed +10k, partial realized',
    allocationUsd: 40_000,
    realizedPnlUsd: 5_000,
    unrealizedPnlUsd: 5_000,
    delta15mUsd: 1_000,
    delta1hUsd: 3_000,
    marketCapUsd: 120_000,
    liquidityUsd: 40_000,
  },
  {
    name: 'surface +10k, realized clear-risk loss',
    allocationUsd: 40_000,
    realizedPnlUsd: -4_000,
    unrealizedPnlUsd: 14_000,
    delta15mUsd: -1_000,
    delta1hUsd: 1_000,
    marketCapUsd: 120_000,
    liquidityUsd: 40_000,
  },
  {
    name: 'ordinary pullback',
    allocationUsd: 40_000,
    realizedPnlUsd: 0,
    unrealizedPnlUsd: -4_000,
    delta15mUsd: 300,
    delta1hUsd: -800,
    marketCapUsd: 120_000,
    liquidityUsd: 40_000,
  },
  {
    name: 'catastrophic loss',
    allocationUsd: 40_000,
    realizedPnlUsd: -1_000,
    unrealizedPnlUsd: -20_000,
    delta15mUsd: -2_000,
    delta1hUsd: -8_000,
    marketCapUsd: 120_000,
    liquidityUsd: 40_000,
  },
  {
    name: 'missing momentum',
    allocationUsd: 40_000,
    realizedPnlUsd: 0,
    unrealizedPnlUsd: 8_000,
    delta15mUsd: null,
    delta1hUsd: null,
    marketCapUsd: 120_000,
    liquidityUsd: 40_000,
  },
];

function round(value: number | null | undefined, digits = 2): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const m = 10 ** digits;
  return Math.round(value * m) / m;
}

function evaluateCase(item: BurnCase) {
  const livePnlUsd = item.realizedPnlUsd + item.unrealizedPnlUsd;
  const quality = potBurnQualityScore({
    potLivePnlUsd: livePnlUsd,
    potRealizedPnlUsd: item.realizedPnlUsd,
    market: {
      market_cap_usd: item.marketCapUsd,
      liquidity_usd: item.liquidityUsd,
    },
  });
  const edge = potEdgeScore({
    potLivePnlUsd: livePnlUsd,
    potDelta15mUsd: item.delta15mUsd,
    potDelta1hUsd: item.delta1hUsd,
    burnImpactScore: quality.parts.burn_impact_score,
  });
  const position = buildPositionModel({
    selectionScore: item.selectionScore ?? 85,
    selectionRank: 1,
    selectedNow: true,
    allocationScore: item.allocationScore ?? 80,
    allocationUsd: item.allocationUsd,
    livePnlUsd,
    delta15mUsd: item.delta15mUsd,
    delta1hUsd: item.delta1hUsd,
    realizedPnlUsd: item.realizedPnlUsd,
    burnQualityScore: quality.total,
    edgeScore: edge.total,
    edgeComplete: edge.complete,
    maxAgentCapU: 200,
    minActionTargetU: 10,
    nowMs: Date.parse('2026-04-28T08:00:00Z'),
  });

  return {
    case: item.name,
    livePnl: livePnlUsd,
    realized: item.realizedPnlUsd,
    unrealized: item.unrealizedPnlUsd,
    liveFoundation: round(quality.parts.pot_live_pnl_foundation_score),
    realizedPts: round(quality.parts.pot_realized_quality_points),
    burnImpact: round(quality.parts.burn_impact_score),
    burnQuality: round(quality.total),
    liveExpectation: round(edge.total),
    risk: `${position.metrics.riskState} x${position.metrics.riskMultiplier}`,
    signalState: position.signalState,
    positionLayer: position.positionLayer,
    liveTarget: position.metrics.livePnlTargetRatio,
    realizedBonus: position.metrics.realizedQualityTargetBonus,
    targetU: position.targetU,
  };
}

function latestLocalPotRows(): BurnCase[] {
  const dbPath = path.join(process.cwd(), 'data', 'chain-radar.db');
  if (!existsSync(dbPath)) return [];
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const latest = db.prepare(`
      SELECT timestamp
      FROM pot_agent_snapshots
      GROUP BY timestamp
      HAVING COUNT(*) >= 10
      ORDER BY timestamp DESC
      LIMIT 1
    `).get() as { timestamp: number } | undefined;
    if (!latest) return [];
    const rows = db.prepare(`
      SELECT token_symbol, starting_capital, realized_pnl, unrealized_pnl, live_pnl
      FROM pot_agent_snapshots
      WHERE timestamp = ?
      ORDER BY official_rank ASC
      LIMIT 10
    `).all(latest.timestamp) as Array<{
      token_symbol: string;
      starting_capital: number;
      realized_pnl: number;
      unrealized_pnl: number;
      live_pnl: number;
    }>;
    return rows.map((row) => ({
      name: `real ${row.token_symbol}`,
      allocationUsd: row.starting_capital,
      realizedPnlUsd: row.realized_pnl,
      unrealizedPnlUsd: row.unrealized_pnl,
      delta15mUsd: null,
      delta1hUsd: null,
      marketCapUsd: null,
      liquidityUsd: null,
    }));
  } finally {
    db.close();
  }
}

console.log('\n=== Simulated burn model cases ===');
console.table(cases.map(evaluateCase));

const realRows = latestLocalPotRows();
if (realRows.length > 0) {
  console.log('\n=== Latest local Pot snapshot cases ===');
  console.table(realRows.map(evaluateCase));
} else {
  console.log('\nNo local complete pot_agent_snapshots found; run npm run expectation or use server DB for live-data validation.');
}
