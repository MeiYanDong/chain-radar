import assert from 'node:assert/strict';

process.env.CHAIN_RADAR_DATA_HEALTH_TEST = '1';

const { incidentSummary, systemIncidentDecision } = await import('./checkDataHealth.js');

const critical = {
  status: 'critical' as const,
  title: '数据健康严重异常',
  details: ['市场快照已经 600 秒没有更新。'],
};
const warning = {
  status: 'warning' as const,
  title: '数据健康警告',
  details: ['最新批次只有 9 行。'],
};
const healthy = {
  status: 'healthy' as const,
  title: '数据健康正常',
  details: ['最新市场快照正常。'],
};

assert.deepEqual(
  systemIncidentDecision(critical, {}, 1000, 300, true),
  { shouldSend: true, kind: 'critical' },
);

assert.deepEqual(
  systemIncidentDecision(critical, { lastIncidentActive: true, lastIncidentAlertAt: 900 }, 1000, 300, true),
  { shouldSend: false, kind: 'critical' },
);

assert.deepEqual(
  systemIncidentDecision(critical, { lastIncidentActive: true, lastIncidentAlertAt: 600 }, 1000, 300, true),
  { shouldSend: true, kind: 'critical' },
);

assert.deepEqual(
  systemIncidentDecision(warning, { lastIncidentActive: true, lastIncidentAlertAt: 900 }, 1000, 300, true),
  { shouldSend: false, kind: 'none' },
);

assert.deepEqual(
  systemIncidentDecision(healthy, { lastIncidentActive: true, lastIncidentAlertAt: 900 }, 1000, 300, true),
  { shouldSend: true, kind: 'recovered' },
);

assert.deepEqual(
  systemIncidentDecision(healthy, { lastIncidentActive: false, lastIncidentAlertAt: 900 }, 1000, 300, true),
  { shouldSend: false, kind: 'none' },
);

assert.deepEqual(
  incidentSummary({
    status: 'critical',
    title: '数据健康异常：数据库不存在',
    details: ['路径：/tmp/missing.db'],
  }),
  {
    cause: '监控数据库不可读，Pot 主线视为失效。',
    latest: '-',
    coverage: '-',
  },
);

assert.deepEqual(
  incidentSummary({
    status: 'critical',
    title: '数据健康严重异常',
    details: [
      '市场快照已经 600 秒没有更新。',
      '最新市场快照：2026/5/4 11:31:17，距现在 600 秒。',
      '最新批次：10 行，美元价格 10 行，市值 10 行。',
      '最新官网原始批次：10/10 有效。',
    ],
  }),
  {
    cause: 'Pot 快照已经 600 秒没有更新。',
    latest: '2026/5/4 11:31:17，距现在 600 秒。',
    coverage: '最新批次：10 行，美元价格 10 行，市值 10 行；最新官网原始批次：10/10 有效',
  },
);

console.log('data health incident tests passed');
