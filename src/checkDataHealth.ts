import 'dotenv/config';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'chain-radar.db');
const STATE_PATH = process.env.DATA_HEALTH_STATE_PATH ?? path.join(process.cwd(), 'data', 'data-health-state.json');
const FEISHU_WEBHOOK = process.env.FEISHU_WEBHOOK ?? '';
const ALERTS_ENABLED = process.env.DATA_HEALTH_ALERTS_ENABLED === '1';
const SYSTEM_INCIDENT_ALERTS_ENABLED = process.env.POT_MAINLINE_INCIDENT_ALERTS_ENABLED === '1';
const SYSTEM_INCIDENT_RECOVERY_ALERTS_ENABLED = process.env.POT_MAINLINE_INCIDENT_RECOVERY_ALERTS_ENABLED !== '0';
const SYSTEM_INCIDENT_MENTION_USER_ID = process.env.POT_MAINLINE_INCIDENT_MENTION_USER_ID ?? 'all';
const SYSTEM_INCIDENT_COOLDOWN_SECONDS = Number(process.env.POT_MAINLINE_INCIDENT_COOLDOWN_SECONDS ?? 300);
const MAX_STALE_SECONDS = Number(process.env.DATA_HEALTH_MAX_STALE_SECONDS ?? 180);
const MAX_BATCH_GAP_SECONDS = Number(process.env.DATA_HEALTH_MAX_BATCH_GAP_SECONDS ?? 180);
const MIN_RECENT_BATCHES = Number(process.env.DATA_HEALTH_MIN_RECENT_BATCHES ?? 3);
const MIN_ROWS_PER_BATCH = Number(process.env.DATA_HEALTH_MIN_ROWS_PER_BATCH ?? 10);
const ALERT_COOLDOWN_SECONDS = Number(process.env.DATA_HEALTH_ALERT_COOLDOWN_SECONDS ?? 900);

interface HealthState {
  lastStatus?: string;
  lastAlertAt?: number;
  lastIncidentActive?: boolean;
  lastIncidentAlertAt?: number;
}

interface CheckResult {
  status: 'healthy' | 'warning' | 'critical';
  title: string;
  details: string[];
}

interface IncidentDecision {
  shouldSend: boolean;
  kind: 'critical' | 'recovered' | 'none';
}

interface IncidentSummary {
  cause: string;
  latest: string;
  coverage: string;
}

function loadState(): HealthState {
  try {
    if (!existsSync(STATE_PATH)) return {};
    return JSON.parse(readFileSync(STATE_PATH, 'utf8')) as HealthState;
  } catch {
    return {};
  }
}

function saveState(state: HealthState) {
  mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

function bj(seconds: number | null | undefined): string {
  if (!seconds) return '-';
  return new Date(seconds * 1000).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM sqlite_master WHERE type=? AND name=?').get('table', table));
}

function checkDb(): CheckResult {
  if (!existsSync(DB_PATH)) {
    return {
      status: 'critical',
      title: '数据健康异常：数据库不存在',
      details: [`路径：${DB_PATH}`],
    };
  }

  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    if (!tableExists(db, 'pot_market_snapshots') || !tableExists(db, 'pot_agent_raw_snapshots')) {
      return {
        status: 'critical',
        title: '数据健康异常：关键数据表不存在',
        details: ['缺少 pot_market_snapshots 或 pot_agent_raw_snapshots。'],
      };
    }

    const now = Math.floor(Date.now() / 1000);
    const latest = db.prepare('SELECT max(timestamp) AS ts FROM pot_market_snapshots').get() as { ts: number | null };
    if (!latest.ts) {
      return {
        status: 'critical',
        title: '数据健康异常：没有市场快照',
        details: ['pot_market_snapshots 为空。'],
      };
    }

    const age = now - latest.ts;
    const latestBatch = db.prepare(`
      SELECT
        count(*) AS rows,
        count(token_price_usd) AS usd_price_rows,
        count(market_cap_usd) AS market_cap_rows
      FROM pot_market_snapshots
      WHERE timestamp = ?
    `).get(latest.ts) as {
      rows: number;
      usd_price_rows: number;
      market_cap_rows: number;
    };

    const recentBatches = db.prepare(`
      SELECT
        timestamp,
        count(*) AS rows,
        count(token_price_usd) AS usd_price_rows
      FROM pot_market_snapshots
      GROUP BY timestamp
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(MIN_RECENT_BATCHES) as { timestamp: number; rows: number; usd_price_rows: number }[];

    const gap = db.prepare(`
      WITH batches AS (
        SELECT timestamp, lag(timestamp) OVER (ORDER BY timestamp) AS prev
        FROM pot_market_snapshots
        WHERE timestamp >= ?
        GROUP BY timestamp
      )
      SELECT max(timestamp - prev) AS max_gap
      FROM batches
      WHERE prev IS NOT NULL
    `).get(now - 3600) as { max_gap: number | null };

    const rawLatest = db.prepare(`
      SELECT count(*) AS total, sum(valid) AS valid
      FROM pot_agent_raw_snapshots
      WHERE timestamp = (SELECT max(timestamp) FROM pot_agent_raw_snapshots)
    `).get() as { total: number; valid: number | null };

    const details = [
      `最新市场快照：${bj(latest.ts)}，距现在 ${age} 秒。`,
      `最新批次：${latestBatch.rows} 行，美元价格 ${latestBatch.usd_price_rows} 行，市值 ${latestBatch.market_cap_rows} 行。`,
      `最近 ${MIN_RECENT_BATCHES} 个批次行数：${recentBatches.map((row) => `${bj(row.timestamp)}=${row.rows}/${row.usd_price_rows}`).join('；')}`,
      `最近一小时最大批次间隔：${gap.max_gap ?? 0} 秒。`,
      `最新官网原始批次：${rawLatest.valid ?? 0}/${rawLatest.total} 有效。`,
    ];

    let status: CheckResult['status'] = 'healthy';
    const problems: string[] = [];
    if (age > MAX_STALE_SECONDS) {
      status = 'critical';
      problems.push(`市场快照已经 ${age} 秒没有更新。`);
    }
    if (latestBatch.rows < MIN_ROWS_PER_BATCH) {
      status = status === 'critical' ? status : 'warning';
      problems.push(`最新市场快照只有 ${latestBatch.rows} 行，少于 ${MIN_ROWS_PER_BATCH} 行。`);
    }
    if (latestBatch.usd_price_rows < latestBatch.rows || latestBatch.market_cap_rows < latestBatch.rows) {
      status = status === 'critical' ? status : 'warning';
      problems.push('最新批次存在美元价格或市值字段缺失。');
    }
    if ((gap.max_gap ?? 0) > MAX_BATCH_GAP_SECONDS) {
      status = status === 'critical' ? status : 'warning';
      problems.push(`最近一小时出现 ${gap.max_gap} 秒采集间隔。`);
    }
    if ((rawLatest.valid ?? 0) < rawLatest.total) {
      status = status === 'critical' ? status : 'warning';
      problems.push(`官网原始数据存在无效行：${rawLatest.valid ?? 0}/${rawLatest.total}。`);
    }

    if (status === 'healthy') {
      return {
        status,
        title: '数据健康正常',
        details,
      };
    }
    return {
      status,
      title: status === 'critical' ? '数据健康严重异常' : '数据健康警告',
      details: [...problems, ...details],
    };
  } finally {
    db.close();
  }
}

async function sendFeishu(result: CheckResult) {
  if (!ALERTS_ENABLED || !FEISHU_WEBHOOK) return;
  const prefix = result.status === 'critical' ? '【严重】' : result.status === 'warning' ? '【警告】' : '【恢复】';
  const text = `${prefix}${result.title}\n${result.details.slice(0, 8).join('\n')}`;
  await fetch(FEISHU_WEBHOOK, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      msg_type: 'text',
      content: { text },
    }),
  });
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 1))}…` : value;
}

function feishuMentionPrefix(userId: string | null): string {
  const id = (userId ?? '').trim();
  if (!id) return '';
  if (id === 'all') return '<at user_id="all">所有人</at> ';
  return `<at user_id="${id}"></at> `;
}

function firstDetailMatching(result: CheckResult, pattern: RegExp): string | null {
  return result.details.find((line) => pattern.test(line)) ?? null;
}

function stripTrailingSentencePunctuation(value: string): string {
  return value.replace(/[。.!！]+$/, '');
}

function present(value: string | null): value is string {
  return Boolean(value);
}

export function incidentSummary(result: CheckResult): IncidentSummary {
  const stale = firstDetailMatching(result, /市场快照已经 \d+ 秒没有更新/);
  const latest = firstDetailMatching(result, /^最新市场快照：/);
  const batch = firstDetailMatching(result, /^最新批次：/);
  const raw = firstDetailMatching(result, /^最新官网原始批次：/);

  let cause = 'Pot 主线采集异常。';
  if (/数据库不存在/.test(result.title)) {
    cause = '监控数据库不可读，Pot 主线视为失效。';
  } else if (/关键数据表不存在/.test(result.title)) {
    cause = '监控表缺失，Pot 主线视为失效。';
  } else if (/没有市场快照/.test(result.title)) {
    cause = '还没有任何 Pot 市场快照，主线未开始采集。';
  } else if (stale) {
    cause = stale.replace('市场快照', 'Pot 快照');
  } else if (result.status === 'critical') {
    cause = 'Pot Live P&L 或价格快照已进入严重异常。';
  }

  return {
    cause,
    latest: latest?.replace('最新市场快照：', '') ?? '-',
    coverage: [batch, raw].filter(present).map(stripTrailingSentencePunctuation).join('；') || '-',
  };
}

export function systemIncidentDecision(
  result: CheckResult,
  state: HealthState,
  now: number,
  cooldownSeconds = SYSTEM_INCIDENT_COOLDOWN_SECONDS,
  recoveryAlertsEnabled = SYSTEM_INCIDENT_RECOVERY_ALERTS_ENABLED,
): IncidentDecision {
  const cooldownPassed = !state.lastIncidentAlertAt || now - state.lastIncidentAlertAt >= cooldownSeconds;
  if (result.status === 'critical') {
    return {
      shouldSend: !state.lastIncidentActive || cooldownPassed,
      kind: 'critical',
    };
  }
  if (result.status === 'healthy' && state.lastIncidentActive && recoveryAlertsEnabled) {
    return {
      shouldSend: true,
      kind: 'recovered',
    };
  }
  return { shouldSend: false, kind: 'none' };
}

async function sendSystemIncidentFeishu(result: CheckResult, kind: IncidentDecision['kind']) {
  if (!SYSTEM_INCIDENT_ALERTS_ENABLED || !FEISHU_WEBHOOK || kind === 'none') return;
  const summary = incidentSummary(result);
  const lines = kind === 'critical'
    ? [
        '【监控事故：Pot 主线断采】',
        '影响：Live P&L / 价格快照可能没更新，自动提醒暂时不可信。',
        '动作：立刻打开官网 Pot 人工确认 Top10；不要等系统下一条提醒。',
        `原因：${summary.cause}`,
        `最新：${summary.latest}`,
        `覆盖：${summary.coverage}`,
      ]
    : [
        '【监控恢复：Pot 主线已恢复】',
        '影响：Live P&L / 价格快照已恢复更新。',
        '动作：继续观察下一轮是否稳定；可重新参考系统提醒。',
        `最新：${summary.latest}`,
        `覆盖：${summary.coverage}`,
      ];
  const text = lines.join('\n');
  await fetch(FEISHU_WEBHOOK, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      msg_type: 'text',
      content: { text: `${feishuMentionPrefix(SYSTEM_INCIDENT_MENTION_USER_ID)}${truncateText(text, 1200)}` },
    }),
  });
}

export async function main() {
  const result = checkDb();
  const now = Math.floor(Date.now() / 1000);
  const state = loadState();
  const changed = state.lastStatus !== result.status;
  const cooldownPassed = !state.lastAlertAt || now - state.lastAlertAt >= ALERT_COOLDOWN_SECONDS;
  const shouldAlert = result.status !== 'healthy'
    ? changed || cooldownPassed
    : state.lastStatus && state.lastStatus !== 'healthy';

  console.log(JSON.stringify(result));

  if (shouldAlert) {
    await sendFeishu(result);
    state.lastAlertAt = now;
  }
  const incident = systemIncidentDecision(result, state, now);
  if (incident.shouldSend) {
    await sendSystemIncidentFeishu(result, incident.kind);
    state.lastIncidentAlertAt = now;
  }
  state.lastIncidentActive = result.status === 'critical';
  state.lastStatus = result.status;
  saveState(state);
}

if (process.env.CHAIN_RADAR_DATA_HEALTH_TEST !== '1') {
  await main();
}
