import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import path from 'path';
import { buildPositionModel } from './positionModel.js';
import { estimatedBurnUsd, potBurnQualityScore, potEdgeScore } from './potScoring.js';

type ExpectationLevel = 'high' | 'medium' | 'low' | 'none' | 'unknown';
type TradabilityStatus = 'unchecked' | 'dex_liquid' | 'low_liquidity' | 'no_pool' | 'unknown';
type DataFreshness = 'fresh' | 'aging' | 'old' | 'unknown';

interface LeaderboardAgent {
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

interface PotPosition {
  pair?: string;
  side?: 'long' | 'short';
  leverage?: number;
  unrealizedPnl?: number;
  notionalSize?: number;
}

interface PotAgent {
  id: string;
  name: string;
  opWalletAddress?: string;
  currentSeason?: {
    seasonId?: string;
    seasonName?: string;
    copyTradeAgentId?: string;
    copyTradeAgentName?: string;
    tokenSymbol?: string;
    virtualId?: number;
    startingCapital?: number;
    finalPnl?: number | null;
    currentValue?: number;
    realizedPnl?: number;
    unrealizedPnl?: number;
    status?: string;
    positions?: PotPosition[];
  } | null;
}

interface PotAgentsResponse {
  data?: PotAgent[];
}

interface PotAgentSnapshotDbRow {
  season_id: string;
  agent_name: string;
  timestamp: number;
  official_rank: number;
  pot_id: string | null;
  pot_name: string;
  season_entry_id: string | null;
  copy_trade_agent_id: string | null;
  copy_trade_agent_wallet: string | null;
  token_symbol: string;
  virtual_id: number | null;
  starting_capital: number;
  current_value: number;
  live_pnl: number;
  realized_pnl: number;
  unrealized_pnl: number;
  season_status: string;
  positions_json: string;
}

interface VirtualAgentResponse {
  data?: {
    id?: number;
    symbol?: string;
    preToken?: string | null;
    mcapInVirtual?: number | string | null;
    fdvInVirtual?: number | string | null;
    liquidityUsd?: number | string | null;
    volume24h?: number | string | null;
    holderCount?: number | null;
  };
}

interface VirtualPriceResponse {
  'virtual-protocol'?: {
    usd?: number;
  };
}

interface GeckoPool {
  attributes?: {
    address?: string;
    reserve_in_usd?: string;
    volume_usd?: {
      h24?: string;
    };
  };
}

interface GeckoPoolsResponse {
  data?: GeckoPool[];
}

interface TradabilityInfo {
  tradability_status: TradabilityStatus;
  dex_pool_count: number;
  dex_liquidity_usd: number | null;
  dex_volume_24h_usd: number | null;
  best_pool_address?: string | null;
}

interface VirtualMarketInfo {
  virtual_id: number;
  symbol: string | null;
  pre_token: string | null;
  market_cap_usd: number | null;
  fdv_usd: number | null;
  liquidity_usd: number | null;
  volume_24h_usd: number | null;
  holder_count: number | null;
  source: 'virtuals_api';
}

interface SelectionScore {
  level: ExpectationLevel;
  total: number;
  parts: Record<string, number>;
}

interface BurnScore {
  level: ExpectationLevel;
  total: number | null;
  parts: Record<string, number | null>;
  inputs?: Record<string, number | null>;
  momentumAvailable: boolean;
  momentumComplete: boolean;
}

interface BurnEdgeScore {
  total: number | null;
  parts: Record<string, number | null>;
  complete: boolean;
  missingFields: string[];
}

interface ExpectationRow {
  token: string;
  agent: string;
  search_name: string;
  token_address: string | null;
  virtual_id: number | null;
  virtual_url: string | null;
  selected_now: boolean;
  pot_official_rank: number | null;
  selection_rank: number;
  selection_level: ExpectationLevel;
  selection_score: number | null;
  burn_level: ExpectationLevel;
  burn_score: number | null;
  edge_score: number | null;
  edge_complete: boolean;
  momentum_available: boolean;
  momentum_complete: boolean;
  confirm_score: number | null;
  confirm_target_u: number | null;
  confirm_parts: Record<string, number | null>;
  fundamental_score?: number | null;
  fundamental_ratio?: number | null;
  agent_cap_u?: number | null;
  pre_selection_cap_u?: number | null;
  confirmation_cap_u?: number | null;
  confirmation_position_score?: number | null;
  pnl_adjustment?: number | null;
  risk_state?: string;
  risk_multiplier?: number | null;
  burn_progress?: number | null;
  calendar_phase?: string;
  signal_state?: string;
  position_layer?: string;
  realized_pnl: number | null;
  mtm_pnl: number | null;
  holdings_value_usd: number | null;
  capital_efficiency_ratio: number | null;
  api_return_pct: number | null;
  return_pct: number | null;
  trade_count: number;
  win_rate: number | null;
  sharpe_ratio: number | null;
  open_perps: number;
  forum_posts: number;
  last_trade_at: string | null;
  calculated_at: string | null;
  data_age_minutes: number | null;
  data_freshness: DataFreshness;
  tradability_status: TradabilityStatus;
  dex_pool_count: number;
  dex_liquidity_usd: number | null;
  dex_volume_24h_usd: number | null;
  best_pool_address?: string | null;
  selection_parts: Record<string, number | null>;
  burn_parts: Record<string, number | null>;
  burn_inputs?: Record<string, number | null>;
  edge_parts: Record<string, number | null>;
  position_stage?: string;
  target_position_u?: number;
  action_rule?: string;
}

const DEFAULT_HELD_SYMBOLS = ['ZMAC', 'NOVA', 'EVERYTRADE', 'WOA', 'BL', 'BENYORKE'];
const DEFAULT_EXCLUDED_SYMBOLS = ['AIDOG'];
const DB_PATH = path.join(process.cwd(), 'data', 'chain-radar.db');

function parseSymbolList(value: string | undefined, fallback: string[]): string[] {
  return (value ?? fallback.join(','))
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function normalizeAgentName(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function parseNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function round(value: number | null | undefined, digits = 2): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const m = 10 ** digits;
  return Math.round(value * m) / m;
}

function levelFromScore(score: number): Exclude<ExpectationLevel, 'none' | 'unknown'> {
  if (score >= 75) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(url: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const freshUrl = new URL(url);
    freshUrl.searchParams.set('_ts', `${Date.now()}-${attempt}`);
    try {
      const res = await fetch(freshUrl, {
        cache: 'no-store',
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
      if (attempt < 3) await sleep(500 * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Failed to fetch ${url}`);
}

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchTradability(
  tokenAddress: string | null,
  minLiquidityUsd: number,
): Promise<TradabilityInfo> {
  if (!tokenAddress) {
    return {
      tradability_status: 'no_pool',
      dex_pool_count: 0,
      dex_liquidity_usd: null,
      dex_volume_24h_usd: null,
      best_pool_address: null,
    };
  }

  try {
    const data = await fetchJson<GeckoPoolsResponse>(
      `https://api.geckoterminal.com/api/v2/networks/base/tokens/${tokenAddress}/pools`,
    );
    const pools = data.data ?? [];
    const parsedPools = pools.map((pool) => ({
      address: pool.attributes?.address ?? null,
      liquidity: toNumber(pool.attributes?.reserve_in_usd),
      volume24h: toNumber(pool.attributes?.volume_usd?.h24),
    }));
    const bestPool = parsedPools.sort((a, b) => b.liquidity - a.liquidity)[0];
    const totalLiquidity = parsedPools.reduce((sum, pool) => sum + pool.liquidity, 0);
    const totalVolume24h = parsedPools.reduce((sum, pool) => sum + pool.volume24h, 0);

    if (pools.length === 0) {
      return {
        tradability_status: 'no_pool',
        dex_pool_count: 0,
        dex_liquidity_usd: null,
        dex_volume_24h_usd: null,
        best_pool_address: null,
      };
    }

    return {
      tradability_status: (bestPool?.liquidity ?? 0) >= minLiquidityUsd ? 'dex_liquid' : 'low_liquidity',
      dex_pool_count: pools.length,
      dex_liquidity_usd: round(bestPool?.liquidity ?? 0),
      dex_volume_24h_usd: round(totalVolume24h),
      best_pool_address: bestPool?.address ?? null,
    };
  } catch {
    return {
      tradability_status: 'unknown',
      dex_pool_count: 0,
      dex_liquidity_usd: null,
      dex_volume_24h_usd: null,
      best_pool_address: null,
    };
  }
}

async function fetchVirtualUsd(): Promise<number> {
  try {
    const data = await fetchJson<VirtualPriceResponse>(
      'https://api.coingecko.com/api/v3/simple/price?ids=virtual-protocol&vs_currencies=usd',
    );
    const price = data['virtual-protocol']?.usd;
    return Number.isFinite(price) && price! > 0 ? price! : 0;
  } catch {
    return 0;
  }
}

async function fetchVirtualMarketInfo(
  virtualId: number,
  virtualUsd: number,
): Promise<VirtualMarketInfo | null> {
  try {
    const data = await fetchJson<VirtualAgentResponse>(`https://api.virtuals.io/api/virtuals/${virtualId}`);
    const agent = data.data;
    if (!agent) return null;

    const mcapInVirtual = optionalNumber(agent.mcapInVirtual);
    const fdvInVirtual = optionalNumber(agent.fdvInVirtual);
    const marketCapUsd = mcapInVirtual !== null && virtualUsd > 0 ? mcapInVirtual * virtualUsd : null;
    const fdvUsd = fdvInVirtual !== null && virtualUsd > 0 ? fdvInVirtual * virtualUsd : marketCapUsd;

    return {
      virtual_id: virtualId,
      symbol: agent.symbol ?? null,
      pre_token: agent.preToken ?? null,
      market_cap_usd: marketCapUsd,
      fdv_usd: fdvUsd,
      liquidity_usd: optionalNumber(agent.liquidityUsd),
      volume_24h_usd: optionalNumber(agent.volume24h),
      holder_count: agent.holderCount ?? null,
      source: 'virtuals_api',
    };
  } catch {
    return null;
  }
}

async function buildVirtualMarketMap(potRows: PotAgent[], virtualUsd: number): Promise<Map<number, VirtualMarketInfo>> {
  const ids = Array.from(new Set(
    potRows
      .map((pot) => pot.currentSeason?.virtualId)
      .filter((id): id is number => Number.isFinite(id)),
  ));
  const entries: Array<readonly [number, VirtualMarketInfo]> = [];
  for (const id of ids) {
    const info = await fetchVirtualMarketInfo(id, virtualUsd);
    if (info) entries.push([id, info] as const);
    await sleep(150);
  }
  return new Map(entries);
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

function selectionScore(agent: LeaderboardAgent, allAgents: LeaderboardAgent[], now: number): SelectionScore {
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
  const resultPart = pnlRelativeScore * 0.55 + pnlAbsoluteScore * 0.45;
  const capitalScores = capitalEfficiencyFunctionScores(efficiencyRatio, holdingsValueUsd);
  const credibilityScores = statisticalCredibilityFunctionScores(tradeCount, winRate);
  const parts: Record<string, number> = {
    mtm_relative_score: mtmRelativeScore,
    realized_relative_score: realizedRelativeScore,
    pnl_relative_score: pnlRelativeScore,
    mtm_absolute_score: mtmAbsoluteScore,
    realized_absolute_score: realizedAbsoluteScore,
    pnl_absolute_score: pnlAbsoluteScore,
    trading_result_score: resultPart,
    ...capitalScores,
    ...credibilityScores,
    activity_score: activityFunctionScore(p.lastTradeAt, now),
    council_evidence_score: councilEvidenceFunctionScore(forumPostCount),
    open_exposure_safety_score: openExposureSafetyFunctionScore(openPerps, tradeCount),
  };

  const total =
    (parts.capital_efficiency_score / 100) * 25 +
    (parts.trading_result_score / 100) * 15 +
    (parts.statistical_credibility_score / 100) * 35 +
    (parts.open_exposure_safety_score / 100) * 10 +
    (parts.activity_score / 100) * 10 +
    (parts.council_evidence_score / 100) * 5;

  return {
    level: agent.performance ? levelFromScore(total) : 'unknown',
    total,
    parts,
  };
}

function pnlDeltaScore(delta: number | null, scale: number): number | null {
  if (delta === null) return null;
  return symmetricTanhScore(delta, scale);
}

function allocationImpactScore(allocation: number, allAllocations: number[]): number {
  const positiveAllocations = allAllocations.filter((value) => value > 0);
  return distributionTanhScore(allocation, positiveAllocations);
}

function selectedConfirmationScore(
  selectionTotal: number,
  allocation: number,
  allAllocations: number[],
): { total: number; parts: Record<string, number> } | null {
  if (!Number.isFinite(allocation) || allocation <= 0) return null;
  const allocationScore = allocationImpactScore(allocation, allAllocations);
  const total = selectionTotal * 0.7 + allocationScore * 0.3;
  return {
    total,
    parts: {
      selection_score_component: selectionTotal,
      official_allocation_score: allocationScore,
      selected_confirmation_score: total,
    },
  };
}

function openReadonlyDb(): Database.Database | null {
  if (!existsSync(DB_PATH)) return null;
  try {
    return new Database(DB_PATH, { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }
}

function parsePositions(value: string): PotPosition[] {
  try {
    const parsed = JSON.parse(value) as PotPosition[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function latestPotAgentRowsFromDb(
  db: Database.Database | null,
  nowSeconds: number,
  maxAgeSeconds: number,
  minRows: number,
): { rows: PotAgent[]; source: string; snapshotTimestamp: number | null } {
  if (!db) return { rows: [], source: 'api', snapshotTimestamp: null };
  try {
    const table = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'pot_agent_snapshots' LIMIT 1",
    ).get();
    if (!table) return { rows: [], source: 'api', snapshotTimestamp: null };

    const latest = db.prepare(`
      SELECT timestamp
      FROM pot_agent_snapshots
      GROUP BY timestamp
      HAVING COUNT(*) >= ?
      ORDER BY timestamp DESC
      LIMIT 1
    `).get(minRows) as
      | { timestamp: number | null }
      | undefined;
    const timestamp = latest?.timestamp ?? null;
    if (!timestamp || nowSeconds - timestamp > maxAgeSeconds) {
      return { rows: [], source: 'api', snapshotTimestamp: timestamp };
    }

    const rows = db.prepare(`
      SELECT *
      FROM pot_agent_snapshots
      WHERE timestamp = ?
      ORDER BY official_rank ASC
    `).all(timestamp) as PotAgentSnapshotDbRow[];

    return {
      source: 'server_db',
      snapshotTimestamp: timestamp,
      rows: rows.map((row) => ({
        id: row.pot_id ?? `${row.season_id}:${row.agent_name}`,
        name: row.pot_name,
        opWalletAddress: undefined,
        currentSeason: {
          seasonId: row.season_id,
          seasonName: `Season ${row.season_id}`,
          copyTradeAgentId: row.copy_trade_agent_id ?? undefined,
          copyTradeAgentName: row.agent_name,
          tokenSymbol: row.token_symbol,
          virtualId: row.virtual_id ?? undefined,
          startingCapital: row.starting_capital,
          finalPnl: row.live_pnl,
          currentValue: row.current_value,
          realizedPnl: row.realized_pnl,
          unrealizedPnl: row.unrealized_pnl,
          status: row.season_status,
          positions: parsePositions(row.positions_json),
        },
      })),
    };
  } catch {
    return { rows: [], source: 'api', snapshotTimestamp: null };
  }
}

function pnlDeltaFromDb(
  db: Database.Database | null,
  agentName: string,
  currentLivePnl: number,
  windowSeconds: number,
  nowSeconds: number,
): number | null {
  if (!db) return null;
  const row = db.prepare(
    `SELECT live_pnl, timestamp FROM pot_pnl_snapshots
     WHERE agent_name = ? AND timestamp <= ?
     ORDER BY timestamp DESC LIMIT 1`,
  ).get(agentName, nowSeconds - windowSeconds) as { live_pnl: number; timestamp: number } | undefined;
  if (!row) return null;
  if (nowSeconds - row.timestamp > windowSeconds + 300) return null;
  return currentLivePnl - row.live_pnl;
}

function burnScore(
  pot: PotAgent['currentSeason'] | null | undefined,
  allPotAgents: PotAgent[],
  db: Database.Database | null,
  now: number,
  market: VirtualMarketInfo | null,
): BurnScore {
  if (!pot) {
    return { level: 'none', total: null, parts: {}, momentumAvailable: false, momentumComplete: false };
  }

  const allocation = pot.startingCapital ?? 0;
  const currentValue = pot.currentValue ?? 0;
  const livePnl = currentValue - allocation;
  const realizedPnl = pot.realizedPnl ?? 0;
  const unrealizedPnl = pot.unrealizedPnl ?? 0;
  if (allocation <= 0 || currentValue <= 0 || !pot.copyTradeAgentName || !Number.isFinite(livePnl)) {
    const estimatedBurn = estimatedBurnUsd(livePnl);
    return {
      level: 'unknown',
      total: null,
      parts: {},
      inputs: {
        pot_allocation_usd: allocation,
        pot_current_value_usd: currentValue,
        pot_live_pnl_usd: livePnl,
        pot_realized_pnl_usd: realizedPnl,
        pot_unrealized_pnl_usd: unrealizedPnl,
        pot_delta_pnl_15m_usd: null,
        pot_delta_pnl_1h_usd: null,
        allocation_usd: allocation,
        current_value_usd: currentValue,
        live_pnl_usd: livePnl,
        realized_pnl_usd: realizedPnl,
        unrealized_pnl_usd: unrealizedPnl,
        estimated_burn_usd: estimatedBurn,
        token_market_cap_usd: market?.market_cap_usd ?? null,
        token_fdv_usd: market?.fdv_usd ?? null,
        token_liquidity_usd: market?.liquidity_usd ?? null,
        token_volume_24h_usd: market?.volume_24h_usd ?? null,
        burn_impact_market_ratio: null,
        burn_impact_liquidity_ratio: null,
        delta_pnl_15m_usd: null,
        delta_pnl_1h_usd: null,
      },
      momentumAvailable: false,
      momentumComplete: false,
    };
  }

  const nowSeconds = Math.floor(now / 1000);
  const delta15m = pnlDeltaFromDb(db, pot.copyTradeAgentName, livePnl, 900, nowSeconds);
  const delta1h = pnlDeltaFromDb(db, pot.copyTradeAgentName, livePnl, 3600, nowSeconds);
  const rapidScore = pnlDeltaScore(delta15m, 2000);
  const hourlyScore = pnlDeltaScore(delta1h, 5000);
  const quality = potBurnQualityScore({
    potLivePnlUsd: livePnl,
    potRealizedPnlUsd: realizedPnl,
    market,
  });
  const parts = {
    pot_live_pnl_foundation_score: quality.parts.pot_live_pnl_foundation_score,
    delta_15m_score: rapidScore,
    delta_1h_score: hourlyScore,
    burn_impact_score: quality.parts.burn_impact_score,
    burn_impact_market_score: quality.parts.burn_impact_market_score,
    burn_impact_liquidity_score: quality.parts.burn_impact_liquidity_score,
    pot_realized_quality_points: quality.parts.pot_realized_quality_points,
  };

  const total = quality.total;

  return {
    level: levelFromScore(total),
    total,
    parts,
    inputs: {
      pot_allocation_usd: allocation,
      pot_current_value_usd: currentValue,
      pot_live_pnl_usd: livePnl,
      pot_realized_pnl_usd: realizedPnl,
      pot_unrealized_pnl_usd: unrealizedPnl,
      pot_delta_pnl_15m_usd: delta15m,
      pot_delta_pnl_1h_usd: delta1h,
      allocation_usd: allocation,
      current_value_usd: currentValue,
      live_pnl_usd: livePnl,
      realized_pnl_usd: realizedPnl,
      unrealized_pnl_usd: unrealizedPnl,
      estimated_burn_usd: quality.estimatedBurnUsd,
      token_market_cap_usd: market?.market_cap_usd ?? null,
      token_fdv_usd: market?.fdv_usd ?? null,
      token_liquidity_usd: market?.liquidity_usd ?? null,
      token_volume_24h_usd: market?.volume_24h_usd ?? null,
      burn_impact_market_ratio: quality.impact.marketImpactRatio,
      burn_impact_liquidity_ratio: quality.impact.liquidityImpactRatio,
      delta_pnl_15m_usd: delta15m,
      delta_pnl_1h_usd: delta1h,
    },
    momentumAvailable: delta15m !== null || delta1h !== null,
    momentumComplete: delta15m !== null && delta1h !== null,
  };
}

function burnEdgeScore(burn: BurnScore): BurnEdgeScore {
  if (burn.total === null || !burn.inputs) return { total: null, parts: {}, complete: false, missingFields: [] };

  const result = potEdgeScore({
    potLivePnlUsd: burn.inputs.pot_live_pnl_usd ?? burn.inputs.live_pnl_usd ?? 0,
    potDelta15mUsd: burn.inputs.pot_delta_pnl_15m_usd ?? burn.inputs.delta_pnl_15m_usd ?? null,
    potDelta1hUsd: burn.inputs.pot_delta_pnl_1h_usd ?? burn.inputs.delta_pnl_1h_usd ?? null,
    burnImpactScore: burn.parts.burn_impact_score ?? 0,
  });

  return {
    total: result.total,
    parts: result.parts,
    complete: result.complete,
    missingFields: result.missingFields,
  };
}

function formatLevel(level: ExpectationLevel): string {
  if (level === 'low') return 'low';
  if (level === 'medium') return 'medium';
  if (level === 'high') return 'high';
  return level;
}

function toExpectationRow(
  agent: LeaderboardAgent,
  allAgents: LeaderboardAgent[],
  potRows: PotAgent[],
  potByVirtualId: Map<number, { pot: NonNullable<PotAgent['currentSeason']>; officialRank: number }>,
  potByName: Map<string, { pot: NonNullable<PotAgent['currentSeason']>; officialRank: number }>,
  db: Database.Database | null,
  now: number,
  marketByVirtualId: Map<number, VirtualMarketInfo>,
): ExpectationRow {
  const symbol = agent.tokenSymbol!.toUpperCase();
  const selection = selectionScore(agent, allAgents, now);
  const matchedPot = agent.virtualId
    ? potByVirtualId.get(agent.virtualId) ?? null
    : null;
  const exactPot = matchedPot ?? potByName.get(normalizeAgentName(agent.name)) ?? null;
  const pot = exactPot?.pot ?? null;
  const burn = burnScore(
    pot,
    potRows,
    db,
    now,
    agent.virtualId ? marketByVirtualId.get(agent.virtualId) ?? null : null,
  );
  const edge = burnEdgeScore(burn);
  const allAllocations = potRows.map((a) => a.currentSeason?.startingCapital ?? 0);
  const confirm = pot ? selectedConfirmationScore(selection.total, pot.startingCapital ?? 0, allAllocations) : null;
  const p = agent.performance ?? {};
  const ageMinutes = dataAgeMinutes(p.calculatedAt, now);

  return {
    token: symbol,
    agent: agent.name,
    search_name: agent.name,
    token_address: agent.tokenAddress ?? null,
    virtual_id: agent.virtualId ?? null,
    virtual_url: agent.virtualId ? `https://app.virtuals.io/virtuals/${agent.virtualId}` : null,
    selected_now: burn.level !== 'none',
    pot_official_rank: exactPot?.officialRank ?? null,
    selection_rank: 0,
    selection_level: selection.level,
    selection_score: round(selection.total),
    burn_level: burn.level,
    burn_score: round(burn.total),
    edge_score: round(edge.total),
    edge_complete: edge.complete,
    momentum_available: burn.momentumAvailable,
    momentum_complete: burn.momentumComplete,
    confirm_score: round(confirm?.total),
    confirm_target_u: null,
    confirm_parts: confirm
      ? Object.fromEntries(Object.entries(confirm.parts).map(([k, v]) => [k, round(v)]))
      : {},
    realized_pnl: round(p.totalRealizedPnl),
    mtm_pnl: round(p.totalMtmPnl),
    holdings_value_usd: round(p.holdingsValueUsd),
    capital_efficiency_ratio: round(capitalEfficiencyRatio(p.totalRealizedPnl ?? 0, p.totalMtmPnl ?? 0, p.holdingsValueUsd), 4),
    api_return_pct: round(p.returnPct, 4),
    return_pct: round(p.returnPct, 4),
    trade_count: p.totalTradeCount ?? 0,
    win_rate: round(p.winRate, 4),
    sharpe_ratio: round(p.sharpeRatio, 4),
    open_perps: p.openPerps ?? 0,
    forum_posts: p.forumPostCount ?? 0,
    last_trade_at: p.lastTradeAt ?? null,
    calculated_at: p.calculatedAt ?? null,
    data_age_minutes: round(ageMinutes),
    data_freshness: freshnessFromAge(ageMinutes),
    tradability_status: 'unchecked',
    dex_pool_count: 0,
    dex_liquidity_usd: null,
    dex_volume_24h_usd: null,
    best_pool_address: null,
    selection_parts: Object.fromEntries(Object.entries(selection.parts).map(([k, v]) => [k, round(v)])),
    burn_parts: Object.fromEntries(Object.entries(burn.parts).map(([k, v]) => [k, round(v)])),
    burn_inputs: burn.inputs
      ? Object.fromEntries(Object.entries(burn.inputs).map(([k, v]) => [k, round(v)]))
      : undefined,
    edge_parts: Object.fromEntries(Object.entries(edge.parts).map(([k, v]) => [k, round(v)])),
  };
}

function positionPlan(
  row: ExpectationRow,
  maxAgentCapU: number,
  minActionTargetU: number,
  nowMs: number,
) {
  const selectionScore = row.selection_score ?? 0;
  const selectionRank = row.selection_rank || Number.POSITIVE_INFINITY;
  const allocationScore = row.confirm_parts.official_allocation_score ?? null;
  const plan = buildPositionModel({
    selectionScore,
    selectionRank,
    selectedNow: row.selected_now,
    allocationScore,
    allocationUsd: row.burn_inputs?.pot_allocation_usd ?? row.burn_inputs?.allocation_usd ?? null,
    livePnlUsd: row.burn_inputs?.pot_live_pnl_usd ?? row.burn_inputs?.live_pnl_usd ?? null,
    delta15mUsd: row.burn_inputs?.pot_delta_pnl_15m_usd ?? row.burn_inputs?.delta_pnl_15m_usd ?? null,
    delta1hUsd: row.burn_inputs?.pot_delta_pnl_1h_usd ?? row.burn_inputs?.delta_pnl_1h_usd ?? null,
    realizedPnlUsd: row.burn_inputs?.pot_realized_pnl_usd ?? row.burn_inputs?.realized_pnl_usd ?? null,
    burnQualityScore: row.burn_score ?? null,
    edgeScore: row.edge_score ?? null,
    edgeComplete: row.edge_complete,
    maxAgentCapU,
    minActionTargetU,
    nowMs,
  });

  return {
    position_stage: plan.stage,
    calendar_phase: plan.calendarPhase,
    signal_state: plan.signalState,
    position_layer: plan.positionLayer,
    target_position_u: plan.targetU,
    action_rule: plan.reason,
    fundamental_score: Number(plan.metrics.fundamentalScore ?? 0),
    fundamental_ratio: Number(plan.metrics.fundamentalRatio ?? 0),
    agent_cap_u: Number(plan.metrics.agentCapU ?? 0),
    pre_selection_cap_u: Number(plan.metrics.selectionCapU ?? 0),
    confirmation_cap_u: Number(plan.metrics.confirmationCapU ?? 0),
    confirm_target_u: row.selected_now ? Number(plan.metrics.finalConfirmationTargetU ?? 0) : null,
    confirmation_position_score: row.selected_now ? Number(plan.metrics.confirmationPositionScore ?? 0) : null,
    pnl_adjustment: row.selected_now ? Number(plan.metrics.pnlAdjustment ?? 0) : null,
    risk_state: row.selected_now ? String(plan.metrics.riskState ?? 'normal') : undefined,
    risk_multiplier: row.selected_now ? Number(plan.metrics.riskMultiplier ?? 1) : null,
    burn_progress: row.selected_now ? Number(plan.metrics.burnProgress ?? 0) : null,
  };
}

function compactTableRows(rows: ExpectationRow[]) {
  return rows.map((row) => ({
    token: row.token,
    searchName: row.search_name,
    selected: row.selected_now ? 'yes' : 'no',
    officialRank: row.pot_official_rank ?? '-',
    rank: row.selection_rank,
    selection: `${formatLevel(row.selection_level)} ${row.selection_score ?? '-'}`,
    agentCapU: row.agent_cap_u ?? '-',
    potLivePnl: row.burn_inputs?.pot_live_pnl_usd ?? row.burn_inputs?.live_pnl_usd ?? '-',
    potRealizedPnl: row.burn_inputs?.pot_realized_pnl_usd ?? row.burn_inputs?.realized_pnl_usd ?? '-',
    signalState: row.signal_state ?? '-',
    positionLayer: row.position_layer ?? row.position_stage ?? '-',
    risk: row.risk_state ? `${row.risk_state} x${row.risk_multiplier ?? '-'}` : '-',
    burnQuality: `${formatLevel(row.burn_level)} ${row.burn_score ?? '-'}`,
    burnTarget: row.burn_progress ?? '-',
    targetU: row.target_position_u,
  }));
}

function burnAuditTableRows(rows: ExpectationRow[]) {
  return rows.map((row) => ({
    officialRank: row.pot_official_rank ?? '-',
    token: row.token,
    potLivePnl: row.burn_inputs?.pot_live_pnl_usd ?? row.burn_inputs?.live_pnl_usd ?? null,
    potRealizedPnl: row.burn_inputs?.pot_realized_pnl_usd ?? row.burn_inputs?.realized_pnl_usd ?? null,
    potUnrealizedPnl: row.burn_inputs?.pot_unrealized_pnl_usd ?? row.burn_inputs?.unrealized_pnl_usd ?? null,
    estimatedBurn: row.burn_inputs?.estimated_burn_usd ?? null,
    marketCap: row.burn_inputs?.token_market_cap_usd ?? null,
    liquidity: row.burn_inputs?.token_liquidity_usd ?? null,
    burnToMarketPct: row.burn_inputs?.burn_impact_market_ratio
      ? round((row.burn_inputs.burn_impact_market_ratio ?? 0) * 100)
      : null,
    burnToLiquidityPct: row.burn_inputs?.burn_impact_liquidity_ratio
      ? round((row.burn_inputs.burn_impact_liquidity_ratio ?? 0) * 100)
      : null,
    burnQuality: row.burn_score,
    risk: row.risk_state ?? null,
    burnTarget: row.burn_progress ?? null,
    signalState: row.signal_state ?? null,
    positionLayer: row.position_layer ?? null,
    targetU: row.target_position_u,
  }));
}

async function main() {
  const heldSymbols = new Set(parseSymbolList(process.env.HELD_SYMBOLS, DEFAULT_HELD_SYMBOLS));
  const excludedSymbols = new Set(parseSymbolList(process.env.EXCLUDED_SYMBOLS, DEFAULT_EXCLUDED_SYMBOLS));
  const earlyAlphaMinScore = parseNumberEnv('EARLY_ALPHA_MIN_SCORE', 75);
  const watchlistMinScore = parseNumberEnv('WATCHLIST_MIN_SCORE', 65);
  const alphaLimit = parseNumberEnv('ALPHA_LIMIT', 10);
  const selectedLimit = parseNumberEnv('SELECTED_LIMIT', 10);
  const minTradableLiquidityUsd = parseNumberEnv('MIN_TRADABLE_LIQUIDITY_USD', 1000);
  const checkDexLiquidity = process.env.CHECK_DEX_LIQUIDITY === '1';
  const positionCapU = parseNumberEnv('POSITION_CAP_U', 200);
  const minActionTargetU = parseNumberEnv('POSITION_MIN_ACTION_U', 10);
  const potAgentSnapshotMaxAgeSeconds = parseNumberEnv('POT_AGENT_SNAPSHOT_MAX_AGE_SECONDS', 1800);
  const potAgentSnapshotMinRows = parseNumberEnv('POT_AGENT_SNAPSHOT_MIN_ROWS', 10);
  const now = Date.now();
  const nowSeconds = Math.floor(now / 1000);
  const db = openReadonlyDb();
  const dbPotAgents = latestPotAgentRowsFromDb(db, nowSeconds, potAgentSnapshotMaxAgeSeconds, potAgentSnapshotMinRows);

  const [leaderboard, apiPotAgents] = await Promise.all([
    fetchJson<LeaderboardResponse>('https://degen.virtuals.io/api/leaderboard?limit=500&sortBy=pnl&sortDir=desc&timeRange=all'),
    dbPotAgents.rows.length > 0
      ? Promise.resolve<PotAgentsResponse>({ data: [] })
      : fetchJson<PotAgentsResponse>('https://degen.virtuals.io/api/pot-agents'),
  ]);

  const allAgents = leaderboard.data ?? [];
  const potRows = dbPotAgents.rows.length > 0 ? dbPotAgents.rows : apiPotAgents.data ?? [];
  const potSource = dbPotAgents.rows.length > 0 ? dbPotAgents.source : 'api';
  const potEntries = potRows
    .map((pot, index) => ({ pot: pot.currentSeason, officialRank: index + 1 }))
    .filter((entry): entry is { pot: NonNullable<PotAgent['currentSeason']>; officialRank: number } => Boolean(entry.pot?.tokenSymbol));
  const potByVirtualId = new Map(
    potEntries
      .filter((entry) => Number.isFinite(entry.pot.virtualId))
      .map((entry) => [entry.pot.virtualId!, entry]),
  );
  const potByName = new Map(
    potEntries
      .filter((entry) => Boolean(entry.pot.copyTradeAgentName))
      .map((entry) => [normalizeAgentName(entry.pot.copyTradeAgentName), entry]),
  );

  const virtualUsd = await fetchVirtualUsd();
  const marketByVirtualId = await buildVirtualMarketMap(potRows, virtualUsd);

  let scoredRows = allAgents
    .filter((agent) => agent.tokenSymbol)
    .filter((agent) => !excludedSymbols.has(agent.tokenSymbol!.toUpperCase()))
    .map((agent) => toExpectationRow(agent, allAgents, potRows, potByVirtualId, potByName, db, now, marketByVirtualId));

  scoredRows = scoredRows
    .sort((a, b) => (b.selection_score ?? -1) - (a.selection_score ?? -1))
    .map((row, index) => ({ ...row, selection_rank: index + 1 }));

  const tradabilityRows = checkDexLiquidity
    ? scoredRows
      .filter((row) => heldSymbols.has(row.token) || row.selected_now || (row.selection_score ?? 0) >= watchlistMinScore)
      .filter((row) => row.token_address)
    : [];
  const tradabilityEntries: Array<readonly [string, TradabilityInfo]> = [];
  for (const row of tradabilityRows) {
    tradabilityEntries.push([
      row.token,
      await fetchTradability(row.token_address, minTradableLiquidityUsd),
    ] as const);
    await sleep(350);
  }
  const tradabilityByToken = new Map(tradabilityEntries);

  scoredRows = scoredRows.map((row) => {
    const tradability = tradabilityByToken.get(row.token);
    const enriched = tradability ? { ...row, ...tradability } : row;
    return {
      ...enriched,
      ...positionPlan(enriched, positionCapU, minActionTargetU, now),
    };
  });

  const holdingRows = scoredRows
    .filter((row) => heldSymbols.has(row.token))
    .sort((a, b) => {
      if (a.selected_now !== b.selected_now) return a.selected_now ? -1 : 1;
      return (b.burn_score ?? -1) - (a.burn_score ?? -1);
    });

  const earlyAlphaRows = scoredRows
    .filter((row) => !row.selected_now)
    .filter((row) => row.selection_level !== 'unknown')
    .filter((row) => (row.selection_score ?? 0) >= earlyAlphaMinScore)
    .sort((a, b) => (b.selection_score ?? -1) - (a.selection_score ?? -1))
    .slice(0, alphaLimit);

  const watchlistRows = scoredRows
    .filter((row) => !row.selected_now)
    .filter((row) => row.selection_level !== 'unknown')
    .filter((row) => (row.selection_score ?? 0) >= watchlistMinScore)
    .filter((row) => (row.selection_score ?? 0) < earlyAlphaMinScore)
    .sort((a, b) => (b.selection_score ?? -1) - (a.selection_score ?? -1))
    .slice(0, alphaLimit);

  const selectedRows = scoredRows
    .filter((row) => row.pot_official_rank !== null)
    .sort((a, b) => (a.pot_official_rank ?? 999) - (b.pot_official_rank ?? 999))
    .slice(0, selectedLimit);

  db?.close();

  console.log(`\nPhase 2.4 Expectation Snapshot (${new Date(now).toISOString()})\n`);
  const potSnapshotTimestamp = potSource === 'server_db' ? dbPotAgents.snapshotTimestamp : null;
  console.log(`Pot source: ${potSource}${potSnapshotTimestamp ? ` @ ${new Date(potSnapshotTimestamp * 1000).toISOString()}` : ''}`);

  console.log('Held exposure:');
  console.table(compactTableRows(holdingRows));

  console.log(`\nEarly alpha candidates (unselected, selection score >= ${earlyAlphaMinScore}):`);
  console.table(compactTableRows(earlyAlphaRows));

  console.log(`\nWatchlist (unselected, selection score ${watchlistMinScore}-${earlyAlphaMinScore - 0.01}):`);
  console.table(compactTableRows(watchlistRows));

  console.log('\nSelected reference top:');
  console.table(compactTableRows(selectedRows));

  console.log('\nBurn expectation breakdown (selected agents):');
  console.table(burnAuditTableRows(selectedRows));

  if (process.env.EXPECTATION_JSON === '1') {
    console.log('\nJSON:');
    console.log(JSON.stringify({
      generated_at: new Date(now).toISOString(),
      held_symbols: Array.from(heldSymbols),
      excluded_symbols: Array.from(excludedSymbols),
      early_alpha_min_score: earlyAlphaMinScore,
      watchlist_min_score: watchlistMinScore,
      check_dex_liquidity: checkDexLiquidity,
      min_tradable_liquidity_usd: minTradableLiquidityUsd,
      pot_source: potSource,
      pot_snapshot_timestamp: potSnapshotTimestamp,
      pot_snapshot_min_rows: potAgentSnapshotMinRows,
      virtual_usd: round(virtualUsd, 4),
      position_model: {
        max_agent_cap_u: positionCapU,
        min_action_target_u: minActionTargetU,
        pre_selection_cap_ratio: 0.3,
        confirmation_cap_ratio: 0.4,
        burn_cap_ratio: 1,
        note: 'target U scales by fundamental_ratio before phase progress and risk multiplier',
      },
      holding_rows: holdingRows,
      early_alpha_rows: earlyAlphaRows,
      watchlist_rows: watchlistRows,
      selected_rows: selectedRows,
    }, null, 2));
  }
}

main().catch((err) => {
  console.error('[expectation] failed:', err);
  process.exitCode = 1;
});
