import Database from 'better-sqlite3';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { analyzeLagSeries, type PnlPricePoint } from './pnlPriceLag.js';

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'chain-radar.db');
const REPORT_PATH = process.env.REPORT_PATH ?? path.join(process.cwd(), 'reports', 'live-pnl-price-lag.html');
const MAX_AGE_HOURS = Number(process.env.REPORT_MAX_AGE_HOURS ?? 48);
const LAG_MINUTES = [-60, -30, -15, -10, -5, 0, 5, 10, 15, 30, 60];
const BASE_WINDOW_MINUTES = Number(process.env.REPORT_BASE_WINDOW_MINUTES ?? 5);
const MIN_SAMPLES = Number(process.env.REPORT_MIN_SAMPLES ?? 12);
const EVENT_LOOKAHEAD_MINUTES = Number(process.env.REPORT_EVENT_LOOKAHEAD_MINUTES ?? 60);
const THRESHOLDS = [1500, 3000, 4500, 6000, 7500, 10000, 15000, 20000, -2500, -4000];

interface MarketRow {
  token_symbol: string;
  agent_name: string;
  timestamp: number;
  official_rank: number;
  live_pnl: number;
  realized_pnl: number;
  unrealized_pnl: number;
  token_price_virtual: number | null;
  virtual_usd: number | null;
  token_price_usd: number | null;
  market_cap_usd: number | null;
  liquidity_usd: number | null;
  volume_24h_usd: number | null;
}

interface ChartPoint {
  t: number;
  pnl: number;
  realized: number;
  unrealized: number;
  pv: number | null;
  vu: number | null;
  pu: number | null;
  mc: number | null;
  liq: number | null;
  vol: number | null;
}

interface TokenSeries {
  token: string;
  agent: string;
  rank: number;
  latestTimestamp: number;
  latestLivePnl: number;
  latestPriceVirtual: number | null;
  latestPriceUsd: number | null;
  latestVirtualUsd: number | null;
  points: ChartPoint[];
}

interface EventRow {
  token: string;
  agent: string;
  timestamp: number;
  threshold: number;
  type: '上穿' | '跌破';
  livePnl: number;
  priceMovePct: number | null;
  delayMinutes: number | null;
  priceUnit: 'virtual' | 'usd';
}

function hasTable(db: Database.Database, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").get(table));
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
    .some((row) => row.name === column);
}

function loadRows(db: Database.Database): MarketRow[] {
  if (!hasTable(db, 'pot_market_snapshots')) return [];
  const hasVirtualPrice = hasColumn(db, 'pot_market_snapshots', 'token_price_virtual');
  const hasVirtualUsd = hasColumn(db, 'pot_market_snapshots', 'virtual_usd');
  const since = Math.floor(Date.now() / 1000) - Math.max(1, MAX_AGE_HOURS) * 3600;
  return db.prepare(`
    SELECT
      token_symbol,
      agent_name,
      timestamp,
      official_rank,
      live_pnl,
      realized_pnl,
      unrealized_pnl,
      ${hasVirtualPrice ? 'token_price_virtual' : 'NULL'} AS token_price_virtual,
      ${hasVirtualUsd ? 'virtual_usd' : 'NULL'} AS virtual_usd,
      token_price_usd,
      market_cap_usd,
      liquidity_usd,
      volume_24h_usd
    FROM pot_market_snapshots
    WHERE timestamp >= ?
      AND (token_price_usd IS NOT NULL OR ${hasVirtualPrice ? 'token_price_virtual IS NOT NULL' : '0'})
    ORDER BY token_symbol ASC, timestamp ASC
  `).all(since) as MarketRow[];
}

function buildSeries(rows: MarketRow[]): TokenSeries[] {
  const grouped = new Map<string, MarketRow[]>();
  for (const row of rows) {
    const token = row.token_symbol.toUpperCase();
    const list = grouped.get(token) ?? [];
    list.push(row);
    grouped.set(token, list);
  }

  return [...grouped.entries()]
    .map(([token, list]) => {
      const sorted = [...list].sort((a, b) => a.timestamp - b.timestamp);
      const latest = sorted[sorted.length - 1];
      return {
        token,
        agent: latest.agent_name,
        rank: latest.official_rank,
        latestTimestamp: latest.timestamp,
        latestLivePnl: latest.live_pnl,
        latestPriceVirtual: latest.token_price_virtual,
        latestPriceUsd: latest.token_price_usd,
        latestVirtualUsd: latest.virtual_usd,
        points: sorted.map((row) => ({
          t: row.timestamp,
          pnl: row.live_pnl,
          realized: row.realized_pnl,
          unrealized: row.unrealized_pnl,
          pv: row.token_price_virtual,
          vu: row.virtual_usd,
          pu: row.token_price_usd,
          mc: row.market_cap_usd,
          liq: row.liquidity_usd,
          vol: row.volume_24h_usd,
        })),
      } satisfies TokenSeries;
    })
    .sort((a, b) => a.rank - b.rank || b.latestLivePnl - a.latestLivePnl);
}

function pointPrice(point: ChartPoint, mode: 'virtual' | 'usd'): number | null {
  return mode === 'virtual' ? point.pv : point.pu;
}

function toPnlPricePoints(series: TokenSeries, mode: 'virtual' | 'usd'): PnlPricePoint[] {
  return series.points
    .map((point) => ({
      timestamp: point.t,
      livePnl: point.pnl,
      tokenPriceUsd: pointPrice(point, mode) ?? 0,
    }))
    .filter((point) => point.tokenPriceUsd > 0);
}

function buildAnalysis(series: TokenSeries[], mode: 'virtual' | 'usd') {
  return series.map((item) => analyzeLagSeries({
    token: item.token,
    points: toPnlPricePoints(item, mode),
    lagMinutes: LAG_MINUTES,
    baseWindowMinutes: BASE_WINDOW_MINUTES,
    minSamples: MIN_SAMPLES,
  }));
}

function buildEvents(series: TokenSeries[], mode: 'virtual' | 'usd'): EventRow[] {
  const lookaheadSeconds = EVENT_LOOKAHEAD_MINUTES * 60;
  const events: EventRow[] = [];

  for (const item of series) {
    const points = item.points
      .filter((point) => pointPrice(point, mode) !== null && pointPrice(point, mode)! > 0)
      .sort((a, b) => a.t - b.t);
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const cur = points[i];
      for (const threshold of THRESHOLDS) {
        const crossedUp = threshold > 0 && prev.pnl < threshold && cur.pnl >= threshold;
        const crossedDown = threshold < 0 && prev.pnl > threshold && cur.pnl <= threshold;
        if (!crossedUp && !crossedDown) continue;
        const startPrice = pointPrice(cur, mode);
        const future = points.filter((point) => point.t > cur.t && point.t <= cur.t + lookaheadSeconds);
        let priceMovePct: number | null = null;
        let delayMinutes: number | null = null;
        if (startPrice && future.length > 0) {
          const target = crossedUp
            ? future.reduce((best, point) => (pointPrice(point, mode)! > pointPrice(best, mode)! ? point : best), future[0])
            : future.reduce((best, point) => (pointPrice(point, mode)! < pointPrice(best, mode)! ? point : best), future[0]);
          const targetPrice = pointPrice(target, mode);
          if (targetPrice) {
            priceMovePct = ((targetPrice / startPrice) - 1) * 100;
            delayMinutes = Math.round((target.t - cur.t) / 60);
          }
        }
        events.push({
          token: item.token,
          agent: item.agent,
          timestamp: cur.t,
          threshold,
          type: crossedUp ? '上穿' : '跌破',
          livePnl: cur.pnl,
          priceMovePct,
          delayMinutes,
          priceUnit: mode,
        });
      }
    }
  }

  return events
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 80);
}

function buildCoverage(rows: MarketRow[]) {
  const timestamps = [...new Set(rows.map((row) => row.timestamp))].sort((a, b) => a - b);
  const firstMarket = timestamps[0] ?? null;
  const latest = timestamps[timestamps.length - 1] ?? null;
  const firstUsd = rows
    .filter((row) => row.token_price_usd !== null && row.token_price_usd > 0)
    .map((row) => row.timestamp)
    .sort((a, b) => a - b)[0] ?? null;
  const latestRows = latest === null ? [] : rows.filter((row) => row.timestamp === latest);
  const expectedBatches = firstMarket !== null && latest !== null
    ? Math.floor((latest - firstMarket) / 60) + 1
    : 0;
  return {
    firstMarket,
    firstUsd,
    latest,
    tokenCount: new Set(rows.map((row) => row.token_symbol.toUpperCase())).size,
    rowCount: rows.length,
    usdRowCount: rows.filter((row) => row.token_price_usd !== null && row.token_price_usd > 0).length,
    latestBatchRows: latestRows.length,
    latestBatchUsdRows: latestRows.filter((row) => row.token_price_usd !== null && row.token_price_usd > 0).length,
    batchCount: timestamps.length,
    expectedBatches,
    coveragePct: expectedBatches > 0 ? timestamps.length / expectedBatches * 100 : null,
  };
}

function jsonForHtml(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function buildHtml(report: {
  generatedAt: string;
  maxAgeHours: number;
  minTimestamp: number | null;
  maxTimestamp: number | null;
  series: TokenSeries[];
  analysis: {
    virtual: ReturnType<typeof buildAnalysis>;
    usd: ReturnType<typeof buildAnalysis>;
  };
  events: {
    virtual: EventRow[];
    usd: EventRow[];
  };
}) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Live P&L 与 Agent 代币价格滞后性观察</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0c1014;
      --panel: #121820;
      --panel-2: #16202a;
      --text: #e7edf3;
      --muted: #91a0ad;
      --line: #263241;
      --blue: #64a6ff;
      --green: #30d18c;
      --red: #ff6b7a;
      --amber: #ffc857;
      --white: #ffffff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    header {
      padding: 22px 28px 14px;
      border-bottom: 1px solid var(--line);
      background: #0f151b;
      position: sticky;
      top: 0;
      z-index: 5;
    }
    h1 { margin: 0 0 8px; font-size: 22px; font-weight: 680; letter-spacing: 0; }
    .subtitle { color: var(--muted); max-width: 1100px; }
    main { padding: 20px 28px 36px; }
    .controls {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
      margin-bottom: 16px;
    }
    select, button {
      background: var(--panel);
      color: var(--text);
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px 10px;
      min-height: 36px;
    }
    button { cursor: pointer; }
    button.active { border-color: var(--blue); color: var(--white); background: #1a2b3e; }
    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1.8fr) minmax(320px, 0.8fr);
      gap: 16px;
      align-items: start;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
    }
    .panel h2 {
      margin: 0 0 10px;
      font-size: 15px;
      font-weight: 660;
      letter-spacing: 0;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 12px;
    }
    .metric {
      background: var(--panel-2);
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 10px;
      min-height: 70px;
    }
    .metric .label { color: var(--muted); font-size: 12px; }
    .metric .value { margin-top: 6px; font-size: 18px; font-weight: 700; }
    .legend {
      display: flex;
      gap: 16px;
      color: var(--muted);
      font-size: 12px;
      margin: 8px 0 0;
      flex-wrap: wrap;
    }
    .dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      margin-right: 6px;
      vertical-align: -1px;
    }
    .blue { background: var(--blue); }
    .green { background: var(--green); }
    .amber { background: var(--amber); }
    .top-grid {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 10px;
    }
    .mini {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      cursor: pointer;
      min-height: 120px;
    }
    .mini.active { border-color: var(--blue); background: #132033; }
    .mini-title {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 6px;
      font-weight: 650;
    }
    .mini-meta { color: var(--muted); font-size: 12px; }
    svg { width: 100%; display: block; }
    .axis { stroke: #415062; stroke-width: 1; }
    .gridline { stroke: #24303d; stroke-width: 1; }
    .pnl-line { fill: none; stroke: var(--blue); stroke-width: 2.2; }
    .price-line { fill: none; stroke: var(--green); stroke-width: 2.2; }
    .threshold { stroke: var(--amber); stroke-width: 1; stroke-dasharray: 5 5; opacity: 0.8; }
    .zero { stroke: #647384; stroke-width: 1; stroke-dasharray: 3 5; }
    .axis-label { fill: var(--muted); font-size: 11px; }
    .empty { color: var(--muted); padding: 24px 0; text-align: center; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { padding: 7px 8px; border-bottom: 1px solid var(--line); text-align: right; white-space: nowrap; }
    th:first-child, td:first-child { text-align: left; }
    th { color: var(--muted); font-weight: 600; }
    .heatmap-wrap { overflow: auto; }
    .heat-cell { color: #081017; font-weight: 650; text-align: center; border-radius: 4px; }
    .events { max-height: 360px; overflow: auto; }
    .note {
      color: var(--muted);
      font-size: 12px;
      margin-top: 10px;
    }
    .health {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 16px;
    }
    .health strong { display: block; margin-top: 5px; font-size: 16px; }
    .stack { display: grid; gap: 16px; margin-top: 16px; }
    @media (max-width: 1100px) {
      .grid { grid-template-columns: 1fr; }
      .top-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .health { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 640px) {
      header, main { padding-left: 14px; padding-right: 14px; }
      .top-grid { grid-template-columns: 1fr; }
      .metrics { grid-template-columns: 1fr; }
      .health { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Live P&L 与 Agent 代币价格滞后性观察</h1>
    <div class="subtitle">默认直接观察 Agent 代币的美元价格。VIRTUAL/USD 只作为底层换算审计字段，不进入主视图。生成时间：${report.generatedAt}</div>
  </header>
  <main>
    <div class="controls">
      <label>Agent <select id="agentSelect"></select></label>
      <button data-hours="1">1小时</button>
      <button data-hours="6">6小时</button>
      <button data-hours="24" class="active">24小时</button>
      <button data-hours="0">全部</button>
    </div>

    <section class="panel" style="margin-bottom:16px">
      <h2>数据可靠性</h2>
      <div id="health" class="health"></div>
      <div class="note">这部分比曲线本身更重要。当前正式研究口径直接使用 Agent 代币美元价格。</div>
    </section>

    <section class="panel" style="margin-bottom:16px">
      <h2>Top10 总览</h2>
      <div id="miniGrid" class="top-grid"></div>
      <div class="note">蓝线是官方跟单实时盈亏，绿线是代币价格指数。绿线晚于蓝线变化，才可能有信息差。</div>
    </section>

    <div class="grid">
      <section class="panel">
        <h2 id="mainTitle">曲线</h2>
        <div class="metrics" id="metrics"></div>
        <div id="mainChart"></div>
        <div class="legend">
          <span><i class="dot blue"></i>官方跟单实时盈亏</span>
          <span><i class="dot green"></i>代币价格指数（起点=100）</span>
          <span><i class="dot amber"></i>关键盈亏阶梯</span>
        </div>
      </section>

      <aside class="panel">
        <h2>当前判断</h2>
        <div id="verdict"></div>
        <div class="note">正 lag 且相关系数为正，表示 Live P&L 可能领先价格。负 lag 表示价格可能已经先动。</div>
      </aside>
    </div>

    <div class="stack">
      <section class="panel">
        <h2>滞后热力图</h2>
        <div id="heatmap" class="heatmap-wrap"></div>
      </section>

      <section class="panel">
        <h2>最近阶梯事件</h2>
        <div id="events" class="events"></div>
      </section>
    </div>
  </main>

  <script>
    const REPORT = ${jsonForHtml(report)};

    let selectedToken = REPORT.series[0]?.token ?? '';
    const mode = 'usd';
    let hours = 24;

    const thresholds = ${jsonForHtml(THRESHOLDS)};

    function el(id) { return document.getElementById(id); }
    function esc(value) {
      return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    }
    function fmtTime(ts) {
      if (!ts) return '-';
      return new Date(ts * 1000).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    }
    function fmtPnl(v) {
      if (!Number.isFinite(v)) return '-';
      const sign = v >= 0 ? '+' : '';
      return sign + '$' + Math.round(v).toLocaleString('en-US');
    }
    function fmtPrice(v) {
      if (!Number.isFinite(v) || v <= 0) return '-';
      if (v >= 1) return '$' + v.toFixed(2);
      if (v >= 0.0001) return '$' + v.toFixed(6);
      return '$' + v.toPrecision(5);
    }
    function fmtPct(v) {
      if (!Number.isFinite(v)) return '-';
      const sign = v >= 0 ? '+' : '';
      return sign + v.toFixed(2) + '%';
    }
    function renderHealth() {
      const c = REPORT.coverage;
      el('health').innerHTML = [
        ['市场快照起点', fmtTime(c.firstMarket)],
        ['美元价格起点', fmtTime(c.firstUsd)],
        ['最新快照', fmtTime(c.latest)],
        ['最新完整度', c.latestBatchRows + ' 行 / 美元价格 ' + c.latestBatchUsdRows + ' 行'],
        ['批次完整率', Number.isFinite(c.coveragePct) ? c.coveragePct.toFixed(1) + '%' : '-']
      ].map(([label, value]) => '<div class="metric"><div class="label">' + label + '</div><strong>' + value + '</strong></div>').join('');
    }
    function priceOf(point) {
      return point.pu;
    }
    function filteredPoints(series) {
      const priced = series.points.filter(p => Number.isFinite(priceOf(p)) && priceOf(p) > 0);
      if (!hours || priced.length === 0) return priced;
      const end = Math.max(...priced.map(p => p.t));
      const start = end - hours * 3600;
      return priced.filter(p => p.t >= start);
    }
    function extent(values, pad = 0.08) {
      const finite = values.filter(Number.isFinite);
      if (finite.length === 0) return [0, 1];
      let min = Math.min(...finite);
      let max = Math.max(...finite);
      if (min === max) {
        const delta = Math.abs(min || 1) * 0.1;
        min -= delta;
        max += delta;
      }
      const span = max - min;
      return [min - span * pad, max + span * pad];
    }
    function linePath(points, x, y) {
      return points.map((p, i) => (i === 0 ? 'M' : 'L') + x(p.x).toFixed(1) + ',' + y(p.y).toFixed(1)).join(' ');
    }
    function drawMainChart(series) {
      const points = filteredPoints(series);
      if (points.length < 2) return '<div class="empty">当前样本太少，曲线会在后续每分钟自动变得可观察。</div>';
      const w = 980, h = 430, l = 64, r = 58, t = 22, b = 40;
      const minT = Math.min(...points.map(p => p.t));
      const maxT = Math.max(...points.map(p => p.t));
      const firstPrice = priceOf(points[0]);
      const chart = points.map(p => ({
        t: p.t,
        pnl: p.pnl,
        priceIndex: priceOf(p) / firstPrice * 100,
      }));
      const [pnlMin, pnlMax] = extent([...chart.map(p => p.pnl), 0, ...thresholds]);
      const [priceMin, priceMax] = extent(chart.map(p => p.priceIndex));
      const x = ts => l + ((ts - minT) / Math.max(1, maxT - minT)) * (w - l - r);
      const yPnl = v => t + (1 - (v - pnlMin) / (pnlMax - pnlMin)) * (h - t - b);
      const yPrice = v => t + (1 - (v - priceMin) / (priceMax - priceMin)) * (h - t - b);
      const pnlPath = linePath(chart.map(p => ({x: p.t, y: p.pnl})), x, yPnl);
      const pricePath = linePath(chart.map(p => ({x: p.t, y: p.priceIndex})), x, yPrice);
      const grid = [0, 0.25, 0.5, 0.75, 1].map(q => {
        const yy = t + q * (h - t - b);
        const pnlValue = pnlMax - q * (pnlMax - pnlMin);
        const priceValue = priceMax - q * (priceMax - priceMin);
        return '<line class="gridline" x1="' + l + '" y1="' + yy + '" x2="' + (w-r) + '" y2="' + yy + '"/>' +
          '<text class="axis-label" x="' + (l-8) + '" y="' + (yy+4) + '" text-anchor="end">' + Math.round(pnlValue).toLocaleString('en-US') + '</text>' +
          '<text class="axis-label" x="' + (w-r+8) + '" y="' + (yy+4) + '">' + priceValue.toFixed(1) + '</text>';
      }).join('');
      const thresh = thresholds
        .filter(v => v >= pnlMin && v <= pnlMax)
        .map(v => '<line class="threshold" x1="' + l + '" y1="' + yPnl(v) + '" x2="' + (w-r) + '" y2="' + yPnl(v) + '"/><text class="axis-label" x="' + (w-r-4) + '" y="' + (yPnl(v)-4) + '" text-anchor="end">' + fmtPnl(v) + '</text>')
        .join('');
      const zero = pnlMin <= 0 && pnlMax >= 0 ? '<line class="zero" x1="' + l + '" y1="' + yPnl(0) + '" x2="' + (w-r) + '" y2="' + yPnl(0) + '"/>' : '';
      const labels = [minT, minT + (maxT-minT)/2, maxT].map(ts => '<text class="axis-label" x="' + x(ts) + '" y="' + (h-12) + '" text-anchor="middle">' + fmtTime(ts) + '</text>').join('');
      return '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img">' +
        grid + zero + thresh +
        '<line class="axis" x1="' + l + '" y1="' + (h-b) + '" x2="' + (w-r) + '" y2="' + (h-b) + '"/>' +
        '<path class="pnl-line" d="' + pnlPath + '"/>' +
        '<path class="price-line" d="' + pricePath + '"/>' +
        labels +
        '<text class="axis-label" x="' + l + '" y="14">盈亏 $</text>' +
        '<text class="axis-label" x="' + (w-r) + '" y="14" text-anchor="end">价格指数</text>' +
      '</svg>';
    }
    function miniChart(series) {
      const oldHours = hours;
      hours = 24;
      const points = filteredPoints(series);
      hours = oldHours;
      if (points.length < 2) return '<div class="empty" style="padding:24px 0 4px">样本少</div>';
      const w = 220, h = 64, pad = 4;
      const minT = Math.min(...points.map(p => p.t));
      const maxT = Math.max(...points.map(p => p.t));
      const firstPrice = priceOf(points[0]);
      const [pnlMin, pnlMax] = extent(points.map(p => p.pnl), 0.1);
      const priceIndexes = points.map(p => priceOf(p) / firstPrice * 100);
      const [priceMin, priceMax] = extent(priceIndexes, 0.1);
      const x = ts => pad + ((ts - minT) / Math.max(1, maxT - minT)) * (w - pad * 2);
      const y1 = v => pad + (1 - (v - pnlMin) / (pnlMax - pnlMin)) * (h - pad * 2);
      const y2 = v => pad + (1 - (v - priceMin) / (priceMax - priceMin)) * (h - pad * 2);
      const pnlPath = linePath(points.map(p => ({x: p.t, y: p.pnl})), x, y1);
      const pricePath = linePath(points.map((p, i) => ({x: p.t, y: priceIndexes[i]})), x, y2);
      return '<svg viewBox="0 0 ' + w + ' ' + h + '"><path class="pnl-line" d="' + pnlPath + '"/><path class="price-line" d="' + pricePath + '"/></svg>';
    }
    function renderMiniGrid() {
      el('miniGrid').innerHTML = REPORT.series.map(series => {
        const active = series.token === selectedToken ? ' active' : '';
        return '<div class="mini' + active + '" data-token="' + esc(series.token) + '">' +
          '<div class="mini-title"><span>' + esc(series.token) + '</span><span class="mini-meta">#' + esc(series.rank) + '</span></div>' +
          '<div class="mini-meta">' + esc(series.agent) + '</div>' +
          miniChart(series) +
          '<div class="mini-meta">实时盈亏 ' + fmtPnl(series.latestLivePnl) + '</div>' +
        '</div>';
      }).join('');
      document.querySelectorAll('.mini').forEach(node => {
        node.addEventListener('click', () => {
          selectedToken = node.getAttribute('data-token');
          render();
        });
      });
    }
    function renderMetrics(series) {
      const points = filteredPoints(series);
      const latest = points[points.length - 1] ?? series.points[series.points.length - 1];
      const first = points[0];
      const price = latest ? priceOf(latest) : null;
      const priceMove = first && latest && priceOf(first) && price ? ((price / priceOf(first)) - 1) * 100 : null;
      el('metrics').innerHTML = [
        ['实时盈亏', fmtPnl(latest?.pnl)],
        ['价格', fmtPrice(price)],
        ['区间价格变化', fmtPct(priceMove)],
        ['样本点', String(points.length)]
      ].map(([label, value]) => '<div class="metric"><div class="label">' + label + '</div><div class="value">' + value + '</div></div>').join('');
    }
    function renderVerdict(series) {
      const analysis = REPORT.analysis[mode].find(item => item.token === series.token);
      const best = analysis?.best;
      const latest = series.points[series.points.length - 1];
      const main = best && best.correlation !== null
        ? analysis.verdict
        : '当前正式口径样本不足，先观察曲线形态，不做滞后结论。';
      el('verdict').innerHTML =
        '<div class="metric" style="margin-bottom:10px"><div class="label">滞后判断</div><div class="value" style="font-size:16px">' + esc(main) + '</div></div>' +
        '<table><tbody>' +
        '<tr><th>Agent</th><td>' + esc(series.agent) + '</td></tr>' +
        '<tr><th>官方排名</th><td>#' + esc(series.rank) + '</td></tr>' +
        '<tr><th>最新时间</th><td>' + fmtTime(latest?.t) + '</td></tr>' +
        '<tr><th>已实现 / 未实现</th><td>' + fmtPnl(latest?.realized) + ' / ' + fmtPnl(latest?.unrealized) + '</td></tr>' +
        '<tr><th>市值 / 流动性</th><td>' + fmtPnl(latest?.mc) + ' / ' + fmtPnl(latest?.liq) + '</td></tr>' +
        '</tbody></table>';
    }
    function heatColor(corr, lag) {
      if (!Number.isFinite(corr)) return 'background:#202a35;color:#6d7b88';
      const strength = Math.min(1, Math.abs(corr));
      const good = corr > 0 && lag > 0;
      const bad = corr > 0 && lag < 0;
      const sync = lag === 0;
      if (good) return 'background:rgba(48,209,140,' + (0.25 + strength * 0.7) + ');color:#07140f';
      if (bad) return 'background:rgba(255,107,122,' + (0.22 + strength * 0.65) + ');color:#18080b';
      if (sync) return 'background:rgba(255,200,87,' + (0.18 + strength * 0.55) + ');color:#171005';
      return 'background:rgba(145,160,173,' + (0.12 + strength * 0.35) + ');color:#e7edf3';
    }
    function renderHeatmap() {
      const rows = REPORT.analysis[mode];
      const header = '<tr><th>Agent</th>' + REPORT.lagMinutes.map(lag => '<th>' + lag + 'm</th>').join('') + '<th>判断</th></tr>';
      const body = rows.map(row => {
        const cells = REPORT.lagMinutes.map(lag => {
          const item = row.correlations.find(c => c.lagMinutes === lag);
          const corr = item?.correlation;
          return '<td class="heat-cell" style="' + heatColor(corr, lag) + '">' + (Number.isFinite(corr) ? corr.toFixed(2) : '-') + '</td>';
        }).join('');
        return '<tr><td>' + esc(row.token) + '</td>' + cells + '<td style="text-align:left">' + esc(row.verdict) + '</td></tr>';
      }).join('');
      el('heatmap').innerHTML = '<table>' + header + body + '</table>';
    }
    function renderEvents() {
      const events = REPORT.events[mode];
      if (!events.length) {
        el('events').innerHTML = '<div class="empty">当前样本内没有新的阶梯事件。</div>';
        return;
      }
      el('events').innerHTML = '<table><thead><tr><th>时间</th><th>Agent</th><th>事件</th><th>实时盈亏</th><th>后续价格变化</th><th>延迟</th></tr></thead><tbody>' +
        events.map(ev => '<tr>' +
          '<td>' + fmtTime(ev.timestamp) + '</td>' +
          '<td>' + esc(ev.token) + '</td>' +
          '<td>' + esc(ev.type) + ' ' + fmtPnl(ev.threshold) + '</td>' +
          '<td>' + fmtPnl(ev.livePnl) + '</td>' +
          '<td>' + fmtPct(ev.priceMovePct) + '</td>' +
          '<td>' + (Number.isFinite(ev.delayMinutes) ? ev.delayMinutes + '分钟' : '-') + '</td>' +
        '</tr>').join('') + '</tbody></table>';
    }
    function render() {
      const series = REPORT.series.find(item => item.token === selectedToken) ?? REPORT.series[0];
      if (!series) {
        document.body.innerHTML = '<main><div class="panel">没有可视化数据。等待服务器采集后重新生成报告。</div></main>';
        return;
      }
      selectedToken = series.token;
      el('agentSelect').value = selectedToken;
      el('mainTitle').textContent = series.token + ' / ' + series.agent;
      renderMetrics(series);
      renderHealth();
      el('mainChart').innerHTML = drawMainChart(series);
      renderVerdict(series);
      renderMiniGrid();
      renderHeatmap();
      renderEvents();
      document.querySelectorAll('button[data-hours]').forEach(btn => {
        btn.classList.toggle('active', Number(btn.getAttribute('data-hours')) === hours);
      });
    }
    function init() {
      const select = el('agentSelect');
      select.innerHTML = REPORT.series.map(s => '<option value="' + esc(s.token) + '">' + esc(s.token) + ' / ' + esc(s.agent) + '</option>').join('');
      select.value = selectedToken;
      select.addEventListener('change', () => {
        selectedToken = select.value;
        render();
      });
      document.querySelectorAll('button[data-hours]').forEach(btn => {
        btn.addEventListener('click', () => {
          hours = Number(btn.getAttribute('data-hours'));
          render();
        });
      });
      render();
    }
    init();
  </script>
</body>
</html>`;
}

if (!existsSync(DB_PATH)) {
  throw new Error(`DB not found: ${DB_PATH}`);
}

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
try {
  const rows = loadRows(db);
  const series = buildSeries(rows);
  const allTimestamps = series.flatMap((item) => item.points.map((point) => point.t));
  const report = {
    generatedAt: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }),
    maxAgeHours: MAX_AGE_HOURS,
    minTimestamp: allTimestamps.length ? Math.min(...allTimestamps) : null,
    maxTimestamp: allTimestamps.length ? Math.max(...allTimestamps) : null,
    coverage: buildCoverage(rows),
    lagMinutes: LAG_MINUTES,
    baseWindowMinutes: BASE_WINDOW_MINUTES,
    minSamples: MIN_SAMPLES,
    series,
    analysis: {
      virtual: buildAnalysis(series, 'virtual'),
      usd: buildAnalysis(series, 'usd'),
    },
    events: {
      virtual: buildEvents(series, 'virtual'),
      usd: buildEvents(series, 'usd'),
    },
  };
  mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, buildHtml(report), 'utf8');
  console.log(`report=${REPORT_PATH}`);
  console.log(`tokens=${series.length}`);
  console.log(`points=${series.reduce((sum, item) => sum + item.points.length, 0)}`);
} finally {
  db.close();
}
