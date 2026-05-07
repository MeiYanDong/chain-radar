import 'dotenv/config';
import type { StoredPotAgentSnapshotRecord } from './db.js';

process.env.CHAIN_RADAR_WATCHER_TEST = '1';

const POSITIVE_TIERS = [1500, 3000, 4500, 6000, 7500, 10000, 15000, 20000];
const NEGATIVE_TIERS = [2500, 4000];

type DrillDirection = 'positive' | 'risk';

interface DrillScenario {
  label: string;
  direction: DrillDirection;
  preferredSymbol: string;
}

function normalizeSymbol(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase();
}

function currentPositiveTier(livePnl: number): number {
  return [...POSITIVE_TIERS].reverse().find((tier) => livePnl >= tier) ?? 0;
}

function currentRiskTier(livePnl: number): number {
  const loss = Math.abs(Math.min(0, livePnl));
  return [...NEGATIVE_TIERS].reverse().find((tier) => loss >= tier) ?? 0;
}

function previousPositiveLivePnl(livePnl: number): number | null {
  const tier = currentPositiveTier(livePnl);
  if (tier <= 0) return null;
  const index = POSITIVE_TIERS.indexOf(tier);
  return index > 0 ? POSITIVE_TIERS[index - 1] : 0;
}

function previousRiskLivePnl(livePnl: number): number | null {
  const tier = currentRiskTier(livePnl);
  if (tier <= 0) return null;
  return 0;
}

function chooseSnapshot(
  rows: StoredPotAgentSnapshotRecord[],
  scenario: DrillScenario,
): StoredPotAgentSnapshotRecord | null {
  const preferred = rows.find((row) => normalizeSymbol(row.token_symbol) === normalizeSymbol(scenario.preferredSymbol));
  if (preferred) return preferred;
  if (scenario.direction === 'positive') {
    return rows
      .filter((row) => currentPositiveTier(row.live_pnl) > 0)
      .sort((a, b) => b.live_pnl - a.live_pnl)[0] ?? null;
  }
  return rows
    .filter((row) => currentRiskTier(row.live_pnl) > 0)
    .sort((a, b) => a.live_pnl - b.live_pnl)[0] ?? null;
}

function snapshotToAgent(row: StoredPotAgentSnapshotRecord) {
  return {
    potName: row.pot_name,
    agentName: row.agent_name,
    symbol: row.token_symbol,
    livePnl: row.live_pnl,
    seasonId: row.season_id,
    virtualId: row.virtual_id ?? 0,
    positions: (Array.isArray(row.positions) ? row.positions : []).map((position: any) => ({
      pair: String(position?.pair ?? ''),
      side: String(position?.side ?? ''),
      leverage: Number(position?.leverage ?? 0),
      unrealizedPnl: Number(position?.unrealizedPnl ?? 0),
    })),
    snapshot: row,
  };
}

function notificationRows(dedupeKeys: string[]) {
  if (dedupeKeys.length === 0) return [];
  const placeholders = dedupeKeys.map(() => '?').join(',');
  return getDb().prepare(`
    SELECT channel, dedupe_key, title, status, attempts, last_error
    FROM notification_outbox
    WHERE dedupe_key IN (${placeholders})
    ORDER BY id ASC
  `).all(...dedupeKeys);
}

const { getDb, getLatestCompletePotAgentSnapshots } = await import('./db.js');
const { __watcherTest } = await import('./watcher.js');

const scenarios: DrillScenario[] = [
  {
    label: 'positive',
    direction: 'positive',
    preferredSymbol: process.env.DRILL_POSITIVE_SYMBOL ?? 'BL',
  },
  {
    label: 'risk',
    direction: 'risk',
    preferredSymbol: process.env.DRILL_RISK_SYMBOL ?? 'GOCHU',
  },
];

const snapshots = getLatestCompletePotAgentSnapshots(10, Number(process.env.DRILL_MAX_SNAPSHOT_AGE_SECONDS ?? 3600));
if (snapshots.length === 0) {
  throw new Error('No fresh complete Pot agent snapshots found. Run the monitor first.');
}

const drillId = process.env.DRILL_ID ?? String(Date.now());
const outputs: any[] = [];

for (const scenario of scenarios) {
  const row = chooseSnapshot(snapshots, scenario);
  if (!row) {
    outputs.push({ scenario: scenario.label, skipped: true, reason: 'no matching snapshot can trigger this direction' });
    continue;
  }

  const previousLivePnl = scenario.direction === 'positive'
    ? previousPositiveLivePnl(row.live_pnl)
    : previousRiskLivePnl(row.live_pnl);
  if (previousLivePnl === null) {
    outputs.push({
      scenario: scenario.label,
      skipped: true,
      symbol: row.token_symbol,
      livePnl: row.live_pnl,
      reason: 'latest snapshot does not cross a configured production tier',
    });
    continue;
  }

  const agent = snapshotToAgent(row);
  const cards = await __watcherTest.buildThresholdSignalCardsForDrill(
    agent as any,
    previousLivePnl,
    row.timestamp,
  );
  const dedupeKeys: string[] = [];
  for (const card of cards) {
    card.dedupeKey = `${card.dedupeKey}:drill:${drillId}`;
    dedupeKeys.push(card.dedupeKey, `feishu-urgent:${card.dedupeKey}`, `pushover:${card.dedupeKey}`);
    __watcherTest.enqueueFeishuCard(card);
  }
  await __watcherTest.flushNotificationOutbox();

  outputs.push({
    scenario: scenario.label,
    symbol: row.token_symbol,
    agentName: row.agent_name,
    livePnl: row.live_pnl,
    previousLivePnl,
    snapshotTime: row.timestamp,
    cardTitles: cards.map((card: any) => card.title),
    notificationRows: notificationRows(dedupeKeys),
  });
}

console.log(JSON.stringify(outputs, null, 2));
