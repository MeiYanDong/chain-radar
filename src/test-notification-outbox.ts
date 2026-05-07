import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const tempDir = mkdtempSync(path.join(tmpdir(), 'chain-radar-outbox-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');

try {
  const {
    enqueueNotification,
    claimDueNotifications,
    getDb,
    getDueNotifications,
    hasRecentNotificationWithPrefix,
    markNotificationDeliveryFailed,
    markNotificationSent,
    savePotAgentRawSnapshots,
  } = await import('./db.js');

  const now = 1_777_000_000_000;
  const first = enqueueNotification({
    dedupe_key: 'test:bl:down',
    title: '[实时盈亏风险] BL 跌破 -$2,500',
    template: 'orange',
    token_url: 'https://app.virtuals.io/virtuals/1',
    fields: [{ label: '动作', value: '检查是否减仓' }],
  }, now);
  assert.equal(first.inserted, true);

  const duplicate = enqueueNotification({
    dedupe_key: 'test:bl:down',
    title: '[实时盈亏风险] BL 跌破 -$2,500',
    template: 'orange',
    fields: [{ label: '动作', value: '重复事件不应该新建' }],
  }, now + 1);
  assert.equal(duplicate.inserted, false);
  assert.equal(getDueNotifications(now).length, 1);

  const claimedOnce = claimDueNotifications(now);
  assert.equal(claimedOnce.length, 1);
  assert.equal(claimDueNotifications(now).length, 0, 'claimed notification must not be claimed twice');

  markNotificationDeliveryFailed(first.id!, 'network timeout', 5_000, 3, now);
  assert.equal(getDueNotifications(now + 4_999).length, 0);
  assert.equal(getDueNotifications(now + 5_000).length, 1);

  markNotificationSent(first.id!, now + 5_000);
  assert.equal(getDueNotifications(now + 5_000).length, 0);
  assert.equal(hasRecentNotificationWithPrefix('test:bl:', now - 1), true);
  assert.equal(hasRecentNotificationWithPrefix('test:other:', now - 1), false);

  savePotAgentRawSnapshots([{
    season_id: 'season-test',
    agent_name: 'Degentic AI',
    official_rank: 1,
    pot_id: 'pot-test',
    pot_name: 'BL Pot',
    token_symbol: 'BL',
    virtual_id: 123,
    starting_capital: 40_000,
    current_value: 0,
    live_pnl: null,
    realized_pnl: 2_800,
    unrealized_pnl: -4_000,
    season_status: 'ACTIVE',
    valid: false,
    invalid_reason: '官网返回 currentValue=0',
    raw: { currentSeason: { currentValue: 0 } },
  }], Math.floor(now / 1000));

  const row = getDb().prepare(`
    SELECT valid, invalid_reason, current_value
    FROM pot_agent_raw_snapshots
    WHERE agent_name = ?
  `).get('Degentic AI') as { valid: number; invalid_reason: string; current_value: number };
  assert.equal(row.valid, 0);
  assert.equal(row.invalid_reason, '官网返回 currentValue=0');
  assert.equal(row.current_value, 0);

  console.log('notification outbox tests passed');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
