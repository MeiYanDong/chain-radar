import { buildPositionModel } from './positionModel.js';

const SELECTION_FETCH_TIMEOUT_MS = Math.max(1000, Math.round(Number(process.env.SELECTION_FETCH_TIMEOUT_MS ?? 10_000) || 10_000));

type ExpectationLevel = 'high' | 'medium' | 'low' | 'unknown';
type DataFreshness = 'fresh' | 'aging' | 'old' | 'unknown';

export interface LeaderboardAgent {
  id: string;
  name: string;
  tokenAddress?: string;
  agentAddress?: string;
  virtualId?: number;
  tokenSymbol?: string;
  performance?: {
    totalRealizedPnl?: number | null;
    totalMtmPnl?: number | null;
    returnPct?: number | null;
    totalTradeCount?: number | null;
    winRate?: number | null;
    sharpeRatio?: number | null;
    openPerps?: number | null;
    holdingsValueUsd?: number | null;
    totalTradeVolume?: number | null;
    lastTradeAt?: string | null;
    forumPostCount?: number | null;
    calculatedAt?: string | null;
  };
}

interface LeaderboardResponse {
  data?: LeaderboardAgent[];
}

export interface SelectionAgentRow {
  agent_key: string;
  token: string;
  agent: string;
  search_name: string;
  token_address: string | null;
  virtual_id: number | null;
  virtual_url: string | null;
  selected_now: boolean;
  selection_rank: number;
  selection_level: ExpectationLevel;
  selection_score: number;
  realized_pnl: number | null;
  mtm_pnl: number | null;
  holdings_value_usd: number | null;
  capital_efficiency_ratio: number | null;
  api_return_pct: number | null;
  trade_count: number;
  win_rate: number | null;
  sharpe_ratio: number | null;
  open_perps: number;
  forum_posts: number;
  last_trade_at: string | null;
  calculated_at: string | null;
  data_age_minutes: number | null;
  data_freshness: DataFreshness;
  selection_parts: Record<string, number>;
  fundamental_score: number;
  fundamental_ratio: number;
  agent_cap_u: number;
  calendar_phase: string;
  signal_state: string;
  position_layer: string;
  target_position_u: number;
}

export const DEFAULT_SELECTION_EXCLUDED_SYMBOLS = ['AIDOG'];

export function parseSymbolSet(value: string | undefined, fallback: string[]): Set<string> {
  return new Set(
    (value ?? fallback.join(','))
      .split(',')
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean),
  );
}

export function round(value: number | null | undefined, digits = 2): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const m = 10 ** digits;
  return Math.round(value * m) / m;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function levelFromScore(score: number): ExpectationLevel {
  if (score >= 75) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

function symmetricTanhScore(value: number, scale: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(scale) || scale <= 0) return 50;
  return clampPercent(50 + 50 * Math.tanh(value / scale));
}

function positiveTanhScore(value: number, scale: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(scale) || scale <= 0) return 0;
  return clampPercent(100 * Math.tanh(Math.max(0, value) / scale));
}

function quantile(sortedValues: number[], q: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const pos = (sortedValues.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sortedValues[base + 1] ?? sortedValues[base];
  return sortedValues[base] + rest * (next - sortedValues[base]);
}

function distributionTanhScore(value: number | null | undefined, allValues: number[]): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0;
  const values = allValues.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (values.length === 0) return 0;
  const median = quantile(values, 0.5);
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  const iqr = q3 - q1;
  const fallbackScale = Math.max(1, Math.abs(median) || Math.abs(value) || 1);
  const scale = iqr > 0 ? iqr / 2 : fallbackScale;
  return symmetricTanhScore(value - median, scale);
}

function capitalEfficiencyFunctionScores(
  ratio: number | null | undefined,
  holdingsValueUsd: number | null | undefined,
): Record<string, number> {
  const capitalReturnScore = ratio === null || ratio === undefined || !Number.isFinite(ratio)
    ? 0
    : positiveTanhScore(ratio, 0.25);
  const capitalBaseConfidenceScore = positiveTanhScore(holdingsValueUsd ?? 0, 500);
  return {
    capital_return_score: capitalReturnScore,
    capital_base_confidence_score: capitalBaseConfidenceScore,
    capital_efficiency_score: (capitalReturnScore * capitalBaseConfidenceScore) / 100,
  };
}

function statisticalCredibilityFunctionScores(tradeCount: number, winRate: number): Record<string, number> {
  const sampleScore = positiveTanhScore(tradeCount, 60);
  const winRateScore = symmetricTanhScore(winRate - 0.5, 0.12);
  return {
    sample_size_score: sampleScore,
    win_rate_score: winRateScore,
    statistical_credibility_score: clampPercent(sampleScore * (winRateScore / 100)),
  };
}

function activityFunctionScore(lastTradeAt: string | null | undefined, now: number): number {
  if (!lastTradeAt) return 0;
  const t = Date.parse(lastTradeAt);
  if (Number.isNaN(t)) return 0;
  const ageHours = (now - t) / 3_600_000;
  if (ageHours < 0) return 100;
  return clampPercent(100 * Math.exp(-ageHours / 72));
}

function councilEvidenceFunctionScore(forumPostCount: number): number {
  return positiveTanhScore(forumPostCount, 80);
}

function openExposureSafetyFunctionScore(openPerps: number, tradeCount: number): number {
  const openRatio = Math.abs(openPerps) / Math.max(tradeCount, 1);
  return clampPercent(100 * Math.exp(-openRatio / 0.8));
}

function dataAgeMinutes(calculatedAt: string | null | undefined, now: number): number | null {
  if (!calculatedAt) return null;
  const t = Date.parse(calculatedAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, (now - t) / 60_000);
}

function freshnessFromAge(ageMinutes: number | null): DataFreshness {
  if (ageMinutes === null) return 'unknown';
  if (ageMinutes <= 120) return 'fresh';
  if (ageMinutes <= 720) return 'aging';
  return 'old';
}

function capitalEfficiencyRatio(
  realizedPnl: number,
  mtmPnl: number,
  holdingsValueUsd: number | null | undefined,
): number | null {
  if (!holdingsValueUsd || !Number.isFinite(holdingsValueUsd) || holdingsValueUsd <= 0) return null;
  const realizedRatio = realizedPnl / holdingsValueUsd;
  const mtmRatio = mtmPnl / holdingsValueUsd;
  return Math.max(0, (realizedRatio + mtmRatio) / 2);
}

async function fetchJson<T>(url: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const freshUrl = new URL(url);
    freshUrl.searchParams.set('_ts', `${Date.now()}-${attempt}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SELECTION_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(freshUrl, {
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          'cache-control': 'no-cache',
          pragma: 'no-cache',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Failed to fetch ${url}`);
}

function selectionParts(agent: LeaderboardAgent, allAgents: LeaderboardAgent[], now: number) {
  const p = agent.performance ?? {};
  const realizedPnl = p.totalRealizedPnl ?? 0;
  const mtmPnl = p.totalMtmPnl ?? 0;
  const holdingsValueUsd = p.holdingsValueUsd ?? null;
  const efficiencyRatio = capitalEfficiencyRatio(realizedPnl, mtmPnl, holdingsValueUsd);
  const tradeCount = p.totalTradeCount ?? 0;
  const winRate = p.winRate ?? 0;
  const openPerps = p.openPerps ?? 0;
  const forumPostCount = p.forumPostCount ?? 0;
  const mtmValues = allAgents.map((a) => a.performance?.totalMtmPnl ?? 0);
  const realizedValues = allAgents.map((a) => a.performance?.totalRealizedPnl ?? 0);
  const mtmRelativeScore = distributionTanhScore(mtmPnl, mtmValues);
  const realizedRelativeScore = distributionTanhScore(realizedPnl, realizedValues);
  const pnlRelativeScore = (mtmRelativeScore + realizedRelativeScore) / 2;
  const mtmAbsoluteScore = positiveTanhScore(mtmPnl, 150);
  const realizedAbsoluteScore = positiveTanhScore(realizedPnl, 150);
  const pnlAbsoluteScore = (mtmAbsoluteScore + realizedAbsoluteScore) / 2;
  const tradingResultScore = pnlRelativeScore * 0.55 + pnlAbsoluteScore * 0.45;
  const capitalScores = capitalEfficiencyFunctionScores(efficiencyRatio, holdingsValueUsd);
  const credibilityScores = statisticalCredibilityFunctionScores(tradeCount, winRate);

  return {
    mtm_relative_score: mtmRelativeScore,
    realized_relative_score: realizedRelativeScore,
    pnl_relative_score: pnlRelativeScore,
    mtm_absolute_score: mtmAbsoluteScore,
    realized_absolute_score: realizedAbsoluteScore,
    pnl_absolute_score: pnlAbsoluteScore,
    trading_result_score: tradingResultScore,
    ...capitalScores,
    ...credibilityScores,
    activity_score: activityFunctionScore(p.lastTradeAt, now),
    council_evidence_score: councilEvidenceFunctionScore(forumPostCount),
    open_exposure_safety_score: openExposureSafetyFunctionScore(openPerps, tradeCount),
  };
}

function selectionTotal(parts: Record<string, number>): number {
  return (
    (parts.capital_efficiency_score / 100) * 25 +
    (parts.trading_result_score / 100) * 15 +
    (parts.statistical_credibility_score / 100) * 35 +
    (parts.open_exposure_safety_score / 100) * 10 +
    (parts.activity_score / 100) * 10 +
    (parts.council_evidence_score / 100) * 5
  );
}

function agentKey(agent: LeaderboardAgent, symbol: string): string {
  return agent.virtualId ? `virtual:${agent.virtualId}` : `symbol:${symbol}:agent:${agent.name}`;
}

export function buildSelectionRows(
  agents: LeaderboardAgent[],
  selectedSymbols: Set<string>,
  excludedSymbols: Set<string>,
  now = Date.now(),
  maxAgentCapU = 200,
  minActionTargetU = 10,
): SelectionAgentRow[] {
  const rows = agents
    .filter((agent) => agent.tokenSymbol)
    .filter((agent) => agent.performance)
    .filter((agent) => !excludedSymbols.has(agent.tokenSymbol!.toUpperCase()))
    .map((agent) => {
      const p = agent.performance!;
      const symbol = agent.tokenSymbol!.toUpperCase();
      const partsRaw = selectionParts(agent, agents, now);
      const total = selectionTotal(partsRaw);
      const ageMinutes = dataAgeMinutes(p.calculatedAt, now);
      const selectedNow = selectedSymbols.has(symbol);

      return {
        agent_key: agentKey(agent, symbol),
        token: symbol,
        agent: agent.name,
        search_name: agent.name,
        token_address: agent.tokenAddress ?? null,
        virtual_id: agent.virtualId ?? null,
        virtual_url: agent.virtualId ? `https://app.virtuals.io/virtuals/${agent.virtualId}` : null,
        selected_now: selectedNow,
        selection_rank: 0,
        selection_level: levelFromScore(total),
        selection_score: round(total)!,
        realized_pnl: round(p.totalRealizedPnl),
        mtm_pnl: round(p.totalMtmPnl),
        holdings_value_usd: round(p.holdingsValueUsd),
        capital_efficiency_ratio: round(
          capitalEfficiencyRatio(p.totalRealizedPnl ?? 0, p.totalMtmPnl ?? 0, p.holdingsValueUsd),
          4,
        ),
        api_return_pct: round(p.returnPct, 4),
        trade_count: p.totalTradeCount ?? 0,
        win_rate: round(p.winRate, 4),
        sharpe_ratio: round(p.sharpeRatio, 4),
        open_perps: p.openPerps ?? 0,
        forum_posts: p.forumPostCount ?? 0,
        last_trade_at: p.lastTradeAt ?? null,
        calculated_at: p.calculatedAt ?? null,
        data_age_minutes: round(ageMinutes),
        data_freshness: freshnessFromAge(ageMinutes),
        selection_parts: Object.fromEntries(Object.entries(partsRaw).map(([k, v]) => [k, round(v)!])),
        fundamental_score: round(total)!,
        fundamental_ratio: 0,
        agent_cap_u: 0,
        calendar_phase: '',
        signal_state: '',
        position_layer: '',
        target_position_u: 0,
      };
    })
    .sort((a, b) => b.selection_score - a.selection_score);

  return rows.map((row, index) => {
    const selectionRank = index + 1;
    const plan = buildPositionModel({
      selectionScore: row.selection_score,
      selectionRank,
      selectedNow: row.selected_now,
      maxAgentCapU,
      minActionTargetU,
    });
    return {
      ...row,
      selection_rank: selectionRank,
      fundamental_ratio: Number(plan.metrics.fundamentalRatio ?? 0),
      agent_cap_u: Number(plan.metrics.agentCapU ?? 0),
      calendar_phase: String(plan.metrics.calendarPhase ?? plan.calendarPhase),
      signal_state: String(plan.metrics.signalState ?? plan.signalState),
      position_layer: String(plan.metrics.positionLayer ?? plan.positionLayer),
      target_position_u: !row.selected_now ? plan.targetU : 0,
    };
  });
}

export async function fetchSelectionRows(
  selectedSymbols: Set<string>,
  excludedSymbols = parseSymbolSet(process.env.EXCLUDED_SYMBOLS, DEFAULT_SELECTION_EXCLUDED_SYMBOLS),
  now = Date.now(),
  maxAgentCapU = 200,
  minActionTargetU = 10,
): Promise<SelectionAgentRow[]> {
  const leaderboard = await fetchJson<LeaderboardResponse>(
    'https://degen.virtuals.io/api/leaderboard?limit=500&sortBy=pnl&sortDir=desc&timeRange=all',
  );
  return buildSelectionRows(leaderboard.data ?? [], selectedSymbols, excludedSymbols, now, maxAgentCapU, minActionTargetU);
}
