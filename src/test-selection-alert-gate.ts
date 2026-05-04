import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.CHAIN_RADAR_WATCHER_TEST = '1';
process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), 'chain-radar-selection-alert-')), 'test.db');

const { __watcherTest } = await import('./watcher.js');

const baseRow = {
  agent_key: 'test-agent',
  search_name: 'TestAgent',
  token: 'TEST',
  virtual_url: 'https://degen.virtuals.io/agents/test',
  selected_now: false,
  selection_score: 80,
  selection_rank: 3,
  target_position_u: 40,
  selection_parts: {
    quality: 80,
    capital_efficiency: 80,
    trading_result: 80,
    market_attention: 80,
  },
};

const baseSnapshot = {
  agent_key: 'test-agent',
  token: 'TEST',
  search_name: 'TestAgent',
  selected_now: false,
  selection_score: 60,
  selection_rank: 12,
  target_position_u: 0,
  selection_parts: {
    quality: 60,
    capital_efficiency: 60,
    trading_result: 60,
    market_attention: 60,
  },
};

const blockedStrong = __watcherTest.checkSelectionSignals(
  { ...baseRow, agent_key: 'blocked-strong' } as any,
  { ...baseSnapshot, agent_key: 'blocked-strong' } as any,
  null,
  null,
  { allowExpectationAlerts: false },
);
assert.equal(blockedStrong.some((card) => card.title.startsWith('[强机会]')), false);

const allowedStrong = __watcherTest.checkSelectionSignals(
  { ...baseRow, agent_key: 'allowed-strong' } as any,
  { ...baseSnapshot, agent_key: 'allowed-strong' } as any,
  null,
  null,
  { allowExpectationAlerts: true },
);
assert.equal(allowedStrong.some((card) => card.title.startsWith('[强机会]')), true);

const blockedRisk = __watcherTest.checkSelectionSignals(
  {
    ...baseRow,
    agent_key: 'blocked-risk',
    selection_score: 65,
    selection_rank: 15,
    target_position_u: 20,
  } as any,
  {
    ...baseSnapshot,
    agent_key: 'blocked-risk',
    selection_score: 75,
    selection_rank: 5,
    target_position_u: 20,
  } as any,
  null,
  null,
  { allowExpectationAlerts: false },
);
assert.equal(blockedRisk.some((card) => card.title.startsWith('[入选预期走弱]')), false);

const selectedConfirmation = __watcherTest.checkSelectionSignals(
  {
    ...baseRow,
    agent_key: 'selected-confirmation',
    selected_now: true,
  } as any,
  {
    ...baseSnapshot,
    agent_key: 'selected-confirmation',
    selected_now: false,
  } as any,
  null,
  null,
  { allowExpectationAlerts: false },
);
assert.equal(selectedConfirmation.some((card) => card.title.startsWith('[入选确认]')), true);

console.log('selection alert gate tests passed');
