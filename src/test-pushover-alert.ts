import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const tempDir = mkdtempSync(path.join(tmpdir(), 'chain-radar-pushover-alert-'));
process.env.CHAIN_RADAR_WATCHER_TEST = '1';
process.env.DB_PATH = path.join(tempDir, 'test.db');
process.env.PUSHOVER_ENABLED = '1';
process.env.PUSHOVER_APP_TOKEN = 'test-app-token';
process.env.PUSHOVER_USER_KEY = 'test-user-key';

try {
  const { __watcherTest } = await import('./watcher.js');

  const input = __watcherTest.pushoverNotificationInputFromCard({
    title: '[实时盈亏风险] BL 跌破 -$4,000',
    template: 'red',
    tokenUrl: 'https://app.virtuals.io/virtuals/1',
    dedupeKey: 'pnl-threshold:bl:0->0:2500->4000:0',
    voice: {
      priority: 'p0',
      message: 'BL 实时盈亏跌破负 4,000 美元，进入清仓风险线。',
    },
    fields: [{ label: '动作', value: '检查是否清仓' }],
  } as any);

  assert.ok(input);
  assert.equal(input.channel, 'pushover');
  assert.equal(input.dedupe_key, 'pushover:pnl-threshold:bl:0->0:2500->4000:0');
  assert.equal(input.fields.find((field: any) => field.label === '__pushover_priority')?.value, 'p0');
  assert.equal(input.fields.find((field: any) => field.label === '__pushover_sound')?.value, 'siren');
  assert.equal(
    input.fields.find((field: any) => field.label === '__pushover_message')?.value,
    'BL 实时盈亏跌破负 4,000 美元，进入清仓风险线。',
  );
} catch (err) {
  if (err instanceof assert.AssertionError) throw err;
  throw err;
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log('pushover alert tests passed');
