import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.CHAIN_RADAR_WATCHER_TEST = '1';
process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), 'chain-radar-pot-source-')), 'test.db');
process.env.POT_DATA_SOURCE_ALERTS_ENABLED = '1';
process.env.POT_DATA_SOURCE_ANOMALY_MIN_ZERO_AGENTS = '3';
process.env.POT_DATA_SOURCE_DEGRADED_MIN_ZERO_AGENTS = '2';
process.env.POT_DATA_SOURCE_RECOVERY_CONFIRM_CYCLES = '2';

const { __watcherTest } = await import('./watcher.js');

assert.equal(__watcherTest.isTrackedPotSeasonStatus('ACTIVE'), true);
assert.equal(__watcherTest.isTrackedPotSeasonStatus('DRAINING'), true);
assert.equal(__watcherTest.isTrackedPotSeasonStatus('SETTLED'), true);
assert.equal(__watcherTest.isTrackedPotSeasonStatus('PENDING'), false);

function invalid(symbol: string, rank: number) {
  return {
    potName: `${symbol}Pot`,
    agentName: `${symbol}Agent`,
    symbol,
    seasonId: 'season-test',
    virtualId: rank,
    officialRank: rank,
    startingCapital: 1000,
    currentValue: 0,
    realizedPnl: -1000,
    unrealizedPnl: 0,
    reason: '官网返回 currentValue=0',
  };
}

function raw(symbol: string, rank: number, valid: boolean) {
  return {
    season_id: 'season-test',
    agent_name: `${symbol}Agent`,
    official_rank: rank,
    pot_id: `pot-${symbol}`,
    pot_name: `${symbol}Pot`,
    token_symbol: symbol,
    virtual_id: rank,
    starting_capital: 1000,
    current_value: valid ? 1100 : 0,
    live_pnl: valid ? 100 : null,
    realized_pnl: valid ? 100 : -1000,
    unrealized_pnl: 0,
    season_status: 'ACTIVE',
    valid,
    invalid_reason: valid ? null : '官网返回 currentValue=0',
    raw: {},
  };
}

function agent(symbol: string, rank: number) {
  return {
    potName: `${symbol}Pot`,
    agentName: `${symbol}Agent`,
    symbol,
    livePnl: 100,
    seasonId: 'season-test',
    virtualId: rank,
    positions: [],
    snapshot: {
      season_id: 'season-test',
      agent_name: `${symbol}Agent`,
      official_rank: rank,
      pot_id: `pot-${symbol}`,
      pot_name: `${symbol}Pot`,
      pot_status: 'ACTIVE',
      season_entry_id: null,
      copy_trade_agent_id: null,
      copy_trade_agent_wallet: null,
      token_symbol: symbol,
      virtual_id: rank,
      starting_capital: 1000,
      current_value: 1100,
      live_pnl: 100,
      realized_pnl: 100,
      unrealized_pnl: 0,
      season_status: 'ACTIVE',
      subscriber_count: null,
      positions: [],
      raw: {},
    },
  };
}

const healthyAgents = Array.from({ length: 10 }, (_, i) => agent(`T${i + 1}`, i + 1));
const healthyRaw = Array.from({ length: 10 }, (_, i) => raw(`T${i + 1}`, i + 1, true));
const firstInvalid = [invalid('A', 1), invalid('B', 2), invalid('C', 3), invalid('D', 4)];
const firstRaw = [
  ...firstInvalid.map((row) => raw(row.symbol, row.officialRank, false)),
  ...Array.from({ length: 6 }, (_, i) => raw(`H${i + 1}`, i + 5, true)),
];

const first = __watcherTest.evaluatePotDataSourceHealth(
  healthyAgents.slice(0, 6) as any,
  firstInvalid as any,
  firstRaw as any,
  1000,
  true,
);
assert.equal(first.cards.length, 1);
assert.equal(first.cards[0].title, '[官网数据异常] 4 个 Agent 跟单返回 0');
assert.equal(first.dataSourceUnreliable, true);

const repeated = __watcherTest.evaluatePotDataSourceHealth(
  healthyAgents.slice(0, 6) as any,
  firstInvalid as any,
  firstRaw as any,
  1060,
  true,
);
assert.equal(repeated.cards.length, 0);
assert.equal(repeated.dataSourceUnreliable, true);

const partialInvalid = [invalid('A', 1), invalid('B', 2)];
const partialRaw = [
  ...partialInvalid.map((row) => raw(row.symbol, row.officialRank, false)),
  ...Array.from({ length: 8 }, (_, i) => raw(`H${i + 1}`, i + 3, true)),
];
const partial = __watcherTest.evaluatePotDataSourceHealth(
  healthyAgents.slice(0, 8) as any,
  partialInvalid as any,
  partialRaw as any,
  1120,
  true,
);
assert.equal(partial.cards.length, 0);
assert.equal(partial.dataSourceUnreliable, true);

const recovering = __watcherTest.evaluatePotDataSourceHealth(
  healthyAgents as any,
  [] as any,
  healthyRaw as any,
  1180,
  true,
);
assert.equal(recovering.cards.length, 0);
assert.equal(recovering.dataSourceUnreliable, true);

const recovered = __watcherTest.evaluatePotDataSourceHealth(
  healthyAgents as any,
  [] as any,
  healthyRaw as any,
  1240,
  true,
);
assert.equal(recovered.cards.length, 0);
assert.equal(recovered.dataSourceUnreliable, false);

const second = __watcherTest.evaluatePotDataSourceHealth(
  healthyAgents.slice(0, 6) as any,
  firstInvalid as any,
  firstRaw as any,
  1300,
  true,
);
assert.equal(second.cards.length, 1);
assert.equal(second.cards[0].dedupeKey, 'pot-source-anomaly:season-test:episode:2');

console.log('pot data source anomaly tests passed');
