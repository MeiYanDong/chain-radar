import { config as loadDotenv } from 'dotenv';
import {
  createPublicClient,
  decodeEventLog,
  erc20Abi,
  formatUnits,
  http,
  parseUnits,
  parseAbiItem,
  webSocket,
  type Log,
} from 'viem';
import { base } from 'viem/chains';
import {
  getDb,
  savePnlSnapshot, getPnlSnapshotAt, pruneOldSnapshots, clearAllSnapshots,
  savePotAgentSnapshots, pruneOldPotAgentSnapshots, getLatestCompletePotAgentSnapshots,
  savePotAgentRawSnapshots, pruneOldPotAgentRawSnapshots,
  savePotMarketSnapshots, pruneOldPotMarketSnapshots,
  getLatestSnapshots,
  saveSelectionSnapshot, getSelectionSnapshotAt, getLatestSelectionSnapshots,
  pruneOldSelectionSnapshots,
  savePositionAdviceSnapshot, getLatestPositionAdviceSnapshots, pruneOldPositionAdviceSnapshots,
  hasBuybackEvent, saveBuybackEvent, getBuybackEventCount, saveAutoSellExecution, updateAutoSellExecutionReceipt,
  enqueueNotification, claimDueNotifications, hasRecentNotificationWithPrefix, markNotificationSent,
  markNotificationDeliveryFailed, pruneOldNotifications,
  type PotAgentSnapshotRecord,
  type PotAgentRawSnapshotRecord,
  type PotMarketSnapshotRecord,
  type PositionAdviceSnapshot,
  type SelectionSnapshot,
  type BuybackEventRecord,
  type NotificationField,
  type NotificationTemplate,
} from './db.js';
import {
  DEFAULT_SELECTION_EXCLUDED_SYMBOLS,
  fetchSelectionRows,
  parseSymbolSet,
  type SelectionAgentRow,
} from './selection.js';
import {
  buildPositionModel,
  LIVE_PNL_POSITION_TIERS,
  RISK_EXIT_LOSS_USD,
  RISK_REDUCE_LOSS_USD,
  livePnlTargetRatioFromUsd,
} from './positionModel.js';
import {
  triggeredThresholdKeys,
  highestTriggeredTier,
  positiveTierWithDropBuffer,
  negativeTierWithRecoveryBuffer,
  replaceTierKeys,
  nextTierAfterSentTransition,
  type ThresholdPrefix,
} from './pnlThresholds.js';
import { estimatedBurnUsd, potBurnQualityScore, potEdgeScore } from './potScoring.js';
import {
  autoSellWalletStatus,
  buildAutoSellReadinessReport,
  executeAutoSell,
  type AutoSellReadinessReport,
  type AutoSellResult,
} from './autoSell.js';
import { buildLegacyAutoSellExecutionRecord } from './onchain-exit-engine/auditAdapter.js';
import { buildExitEngineConfigFromEnv } from './onchain-exit-engine/configSchema.js';
import { finalizeSellReceipt } from './onchain-exit-engine/receiptFinalizer.js';
import {
  applyLegacyReceiptFinalization,
  createLegacyAutoSellExecutionStorage,
} from './onchain-exit-engine/storageAdapter.js';

loadDotenv({ override: process.env.CHAIN_RADAR_WATCHER_TEST !== '1' });
const EXIT_ENGINE_CONFIG = buildExitEngineConfigFromEnv(process.env);
const autoSellExecutionStorage = createLegacyAutoSellExecutionStorage({
  saveAutoSellExecution,
  updateAutoSellExecutionReceipt,
});

// --- POT MONITOR: Live P&L Signal Detection ---

const FEISHU_WEBHOOK = process.env.FEISHU_WEBHOOK ?? '';
const FEISHU_URGENT_ENABLED = process.env.FEISHU_URGENT_ENABLED !== '0';
const FEISHU_URGENT_MENTION_USER_ID = process.env.FEISHU_URGENT_MENTION_USER_ID ?? 'all';
const PUSHOVER_ENABLED = process.env.PUSHOVER_ENABLED === '1';
const PUSHOVER_APP_TOKEN = process.env.PUSHOVER_APP_TOKEN ?? '';
const PUSHOVER_USER_KEY = process.env.PUSHOVER_USER_KEY ?? '';
const PUSHOVER_DEVICE = process.env.PUSHOVER_DEVICE ?? '';
const PUSHOVER_TIMEOUT_MS = Math.max(1000, Math.round(parseNumberEnv('PUSHOVER_TIMEOUT_MS', 8_000)));
const PUSHOVER_P0_SOUND = process.env.PUSHOVER_P0_SOUND ?? 'siren';
const PUSHOVER_P1_SOUND = process.env.PUSHOVER_P1_SOUND ?? 'cashregister';
const PUSHOVER_P0_RETRY_SECONDS = clampInt(parseNumberEnv('PUSHOVER_P0_RETRY_SECONDS', 30), 30, 3600);
const PUSHOVER_P0_EXPIRE_SECONDS = clampInt(parseNumberEnv('PUSHOVER_P0_EXPIRE_SECONDS', 300), 60, 10800);
const PNL_POSITIVE_THRESHOLDS = LIVE_PNL_POSITION_TIERS.map((tier) => tier.thresholdUsd);
const PNL_NEGATIVE_THRESHOLDS = [RISK_REDUCE_LOSS_USD, RISK_EXIT_LOSS_USD];
const TIER_DROP_BUFFER_RATIO = 0.9;
const CHANGE_THRESHOLDS = [2000, 5000];
const FIVE_MIN_CHANGE_WINDOW = 300;
const RAPID_CHANGE_WINDOW = 900;
const RAPID_CHANGE_COOLDOWN_MS = 900_000;
const HOURLY_CHANGE_WINDOW = 3600;
const HOURLY_CHANGE_COOLDOWN_MS = 3600_000;
const MONITOR_INTERVAL_MS = parseNumberEnv('MONITOR_INTERVAL_SECONDS', 60) * 1000;
const HTTP_FETCH_TIMEOUT_MS = Math.max(1000, Math.round(parseNumberEnv('HTTP_FETCH_TIMEOUT_MS', 10_000)));
const FEISHU_TIMEOUT_MS = Math.max(1000, Math.round(parseNumberEnv('FEISHU_TIMEOUT_MS', 8_000)));
const FEISHU_OUTBOX_BATCH_SIZE = clampInt(parseNumberEnv('FEISHU_OUTBOX_BATCH_SIZE', 20), 1, 100);
const FEISHU_OUTBOX_MAX_ATTEMPTS = clampInt(parseNumberEnv('FEISHU_OUTBOX_MAX_ATTEMPTS', 20), 1, 100);
const POT_AGENT_SNAPSHOT_RETENTION_SECONDS = parseNumberEnv('POT_AGENT_SNAPSHOT_RETENTION_HOURS', 168) * 3600;
const POT_MARKET_SNAPSHOT_RETENTION_SECONDS = parseNumberEnv('POT_MARKET_SNAPSHOT_RETENTION_DAYS', 30) * 86_400;
const STARTUP_RECOVERY_LOOKBACK_SECONDS = parseNumberEnv('STARTUP_RECOVERY_LOOKBACK_HOURS', 24) * 3600;

const SELECTION_HIGH_SCORE = parseNumberEnv('SELECTION_HIGH_SCORE', 75);
const SELECTION_CRITICAL_MIN_SCORE = parseNumberEnv('SELECTION_CRITICAL_MIN_SCORE', 65);
const SELECTION_RISK_FLOOR_SCORE = parseNumberEnv('SELECTION_RISK_FLOOR_SCORE', 70);
const SELECTION_DELTA_15M_SCORE = parseNumberEnv('SELECTION_DELTA_15M_SCORE', 5);
const SELECTION_DELTA_1H_SCORE = parseNumberEnv('SELECTION_DELTA_1H_SCORE', 8);
const SELECTION_RANK_TOP_STRONG = parseNumberEnv('SELECTION_RANK_TOP_STRONG', 5);
const SELECTION_RANK_TOP_CRITICAL = parseNumberEnv('SELECTION_RANK_TOP_CRITICAL', 10);
const SELECTION_RANK_UP_1H = parseNumberEnv('SELECTION_RANK_UP_1H', 5);
const SELECTION_PART_BOOST_SCORE = parseNumberEnv('SELECTION_PART_BOOST_SCORE', 5);
const SELECTION_ALERT_COOLDOWN_MS = parseNumberEnv('SELECTION_ALERT_COOLDOWN_MINUTES', 30) * 60_000;
const SELECTION_CONFIRM_COOLDOWN_MS = parseNumberEnv('SELECTION_CONFIRM_COOLDOWN_MINUTES', 360) * 60_000;
const SELECTION_SNAPSHOT_RETENTION_SECONDS = parseNumberEnv('SELECTION_SNAPSHOT_RETENTION_HOURS', 24) * 3600;
const SELECTION_EXPECTATION_ALERTS_ENABLED = (
  process.env.SELECTION_EXPECTATION_ALERTS_ENABLED ??
  process.env.SELECTION_SIGNAL_ALERTS_ENABLED ??
  '1'
) !== '0';
const POSITION_CAP_U = parseNumberEnv('POSITION_CAP_U', 200);
const POSITION_MIN_ACTION_U = parseNumberEnv('POSITION_MIN_ACTION_U', 10);
const POSITION_ADVICE_ALERTS_ENABLED = process.env.POSITION_ADVICE_ALERTS_ENABLED === '1';
const POSITION_ADVICE_DELTA_U = parseNumberEnv('POSITION_ADVICE_DELTA_U', 20);
const POSITION_ADVICE_COOLDOWN_MS = parseNumberEnv('POSITION_ADVICE_COOLDOWN_MINUTES', 15) * 60_000;
const POSITION_ADVICE_RETENTION_SECONDS = parseNumberEnv('POSITION_ADVICE_RETENTION_HOURS', 24) * 3600;
const POT_DATA_SOURCE_ALERTS_ENABLED = process.env.POT_DATA_SOURCE_ALERTS_ENABLED === '1';
const POT_SINGLE_AGENT_INVALID_ALERT_COOLDOWN_MS = parseNumberEnv('POT_SINGLE_AGENT_INVALID_ALERT_COOLDOWN_MINUTES', 360) * 60_000;
const POT_DATA_SOURCE_ANOMALY_MIN_ZERO_AGENTS = clampInt(parseNumberEnv('POT_DATA_SOURCE_ANOMALY_MIN_ZERO_AGENTS', 3), 2, 10);
const POT_DATA_SOURCE_DEGRADED_MIN_ZERO_AGENTS = clampInt(parseNumberEnv('POT_DATA_SOURCE_DEGRADED_MIN_ZERO_AGENTS', 2), 1, 10);
const POT_DATA_SOURCE_RECOVERY_CONFIRM_CYCLES = clampInt(parseNumberEnv('POT_DATA_SOURCE_RECOVERY_CONFIRM_CYCLES', 2), 1, 10);
const TRACKED_POT_SEASON_STATUSES = new Set(['ACTIVE', 'DRAINING', 'SETTLED']);
const HELD_SYMBOLS = parseSymbolSet(
  process.env.HELD_SYMBOLS,
  ['ZMAC', 'NOVA', 'EVERYTRADE', 'WOA', 'BL', 'BENYORKE'],
);
const EXCLUDED_SYMBOLS = parseSymbolSet(process.env.EXCLUDED_SYMBOLS, DEFAULT_SELECTION_EXCLUDED_SYMBOLS);
const BUYBACK_MONITOR_ENABLED = process.env.BUYBACK_MONITOR_ENABLED !== '0';
const BUYBACK_EXECUTOR_ADDRESS = EXIT_ENGINE_CONFIG.triggers.officialBuyback.executorAddress.toLowerCase();
const BUYBACK_MONITOR_SOURCE = (process.env.BUYBACK_MONITOR_SOURCE ?? 'rpc').toLowerCase();
const BUYBACK_WINDOW_MODE = (process.env.BUYBACK_WINDOW_MODE ?? 'weekly').toLowerCase();
const BUYBACK_WINDOW_START_DAY = clampInt(parseNumberEnv('BUYBACK_WINDOW_START_DAY', 1), 0, 6);
const BUYBACK_WINDOW_START_HOUR = clampInt(parseNumberEnv('BUYBACK_WINDOW_START_HOUR', 16), 0, 23);
const BUYBACK_WINDOW_END_DAY = clampInt(parseNumberEnv('BUYBACK_WINDOW_END_DAY', 1), 0, 6);
const BUYBACK_WINDOW_END_HOUR = clampInt(parseNumberEnv('BUYBACK_WINDOW_END_HOUR', 20), 0, 24);
const BUYBACK_MONITOR_INTERVAL_MS = Math.max(
  30,
  Math.round(parseNumberEnv(
    'BUYBACK_MONITOR_INTERVAL_MS',
    parseNumberEnv('BUYBACK_MONITOR_INTERVAL_SECONDS', 0.03) * 1000,
  )),
);
const BUYBACK_SCAN_LIMIT = parseNumberEnv('BUYBACK_SCAN_LIMIT', 120);
const BUYBACK_PRIME_HISTORY = process.env.BUYBACK_PRIME_HISTORY !== '0';
const BUYBACK_PRIME_GRACE_SECONDS = parseNumberEnv('BUYBACK_PRIME_GRACE_SECONDS', 120);
const BUYBACK_FAST_BACKFILL_BLOCKS = BigInt(Math.max(0, Math.floor(parseNumberEnv('BUYBACK_FAST_BACKFILL_BLOCKS', 3))));
const BUYBACK_FAST_MAX_BLOCK_RANGE = BigInt(Math.max(1, Math.floor(parseNumberEnv('BUYBACK_FAST_MAX_BLOCK_RANGE', 20))));
const BUYBACK_FLASHBLOCKS_ENABLED = EXIT_ENGINE_CONFIG.integrations.buybackFlashblocksEnabled;
const BUYBACK_FLASHBLOCKS_RECONNECT_MS = Math.max(500, Math.round(parseNumberEnv('BUYBACK_FLASHBLOCKS_RECONNECT_MS', 1_000)));
const BUYBACK_LARGE_BUY_FALLBACK_ENABLED = EXIT_ENGINE_CONFIG.triggers.largeBuy.enabled;
const BUYBACK_LARGE_BUY_THRESHOLD_VIRTUAL = EXIT_ENGINE_CONFIG.triggers.largeBuy.thresholdVirtual;
const BUYBACK_LARGE_BUY_THRESHOLD_VIRTUAL_RAW = BUYBACK_LARGE_BUY_THRESHOLD_VIRTUAL > 0
  ? parseUnits(String(BUYBACK_LARGE_BUY_THRESHOLD_VIRTUAL), 18)
  : 0n;
const BUYBACK_LARGE_BUY_THRESHOLD_USD = EXIT_ENGINE_CONFIG.triggers.largeBuy.thresholdUsd;
const BUYBACK_LARGE_BUY_SYMBOLS = new Set(EXIT_ENGINE_CONFIG.triggers.largeBuy.symbols);
const BUYBACK_LARGE_BUY_VIRTUAL_USD_FALLBACK = EXIT_ENGINE_CONFIG.triggers.largeBuy.virtualUsdFallback;
const AUTO_SELL_HEALTHCHECK_ENABLED = process.env.AUTO_SELL_HEALTHCHECK_ENABLED !== '0';
const AUTO_SELL_HEALTHCHECK_DAY = clampInt(parseNumberEnv('AUTO_SELL_HEALTHCHECK_DAY', 1), 0, 6);
const AUTO_SELL_HEALTHCHECK_HOUR = clampInt(parseNumberEnv('AUTO_SELL_HEALTHCHECK_HOUR', 15), 0, 23);
const AUTO_SELL_HEALTHCHECK_MINUTE = clampInt(parseNumberEnv('AUTO_SELL_HEALTHCHECK_MINUTE', 50), 0, 59);
const AUTO_SELL_HEALTHCHECK_WINDOW_MINUTES = clampInt(parseNumberEnv('AUTO_SELL_HEALTHCHECK_WINDOW_MINUTES', 10), 1, 60);
const AUTO_SELL_HEALTHCHECK_INTERVAL_MS = Math.max(30_000, Math.round(parseNumberEnv('AUTO_SELL_HEALTHCHECK_INTERVAL_SECONDS', 60) * 1000));
const AUTO_SELL_RECEIPT_TIMEOUT_MS = Math.max(5_000, Math.round(parseNumberEnv('AUTO_SELL_RECEIPT_TIMEOUT_SECONDS', 45) * 1000));
const BASESCAN_TX_URL = 'https://basescan.org/tx';
const BLOCKSCOUT_API = 'https://base.blockscout.com/api/v2';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const USDC_TOKEN = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const VIRTUAL_TOKEN = '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b';
const DEFAULT_AUTO_SELL_MARKET_ADDRESS = '0x1A540088125d00dD3990f9dA45CA0859af4d3B01';
const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const BUYBACK_RPC_TIMEOUT_MS = Math.max(100, Math.round(parseNumberEnv('BUYBACK_RPC_TIMEOUT_MS', 1200)));
const BUYBACK_RPC_URLS = [
  EXIT_ENGINE_CONFIG.rpc.primaryUrl || 'https://mainnet.base.org',
  ...EXIT_ENGINE_CONFIG.rpc.fallbackUrls,
]
  .map((value) => value.trim())
  .filter(Boolean)
  .filter((value, index, values) => values.indexOf(value) === index);
const buybackRpcClients = BUYBACK_RPC_URLS.map((url) => createPublicClient({
  chain: base,
  transport: http(url, { retryCount: 0, timeout: BUYBACK_RPC_TIMEOUT_MS }),
}));
type BuybackRpcClient = (typeof buybackRpcClients)[number];

interface AgentPnlData {
  potName: string;
  agentName: string;
  symbol: string;
  livePnl: number;
  seasonId: string;
  virtualId: number;
  positions: { pair: string; side: string; leverage: number; unrealizedPnl: number }[];
  snapshot: PotAgentSnapshotRecord;
}

interface InvalidPotAgentData {
  potName: string;
  agentName: string;
  symbol: string;
  seasonId: string;
  virtualId: number;
  officialRank: number;
  startingCapital: number;
  currentValue: number | null;
  realizedPnl: number;
  unrealizedPnl: number;
  reason: string;
}

interface PotAgentFetchResult {
  agents: AgentPnlData[];
  invalidAgents: InvalidPotAgentData[];
  rawSnapshots: PotAgentRawSnapshotRecord[];
}

type VoiceAlertPriority = 'p0' | 'p1';

interface VoiceAlert {
  priority: VoiceAlertPriority;
  message: string;
  sound?: string;
}

interface FeishuCard {
  title: string;
  template: NotificationTemplate;
  fields: NotificationField[];
  tokenUrl?: string;
  dedupeKey?: string;
  voice?: VoiceAlert;
  onQueued?: () => void;
}

interface BlockscoutTransferAddress {
  hash?: string;
}

interface BlockscoutTokenTransfer {
  block_number: number;
  timestamp: string;
  transaction_hash: string;
  method?: string;
  from?: BlockscoutTransferAddress;
  to?: BlockscoutTransferAddress;
  token?: {
    address_hash?: string;
    decimals?: string;
    symbol?: string;
  };
  total?: {
    decimals?: string;
    value?: string;
  };
}

interface BlockscoutTransferResponse {
  items?: BlockscoutTokenTransfer[];
  next_page_params?: Record<string, string | number | null>;
}

interface DecodedTransferLog {
  token: string;
  from: string;
  to: string;
  value: bigint;
  txHash: string;
  blockNumber: bigint;
}

interface PositionAdvice {
  agentKey: string;
  token: string;
  agentName: string;
  virtualUrl?: string;
  targetU: number;
  stage: string;
  reason: string;
  metrics: Record<string, number | string | null>;
}

interface MarketSnapshot {
  marketCapUsd: number | null;
  fdvUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  tokenPriceVirtual: number | null;
  virtualUsd: number | null;
  tokenPriceUsd: number | null;
  fetchedAtMs: number;
}

interface LivePnlCardContext {
  livePnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
  tokenPriceUsd: number | null;
  delta5m: number | null;
  delta15m: number | null;
  delta1h: number | null;
  delta5mStatus: PnlChangeStatus;
  delta15mStatus: PnlChangeStatus;
  delta1hStatus: PnlChangeStatus;
}

type PnlChangeStatus = 'ok' | '缺少首帧' | '跨度过短' | '跨度过长';

interface PnlChange {
  value: number | null;
  status: PnlChangeStatus;
  baseTimestamp: number | null;
  actualWindowSeconds: number | null;
}

interface PotDataSourceAnomalyState {
  status: 'healthy' | 'anomaly';
  episode: number;
  healthyStreak: number;
  startedAt: number | null;
  lastAnomalyAt: number | null;
  lastUpdateAt: number | null;
  lastZeroCount: number;
  lastValidCount: number;
  lastTotalCount: number;
}

interface PotDataSourceHealth {
  cards: FeishuCard[];
  broadAnomaly: boolean;
  dataSourceUnreliable: boolean;
  activeEpisode: boolean;
  zeroValueAgents: InvalidPotAgentData[];
}

const triggeredThresholds = new Map<string, Set<string>>();
const rapidCooldown = new Map<string, number>();
const hourlyCooldown = new Map<string, number>();
const selectionAlertCooldown = new Map<string, number>();
const positionAdviceCooldown = new Map<string, number>();
const invalidDataAlertCooldown = new Map<string, number>();
let currentSeasonId = '';
let alertBaselinePrimed = false;
let selectionBaselinePrimed = false;
let lastFetchedSelectedSymbols = new Set<string>();
let potMonitorRunning = false;
let buybackMonitorRunning = false;
let autoSellHealthCheckRunning = false;
let buybackPauseLoggedFor = '';
let buybackLastActiveLogMs = 0;
let autoSellHealthCheckLastKey = '';

function potSeasonStatus(status: unknown): string {
  return String(status ?? 'UNKNOWN').toUpperCase();
}

function isTrackedPotSeasonStatus(status: unknown): boolean {
  return TRACKED_POT_SEASON_STATUSES.has(potSeasonStatus(status));
}
let buybackLastScannedBlock: bigint | null = null;
let pushoverConfigWarningLogged = false;
let buybackFallbackRpcErrorLastLogMs = 0;
let flashblocksBuybackMonitorStarted = false;
const tokenMetaCache = new Map<string, { symbol: string; decimals: number }>();
const marketSnapshotCache = new Map<number, MarketSnapshot>();
let virtualUsdCache: { value: number; fetchedAtMs: number } | null = null;
let virtualUsdPrimaryBackoffUntilMs = 0;

interface ChangeSignalConfig {
  label: '15min' | '1H';
  windowSeconds: number;
  cooldownMs: number;
  cooldowns: Map<string, number>;
  signalName: '信息差' | '趋势确认';
}

function parseNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function roundNumber(value: number | null | undefined, digits = 2): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const m = 10 ** digits;
  return Math.round(value * m) / m;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpUrlToWsUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') parsed.protocol = 'wss:';
    else if (parsed.protocol === 'http:') parsed.protocol = 'ws:';
    else if (parsed.protocol !== 'wss:' && parsed.protocol !== 'ws:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function flashblocksWsUrls(): string[] {
  const configured = EXIT_ENGINE_CONFIG.integrations.buybackFlashblocksWsUrls;
  if (configured.length > 0) return [...new Set(configured)];

  const urls: string[] = [];
  const primaryWs = httpUrlToWsUrl(EXIT_ENGINE_CONFIG.rpc.primaryUrl ?? '');
  if (primaryWs) urls.push(primaryWs);
  return [...new Set(urls)];
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = HTTP_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeAgentName(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function symmetricTanhScore(value: number, scale: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(scale) || scale <= 0) return 50;
  return clampPercent(50 + 50 * Math.tanh(value / scale));
}

function positiveTanhScore(value: number, scale: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(scale) || scale <= 0) return 0;
  return clampPercent(100 * Math.tanh(Math.max(0, value) / scale));
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

async function readBuybackRpc<T>(read: (client: BuybackRpcClient) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (const client of buybackRpcClients) {
    try {
      return await read(client);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

function logBuybackFallbackRpcError(label: string, err: unknown) {
  const now = Date.now();
  if (now - buybackFallbackRpcErrorLastLogMs < 60_000) return;
  buybackFallbackRpcErrorLastLogMs = now;
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[BuybackMonitor] large-buy fallback ${label} scan failed: ${message.slice(0, 180)}`);
}

function beijingTimeParts(now = new Date()) {
  const beijing = new Date(now.getTime() + 8 * 3_600_000);
  const hour = beijing.getUTCHours();
  const minute = beijing.getUTCMinutes();
  return {
    day: beijing.getUTCDay(),
    hour,
    minute,
    minuteOfWeek: beijing.getUTCDay() * 24 * 60 + hour * 60 + minute,
    label: beijing.toISOString().replace('T', ' ').slice(0, 16),
  };
}

function dayLabel(day: number): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day] ?? String(day);
}

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

function buybackWindowLabel(): string {
  if (BUYBACK_WINDOW_MODE === 'always') return 'all hours';
  return `Beijing ${dayLabel(BUYBACK_WINDOW_START_DAY)} ${hourLabel(BUYBACK_WINDOW_START_HOUR)} -> ${dayLabel(BUYBACK_WINDOW_END_DAY)} ${hourLabel(BUYBACK_WINDOW_END_HOUR)}`;
}

function isBuybackScanWindow(now = new Date()): boolean {
  if (BUYBACK_WINDOW_MODE === 'always') return true;
  const { minuteOfWeek } = beijingTimeParts(now);
  const start = BUYBACK_WINDOW_START_DAY * 24 * 60 + BUYBACK_WINDOW_START_HOUR * 60;
  const end = BUYBACK_WINDOW_END_DAY * 24 * 60 + BUYBACK_WINDOW_END_HOUR * 60;
  if (start === end) return true;
  if (start < end) return minuteOfWeek >= start && minuteOfWeek < end;
  return minuteOfWeek >= start || minuteOfWeek < end;
}

function addressOf(value: string | undefined): string {
  return (value ?? '').toLowerCase();
}

function asAddress(value: string): `0x${string}` {
  return value as `0x${string}`;
}

function parseAddressValueList(items: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of items) {
    const [address, value] = item.split(':');
    if (!address || !value) continue;
    map.set(address.trim().toLowerCase(), value.trim());
  }
  return map;
}

function configuredTokenMeta(token: string): { symbol: string; decimals: number } | null {
  const key = token.toLowerCase();
  const symbol = parseAddressValueList(EXIT_ENGINE_CONFIG.route.tokenSymbols).get(key);
  const decimalsRaw = parseAddressValueList(EXIT_ENGINE_CONFIG.route.tokenDecimals).get(key);
  const decimals = decimalsRaw !== undefined ? Number(decimalsRaw) : NaN;
  if (!symbol || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) return null;
  return { symbol: symbol.toUpperCase(), decimals };
}

function preapprovedAutoSellTokenSet(): Set<string> {
  const tokens = new Set<string>();
  for (const item of EXIT_ENGINE_CONFIG.route.preapprovedAllowances) {
    const [token] = item.split(':');
    if (token?.trim()) tokens.add(token.trim().toLowerCase());
  }
  return tokens;
}

function largeBuyFallbackTokenAddresses(): `0x${string}`[] {
  if (!BUYBACK_LARGE_BUY_FALLBACK_ENABLED) return [];
  if (BUYBACK_LARGE_BUY_THRESHOLD_VIRTUAL <= 0 && BUYBACK_LARGE_BUY_THRESHOLD_USD <= 0) return [];
  const preapproved = preapprovedAutoSellTokenSet();
  const symbolsByAddress = parseAddressValueList(EXIT_ENGINE_CONFIG.route.tokenSymbols);
  const decimalsByAddress = parseAddressValueList(EXIT_ENGINE_CONFIG.route.tokenDecimals);
  const addresses: `0x${string}`[] = [];
  for (const [address, symbolRaw] of symbolsByAddress.entries()) {
    const symbol = symbolRaw.toUpperCase();
    if (!preapproved.has(address)) continue;
    if (!decimalsByAddress.has(address)) continue;
    if (BUYBACK_LARGE_BUY_SYMBOLS.size > 0 && !BUYBACK_LARGE_BUY_SYMBOLS.has(symbol)) continue;
    addresses.push(asAddress(address));
  }
  return addresses;
}

function defaultAutoSellMarketAddress(): string {
  return EXIT_ENGINE_CONFIG.route.marketAddress || DEFAULT_AUTO_SELL_MARKET_ADDRESS;
}

function decodeTransferLog(log: Log): DecodedTransferLog | null {
  try {
    const { args } = decodeEventLog({
      abi: [TRANSFER_EVENT],
      data: log.data,
      topics: log.topics,
    });
    const transfer = args as { from?: string; to?: string; value?: bigint };
    if (!transfer.from || !transfer.to || transfer.value === undefined || !log.transactionHash || log.blockNumber === null) {
      return null;
    }
    return {
      token: addressOf(log.address),
      from: addressOf(transfer.from),
      to: addressOf(transfer.to),
      value: transfer.value,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
    };
  } catch {
    return null;
  }
}

function decodeTransferLogs(logs: Log[]): DecodedTransferLog[] {
  return logs
    .map(decodeTransferLog)
    .filter((item): item is DecodedTransferLog => Boolean(item));
}

function bigintFromRpcQuantity(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.max(0, Math.floor(value)));
  if (typeof value === 'string' && value.trim()) {
    try {
      return BigInt(value);
    } catch {
      return null;
    }
  }
  return null;
}

function numberFromRpcQuantity(value: unknown): number | undefined {
  const bigint = bigintFromRpcQuantity(value);
  return bigint === null ? undefined : Number(bigint);
}

function normalizeRpcLog(raw: unknown, fallbackTxHash?: string): Log | null {
  const item = raw as Record<string, unknown> | null;
  if (!item) return null;
  const address = typeof item.address === 'string' ? item.address : '';
  const data = typeof item.data === 'string' ? item.data : '';
  const topics = Array.isArray(item.topics) ? item.topics.filter((topic): topic is `0x${string}` => typeof topic === 'string' && topic.startsWith('0x')) : [];
  const txHash = typeof item.transactionHash === 'string'
    ? item.transactionHash
    : typeof item.txHash === 'string'
      ? item.txHash
      : fallbackTxHash;
  if (!address || !data || topics.length === 0 || !txHash) return null;
  return {
    address: asAddress(address),
    data: data as `0x${string}`,
    topics: topics as [`0x${string}`, ...`0x${string}`[]],
    transactionHash: txHash as `0x${string}`,
    blockNumber: bigintFromRpcQuantity(item.blockNumber) ?? 0n,
    blockHash: typeof item.blockHash === 'string' ? item.blockHash as `0x${string}` : null,
    transactionIndex: numberFromRpcQuantity(item.transactionIndex),
    logIndex: numberFromRpcQuantity(item.logIndex),
    removed: Boolean(item.removed),
  } as Log;
}

function txHashesFromLogs(logs: Log[]): `0x${string}`[] {
  return [...new Set(
    logs
      .map((log) => log.transactionHash)
      .filter((hash): hash is `0x${string}` => Boolean(hash)),
  )];
}

function transfersByTxHash(transfers: DecodedTransferLog[]): Map<string, DecodedTransferLog[]> {
  const grouped = new Map<string, DecodedTransferLog[]>();
  for (const item of transfers) {
    const existing = grouped.get(item.txHash) ?? [];
    existing.push(item);
    grouped.set(item.txHash, existing);
  }
  return grouped;
}

async function getTokenMeta(token: string): Promise<{ symbol: string; decimals: number }> {
  const key = token.toLowerCase();
  const cached = tokenMetaCache.get(key);
  if (cached) return cached;
  const configured = configuredTokenMeta(token);
  if (configured) {
    tokenMetaCache.set(key, configured);
    return configured;
  }

  try {
    const [symbol, decimals] = await Promise.all([
      readBuybackRpc((client) => client.readContract({
        address: asAddress(token),
        abi: erc20Abi,
        functionName: 'symbol',
      })),
      readBuybackRpc((client) => client.readContract({
        address: asAddress(token),
        abi: erc20Abi,
        functionName: 'decimals',
      })),
    ]);
    const meta = { symbol: String(symbol).toUpperCase(), decimals: Number(decimals) };
    tokenMetaCache.set(key, meta);
    return meta;
  } catch {
    const meta = { symbol: 'UNKNOWN', decimals: 18 };
    tokenMetaCache.set(key, meta);
    return meta;
  }
}

function transferAmount(item: BlockscoutTokenTransfer): number {
  const decimals = Number(item.total?.decimals ?? item.token?.decimals ?? 18);
  const raw = item.total?.value ?? '0';
  try {
    return Number(BigInt(raw)) / 10 ** decimals;
  } catch {
    return 0;
  }
}

function timestampSeconds(value: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return Math.floor(Date.now() / 1000);
  return Math.floor(parsed / 1000);
}

function shortHash(value: string): string {
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

const AUTO_SELL_STATUS_TEXT: Record<AutoSellResult['status'], string> = {
  disabled: '未开启',
  'missing-key': '未配置私钥',
  'invalid-key': '私钥格式无效',
  'no-balance': '自动卖出钱包无余额',
  'dry-run': '模拟运行，未发交易',
  sent: '已提交卖出交易',
  failed: '执行失败',
  skipped: '已跳过重复/冲突卖出',
};

function autoSellNeedsEmergency(result: AutoSellResult | undefined): boolean {
  if (!result) return false;
  return result.status === 'failed' ||
    result.status === 'missing-key' ||
    result.status === 'invalid-key';
}

function autoSellSummary(result: AutoSellResult | undefined): FeishuCard['fields'] {
  if (!result || result.status === 'disabled') return [];
  const fields: FeishuCard['fields'] = [
    { label: '自动卖出状态', value: AUTO_SELL_STATUS_TEXT[result.status] },
  ];
  if (result.detectedToSubmitMs !== undefined) fields.push({ label: '发现到提交', value: `${result.detectedToSubmitMs}ms` });
  if (result.queueWaitMs !== undefined) fields.push({ label: '队列等待', value: `${result.queueWaitMs}ms` });
  if (result.nonce !== undefined) fields.push({ label: '交易 nonce', value: String(result.nonce) });
  if (result.submitMode) fields.push({ label: '提交路径', value: result.submitMode === 'multi-rpc' ? '多 RPC 并发广播' : '主 RPC' });
  if (result.slippageBps !== undefined) fields.push({ label: '滑点保护', value: `${result.slippageBps / 100}%` });
  if (result.minOutSource) fields.push({ label: '最低收回来源', value: result.minOutSource === 'reference' ? '触发买入价' : result.minOutSource });
  if (result.amountOutMin) fields.push({ label: '最低收回', value: result.amountOutMin });
  if (result.sellTxHash) fields.push({ label: '卖出交易', value: shortHash(result.sellTxHash) });
  if (result.error) fields.push({ label: '失败原因', value: result.error.slice(0, 120) });
  return fields;
}

function logAutoSellResult(event: BuybackEventRecord, result: AutoSellResult) {
  const parts = [
    `status=${result.status}`,
    `token=${event.token_symbol}`,
    `trigger=${shortHash(event.tx_hash)}`,
  ];
  if (result.tokenAmount) parts.push(`amount=${result.tokenAmount}`);
  if (result.detectedToSubmitMs !== undefined) parts.push(`detectedToSubmitMs=${result.detectedToSubmitMs}`);
  if (result.queueWaitMs !== undefined) parts.push(`queueWaitMs=${result.queueWaitMs}`);
  if (result.nonce !== undefined) parts.push(`nonce=${result.nonce}`);
  if (result.submitMode) parts.push(`submitMode=${result.submitMode}`);
  if (result.slippageBps !== undefined) parts.push(`slippageBps=${result.slippageBps}`);
  if (result.minOutSource) parts.push(`minOutSource=${result.minOutSource}`);
  if (result.amountOutMin) parts.push(`amountOutMin=${result.amountOutMin}`);
  if (result.sellTxHash) parts.push(`sell=${shortHash(result.sellTxHash)}`);
  if (result.approveTxHash) parts.push(`approve=${shortHash(result.approveTxHash)}`);
  if (result.approvalSpenderAddress) parts.push(`spender=${shortHash(result.approvalSpenderAddress)}`);
  if (result.error) parts.push(`error=${result.error.slice(0, 160)}`);
  console.log(`[AutoSell] ${parts.join(' | ')}`);
}

function saveAutoSellResult(event: BuybackEventRecord, result: AutoSellResult) {
  autoSellExecutionStorage.saveExecution(buildLegacyAutoSellExecutionRecord(event, result));
  monitorAutoSellReceipt(event, result);
}

function monitorAutoSellReceipt(event: BuybackEventRecord, result: AutoSellResult) {
  if (result.status !== 'sent' || !result.sellTxHash) return;
  const sellTxHash = result.sellTxHash as `0x${string}`;
  void (async () => {
    try {
      const receipt = await readBuybackRpc((client) => client.waitForTransactionReceipt({
        hash: sellTxHash,
        timeout: AUTO_SELL_RECEIPT_TIMEOUT_MS,
      }));
      const finalization = finalizeSellReceipt({ receiptStatus: receipt.status });
      if (finalization.action === 'confirm') {
        applyLegacyReceiptFinalization(
          autoSellExecutionStorage,
          event.tx_hash,
          event.token_address,
          finalization.legacyDbUpdate,
        );
        console.log(`[AutoSellReceipt] status=success | token=${event.token_symbol} | sell=${shortHash(sellTxHash)}`);
        return;
      }

      const error = finalization.error ?? `sell receipt status=${finalization.receiptStatusForDb}`;
      applyLegacyReceiptFinalization(
        autoSellExecutionStorage,
        event.tx_hash,
        event.token_address,
        finalization.legacyDbUpdate,
      );
      console.error(`[AutoSellReceipt] status=${finalization.receiptStatusForDb} | token=${event.token_symbol} | sell=${shortHash(sellTxHash)} | ${error}`);
      enqueueFeishuCard({
        title: `[自动卖出链上失败] ${event.token_symbol}`,
        template: 'red',
        tokenUrl: `${BASESCAN_TX_URL}/${sellTxHash}`,
        dedupeKey: `auto-sell-receipt:${sellTxHash}`,
        voice: voiceAlert('p0', `${event.token_symbol} 自动卖出交易已提交但链上失败，立即查看。`),
        fields: [
          { label: '状态', value: error },
          { label: '卖出交易', value: shortHash(sellTxHash) },
          { label: '触发交易', value: shortHash(event.tx_hash) },
          { label: '市场合约', value: result.marketAddress ? shortHash(result.marketAddress) : '未知' },
          { label: '授权对象', value: result.approvalSpenderAddress ? shortHash(result.approvalSpenderAddress) : '未知' },
        ],
      });
      await flushNotificationOutbox();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const finalization = finalizeSellReceipt({ checkError: message });
      applyLegacyReceiptFinalization(
        autoSellExecutionStorage,
        event.tx_hash,
        event.token_address,
        finalization.legacyDbUpdate,
      );
      console.error(`[AutoSellReceipt] check failed | token=${event.token_symbol} | sell=${shortHash(sellTxHash)} | error=${message.slice(0, 160)}`);
    }
  })();
}

function getTriggeredThresholdKeys(livePnl: number): Set<string> {
  return triggeredThresholdKeys(livePnl, PNL_POSITIVE_THRESHOLDS, PNL_NEGATIVE_THRESHOLDS);
}

function initThresholdsFromDb(): boolean {
  const snapshots = getLatestSnapshots();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const freshSnapshots = snapshots.filter((snapshot) => nowSeconds - snapshot.timestamp <= STARTUP_RECOVERY_LOOKBACK_SECONDS);
  for (const { agent_name, live_pnl } of freshSnapshots) {
    triggeredThresholds.set(agent_name, getTriggeredThresholdKeys(live_pnl));
  }
  const seasons = [...new Set(freshSnapshots.map((snapshot) => snapshot.season_id).filter(Boolean))];
  if (seasons.length === 1) currentSeasonId = seasons[0];
  if (freshSnapshots.length > 0) {
    console.log(`[PotMonitor] Restored thresholds for ${freshSnapshots.length} agents from DB`);
    return true;
  }
  return false;
}

function initSelectionStateFromDb() {
  const snapshots = getLatestSelectionSnapshots();
  if (snapshots.length > 0) {
    console.log(`[SelectionMonitor] Restored latest snapshots for ${snapshots.length} agents from DB`);
  }
}

async function fetchAllAgentPnl(): Promise<PotAgentFetchResult> {
  const res = await fetchWithTimeout('https://degen.virtuals.io/api/pot-agents', {
    cache: 'no-store',
    headers: { accept: 'application/json', 'cache-control': 'no-cache' },
  });
  if (!res.ok) throw new Error(`Pot API HTTP ${res.status}`);
  const json = await res.json();
  const agents: AgentPnlData[] = [];
  const invalidAgents: InvalidPotAgentData[] = [];
  const rawSnapshots: PotAgentRawSnapshotRecord[] = [];
  const selectedSymbols = new Set<string>();
  for (const [index, a] of (json.data ?? []).entries()) {
    const s = a.currentSeason;
    if (!s || !isTrackedPotSeasonStatus(s.status)) continue;
    const status = potSeasonStatus(s.status);
    const agentName = String(s.copyTradeAgentName ?? a.name ?? `rank-${index + 1}`);
    const symbol = String(s.tokenSymbol ?? 'UNKNOWN').toUpperCase();
    const seasonId = String(s.seasonId ?? 'UNKNOWN');
    const currentValue = s.currentValue === null || s.currentValue === undefined ? null : Number(s.currentValue);
    const startingCapital = s.startingCapital === null || s.startingCapital === undefined ? null : Number(s.startingCapital);
    const realizedPnl = Number(s.realizedPnl ?? 0);
    const unrealizedPnl = Number(s.unrealizedPnl ?? 0);
    const valid = Number.isFinite(currentValue) && Number.isFinite(startingCapital) &&
      (currentValue ?? 0) > 0 && (startingCapital ?? 0) > 0;
    const invalidReason = valid
      ? null
      : currentValue === 0 && (startingCapital ?? 0) > 0
        ? '官网返回 currentValue=0'
        : '官网返回无效跟单数据';
    const livePnl = valid && currentValue !== null && startingCapital !== null ? currentValue - startingCapital : null;
    if (s.tokenSymbol) selectedSymbols.add(symbol);
    rawSnapshots.push({
      season_id: seasonId,
      agent_name: agentName,
      official_rank: index + 1,
      pot_id: a.id ?? null,
      pot_name: String(a.name ?? agentName),
      token_symbol: symbol,
      virtual_id: s.virtualId ?? null,
      starting_capital: startingCapital,
      current_value: currentValue,
      live_pnl: livePnl,
      realized_pnl: realizedPnl,
      unrealized_pnl: unrealizedPnl,
      season_status: status,
      valid,
      invalid_reason: invalidReason,
      raw: a,
    });
    if (!valid || livePnl === null || currentValue === null || startingCapital === null) {
      console.log(`[PotMonitor] Skipping ${agentName}: invalid data (cv=${currentValue}, sc=${startingCapital})`);
      invalidAgents.push({
        potName: String(a.name ?? agentName),
        agentName,
        symbol,
        seasonId,
        virtualId: s.virtualId ?? 0,
        officialRank: index + 1,
        startingCapital: startingCapital ?? 0,
        currentValue,
        realizedPnl,
        unrealizedPnl,
        reason: invalidReason ?? '官网返回无效跟单数据',
      });
      continue;
    }
    const positions = (s.positions ?? []).map((p: any) => ({
      pair: p.pair, side: p.side, leverage: p.leverage, unrealizedPnl: p.unrealizedPnl,
    }));
    agents.push({
      potName: String(a.name ?? agentName),
      agentName,
      symbol,
      livePnl,
      seasonId,
      virtualId: s.virtualId ?? 0,
      positions,
      snapshot: {
        season_id: seasonId,
        agent_name: agentName,
        official_rank: index + 1,
        pot_id: a.id ?? null,
        pot_name: String(a.name ?? agentName),
        pot_status: a.status ?? null,
        season_entry_id: s.id ?? null,
        copy_trade_agent_id: s.copyTradeAgentId ?? null,
        copy_trade_agent_wallet: s.copyTradeAgentWallet ?? null,
        token_symbol: symbol,
        virtual_id: s.virtualId ?? null,
        starting_capital: startingCapital,
        current_value: currentValue,
        live_pnl: livePnl,
        realized_pnl: realizedPnl,
        unrealized_pnl: unrealizedPnl,
        season_status: status,
        subscriber_count: s.subscriberCount ?? null,
        positions: s.positions ?? [],
        raw: a,
      },
    });
  }
  lastFetchedSelectedSymbols = selectedSymbols;
  return { agents, invalidAgents, rawSnapshots };
}

function fallbackPotAgentsFromDb(): AgentPnlData[] {
  const snapshots = getLatestCompletePotAgentSnapshots(10, 1800);
  if (snapshots.length === 0) return [];
  return snapshots.map((snapshot) => ({
    potName: snapshot.pot_name,
    agentName: snapshot.agent_name,
    symbol: snapshot.token_symbol,
    livePnl: snapshot.live_pnl,
    seasonId: snapshot.season_id,
    virtualId: snapshot.virtual_id ?? 0,
    positions: (snapshot.positions as any[]).map((p: any) => ({
      pair: p.pair,
      side: p.side,
      leverage: p.leverage,
      unrealizedPnl: p.unrealizedPnl,
    })),
    snapshot,
  }));
}

async function fetchVirtualUsd(): Promise<number> {
  const now = Date.now();
  if (virtualUsdCache && now - virtualUsdCache.fetchedAtMs < 120_000) return virtualUsdCache.value;

  if (now >= virtualUsdPrimaryBackoffUntilMs) {
    try {
      const res = await fetchWithTimeout('https://api.coingecko.com/api/v3/simple/price?ids=virtual-protocol&vs_currencies=usd', {
        cache: 'no-store',
        headers: { accept: 'application/json', 'cache-control': 'no-cache' },
      });
      if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
      const json = await res.json() as { 'virtual-protocol'?: { usd?: number } };
      const value = json['virtual-protocol']?.usd;
      if (Number.isFinite(value) && value! > 0) {
        virtualUsdCache = { value: value!, fetchedAtMs: now };
        return value!;
      }
    } catch {
      virtualUsdPrimaryBackoffUntilMs = now + 15 * 60_000;
      // CoinGecko free endpoint can rate-limit production hosts; DexScreener is the runtime fallback.
    }
  }

  const fallback = await fetchVirtualUsdFromDexScreener();
  if (fallback > 0) {
    virtualUsdCache = { value: fallback, fetchedAtMs: now };
    return fallback;
  }

  return virtualUsdCache?.value ?? 0;
}

async function fetchVirtualUsdFromDexScreener(): Promise<number> {
  try {
    const res = await fetchWithTimeout(`https://api.dexscreener.com/latest/dex/tokens/${VIRTUAL_TOKEN}`, {
      cache: 'no-store',
      headers: { accept: 'application/json', 'cache-control': 'no-cache' },
    });
    if (!res.ok) throw new Error(`DexScreener HTTP ${res.status}`);
    const json = await res.json() as {
      pairs?: {
        chainId?: string;
        priceUsd?: string | number | null;
        liquidity?: { usd?: string | number | null } | null;
      }[];
    };
    const pairs = (json.pairs ?? [])
      .filter((pair) => pair.chainId?.toLowerCase() === 'base')
      .map((pair) => ({
        priceUsd: toNumber(pair.priceUsd),
        liquidityUsd: toNumber(pair.liquidity?.usd),
      }))
      .filter((pair): pair is { priceUsd: number; liquidityUsd: number | null } => pair.priceUsd !== null && pair.priceUsd > 0)
      .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
    return pairs[0]?.priceUsd ?? 0;
  } catch {
    return 0;
  }
}

async function fetchMarketSnapshot(virtualId: number): Promise<MarketSnapshot | null> {
  const now = Date.now();
  const cached = marketSnapshotCache.get(virtualId);
  if (cached && now - cached.fetchedAtMs < 120_000) return cached;
  const virtualUsd = await fetchVirtualUsd();
  try {
    const res = await fetchWithTimeout(`https://api.virtuals.io/api/virtuals/${virtualId}?_ts=${Date.now()}`, {
      cache: 'no-store',
      headers: { accept: 'application/json', 'cache-control': 'no-cache' },
    });
    if (!res.ok) throw new Error(`Virtuals HTTP ${res.status}`);
    const json = await res.json() as {
      data?: {
        mcapInVirtual?: number | string | null;
        fdvInVirtual?: number | string | null;
        liquidityUsd?: number | string | null;
        volume24h?: number | string | null;
        totalSupply?: number | string | null;
      };
    };
    const mcapInVirtual = toNumber(json.data?.mcapInVirtual);
    const fdvInVirtual = toNumber(json.data?.fdvInVirtual);
    const totalSupply = toNumber(json.data?.totalSupply);
    const marketCapUsd = mcapInVirtual !== null && virtualUsd > 0 ? mcapInVirtual * virtualUsd : null;
    const tokenPriceVirtual = mcapInVirtual !== null && totalSupply !== null && totalSupply > 0
      ? mcapInVirtual / totalSupply
      : null;
    const snapshot: MarketSnapshot = {
      marketCapUsd,
      fdvUsd: fdvInVirtual !== null && virtualUsd > 0 ? fdvInVirtual * virtualUsd : null,
      liquidityUsd: toNumber(json.data?.liquidityUsd),
      volume24hUsd: toNumber(json.data?.volume24h),
      tokenPriceVirtual,
      virtualUsd: virtualUsd > 0 ? virtualUsd : null,
      tokenPriceUsd: tokenPriceVirtual !== null && virtualUsd > 0 ? tokenPriceVirtual * virtualUsd : null,
      fetchedAtMs: now,
    };
    marketSnapshotCache.set(virtualId, snapshot);
    return snapshot;
  } catch {
    return cached ?? null;
  }
}

function formatPnl(v: number): string {
  const sign = v >= 0 ? '+' : '';
  return `${sign}$${Math.round(v).toLocaleString()}`;
}

function spokenPnl(v: number): string {
  const abs = Math.round(Math.abs(v)).toLocaleString();
  return v >= 0 ? `正 ${abs} 美元` : `负 ${abs} 美元`;
}

function voiceAlert(priority: VoiceAlertPriority, message: string, sound?: string): VoiceAlert {
  return { priority, message, sound };
}

function metricNumber(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatOptionalPnl(value: number | string | null | undefined): string {
  const n = metricNumber(value);
  return n === null ? '-' : formatPnl(n);
}

function formatChangePnl(value: number | string | null | undefined): string {
  const n = metricNumber(value);
  return n === null ? '数据不足' : formatPnl(n);
}

function formatChangePnlWithStatus(value: number | string | null | undefined, status: number | string | null | undefined): string {
  const n = metricNumber(value);
  if (n !== null) return formatPnl(n);
  const label = typeof status === 'string' ? status : null;
  return label && label !== 'ok' ? `数据不足（${label}）` : '数据不足';
}

function formatBeijingTime(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds)) return '-';
  return new Date(seconds * 1000).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}

function formatUsdPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return '-';
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  if (value >= 0.0001) return `$${value.toFixed(6)}`;
  return `$${value.toPrecision(4)}`;
}

function pnlChange(
  agentName: string,
  currentLivePnl: number,
  endSeconds: number,
  windowSeconds: number,
): PnlChange {
  const targetTimestamp = endSeconds - windowSeconds;
  const toleranceSeconds = windowSeconds <= FIVE_MIN_CHANGE_WINDOW
    ? 90
    : windowSeconds <= RAPID_CHANGE_WINDOW
      ? 180
      : 300;
  const snapshot = getPnlSnapshotAt(agentName, targetTimestamp, toleranceSeconds);
  if (!snapshot) {
    return { value: null, status: '缺少首帧', baseTimestamp: null, actualWindowSeconds: null };
  }
  const actualWindowSeconds = endSeconds - snapshot.timestamp;
  const minWindowSeconds = Math.round(windowSeconds * 0.7);
  const maxWindowSeconds = windowSeconds + toleranceSeconds;
  if (actualWindowSeconds < minWindowSeconds) {
    return { value: null, status: '跨度过短', baseTimestamp: snapshot.timestamp, actualWindowSeconds };
  }
  if (actualWindowSeconds > maxWindowSeconds) {
    return { value: null, status: '跨度过长', baseTimestamp: snapshot.timestamp, actualWindowSeconds };
  }
  return {
    value: currentLivePnl - snapshot.live_pnl,
    status: 'ok',
    baseTimestamp: snapshot.timestamp,
    actualWindowSeconds,
  };
}

function agentSnapshotTimestamp(agent: AgentPnlData, defaultTimestamp: number): number {
  const timestamp = (agent.snapshot as PotAgentSnapshotRecord & { timestamp?: unknown }).timestamp;
  return typeof timestamp === 'number' && Number.isFinite(timestamp) ? timestamp : defaultTimestamp;
}

async function livePnlCardContext(agent: AgentPnlData, nowSeconds: number): Promise<LivePnlCardContext> {
  const endSeconds = agentSnapshotTimestamp(agent, nowSeconds);
  const [change5m, change15m, change1h, market] = await Promise.all([
    Promise.resolve(pnlChange(agent.agentName, agent.livePnl, endSeconds, FIVE_MIN_CHANGE_WINDOW)),
    Promise.resolve(pnlChange(agent.agentName, agent.livePnl, endSeconds, RAPID_CHANGE_WINDOW)),
    Promise.resolve(pnlChange(agent.agentName, agent.livePnl, endSeconds, HOURLY_CHANGE_WINDOW)),
    agent.virtualId ? fetchMarketSnapshot(agent.virtualId) : Promise.resolve(null),
  ]);

  return {
    livePnl: agent.livePnl,
    realizedPnl: agent.snapshot.realized_pnl,
    unrealizedPnl: agent.snapshot.unrealized_pnl,
    tokenPriceUsd: market?.tokenPriceUsd ?? null,
    delta5m: change5m.value,
    delta15m: change15m.value,
    delta1h: change1h.value,
    delta5mStatus: change5m.status,
    delta15mStatus: change15m.status,
    delta1hStatus: change1h.status,
  };
}

async function buildPotMarketSnapshots(
  agents: AgentPnlData[],
  timestamp: number,
): Promise<PotMarketSnapshotRecord[]> {
  const rows = await Promise.all(agents.map(async (agent) => {
    const market = agent.virtualId ? await fetchMarketSnapshot(agent.virtualId) : null;
    return {
      season_id: agent.seasonId,
      agent_name: agent.agentName,
      timestamp,
      official_rank: agent.snapshot.official_rank,
      token_symbol: agent.symbol,
      virtual_id: agent.virtualId || null,
      starting_capital: agent.snapshot.starting_capital,
      current_value: agent.snapshot.current_value,
      live_pnl: agent.livePnl,
      realized_pnl: agent.snapshot.realized_pnl,
      unrealized_pnl: agent.snapshot.unrealized_pnl,
      token_price_virtual: roundNumber(market?.tokenPriceVirtual, 18),
      virtual_usd: roundNumber(market?.virtualUsd, 8),
      token_price_usd: roundNumber(market?.tokenPriceUsd, 12),
      market_cap_usd: roundNumber(market?.marketCapUsd, 2),
      fdv_usd: roundNumber(market?.fdvUsd, 2),
      liquidity_usd: roundNumber(market?.liquidityUsd, 2),
      volume_24h_usd: roundNumber(market?.volume24hUsd, 2),
      data_source: market ? 'pot_api+virtuals_api' : 'pot_api',
    };
  }));
  return rows;
}

function livePnlContextFields(context: LivePnlCardContext): FeishuCard['fields'] {
  return [
    { label: '实时盈亏', value: formatPnl(context.livePnl) },
    { label: '盈亏构成', value: `已实现 ${formatPnl(context.realizedPnl)} / 未实现 ${formatPnl(context.unrealizedPnl)}`, wide: true },
    { label: '当前价格', value: formatUsdPrice(context.tokenPriceUsd) },
    {
      label: '变化量',
      value: `5分钟 ${formatChangePnlWithStatus(context.delta5m, context.delta5mStatus)} / 15分钟 ${formatChangePnlWithStatus(context.delta15m, context.delta15mStatus)} / 1小时 ${formatChangePnlWithStatus(context.delta1h, context.delta1hStatus)}`,
      wide: true,
    },
  ];
}

function pausedPositionAdviceField(): NotificationField {
  return {
    label: '仓位调整',
    value: '已暂停主动仓位调整提醒；本卡只提示 Live P&L 阶梯变化，是否交易由人工另行决定。',
    wide: true,
  };
}

function positiveTierLabel(tier: number): string {
  return tier > 0 ? `+$${tier.toLocaleString()}` : '入选确认仓参考线';
}

function negativeTierLabel(tier: number): string {
  return tier > 0 ? `-$${tier.toLocaleString()}` : '风险解除';
}

function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  return value.toFixed(2);
}

function formatPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  return `${(value * 100).toFixed(digits)}%`;
}

function formatScoreDelta(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
}

function formatRankDelta(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  if (value === 0) return '0';
  return value > 0 ? `+${value}` : `${value}`;
}

function displayWindowLabel(label: string): string {
  if (label === '15min') return '15 分钟';
  if (label === '1H') return '1 小时';
  return label;
}

function displaySelectionPartLabel(value: string): string {
  const labels: Record<string, string> = {
    mtm_relative_score: '浮动收益相对表现',
    realized_relative_score: '已实现收益相对表现',
    pnl_relative_score: '收益相对表现',
    mtm_absolute_score: '浮动收益绝对表现',
    realized_absolute_score: '已实现收益绝对表现',
    pnl_absolute_score: '收益绝对表现',
    trading_result_score: '交易结果',
    capital_return_score: '资金回报',
    capital_base_confidence_score: '资金规模可信度',
    capital_efficiency_score: '资金效率',
    sample_size_score: '交易样本量',
    win_rate_score: '胜率',
    statistical_credibility_score: '样本可信度',
    activity_score: '近期活跃度',
    council_evidence_score: '官方评审可读证据',
    open_exposure_safety_score: '未平仓风险控制',
  };
  return labels[value] ?? value.replace(/_score$/, '');
}

function thresholdColor(threshold: number, positive: boolean): FeishuCard['template'] {
  if (positive) {
    if (threshold >= 10000) return 'green';
    if (threshold >= 5000) return 'turquoise';
    return 'blue';
  }
  if (threshold >= RISK_EXIT_LOSS_USD) return 'red';
  if (threshold >= RISK_REDUCE_LOSS_USD) return 'orange';
  return 'yellow';
}

function zeroValueInvalidAgents(invalidAgents: InvalidPotAgentData[]): InvalidPotAgentData[] {
  return invalidAgents.filter((agent) => agent.currentValue === 0 && agent.startingCapital > 0);
}

function broadPotDataSourceAnomaly(
  invalidAgents: InvalidPotAgentData[],
  validAgentCount: number,
  totalActiveAgentCount: number,
): boolean {
  const zeroValueAgents = zeroValueInvalidAgents(invalidAgents);
  return zeroValueAgents.length >= POT_DATA_SOURCE_ANOMALY_MIN_ZERO_AGENTS ||
    (totalActiveAgentCount >= 8 && validAgentCount <= totalActiveAgentCount - POT_DATA_SOURCE_ANOMALY_MIN_ZERO_AGENTS);
}

function defaultPotDataSourceState(): PotDataSourceAnomalyState {
  return {
    status: 'healthy',
    episode: 0,
    healthyStreak: 0,
    startedAt: null,
    lastAnomalyAt: null,
    lastUpdateAt: null,
    lastZeroCount: 0,
    lastValidCount: 0,
    lastTotalCount: 0,
  };
}

function potDataSourceStateKey(seasonId: string): string {
  return `pot_data_source_anomaly_state:${seasonId}`;
}

function readPotDataSourceState(seasonId: string): PotDataSourceAnomalyState {
  const row = getDb().prepare('SELECT value FROM meta WHERE key = ?').get(potDataSourceStateKey(seasonId)) as
    | { value: string }
    | undefined;
  if (!row) return defaultPotDataSourceState();
  try {
    return { ...defaultPotDataSourceState(), ...JSON.parse(row.value) } as PotDataSourceAnomalyState;
  } catch {
    return defaultPotDataSourceState();
  }
}

function writePotDataSourceState(seasonId: string, state: PotDataSourceAnomalyState) {
  getDb().prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
    potDataSourceStateKey(seasonId),
    JSON.stringify(state),
  );
}

function inferPotSeasonId(
  agents: AgentPnlData[],
  invalidAgents: InvalidPotAgentData[],
  rawSnapshots: PotAgentRawSnapshotRecord[],
): string {
  return agents[0]?.seasonId ??
    invalidAgents[0]?.seasonId ??
    rawSnapshots[0]?.season_id ??
    currentSeasonId ??
    'unknown';
}

function evaluatePotDataSourceHealth(
  agents: AgentPnlData[],
  invalidAgents: InvalidPotAgentData[],
  rawSnapshots: PotAgentRawSnapshotRecord[],
  nowSeconds: number,
  allowAlertCard: boolean,
): PotDataSourceHealth {
  const cards: FeishuCard[] = [];
  const zeroValueAgents = zeroValueInvalidAgents(invalidAgents);
  const validAgentCount = agents.length;
  const totalActiveAgentCount = rawSnapshots.length;
  const seasonId = inferPotSeasonId(agents, invalidAgents, rawSnapshots);
  const broadAnomaly = broadPotDataSourceAnomaly(invalidAgents, validAgentCount, totalActiveAgentCount);
  const clusteredDegradation = zeroValueAgents.length >= POT_DATA_SOURCE_DEGRADED_MIN_ZERO_AGENTS;
  const fullyHealthy = totalActiveAgentCount >= 8 &&
    validAgentCount === totalActiveAgentCount &&
    zeroValueAgents.length === 0;
  const previous = readPotDataSourceState(seasonId);
  const wasActiveEpisode = previous.status === 'anomaly';
  const next: PotDataSourceAnomalyState = {
    ...previous,
    lastUpdateAt: nowSeconds,
    lastZeroCount: zeroValueAgents.length,
    lastValidCount: validAgentCount,
    lastTotalCount: totalActiveAgentCount,
  };
  let enteringNewEpisode = false;

  if (broadAnomaly) {
    enteringNewEpisode = !wasActiveEpisode;
    next.status = 'anomaly';
    next.healthyStreak = 0;
    next.lastAnomalyAt = nowSeconds;
    if (enteringNewEpisode) {
      next.episode = previous.episode + 1;
      next.startedAt = nowSeconds;
    }
  } else if (wasActiveEpisode) {
    if (fullyHealthy) {
      next.healthyStreak = previous.healthyStreak + 1;
      if (next.healthyStreak >= POT_DATA_SOURCE_RECOVERY_CONFIRM_CYCLES) {
        next.status = 'healthy';
        console.log(`[PotMonitor] Official Pot data source recovered after ${next.healthyStreak} healthy cycles`);
      }
    } else {
      next.healthyStreak = 0;
    }
  } else if (fullyHealthy) {
    next.status = 'healthy';
    next.healthyStreak = POT_DATA_SOURCE_RECOVERY_CONFIRM_CYCLES;
  }

  writePotDataSourceState(seasonId, next);

  if (POT_DATA_SOURCE_ALERTS_ENABLED && broadAnomaly && enteringNewEpisode && allowAlertCard) {
    const sample = zeroValueAgents
      .slice(0, 8)
      .map((agent) => `${agent.symbol}/${agent.agentName}`)
      .join('、');
    cards.push({
      title: `[官网数据异常] ${zeroValueAgents.length} 个 Agent 跟单返回 0`,
      template: 'orange',
      dedupeKey: `pot-source-anomaly:${seasonId}:episode:${next.episode}`,
      fields: [
        { label: '动作', value: '这是官网数据源异常，不按单个 Agent 亏损处理；等待下一轮数据恢复', wide: true },
        { label: '当前状态', value: `有效 ${validAgentCount}/${totalActiveAgentCount}；返回 0：${zeroValueAgents.length}` },
        { label: '影响对象', value: sample || '-', wide: true },
        { label: '依据', value: '多个 Agent 同时返回 currentValue=0，更像官网/API 数据异常。同一异常状态只提醒一次，恢复前不重复刷屏。', wide: true },
      ],
    });
  }

  const activeEpisode = next.status === 'anomaly';
  return {
    cards,
    broadAnomaly,
    dataSourceUnreliable: broadAnomaly || activeEpisode || clusteredDegradation,
    activeEpisode,
    zeroValueAgents,
  };
}

function invalidPotDataCards(
  invalidAgents: InvalidPotAgentData[],
  validAgentCount: number,
  totalActiveAgentCount: number,
  nowSeconds: number,
  suppressSingleAgentCards = false,
): FeishuCard[] {
  const cards: FeishuCard[] = [];
  const nowMs = nowSeconds * 1000;
  if (
    !POT_DATA_SOURCE_ALERTS_ENABLED ||
    suppressSingleAgentCards ||
    broadPotDataSourceAnomaly(invalidAgents, validAgentCount, totalActiveAgentCount)
  ) return cards;

  for (const agent of invalidAgents) {
    if (!(agent.currentValue === 0 && agent.startingCapital > 0)) continue;
    const latest = getPnlSnapshotAt(agent.agentName, nowSeconds, 7200);
    const previousLivePnl = latest?.live_pnl ?? null;
    const previousPositiveTier = highestTriggeredTier(
      triggeredThresholds.get(agent.agentName) ?? new Set<string>(),
      '+',
      PNL_POSITIVE_THRESHOLDS,
    );
    if ((previousLivePnl ?? 0) <= 0 && previousPositiveTier === 0) continue;

    const cooldownKey = `${agent.agentName}:currentValue0`;
    const dedupePrefix = `pot-invalid:${agent.seasonId}:${agent.agentName}:currentValue0:`;
    if (
      nowMs < (invalidDataAlertCooldown.get(cooldownKey) ?? 0) ||
      hasRecentNotificationWithPrefix(dedupePrefix, nowMs - POT_SINGLE_AGENT_INVALID_ALERT_COOLDOWN_MS)
    ) continue;
    invalidDataAlertCooldown.set(cooldownKey, nowMs + POT_SINGLE_AGENT_INVALID_ALERT_COOLDOWN_MS);

    const theoreticalLivePnl = agent.currentValue - agent.startingCapital;
    cards.push({
      title: `[数据异常/疑似归零] ${agent.symbol} 官方跟单返回 0`,
      template: 'red',
      tokenUrl: agent.virtualId ? `https://app.virtuals.io/virtuals/${agent.virtualId}` : undefined,
      dedupeKey: `${dedupePrefix}${Math.floor(nowMs / Math.max(1, POT_SINGLE_AGENT_INVALID_ALERT_COOLDOWN_MS))}`,
      fields: [
        { label: '动作', value: '立即打开官网确认；如果不是接口异常，按清仓风险处理', wide: true },
        { label: '上次实时盈亏', value: previousLivePnl === null ? '-' : formatPnl(previousLivePnl) },
        { label: '上次时间', value: formatBeijingTime(latest?.timestamp) },
        { label: '异常返回', value: `当前值 $0 / 分配资金 $${Math.round(agent.startingCapital).toLocaleString()}`, wide: true },
        { label: '理论盈亏', value: formatPnl(theoreticalLivePnl) },
        { label: '盈亏构成', value: `已实现 ${formatPnl(agent.realizedPnl)} / 未实现 ${formatPnl(agent.unrealizedPnl)}`, wide: true },
        { label: '依据', value: `${agent.reason}。之前仍有正向 Live P&L，不能静默跳过。`, wide: true },
      ],
    });
  }
  return cards;
}

function commitTierTransitionAfterSend(
  agentName: string,
  prefix: ThresholdPrefix,
  thresholds: number[],
  previousTier: number,
  currentTier: number,
) {
  const triggered = triggeredThresholds.get(agentName);
  if (!triggered || previousTier === currentTier) return;
  const latestTier = highestTriggeredTier(triggered, prefix, thresholds);
  const nextTier = nextTierAfterSentTransition(latestTier, previousTier, currentTier);

  if (nextTier !== latestTier) {
    replaceTierKeys(triggered, prefix, thresholds, nextTier);
  }
}

async function checkThresholdSignals(agent: AgentPnlData, nowSeconds: number): Promise<FeishuCard[]> {
  const cards: FeishuCard[] = [];
  if (!triggeredThresholds.has(agent.agentName)) {
    triggeredThresholds.set(agent.agentName, getTriggeredThresholdKeys(agent.livePnl));
    console.log(`[PotMonitor] Initialized thresholds for ${agent.agentName}, no historical cards sent`);
    return cards;
  }
  const context = await livePnlCardContext(agent, nowSeconds);
  const triggered = triggeredThresholds.get(agent.agentName)!;
  const previousPositiveTier = highestTriggeredTier(triggered, '+', PNL_POSITIVE_THRESHOLDS);
  const currentPositiveTier = positiveTierWithDropBuffer(
    agent.livePnl,
    previousPositiveTier,
    PNL_POSITIVE_THRESHOLDS,
    TIER_DROP_BUFFER_RATIO,
  );

  if (currentPositiveTier > previousPositiveTier) {
    cards.push({
      title: `[实时盈亏上穿] ${agent.symbol} 突破 +$${currentPositiveTier.toLocaleString()}`,
      template: thresholdColor(currentPositiveTier, true),
      tokenUrl: `https://app.virtuals.io/virtuals/${agent.virtualId}`,
      voice: voiceAlert(
        'p1',
        `${agent.symbol} 实时盈亏上穿正 ${currentPositiveTier.toLocaleString()} 美元，当前 ${spokenPnl(agent.livePnl)}。仓位调整提醒已暂停。`,
      ),
      fields: [
        { label: '信号', value: '正向阶梯上穿' },
        { label: '动作', value: '先复核阶梯质量，不直接给仓位调整指令' },
        ...livePnlContextFields(context),
        { label: '阶梯变化', value: `${positiveTierLabel(previousPositiveTier)} → ${positiveTierLabel(currentPositiveTier)}`, wide: true },
        { label: '参考比例', value: `对应回购目标 ${formatPct(livePnlTargetRatioFromUsd(agent.livePnl))}，当前只作信号参考` },
        pausedPositionAdviceField(),
      ],
    });
  } else if (currentPositiveTier < previousPositiveTier) {
    const droppedToConfirmation = currentPositiveTier === 0;
    cards.push({
      title: droppedToConfirmation
        ? `[实时盈亏跌破] ${agent.symbol} 跌破 +$${previousPositiveTier.toLocaleString()}`
        : `[实时盈亏回落] ${agent.symbol} 回落至 +$${currentPositiveTier.toLocaleString()} 档`,
      template: droppedToConfirmation ? 'orange' : 'yellow',
      tokenUrl: `https://app.virtuals.io/virtuals/${agent.virtualId}`,
      fields: [
        { label: '信号', value: droppedToConfirmation ? '正向阶梯跌回确认线' : '正向阶梯回落' },
        { label: '动作', value: currentPositiveTier > 0 ? '观察是否继续跌破，不触发仓位调整卡' : '回到确认仓参考线，人工复核风险' },
        ...livePnlContextFields(context),
        { label: '阶梯变化', value: `${positiveTierLabel(previousPositiveTier)} → ${positiveTierLabel(currentPositiveTier)}`, wide: true },
        { label: '参考比例', value: currentPositiveTier > 0 ? `对应回购目标 ${formatPct(livePnlTargetRatioFromUsd(agent.livePnl))}` : '回到入选确认仓参考线' },
        pausedPositionAdviceField(),
      ],
    });
  }
  const previousNegativeTier = highestTriggeredTier(triggered, '-', PNL_NEGATIVE_THRESHOLDS);
  const currentNegativeTier = negativeTierWithRecoveryBuffer(
    agent.livePnl,
    previousNegativeTier,
    PNL_NEGATIVE_THRESHOLDS,
    TIER_DROP_BUFFER_RATIO,
  );
  if (currentNegativeTier > previousNegativeTier) {
    cards.push({
      title: `[实时盈亏风险] ${agent.symbol} 跌破 -$${currentNegativeTier.toLocaleString()}`,
      template: thresholdColor(currentNegativeTier, false),
      tokenUrl: `https://app.virtuals.io/virtuals/${agent.virtualId}`,
      voice: voiceAlert(
        currentNegativeTier >= RISK_EXIT_LOSS_USD ? 'p0' : 'p1',
        `${agent.symbol} 实时盈亏跌破负 ${currentNegativeTier.toLocaleString()} 美元，当前 ${spokenPnl(agent.livePnl)}，${currentNegativeTier >= RISK_EXIT_LOSS_USD ? '进入清仓风险线。' : '进入减仓风险线。'}仓位调整提醒已暂停。`,
      ),
      fields: [
        { label: '信号', value: currentNegativeTier >= RISK_EXIT_LOSS_USD ? '清仓风险阶梯' : '减仓风险阶梯' },
        { label: '动作', value: currentNegativeTier >= RISK_EXIT_LOSS_USD ? '最高优先级人工风险复核' : '人工复核是否需要降风险' },
        ...livePnlContextFields(context),
        { label: '阶梯变化', value: `${negativeTierLabel(previousNegativeTier)} → ${negativeTierLabel(currentNegativeTier)}`, wide: true },
        { label: '风险规则', value: currentNegativeTier >= RISK_EXIT_LOSS_USD ? '达到清仓风险线' : '达到减仓风险线' },
        pausedPositionAdviceField(),
      ],
    });
  }

  const commitThresholdStateImmediately = () => {
    replaceTierKeys(triggered, '+', PNL_POSITIVE_THRESHOLDS, currentPositiveTier);
    replaceTierKeys(triggered, '-', PNL_NEGATIVE_THRESHOLDS, currentNegativeTier);
  };
  const commitThresholdStateAfterQueue = () => {
    commitTierTransitionAfterSend(agent.agentName, '+', PNL_POSITIVE_THRESHOLDS, previousPositiveTier, currentPositiveTier);
    commitTierTransitionAfterSend(agent.agentName, '-', PNL_NEGATIVE_THRESHOLDS, previousNegativeTier, currentNegativeTier);
  };
  if (cards.length > 0) {
    const baseDedupeKey = `pnl-threshold:${agent.agentName}:${previousPositiveTier}->${currentPositiveTier}:${previousNegativeTier}->${currentNegativeTier}`;
    for (const [index, card] of cards.entries()) {
      card.dedupeKey = `${baseDedupeKey}:${index}:${card.title}`;
      card.onQueued = commitThresholdStateAfterQueue;
    }
  } else {
    commitThresholdStateImmediately();
  }
  return cards;
}

async function buildThresholdSignalCardsForDrill(
  agent: AgentPnlData,
  previousLivePnl: number,
  nowSeconds: number,
): Promise<FeishuCard[]> {
  triggeredThresholds.set(agent.agentName, getTriggeredThresholdKeys(previousLivePnl));
  return checkThresholdSignals(agent, nowSeconds);
}

function checkChangeSignals(agent: AgentPnlData, config: ChangeSignalConfig): FeishuCard[] {
  const now = Math.floor(Date.now() / 1000);
  const endSeconds = agentSnapshotTimestamp(agent, now);
  const change = pnlChange(agent.agentName, agent.livePnl, endSeconds, config.windowSeconds);
  if (change.value === null) return [];

  const delta = change.value;
  const absDelta = Math.abs(delta);
  const triggeredTier = [...CHANGE_THRESHOLDS]
    .sort((a, b) => b - a)
    .find(t => absDelta >= t);
  if (!triggeredTier) return [];

  const rising = delta > 0;
  const direction = rising ? 'up' : 'down';
  const nowMs = Date.now();
  const tiersToCheck = CHANGE_THRESHOLDS
    .filter(t => t <= triggeredTier)
    .sort((a, b) => b - a);
  const alertTier = tiersToCheck.find(t => nowMs >= (config.cooldowns.get(`${agent.agentName}:${direction}:${t}`) ?? 0));
  if (!alertTier) return [];

  for (const t of CHANGE_THRESHOLDS.filter(t => t <= alertTier)) {
    config.cooldowns.set(`${agent.agentName}:${direction}:${t}`, nowMs + config.cooldownMs);
  }

  const strong = alertTier >= 5000;
  const icon = strong ? '🚨' : config.label === '15min' ? '⚡' : '🕐';
  const movement = rising ? '走强' : '走弱';
  const windowLabel = displayWindowLabel(config.label);
  return [{
    title: `${icon} ${agent.agentName} ${windowLabel}${strong ? '强' : ''}${config.signalName}${movement} ${formatPnl(delta)}`,
    template: rising ? (strong ? 'green' : 'turquoise') : (strong ? 'red' : 'orange'),
    tokenUrl: `https://app.virtuals.io/virtuals/${agent.virtualId}`,
    fields: [
      { label: '动作', value: rising ? '观察是否上穿下一档位' : '检查是否需要降仓' },
      { label: '依据', value: `${windowLabel}内变化 ${formatPnl(delta)}；当前 ${formatPnl(agent.livePnl)}` },
      { label: '触发档位', value: `$${alertTier.toLocaleString()}` },
    ],
  }];
}

function checkRapidChange(agent: AgentPnlData): FeishuCard[] {
  return checkChangeSignals(agent, {
    label: '15min',
    windowSeconds: RAPID_CHANGE_WINDOW,
    cooldownMs: RAPID_CHANGE_COOLDOWN_MS,
    cooldowns: rapidCooldown,
    signalName: '信息差',
  });
}

function checkHourlyChange(agent: AgentPnlData): FeishuCard[] {
  return checkChangeSignals(agent, {
    label: '1H',
    windowSeconds: HOURLY_CHANGE_WINDOW,
    cooldownMs: HOURLY_CHANGE_COOLDOWN_MS,
    cooldowns: hourlyCooldown,
    signalName: '趋势确认',
  });
}

function usableSelectionSnapshot(
  snapshot: SelectionSnapshot | null,
  nowSeconds: number,
  windowSeconds: number,
): SelectionSnapshot | null {
  if (!snapshot) return null;
  if (nowSeconds - snapshot.timestamp > windowSeconds + 300) return null;
  return snapshot;
}

function selectionPartBoost(
  current: SelectionAgentRow,
  previous: SelectionSnapshot | null,
): { label: string; delta: number } | null {
  if (!previous) return null;
  const entries = Object.entries(current.selection_parts)
    .map(([key, value]) => ({
      label: displaySelectionPartLabel(key),
      delta: value - (previous.selection_parts[key] ?? value),
    }))
    .sort((a, b) => b.delta - a.delta);
  const best = entries[0];
  if (!best || best.delta < SELECTION_PART_BOOST_SCORE) return null;
  return best;
}

function allowSelectionAlert(agentKey: string, alertType: string, cooldownMs: number): string | null {
  const key = `${agentKey}:${alertType}`;
  const dedupePrefix = `selection:${agentKey}:${alertType}:`;
  const nowMs = Date.now();
  if (nowMs < (selectionAlertCooldown.get(key) ?? 0)) return null;
  if (hasRecentNotificationWithPrefix(dedupePrefix, nowMs - cooldownMs)) return null;
  selectionAlertCooldown.set(key, nowMs + cooldownMs);
  return `${dedupePrefix}${Math.floor(nowMs / Math.max(1, cooldownMs))}`;
}

function scoreDelta(row: SelectionAgentRow, snapshot: SelectionSnapshot | null): number | null {
  if (!snapshot) return null;
  return row.selection_score - snapshot.selection_score;
}

function rankUp(row: SelectionAgentRow, snapshot: SelectionSnapshot | null): number | null {
  if (!snapshot) return null;
  return snapshot.selection_rank - row.selection_rank;
}

function allowPositionAdviceAlert(agentKey: string, targetU: number, stage: string): boolean {
  const key = `${agentKey}:${stage}:${targetU}`;
  const nowMs = Date.now();
  if (nowMs < (positionAdviceCooldown.get(key) ?? 0)) return false;
  positionAdviceCooldown.set(key, nowMs + POSITION_ADVICE_COOLDOWN_MS);
  return true;
}

function positionAdviceCard(advice: PositionAdvice, previous: PositionAdviceSnapshot | null): FeishuCard {
  const previousTarget = previous ? `${previous.target_position_u}U` : '无记录';
  const direction = previous && advice.targetU < previous.target_position_u ? '减仓' : '加仓/补仓';
  const riskMultiplier = Number(advice.metrics.riskMultiplier ?? 1);
  const positionLayer = String(advice.metrics.positionLayer ?? advice.stage);
  const action = direction === '减仓' || riskMultiplier < 1
    ? '检查是否降到目标仓位；风险倍率下降时优先减仓'
    : `检查当前持仓，补到 ${advice.targetU}U`;
  const template: FeishuCard['template'] = direction === '减仓' || riskMultiplier < 1
    ? 'orange'
    : positionLayer === 'burn_add'
      ? 'green'
      : 'turquoise';
  return {
    title: `[仓位调整] ${advice.token} 目标 ${advice.targetU}U`,
    template,
    tokenUrl: advice.virtualUrl,
    dedupeKey: `position-advice:${advice.agentKey}:${previous?.target_position_u ?? 'none'}->${advice.targetU}:${advice.stage}`,
    fields: [
      { label: '动作', value: action },
      { label: '仓位变化', value: `${previousTarget} → ${advice.targetU}U` },
      { label: '实时盈亏', value: formatPnl(Number(advice.metrics.livePnl ?? 0)) },
      { label: '盈亏构成', value: `已实现 ${formatOptionalPnl(advice.metrics.potRealizedPnl)} / 未实现 ${formatOptionalPnl(advice.metrics.potUnrealizedPnl)}`, wide: true },
      { label: '当前价格', value: formatUsdPrice(metricNumber(advice.metrics.tokenPriceUsd)) },
      { label: '变化量', value: `5分钟 ${formatChangePnlWithStatus(advice.metrics.delta5m, advice.metrics.delta5mStatus)} / 15分钟 ${formatChangePnlWithStatus(advice.metrics.delta15m, advice.metrics.delta15mStatus)} / 1小时 ${formatChangePnlWithStatus(advice.metrics.delta1h, advice.metrics.delta1hStatus)}`, wide: true },
      { label: '依据', value: advice.reason, wide: true },
    ],
  };
}

async function buildPositionAdvices(
  rows: SelectionAgentRow[],
  agents: AgentPnlData[],
  nowSeconds: number,
): Promise<PositionAdvice[]> {
  if (agents.length === 0) return [];
  const allocations = agents.map((agent) => agent.snapshot.starting_capital).filter((value) => value > 0);
  const byVirtualId = new Map(agents.map((agent) => [agent.virtualId, agent]));
  const byName = new Map(agents.map((agent) => [normalizeAgentName(agent.agentName), agent]));
  const advices: PositionAdvice[] = [];

  for (const row of rows) {
    if (!row.selected_now) continue;
    const agent = (row.virtual_id ? byVirtualId.get(row.virtual_id) : undefined) ?? byName.get(normalizeAgentName(row.agent));
    if (!agent) continue;

    const allocationScore = distributionTanhScore(agent.snapshot.starting_capital, allocations);
    const agentEndSeconds = agentSnapshotTimestamp(agent, nowSeconds);
    const change5m = pnlChange(agent.agentName, agent.livePnl, agentEndSeconds, FIVE_MIN_CHANGE_WINDOW);
    const change15m = pnlChange(agent.agentName, agent.livePnl, agentEndSeconds, RAPID_CHANGE_WINDOW);
    const change1h = pnlChange(agent.agentName, agent.livePnl, agentEndSeconds, HOURLY_CHANGE_WINDOW);
    const delta5m = change5m.value;
    const delta15m = change15m.value;
    const delta1h = change1h.value;
    const estimatedBurn = estimatedBurnUsd(agent.livePnl);
    const market = agent.virtualId ? await fetchMarketSnapshot(agent.virtualId) : null;
    const burnQualityResult = potBurnQualityScore({
      potLivePnlUsd: agent.livePnl,
      potRealizedPnlUsd: agent.snapshot.realized_pnl,
      market,
    });
    const edgeResult = potEdgeScore({
      potLivePnlUsd: agent.livePnl,
      potDelta15mUsd: delta15m,
      potDelta1hUsd: delta1h,
      burnImpactScore: burnQualityResult.parts.burn_impact_score,
    });
    const burnQuality = burnQualityResult.total;
    const edgeScore = edgeResult.total;
    const position = buildPositionModel({
      selectionScore: row.selection_score,
      selectionRank: row.selection_rank,
      selectedNow: true,
      allocationScore,
      allocationUsd: agent.snapshot.starting_capital,
      livePnlUsd: agent.livePnl,
      delta15mUsd: delta15m,
      delta1hUsd: delta1h,
      realizedPnlUsd: agent.snapshot.realized_pnl,
      burnQualityScore: burnQuality,
      edgeScore,
      edgeComplete: edgeResult.complete,
      maxAgentCapU: POSITION_CAP_U,
      minActionTargetU: POSITION_MIN_ACTION_U,
      nowMs: nowSeconds * 1000,
    });

    advices.push({
      agentKey: row.agent_key,
      token: row.token,
      agentName: row.search_name,
      virtualUrl: row.virtual_url ?? undefined,
      targetU: position.targetU,
      stage: position.stage,
      reason: position.reason,
      metrics: {
        ...position.metrics,
        allocationScore: roundNumber(allocationScore),
        livePnl: roundNumber(agent.livePnl),
        delta5m: roundNumber(delta5m),
        delta15m: roundNumber(delta15m),
        delta1h: roundNumber(delta1h),
        delta5mStatus: change5m.status,
        delta15mStatus: change15m.status,
        delta1hStatus: change1h.status,
        delta5mWindowSeconds: change5m.actualWindowSeconds,
        delta15mWindowSeconds: change15m.actualWindowSeconds,
        delta1hWindowSeconds: change1h.actualWindowSeconds,
        potRealizedPnl: roundNumber(agent.snapshot.realized_pnl),
        potUnrealizedPnl: roundNumber(agent.snapshot.unrealized_pnl),
        tokenPriceUsd: roundNumber(market?.tokenPriceUsd, 10),
        estimatedBurn: roundNumber(estimatedBurn),
        burnImpact: roundNumber(burnQualityResult.parts.burn_impact_score),
        burnToMarketPct: burnQualityResult.impact.marketRatio === null ? null : roundNumber(burnQualityResult.impact.marketRatio * 100, 3),
        burnToLiquidityPct: burnQualityResult.impact.liquidityRatio === null ? null : roundNumber(burnQualityResult.impact.liquidityRatio * 100, 3),
        potLivePnlFoundationScore: roundNumber(burnQualityResult.parts.pot_live_pnl_foundation_score),
        potRealizedQualityPoints: roundNumber(burnQualityResult.parts.pot_realized_quality_points),
        potLivePnlEdgeScore: roundNumber(edgeResult.parts.pot_live_pnl_edge_score),
        burnQuality: roundNumber(burnQuality),
        edgeScore: roundNumber(edgeScore),
      },
    });
  }

  return advices;
}

function selectionCard(
  title: string,
  template: FeishuCard['template'],
  row: SelectionAgentRow,
  fields: FeishuCard['fields'],
  dedupeKey?: string,
): FeishuCard {
  return {
    title,
    template,
    tokenUrl: row.virtual_url ?? undefined,
    dedupeKey,
    fields: [
      { label: '当前判断', value: `${row.selected_now ? '已入选' : '未入选'}；入选分 ${formatScore(row.selection_score)}；排名 #${row.selection_rank}` },
      { label: '建议仓位', value: row.target_position_u > 0 ? `${row.target_position_u}U` : '先观察' },
      ...fields,
    ],
  };
}

function checkSelectionSignals(
  row: SelectionAgentRow,
  latest: SelectionSnapshot | null,
  snapshot15m: SelectionSnapshot | null,
  snapshot1h: SelectionSnapshot | null,
  options: { allowExpectationAlerts: boolean } = { allowExpectationAlerts: true },
): FeishuCard[] {
  const cards: FeishuCard[] = [];
  const delta15m = scoreDelta(row, snapshot15m);
  const delta1h = scoreDelta(row, snapshot1h);
  const rankUp1h = rankUp(row, snapshot1h);
  const partBoost = selectionPartBoost(row, snapshot1h ?? snapshot15m);

  const selectedAlertKey = latest && !latest.selected_now && row.selected_now
    ? allowSelectionAlert(row.agent_key, 'selected', SELECTION_CONFIRM_COOLDOWN_MS)
    : null;
  if (selectedAlertKey) {
    cards.push(selectionCard(
      `[入选确认] ${row.search_name} 已进入官方跟单名单`,
      'green',
      row,
      [
        { label: '动作', value: '切换到回购预期逻辑；按仓位规则确认是否加仓' },
        { label: '依据', value: '上一轮未入选，本轮进入官方跟单名单' },
      ],
      selectedAlertKey,
    ));
  }

  if (!options.allowExpectationAlerts) return cards;

  if (!row.selected_now) {
    const firstCrossHigh = Boolean(latest && latest.selection_score < SELECTION_HIGH_SCORE && row.selection_score >= SELECTION_HIGH_SCORE);
    const rapidRise = delta15m !== null && delta15m >= SELECTION_DELTA_15M_SCORE;
    const hourlyRise = delta1h !== null && delta1h >= SELECTION_DELTA_1H_SCORE;
    const enteredTopStrong = Boolean(latest && latest.selection_rank > SELECTION_RANK_TOP_STRONG && row.selection_rank <= SELECTION_RANK_TOP_STRONG);
    const strongReasons = [
      firstCrossHigh ? `首次进入强入选区，分数不低于 ${SELECTION_HIGH_SCORE}` : null,
      rapidRise ? `15 分钟 ${formatScoreDelta(delta15m)}` : null,
      hourlyRise ? `1 小时 ${formatScoreDelta(delta1h)}` : null,
      enteredTopStrong ? `排名进入前 ${SELECTION_RANK_TOP_STRONG}` : null,
    ].filter((value): value is string => Boolean(value));

    const strongAlertKey = row.selection_score >= SELECTION_HIGH_SCORE && strongReasons.length > 0
      ? allowSelectionAlert(row.agent_key, 'strong-alpha', SELECTION_ALERT_COOLDOWN_MS)
      : null;
    if (strongAlertKey) {
      cards.push(selectionCard(
        `[强机会] ${row.search_name} ${formatScore(row.selection_score)}`,
        'green',
        row,
        [
          { label: '动作', value: `${row.target_position_u}U 观察仓；入选后再切换回购预期逻辑` },
          { label: '依据', value: strongReasons.join('；') },
        ],
        strongAlertKey,
      ));
    }

    const criticalConditions = [
      rapidRise ? `15 分钟 ${formatScoreDelta(delta15m)}` : null,
      hourlyRise ? `1 小时 ${formatScoreDelta(delta1h)}` : null,
      row.selection_rank <= SELECTION_RANK_TOP_CRITICAL ? `排名前 ${SELECTION_RANK_TOP_CRITICAL}` : null,
      rankUp1h !== null && rankUp1h >= SELECTION_RANK_UP_1H ? `1 小时排名 +${rankUp1h}` : null,
      partBoost ? `${partBoost.label} +${partBoost.delta.toFixed(2)}` : null,
    ].filter((value): value is string => Boolean(value));
    const criticalTargetU = row.target_position_u;

    const criticalAlertKey = (
      row.selection_score >= SELECTION_CRITICAL_MIN_SCORE &&
      row.selection_score < SELECTION_HIGH_SCORE &&
      row.target_position_u > 0 &&
      criticalConditions.length >= 2
    ) ? allowSelectionAlert(row.agent_key, 'critical-alpha', SELECTION_ALERT_COOLDOWN_MS) : null;

    if (criticalAlertKey) {
      cards.push(selectionCard(
        `[临界机会] ${row.search_name} ${formatScore(row.selection_score)}`,
        'turquoise',
        { ...row, target_position_u: criticalTargetU },
        [
          { label: '动作', value: `${criticalTargetU}U 试探仓；突破 ${SELECTION_HIGH_SCORE} 或入选后再按比例加仓` },
          { label: '依据', value: criticalConditions.join('；') },
        ],
        criticalAlertKey,
      ));
    }
  }

  const tracked = row.selected_now || row.target_position_u > 0 || HELD_SYMBOLS.has(row.token) ||
    Boolean(latest && (latest.target_position_u > 0 || latest.selection_score >= SELECTION_HIGH_SCORE));
  const droppedBelowRiskFloor = Boolean(latest && latest.selection_score >= SELECTION_RISK_FLOOR_SCORE && row.selection_score < SELECTION_RISK_FLOOR_SCORE);
  const rapidDrop = delta15m !== null && delta15m <= -SELECTION_DELTA_15M_SCORE;
  const hourlyDrop = delta1h !== null && delta1h <= -SELECTION_DELTA_1H_SCORE;
  const leftTop10 = Boolean(latest && latest.selection_rank <= 10 && row.selection_rank > 10);
  const riskReasons = [
    droppedBelowRiskFloor ? `跌破 ${SELECTION_RISK_FLOOR_SCORE}` : null,
    rapidDrop ? `15 分钟 ${formatScoreDelta(delta15m)}` : null,
    hourlyDrop ? `1 小时 ${formatScoreDelta(delta1h)}` : null,
    leftTop10 ? '跌出前 10' : null,
  ].filter((value): value is string => Boolean(value));

  const riskAlertKey = tracked && riskReasons.length > 0
    ? allowSelectionAlert(row.agent_key, 'risk', SELECTION_ALERT_COOLDOWN_MS)
    : null;
  if (riskAlertKey) {
    cards.push(selectionCard(
      `[入选预期走弱] ${row.search_name} ${formatScore(row.selection_score)}`,
      'orange',
      row,
      [
        { label: '动作', value: '检查是否减仓；未入选候选跌破风险线则停止加仓' },
        { label: '依据', value: riskReasons.join('；') },
      ],
      riskAlertKey,
    ));
  }

  return cards;
}

async function runSelectionMonitor(
  selectedSymbols: Set<string>,
  shouldAlert: boolean,
  potAgents: AgentPnlData[] = [],
  options: { allowSelectionExpectationAlerts: boolean; allowPositionAdvice: boolean; savePositionAdvice: boolean } = {
    allowSelectionExpectationAlerts: true,
    allowPositionAdvice: true,
    savePositionAdvice: true,
  },
): Promise<FeishuCard[]> {
  const nowMs = Date.now();
  const nowSeconds = Math.floor(nowMs / 1000);
  const rows = await fetchSelectionRows(selectedSymbols, EXCLUDED_SYMBOLS, nowMs, POSITION_CAP_U, POSITION_MIN_ACTION_U);
  const latestSnapshots = new Map(getLatestSelectionSnapshots().map((snapshot) => [snapshot.agent_key, snapshot]));
  const latestPositionAdvice = new Map(getLatestPositionAdviceSnapshots().map((snapshot) => [snapshot.agent_key, snapshot]));
  const cards: FeishuCard[] = [];

  for (const row of rows) {
    const latest = latestSnapshots.get(row.agent_key) ?? null;
    const snapshot15m = usableSelectionSnapshot(
      getSelectionSnapshotAt(row.agent_key, nowSeconds - RAPID_CHANGE_WINDOW),
      nowSeconds,
      RAPID_CHANGE_WINDOW,
    );
    const snapshot1h = usableSelectionSnapshot(
      getSelectionSnapshotAt(row.agent_key, nowSeconds - HOURLY_CHANGE_WINDOW),
      nowSeconds,
      HOURLY_CHANGE_WINDOW,
    );

    if (shouldAlert) {
      cards.push(...checkSelectionSignals(row, latest, snapshot15m, snapshot1h, {
        allowExpectationAlerts: options.allowSelectionExpectationAlerts,
      }));
    }
    saveSelectionSnapshot(row, nowSeconds);
  }

  if (!options.savePositionAdvice) {
    console.log('[PositionAdvice] Paused because current Pot data source is unreliable');
  } else {
    const positionAdvices = await buildPositionAdvices(rows, potAgents, nowSeconds);
    for (const advice of positionAdvices) {
      const previous = latestPositionAdvice.get(advice.agentKey) ?? null;
      const targetChanged = !previous || Math.abs(advice.targetU - previous.target_position_u) >= POSITION_ADVICE_DELTA_U;
      const stageChanged = Boolean(previous && previous.position_stage !== advice.stage);
      if (options.allowPositionAdvice && shouldAlert && (targetChanged || stageChanged) && allowPositionAdviceAlert(advice.agentKey, advice.targetU, advice.stage)) {
        cards.push(positionAdviceCard(advice, previous));
      }
      savePositionAdviceSnapshot({
        agent_key: advice.agentKey,
        token: advice.token,
        agent_name: advice.agentName,
        timestamp: nowSeconds,
        target_position_u: advice.targetU,
        position_stage: advice.stage,
        reason: advice.reason,
        metrics: advice.metrics,
      });
    }
  }

  pruneOldSelectionSnapshots(SELECTION_SNAPSHOT_RETENTION_SECONDS);
  pruneOldPositionAdviceSnapshots(POSITION_ADVICE_RETENTION_SECONDS);
  const top4 = rows.slice(0, 4).map((row) => `${row.token} ${formatScore(row.selection_score)}`).join(', ');
  console.log(`[SelectionMonitor] ${rows.length} agents | Top: ${top4}`);
  return cards;
}

async function fetchBuybackTransfers(): Promise<BlockscoutTokenTransfer[]> {
  let url = new URL(`${BLOCKSCOUT_API}/addresses/${BUYBACK_EXECUTOR_ADDRESS}/token-transfers`);
  url.searchParams.set('type', 'ERC-20');
  const items: BlockscoutTokenTransfer[] = [];

  for (let page = 0; page < 5 && items.length < BUYBACK_SCAN_LIMIT; page += 1) {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
      },
    });
    if (!res.ok) throw new Error(`Blockscout HTTP ${res.status}`);
    const json = await res.json() as BlockscoutTransferResponse;
    items.push(...(json.items ?? []));
    if (!json.next_page_params) break;

    url = new URL(`${BLOCKSCOUT_API}/addresses/${BUYBACK_EXECUTOR_ADDRESS}/token-transfers`);
    url.searchParams.set('type', 'ERC-20');
    for (const [key, value] of Object.entries(json.next_page_params)) {
      if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
    }
  }

  return items.slice(0, BUYBACK_SCAN_LIMIT);
}

function extractBuybackEvents(items: BlockscoutTokenTransfer[]): BuybackEventRecord[] {
  const byTx = new Map<string, BlockscoutTokenTransfer[]>();
  for (const item of items) {
    if (!item.transaction_hash) continue;
    const group = byTx.get(item.transaction_hash) ?? [];
    group.push(item);
    byTx.set(item.transaction_hash, group);
  }

  const events: BuybackEventRecord[] = [];
  for (const [txHash, txItems] of byTx) {
    const virtualSpent = txItems
      .filter((item) => addressOf(item.token?.address_hash) === VIRTUAL_TOKEN)
      .filter((item) => addressOf(item.from?.hash) === BUYBACK_EXECUTOR_ADDRESS)
      .reduce((sum, item) => sum + transferAmount(item), 0);

    if (virtualSpent <= 0) continue;

    const boughtByToken = new Map<string, BuybackEventRecord>();
    for (const item of txItems) {
      const tokenAddress = addressOf(item.token?.address_hash);
      const from = addressOf(item.from?.hash);
      const to = addressOf(item.to?.hash);
      if (!tokenAddress || tokenAddress === VIRTUAL_TOKEN || tokenAddress === USDC_TOKEN) continue;
	    if (from === ZERO_ADDRESS || to !== BUYBACK_EXECUTOR_ADDRESS) continue;

      const amount = transferAmount(item);
      if (amount <= 0) continue;

      const existing = boughtByToken.get(tokenAddress);
      boughtByToken.set(tokenAddress, {
        tx_hash: txHash,
        token_address: tokenAddress,
        token_symbol: (item.token?.symbol ?? 'UNKNOWN').toUpperCase(),
        timestamp: timestampSeconds(item.timestamp),
        token_amount: (existing?.token_amount ?? 0) + amount,
	        virtual_spent: virtualSpent,
	        approval_spender_address: existing?.approval_spender_address ?? from,
	        trigger_source: 'official_buyback_address',
	        buyer_address: BUYBACK_EXECUTOR_ADDRESS,
	      });
	    }

    events.push(...boughtByToken.values());
  }

  return events.sort((a, b) => a.timestamp - b.timestamp);
}

async function extractBuybackEventsFromReceipt(txHash: `0x${string}`): Promise<BuybackEventRecord[]> {
  const receipt = await readBuybackRpc((client) => client.getTransactionReceipt({ hash: txHash }));
  const detectedAtMs = Date.now();
  const marketAddress = addressOf(receipt.to ?? undefined);
  const transfers = receipt.logs
    .map(decodeTransferLog)
    .filter((item): item is DecodedTransferLog => Boolean(item));
  return extractOfficialBuybackEventsFromTransfers(txHash, transfers, marketAddress, detectedAtMs);
}

async function extractOfficialBuybackEventsFromTransfers(
  txHash: `0x${string}`,
  transfers: DecodedTransferLog[],
  marketAddress: string,
  detectedAtMs: number,
): Promise<BuybackEventRecord[]> {
  const virtualSpentRaw = transfers
    .filter((item) => item.token === VIRTUAL_TOKEN && item.from === BUYBACK_EXECUTOR_ADDRESS && item.value > 0n)
    .reduce((sum, item) => sum + item.value, 0n);

  if (virtualSpentRaw <= 0n) return [];

  const boughtByToken = new Map<string, { rawAmount: bigint; symbol: string; decimals: number; approvalSpenderAddress: string }>();
  for (const item of transfers) {
    if (item.value <= 0n) continue;
    if (item.to !== BUYBACK_EXECUTOR_ADDRESS) continue;
    if (item.from === ZERO_ADDRESS) continue;
    if (item.token === VIRTUAL_TOKEN || item.token === USDC_TOKEN) continue;

    const meta = await getTokenMeta(item.token);
    const existing = boughtByToken.get(item.token);
    boughtByToken.set(item.token, {
      rawAmount: (existing?.rawAmount ?? 0n) + item.value,
      symbol: meta.symbol,
      decimals: meta.decimals,
      approvalSpenderAddress: existing?.approvalSpenderAddress ?? item.from,
    });
  }

  return [...boughtByToken.entries()].map(([tokenAddress, item]) => ({
    tx_hash: txHash,
    token_address: tokenAddress,
    token_symbol: item.symbol,
    timestamp: Math.floor(Date.now() / 1000),
    token_amount: Number(formatUnits(item.rawAmount, item.decimals)),
    virtual_spent: Number(formatUnits(virtualSpentRaw, 18)),
	    market_address: marketAddress || undefined,
	    approval_spender_address: item.approvalSpenderAddress || undefined,
	    detected_at_ms: detectedAtMs,
	    trigger_source: 'official_buyback_address',
	    buyer_address: BUYBACK_EXECUTOR_ADDRESS,
		  }));
}

function virtualUsdForLargeBuyFallback(): number {
  return virtualUsdCache?.value && virtualUsdCache.value > 0
    ? virtualUsdCache.value
    : BUYBACK_LARGE_BUY_VIRTUAL_USD_FALLBACK;
}

function extractLargeBuyFallbackEventsFromTransfers(
  txHash: `0x${string}`,
  transfers: DecodedTransferLog[],
  marketAddress: string,
  detectedAtMs: number,
  virtualUsd: number,
): BuybackEventRecord[] {
  if (!BUYBACK_LARGE_BUY_FALLBACK_ENABLED) return [];
  if (BUYBACK_LARGE_BUY_THRESHOLD_VIRTUAL <= 0 && (BUYBACK_LARGE_BUY_THRESHOLD_USD <= 0 || virtualUsd <= 0)) return [];
  const allowedTokens = new Set(largeBuyFallbackTokenAddresses().map((address) => address.toLowerCase()));
  if (allowedTokens.size === 0) return [];

  const virtualSpentByBuyer = new Map<string, bigint>();
  for (const item of transfers) {
    if (item.token !== VIRTUAL_TOKEN) continue;
    if (item.value <= 0n) continue;
    if (item.from === ZERO_ADDRESS || item.to === ZERO_ADDRESS) continue;
    if (item.from === item.to) continue;
    virtualSpentByBuyer.set(item.from, (virtualSpentByBuyer.get(item.from) ?? 0n) + item.value);
  }

  const eventsByTokenBuyer = new Map<string, BuybackEventRecord>();
  for (const item of transfers) {
    if (!allowedTokens.has(item.token)) continue;
    if (item.value <= 0n) continue;
    if (item.from === ZERO_ADDRESS || item.to === ZERO_ADDRESS) continue;
    if (item.to === BUYBACK_EXECUTOR_ADDRESS) continue;
    const virtualSpentRaw = virtualSpentByBuyer.get(item.to) ?? 0n;
    if (virtualSpentRaw <= 0n) continue;

    const virtualSpent = Number(formatUnits(virtualSpentRaw, 18));
    const virtualSpentUsd = virtualUsd > 0 ? virtualSpent * virtualUsd : undefined;
    const exceedsVirtualThreshold = BUYBACK_LARGE_BUY_THRESHOLD_VIRTUAL_RAW > 0n && virtualSpentRaw > BUYBACK_LARGE_BUY_THRESHOLD_VIRTUAL_RAW;
    const exceedsUsdThreshold = BUYBACK_LARGE_BUY_THRESHOLD_VIRTUAL <= 0 &&
      BUYBACK_LARGE_BUY_THRESHOLD_USD > 0 &&
      virtualSpentUsd !== undefined &&
      Number.isFinite(virtualSpentUsd) &&
      virtualSpentUsd > BUYBACK_LARGE_BUY_THRESHOLD_USD;
    if (!exceedsVirtualThreshold && !exceedsUsdThreshold) continue;

    const meta = configuredTokenMeta(item.token);
    if (!meta) continue;
    const key = `${item.token}:${item.to}`;
    const existing = eventsByTokenBuyer.get(key);
    const amount = Number(formatUnits(item.value, meta.decimals));
    eventsByTokenBuyer.set(key, {
      tx_hash: txHash,
      token_address: item.token,
      token_symbol: meta.symbol,
      timestamp: Math.floor(Date.now() / 1000),
      token_amount: (existing?.token_amount ?? 0) + amount,
      virtual_spent: virtualSpent,
      market_address: marketAddress || undefined,
      approval_spender_address: EXIT_ENGINE_CONFIG.route.approvalSpenderAddress || item.from,
      detected_at_ms: detectedAtMs,
      trigger_source: 'large_buy_fallback',
      buyer_address: item.to,
      virtual_spent_usd: virtualSpentUsd,
      threshold_virtual: BUYBACK_LARGE_BUY_THRESHOLD_VIRTUAL > 0 ? BUYBACK_LARGE_BUY_THRESHOLD_VIRTUAL : undefined,
      threshold_usd: BUYBACK_LARGE_BUY_THRESHOLD_VIRTUAL <= 0 ? BUYBACK_LARGE_BUY_THRESHOLD_USD : undefined,
    });
  }
  return [...eventsByTokenBuyer.values()];
}

async function extractLargeBuyFallbackEventsFromReceipt(txHash: `0x${string}`): Promise<BuybackEventRecord[]> {
  const receipt = await readBuybackRpc((client) => client.getTransactionReceipt({ hash: txHash }));
  const detectedAtMs = Date.now();
  const marketAddress = addressOf(receipt.to ?? undefined);
  const transfers = receipt.logs
    .map(decodeTransferLog)
    .filter((item): item is DecodedTransferLog => Boolean(item));
  return extractLargeBuyFallbackEventsFromTransfers(
    txHash,
    transfers,
    marketAddress,
    detectedAtMs,
    virtualUsdForLargeBuyFallback(),
  );
}

function flashblockItemsFromPayload(payload: unknown): unknown[] {
  const result = (payload as { result?: unknown })?.result ?? payload;
  if (Array.isArray(result)) return result;
  const record = result as Record<string, unknown> | null;
  if (!record) return [];
  if (Array.isArray(record.transactions)) return record.transactions;
  if (Array.isArray(record.txs)) return record.txs;
  return [record];
}

function flashblockTxHash(item: unknown): `0x${string}` | null {
  const record = item as Record<string, unknown> | null;
  const tx = record?.transaction as Record<string, unknown> | undefined;
  const hash = record?.hash ?? record?.transactionHash ?? record?.txHash ?? tx?.hash;
  return typeof hash === 'string' && hash.startsWith('0x') ? hash as `0x${string}` : null;
}

function flashblockTxTo(item: unknown): string {
  const record = item as Record<string, unknown> | null;
  const tx = record?.transaction as Record<string, unknown> | undefined;
  const receipt = record?.receipt as Record<string, unknown> | undefined;
  const to = record?.to ?? tx?.to ?? receipt?.to;
  return typeof to === 'string' ? addressOf(to) : '';
}

function flashblockLogs(item: unknown, txHash: `0x${string}`): Log[] {
  const record = item as Record<string, unknown> | null;
  const tx = record?.transaction as Record<string, unknown> | undefined;
  const receipt = record?.receipt as Record<string, unknown> | undefined;
  const rawLogs = Array.isArray(record?.logs)
    ? record?.logs
    : Array.isArray(receipt?.logs)
      ? receipt?.logs
      : Array.isArray(tx?.logs)
        ? tx?.logs
        : [];
  return rawLogs
    .map((log) => normalizeRpcLog(log, txHash))
    .filter((log): log is Log => Boolean(log));
}

async function executeFlashblockBuybackItem(item: unknown, sourceUrl: string): Promise<FeishuCard[]> {
  if (!isBuybackScanWindow()) return [];
  const txHash = flashblockTxHash(item);
  if (!txHash) return [];
  const logs = flashblockLogs(item, txHash);
  if (logs.length === 0) return [];

  const detectedAtMs = Date.now();
  const transfers = decodeTransferLogs(logs);
  if (transfers.length === 0) return [];

  const marketAddress = flashblockTxTo(item) || defaultAutoSellMarketAddress();
  const cards: FeishuCard[] = [];
  const events = [
    ...await extractOfficialBuybackEventsFromTransfers(txHash, transfers, marketAddress, detectedAtMs),
    ...extractLargeBuyFallbackEventsFromTransfers(
      txHash,
      transfers,
      marketAddress,
      detectedAtMs,
      virtualUsdForLargeBuyFallback(),
    ),
  ];

  for (const event of events) {
    const card = await executeAndRecordBuybackEvent(event);
    if (card) cards.push(card);
  }

  if (cards.length > 0) {
    console.log(`[FlashblocksBuyback] ${shortHash(txHash)} from ${new URL(sourceUrl).host} | logs=${logs.length} | alerts=${cards.length}`);
  }
  return cards;
}

async function handleFlashblocksBuybackPayload(payload: unknown, sourceUrl: string) {
  const cards: FeishuCard[] = [];
  for (const item of flashblockItemsFromPayload(payload)) {
    cards.push(...await executeFlashblockBuybackItem(item, sourceUrl));
  }
  if (cards.length === 0) return;
  for (const card of cards) {
    console.log(`[FlashblocksBuyback] Signal: ${card.title}`);
  }
  enqueueFeishuCards(cards);
  await flushNotificationOutbox();
}

function startFlashblocksBuybackMonitorForUrl(url: string) {
  const client = createPublicClient({
    chain: base,
    transport: webSocket(url, {
      keepAlive: true,
      retryCount: 0,
      timeout: BUYBACK_RPC_TIMEOUT_MS,
    }),
  });

  void (async () => {
    try {
      const subscription = await (client.transport as any).subscribe({
        params: ['newFlashblockTransactions', true],
        onData: (data: unknown) => {
          void handleFlashblocksBuybackPayload(data, url).catch((err) => {
            console.error(`[FlashblocksBuyback] payload error (${new URL(url).host}):`, err);
          });
        },
        onError: (err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[FlashblocksBuyback] subscription error (${new URL(url).host}): ${message}`);
          setTimeout(() => startFlashblocksBuybackMonitorForUrl(url), BUYBACK_FLASHBLOCKS_RECONNECT_MS);
        },
      });
      console.log(`[FlashblocksBuyback] subscribed to ${new URL(url).host} (${subscription.subscriptionId})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[FlashblocksBuyback] subscribe failed (${new URL(url).host}): ${message}`);
      setTimeout(() => startFlashblocksBuybackMonitorForUrl(url), BUYBACK_FLASHBLOCKS_RECONNECT_MS);
    }
  })();
}

function startFlashblocksBuybackMonitor() {
  if (!BUYBACK_FLASHBLOCKS_ENABLED || flashblocksBuybackMonitorStarted) return;
  flashblocksBuybackMonitorStarted = true;
  const urls = flashblocksWsUrls();
  if (urls.length === 0) {
    console.error('[FlashblocksBuyback] enabled but no WebSocket URL is configured');
    return;
  }
  for (const url of urls) startFlashblocksBuybackMonitorForUrl(url);
}

function buybackCard(event: BuybackEventRecord, autoSell?: AutoSellResult): FeishuCard {
  const isHeld = HELD_SYMBOLS.has(event.token_symbol.toUpperCase());
  const autoSellFailed = autoSellNeedsEmergency(autoSell);
  const autoSellText = autoSell ? AUTO_SELL_STATUS_TEXT[autoSell.status] : '未返回自动卖出结果';
  const isLargeBuyFallback = event.trigger_source === 'large_buy_fallback';
  const triggerTitle = isLargeBuyFallback ? '[大额买入触发]' : '[回购已发生]';
  const triggerText = isLargeBuyFallback ? '大额买入 fallback' : '回购';
  const basis = isLargeBuyFallback
    ? `未知买方买入 ${Math.round(event.token_amount).toLocaleString()} ${event.token_symbol}；花费 ${event.virtual_spent.toFixed(2)} VIRTUAL${event.virtual_spent_usd !== undefined ? `，约 ${Math.round(event.virtual_spent_usd).toLocaleString()}U` : ''}，超过 ${Math.round(event.threshold_virtual ?? BUYBACK_LARGE_BUY_THRESHOLD_VIRTUAL).toLocaleString()} VIRTUAL`
    : `官方回购买入 ${Math.round(event.token_amount).toLocaleString()} ${event.token_symbol}；花费 ${event.virtual_spent.toFixed(2)} VIRTUAL`;
  return {
    title: `${triggerTitle} ${event.token_symbol} 立刻检查卖出`,
    template: isHeld ? 'red' : 'orange',
    tokenUrl: `${BASESCAN_TX_URL}/${event.tx_hash}`,
    dedupeKey: `buyback:${event.tx_hash}:${event.token_address.toLowerCase()}`,
    voice: voiceAlert(
      'p0',
      autoSellFailed
        ? `${event.token_symbol} ${triggerText}触发，但自动卖出失败，${autoSellText}。立即查看。`
        : `${event.token_symbol} ${triggerText}已触发，自动卖出状态：${autoSellText}。立即查看。`,
    ),
    fields: [
      { label: '动作', value: isHeld ? '你在持仓列表中，优先卖出/减仓' : '未在持仓列表中，观察即可' },
      { label: '依据', value: basis },
      ...(event.buyer_address ? [{ label: isLargeBuyFallback ? '买方地址' : '回购地址', value: shortHash(event.buyer_address) }] : []),
      ...autoSellSummary(autoSell),
    ],
	  };
	}

async function executeAndRecordBuybackEvent(event: BuybackEventRecord): Promise<FeishuCard | null> {
  if (hasBuybackEvent(event.tx_hash, event.token_address)) return null;
  saveBuybackEvent(event);
  const autoSell = await executeAutoSell({
    tokenAddress: event.token_address,
    tokenSymbol: event.token_symbol,
    marketAddress: event.market_address,
    approvalSpenderAddress: event.approval_spender_address,
    triggerTxHash: event.tx_hash,
    detectedAtMs: event.detected_at_ms ?? Date.now(),
    referenceTokenAmount: event.token_amount,
    referenceVirtualSpent: event.virtual_spent,
  });
  saveAutoSellResult(event, autoSell);
  logAutoSellResult(event, autoSell);
  return buybackCard(event, autoSell);
}

function autoSellHealthCheckWindowLabel(): string {
  return `Beijing ${dayLabel(AUTO_SELL_HEALTHCHECK_DAY)} ${String(AUTO_SELL_HEALTHCHECK_HOUR).padStart(2, '0')}:${String(AUTO_SELL_HEALTHCHECK_MINUTE).padStart(2, '0')}`;
}

function dueAutoSellHealthCheckKey(now = new Date()): string | null {
  if (!AUTO_SELL_HEALTHCHECK_ENABLED) return null;
  const parts = beijingTimeParts(now);
  const weekMinutes = 7 * 24 * 60;
  const target = AUTO_SELL_HEALTHCHECK_DAY * 24 * 60 + AUTO_SELL_HEALTHCHECK_HOUR * 60 + AUTO_SELL_HEALTHCHECK_MINUTE;
  const delta = (parts.minuteOfWeek - target + weekMinutes) % weekMinutes;
  if (delta >= AUTO_SELL_HEALTHCHECK_WINDOW_MINUTES) return null;
  return `${parts.label.slice(0, 10)}:${target}`;
}

function autoSellReadinessSummary(report: AutoSellReadinessReport): string {
  const failed = report.issues.filter((issue) => issue.level === 'error');
  if (failed.length === 0) return '自动卖出窗口前检查通过。';
  return failed.slice(0, 3).map((issue) => issue.message).join('；');
}

function autoSellHealthCard(report: AutoSellReadinessReport): FeishuCard | null {
  const failed = report.issues.filter((issue) => issue.level === 'error');
  if (failed.length === 0) return null;
  const warnings = report.issues.filter((issue) => issue.level === 'warning');
  return {
    title: '[自动卖出未就绪] 周一窗口前检查失败',
    template: 'red',
    dedupeKey: `auto-sell-health:${new Date().toISOString().slice(0, 10)}`,
    voice: voiceAlert('p0', `自动卖出窗口前检查失败：${autoSellReadinessSummary(report)}。16:00 前处理。`),
    fields: [
      { label: '影响', value: '回购触发后可能无法自动卖出或进入慢路径', wide: true },
      { label: '动作', value: '16:00 前检查服务器 .env、RPC、私钥、预授权和飞书强提醒', wide: true },
      { label: '钱包', value: report.wallet ? shortHash(report.wallet) : '未识别' },
      { label: '市场合约', value: shortHash(report.marketAddress) },
      { label: '报价路由', value: shortHash(report.quoteAddress) },
      { label: '授权对象', value: shortHash(report.approvalSpenderAddress) },
      { label: 'RPC 数量', value: String(report.rpcCount) },
      { label: '预授权配置', value: `${report.preapprovedPairs} 组` },
      { label: '失败项', value: failed.map((issue) => issue.message).slice(0, 6).join('\n'), wide: true },
      ...(warnings.length > 0 ? [{ label: '警告项', value: warnings.map((issue) => issue.message).slice(0, 4).join('\n'), wide: true }] : []),
    ],
  };
}

async function runAutoSellHealthCheckTick(now = new Date()) {
  const dueKey = dueAutoSellHealthCheckKey(now);
  if (!dueKey || dueKey === autoSellHealthCheckLastKey || autoSellHealthCheckRunning) return;
  autoSellHealthCheckLastKey = dueKey;
  autoSellHealthCheckRunning = true;
  try {
    const report = await buildAutoSellReadinessReport();
    const card = autoSellHealthCard(report);
    if (card) {
      console.error(`[AutoSellHealth] failed: ${autoSellReadinessSummary(report)}`);
      enqueueFeishuCard(card);
      await flushNotificationOutbox();
    } else {
      const warningCount = report.issues.filter((issue) => issue.level === 'warning').length;
      console.log(`[AutoSellHealth] ready for ${autoSellHealthCheckWindowLabel()} (${warningCount} warning${warningCount === 1 ? '' : 's'})`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[AutoSellHealth] check crashed: ${message}`);
    enqueueFeishuCard({
      title: '[自动卖出未就绪] 健康检查异常',
      template: 'red',
      dedupeKey: `auto-sell-health-crash:${dueKey}`,
      voice: voiceAlert('p0', `自动卖出健康检查异常：${message.slice(0, 120)}。16:00 前处理。`),
      fields: [
        { label: '影响', value: '无法确认自动卖出是否就绪', wide: true },
        { label: '动作', value: '查看服务器日志并手动运行 node dist/checkAutoSellHealth.js', wide: true },
        { label: '异常', value: message.slice(0, 300), wide: true },
      ],
    });
    await flushNotificationOutbox();
  } finally {
    autoSellHealthCheckRunning = false;
  }
}

async function runBlockscoutBuybackMonitor(): Promise<FeishuCard[]> {
  if (!BUYBACK_MONITOR_ENABLED) return [];

  if (!isBuybackScanWindow()) {
    const { label } = beijingTimeParts();
    const pauseKey = label.slice(0, 13);
    if (buybackPauseLoggedFor !== pauseKey) {
      buybackPauseLoggedFor = pauseKey;
      console.log(`[BuybackMonitor] Paused outside ${buybackWindowLabel()} window (now ${label}, mode=${BUYBACK_WINDOW_MODE})`);
    }
    return [];
  }

  const items = await fetchBuybackTransfers();
  const events = extractBuybackEvents(items);
  const shouldPrimeHistory = BUYBACK_PRIME_HISTORY && getBuybackEventCount() === 0;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const cards: FeishuCard[] = [];
  let primed = 0;

  for (const event of events) {
    if (hasBuybackEvent(event.tx_hash, event.token_address)) continue;
    saveBuybackEvent(event);
    const oldHistoricalEvent = nowSeconds - event.timestamp > BUYBACK_PRIME_GRACE_SECONDS;
    if (shouldPrimeHistory && oldHistoricalEvent) {
      primed += 1;
      continue;
    }
	    const autoSell = await executeAutoSell({
	      tokenAddress: event.token_address,
	      tokenSymbol: event.token_symbol,
	      marketAddress: event.market_address,
      approvalSpenderAddress: event.approval_spender_address,
	      triggerTxHash: event.tx_hash,
	      detectedAtMs: event.detected_at_ms ?? Date.now(),
	    });
	    saveAutoSellResult(event, autoSell);
	    logAutoSellResult(event, autoSell);
	    cards.push(buybackCard(event, autoSell));
	  }

  if (shouldPrimeHistory && primed > 0) {
    console.log(`[BuybackMonitor] Primed ${primed} historical buyback events without alerting`);
  }
  const nowMs = Date.now();
  const shouldLogActive = cards.length > 0 || primed > 0 || nowMs - buybackLastActiveLogMs >= 60_000;
  if (shouldLogActive) {
    buybackLastActiveLogMs = nowMs;
    if (events.length > 0) {
      console.log(`[BuybackMonitor] Window active | scanned ${items.length} transfers | detected ${events.length} buyback tx groups`);
    } else {
      console.log(`[BuybackMonitor] Window active | scanned ${items.length} transfers | no buyback tx`);
    }
  }
  return cards;
}

async function runRpcBuybackMonitor(): Promise<FeishuCard[]> {
  if (!BUYBACK_MONITOR_ENABLED) return [];

  if (!isBuybackScanWindow()) {
    buybackLastScannedBlock = null;
    const { label } = beijingTimeParts();
    const pauseKey = label.slice(0, 13);
    if (buybackPauseLoggedFor !== pauseKey) {
      buybackPauseLoggedFor = pauseKey;
      console.log(`[BuybackMonitor] Paused outside ${buybackWindowLabel()} window (now ${label}, mode=${BUYBACK_WINDOW_MODE})`);
    }
    return [];
  }

  const currentBlock = await readBuybackRpc((client) => client.getBlockNumber());
  if (buybackLastScannedBlock === null) {
    buybackLastScannedBlock = currentBlock > BUYBACK_FAST_BACKFILL_BLOCKS
      ? currentBlock - BUYBACK_FAST_BACKFILL_BLOCKS
      : 0n;
  }

  let fromBlock = buybackLastScannedBlock + 1n;
  if (fromBlock > currentBlock) return [];
  if (currentBlock - fromBlock + 1n > BUYBACK_FAST_MAX_BLOCK_RANGE) {
    fromBlock = currentBlock - BUYBACK_FAST_MAX_BLOCK_RANGE + 1n;
  }

  const largeBuyTokens = largeBuyFallbackTokenAddresses();
  const fallbackLogReads = largeBuyTokens.length > 0
    ? Promise.allSettled([
      readBuybackRpc((client) => client.getLogs({
        address: largeBuyTokens,
        event: TRANSFER_EVENT,
        fromBlock,
        toBlock: currentBlock,
      })),
      readBuybackRpc((client) => client.getLogs({
        address: asAddress(VIRTUAL_TOKEN),
        event: TRANSFER_EVENT,
        fromBlock,
        toBlock: currentBlock,
      })),
    ])
    : Promise.resolve([]);
  const [logs, fallbackResults] = await Promise.all([
    readBuybackRpc((client) => client.getLogs({
      event: TRANSFER_EVENT,
      args: { to: asAddress(BUYBACK_EXECUTOR_ADDRESS) },
      fromBlock,
      toBlock: currentBlock,
    })),
    fallbackLogReads,
  ]);
  buybackLastScannedBlock = currentBlock;

  let largeBuyLogs: Log[] = [];
  let largeBuyVirtualLogs: Log[] = [];
  if (fallbackResults.length > 0) {
    const [tokenResult, virtualResult] = fallbackResults;
    if (tokenResult?.status === 'fulfilled') {
      largeBuyLogs = tokenResult.value;
    } else if (tokenResult?.status === 'rejected') {
      logBuybackFallbackRpcError('token', tokenResult.reason);
    }
    if (virtualResult?.status === 'fulfilled') {
      largeBuyVirtualLogs = virtualResult.value;
    } else if (virtualResult?.status === 'rejected') {
      logBuybackFallbackRpcError('virtual', virtualResult.reason);
    }
  }

  const txHashes = txHashesFromLogs(logs);
  const largeBuyTxHashes = txHashesFromLogs(largeBuyLogs);
  const largeBuyTransfersByTx = transfersByTxHash(decodeTransferLogs([...largeBuyLogs, ...largeBuyVirtualLogs]));
  const fallbackDetectedAtMs = Date.now();
  const fallbackMarketAddress = defaultAutoSellMarketAddress();
  const fallbackVirtualUsd = virtualUsdForLargeBuyFallback();
  const cards: FeishuCard[] = [];

  for (const txHash of largeBuyTxHashes) {
    const events = extractLargeBuyFallbackEventsFromTransfers(
      txHash,
      largeBuyTransfersByTx.get(txHash) ?? [],
      fallbackMarketAddress,
      fallbackDetectedAtMs,
      fallbackVirtualUsd,
    );
    for (const event of events) {
      const card = await executeAndRecordBuybackEvent(event);
      if (card) cards.push(card);
    }
  }

  for (const txHash of txHashes) {
    const events = await extractBuybackEventsFromReceipt(txHash);
    for (const event of events) {
      const card = await executeAndRecordBuybackEvent(event);
      if (card) cards.push(card);
    }
  }

  const nowMs = Date.now();
  const shouldLogActive = cards.length > 0 || nowMs - buybackLastActiveLogMs >= 60_000;
  if (shouldLogActive) {
    buybackLastActiveLogMs = nowMs;
    console.log(`[BuybackMonitor] RPC fast | blocks ${fromBlock}-${currentBlock} | address logs ${logs.length} | large-buy token logs ${largeBuyLogs.length} | virtual logs ${largeBuyVirtualLogs.length} | alerts ${cards.length}`);
  }

  return cards;
}

async function runBuybackMonitor(): Promise<FeishuCard[]> {
  if (BUYBACK_MONITOR_SOURCE === 'blockscout') return runBlockscoutBuybackMonitor();
  return runRpcBuybackMonitor();
}

async function runBuybackMonitorTick() {
  if (buybackMonitorRunning) return;
  buybackMonitorRunning = true;
  try {
    await flushNotificationOutbox();
    const cards = await runBuybackMonitor();
    for (const card of cards) {
      console.log(`[BuybackMonitor] Signal: ${card.title}`);
    }
    enqueueFeishuCards(cards);
    await flushNotificationOutbox();
  } catch (err) {
    console.error('[BuybackMonitor] error:', err);
  } finally {
    buybackMonitorRunning = false;
  }
}

async function deliverFeishuCard(card: FeishuCard): Promise<{ ok: boolean; error?: string }> {
  if (!FEISHU_WEBHOOK) {
    console.error(`[Feishu] webhook missing, cannot send: ${card.title}`);
    return { ok: false, error: 'FEISHU_WEBHOOK missing' };
  }
  const elements: any[] = [
    {
      tag: 'div',
      fields: card.fields.map(f => ({
        is_short: !f.wide,
        text: { tag: 'lark_md', content: `**${f.label}**\n${f.value}` },
      })),
    },
  ];
  if (card.tokenUrl) {
    elements.push({
      tag: 'action',
      actions: [{
        tag: 'button',
        text: { tag: 'plain_text', content: '查看代币' },
        type: 'primary',
        url: card.tokenUrl,
      }],
    });
  }
  const body = {
    msg_type: 'interactive',
    card: {
      header: {
        title: { tag: 'plain_text', content: card.title },
        template: card.template,
      },
      elements,
    },
  };
  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetchWithTimeout(FEISHU_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, FEISHU_TIMEOUT_MS);
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      const apiCode = json?.StatusCode ?? json?.code;
      if (res.ok && apiCode === 0) {
        return { ok: true };
      }
      lastError = `HTTP ${res.status}; body=${text.slice(0, 240)}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await sleep(500 * attempt);
  }
  console.error(`[Feishu] send failed after retries: ${card.title}; ${lastError}`);
  return { ok: false, error: lastError || 'unknown Feishu delivery error' };
}

function notificationInputFromCard(card: FeishuCard) {
  return {
    channel: 'feishu',
    dedupe_key: card.dedupeKey ?? `feishu:${card.title}`,
    title: card.title,
    template: card.template,
    token_url: card.tokenUrl ?? null,
    fields: card.fields,
  };
}

const PUSHOVER_MESSAGE_FIELD = '__pushover_message';
const PUSHOVER_PRIORITY_FIELD = '__pushover_priority';
const PUSHOVER_SOUND_FIELD = '__pushover_sound';
const FEISHU_URGENT_MESSAGE_FIELD = '__feishu_urgent_message';
const FEISHU_URGENT_MENTION_FIELD = '__feishu_urgent_mention';

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 1))}…` : value;
}

function shouldQueueFeishuUrgent(card: FeishuCard): boolean {
  return FEISHU_URGENT_ENABLED && Boolean(card.voice);
}

function feishuUrgentNotificationInputFromCard(card: FeishuCard) {
  if (!card.voice || !shouldQueueFeishuUrgent(card)) return null;
  const title = truncateText(card.title.replace(/^\[[^\]]+\]\s*/, '[交易强提醒] '), 120);
  const lines = [
    title,
    card.voice.message,
    card.tokenUrl ? '点开完整飞书卡片后再操作。' : '请立即查看完整飞书卡片后再操作。',
  ];
  return {
    channel: 'feishu_urgent',
    dedupe_key: `feishu-urgent:${card.dedupeKey ?? card.title}`,
    title,
    template: card.template,
    token_url: card.tokenUrl ?? null,
    fields: [
      { label: FEISHU_URGENT_MESSAGE_FIELD, value: lines.join('\n'), wide: true },
      { label: FEISHU_URGENT_MENTION_FIELD, value: FEISHU_URGENT_MENTION_USER_ID },
    ],
  };
}

function feishuUrgentField(record: ReturnType<typeof claimDueNotifications>[number], label: string): string | null {
  return record.fields.find((field) => field.label === label)?.value ?? null;
}

function feishuMentionPrefix(userId: string | null): string {
  const id = (userId ?? '').trim();
  if (!id) return '';
  if (id === 'all') return '<at user_id="all">所有人</at> ';
  return `<at user_id="${id}"></at> `;
}

async function deliverFeishuUrgentNotification(record: ReturnType<typeof claimDueNotifications>[number]): Promise<{ ok: boolean; error?: string }> {
  if (!FEISHU_WEBHOOK) {
    console.error(`[FeishuUrgent] webhook missing, cannot send: ${record.title}`);
    return { ok: false, error: 'FEISHU_WEBHOOK missing' };
  }
  const message = feishuUrgentField(record, FEISHU_URGENT_MESSAGE_FIELD) ?? record.title;
  const mention = feishuUrgentField(record, FEISHU_URGENT_MENTION_FIELD) ?? FEISHU_URGENT_MENTION_USER_ID;
  const body = {
    msg_type: 'text',
    content: {
      text: `${feishuMentionPrefix(mention)}${truncateText(message, 1200)}`,
    },
  };
  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetchWithTimeout(FEISHU_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, FEISHU_TIMEOUT_MS);
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      const apiCode = json?.StatusCode ?? json?.code;
      if (res.ok && apiCode === 0) {
        return { ok: true };
      }
      lastError = `HTTP ${res.status}; body=${text.slice(0, 240)}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await sleep(500 * attempt);
  }
  console.error(`[FeishuUrgent] send failed after retries: ${record.title}; ${lastError}`);
  return { ok: false, error: lastError || 'unknown Feishu urgent delivery error' };
}

function pushoverCredentialsReady(): boolean {
  return Boolean(PUSHOVER_APP_TOKEN && PUSHOVER_USER_KEY);
}

function shouldQueuePushover(card: FeishuCard): boolean {
  if (!card.voice) return false;
  if (!PUSHOVER_ENABLED) return false;
  if (pushoverCredentialsReady()) return true;
  if (!pushoverConfigWarningLogged) {
    pushoverConfigWarningLogged = true;
    console.error('[Pushover] enabled but PUSHOVER_APP_TOKEN or PUSHOVER_USER_KEY is missing; voice alerts are not queued');
  }
  return false;
}

function pushoverNotificationInputFromCard(card: FeishuCard) {
  if (!card.voice || !shouldQueuePushover(card)) return null;
  const sound = card.voice.sound ?? (card.voice.priority === 'p0' ? PUSHOVER_P0_SOUND : PUSHOVER_P1_SOUND);
  return {
    channel: 'pushover',
    dedupe_key: `pushover:${card.dedupeKey ?? card.title}`,
    title: truncateText(card.title.replace(/^\[[^\]]+\]\s*/, '[交易警报] '), 250),
    template: card.template,
    token_url: card.tokenUrl ?? null,
    fields: [
      { label: PUSHOVER_MESSAGE_FIELD, value: card.voice.message, wide: true },
      { label: PUSHOVER_PRIORITY_FIELD, value: card.voice.priority },
      { label: PUSHOVER_SOUND_FIELD, value: sound },
    ],
  };
}

function pushoverField(record: ReturnType<typeof claimDueNotifications>[number], label: string): string | null {
  return record.fields.find((field) => field.label === label)?.value ?? null;
}

async function deliverPushoverNotification(record: ReturnType<typeof claimDueNotifications>[number]): Promise<{ ok: boolean; error?: string }> {
  if (!PUSHOVER_ENABLED) {
    console.log(`[Pushover] disabled, skip queued alert: ${record.title}`);
    return { ok: true };
  }
  if (!pushoverCredentialsReady()) {
    return { ok: false, error: 'Pushover credentials missing' };
  }

  const priority = (pushoverField(record, PUSHOVER_PRIORITY_FIELD) ?? 'p1') as VoiceAlertPriority;
  const message = pushoverField(record, PUSHOVER_MESSAGE_FIELD) ?? record.title;
  const sound = pushoverField(record, PUSHOVER_SOUND_FIELD) ?? (priority === 'p0' ? PUSHOVER_P0_SOUND : PUSHOVER_P1_SOUND);
  const params = new URLSearchParams({
    token: PUSHOVER_APP_TOKEN,
    user: PUSHOVER_USER_KEY,
    title: truncateText(record.title, 250),
    message: truncateText(message, 1024),
    priority: priority === 'p0' ? '2' : '1',
    sound,
  });
  if (PUSHOVER_DEVICE) params.set('device', PUSHOVER_DEVICE);
  if (record.token_url) {
    params.set('url', record.token_url);
    params.set('url_title', '查看详情');
  }
  if (priority === 'p0') {
    params.set('retry', String(PUSHOVER_P0_RETRY_SECONDS));
    params.set('expire', String(PUSHOVER_P0_EXPIRE_SECONDS));
  }

  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetchWithTimeout('https://api.pushover.net/1/messages.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
      }, PUSHOVER_TIMEOUT_MS);
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (res.ok && json?.status === 1) {
        return { ok: true };
      }
      lastError = `HTTP ${res.status}; body=${text.slice(0, 240)}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await sleep(500 * attempt);
  }
  console.error(`[Pushover] send failed after retries: ${record.title}; ${lastError}`);
  return { ok: false, error: lastError || 'unknown Pushover delivery error' };
}

function enqueuePushoverCard(card: FeishuCard): boolean {
  const input = pushoverNotificationInputFromCard(card);
  if (!input) return false;
  const result = enqueueNotification(input);
  if (result.inserted) {
    console.log(`[PushoverOutbox] queued: ${card.title}`);
  } else {
    console.log(`[PushoverOutbox] duplicate skipped (${result.status}): ${card.title}`);
  }
  return result.inserted;
}

function enqueueFeishuUrgentCard(card: FeishuCard): boolean {
  const input = feishuUrgentNotificationInputFromCard(card);
  if (!input) return false;
  const result = enqueueNotification(input);
  if (result.inserted) {
    console.log(`[FeishuUrgentOutbox] queued: ${card.title}`);
  } else {
    console.log(`[FeishuUrgentOutbox] duplicate skipped (${result.status}): ${card.title}`);
  }
  return result.inserted;
}

function enqueueFeishuCard(card: FeishuCard): boolean {
  const urgentInserted = enqueueFeishuUrgentCard(card);
  const result = enqueueNotification(notificationInputFromCard(card));
  const pushoverInserted = enqueuePushoverCard(card);
  if (result.inserted) {
    console.log(`[FeishuOutbox] queued: ${card.title}`);
  } else {
    console.log(`[FeishuOutbox] duplicate skipped (${result.status}): ${card.title}`);
  }
  try {
    card.onQueued?.();
  } catch (err) {
    console.error(`[FeishuOutbox] onQueued hook failed for ${card.title}:`, err);
  }
  return result.inserted || urgentInserted || pushoverInserted;
}

function enqueueFeishuCards(cards: FeishuCard[]) {
  for (const card of cards) {
    enqueueFeishuCard(card);
  }
}

function notificationRecordToCard(record: ReturnType<typeof claimDueNotifications>[number]): FeishuCard {
  return {
    title: record.title,
    template: record.template,
    tokenUrl: record.token_url ?? undefined,
    fields: record.fields,
    dedupeKey: record.dedupe_key,
  };
}

function retryDelayMs(attempts: number): number {
  const seconds = Math.min(300, Math.max(5, 5 * 2 ** Math.min(attempts, 6)));
  return seconds * 1000;
}

async function flushNotificationOutbox() {
  const due = claimDueNotifications(Date.now(), FEISHU_OUTBOX_BATCH_SIZE);
  if (due.length === 0) return;
  for (const record of due) {
    const card = notificationRecordToCard(record);
    const result = record.channel === 'pushover'
      ? await deliverPushoverNotification(record)
      : record.channel === 'feishu_urgent'
        ? await deliverFeishuUrgentNotification(record)
      : await deliverFeishuCard(card);
    if (result.ok) {
      markNotificationSent(record.id);
      const channelName = record.channel === 'pushover'
        ? 'Pushover'
        : record.channel === 'feishu_urgent'
          ? 'FeishuUrgent'
          : 'Feishu';
      console.log(`[${channelName}] sent: ${card.title}`);
    } else {
      markNotificationDeliveryFailed(
        record.id,
        result.error ?? `unknown ${record.channel} delivery error`,
        retryDelayMs(record.attempts),
        FEISHU_OUTBOX_MAX_ATTEMPTS,
      );
    }
  }
}

async function runPotMonitor() {
  if (potMonitorRunning) {
    console.warn('[PotMonitor] previous cycle still running; skip this tick');
    return;
  }
  potMonitorRunning = true;
  try {
    await flushNotificationOutbox();
    const { agents, invalidAgents, rawSnapshots } = await fetchAllAgentPnl();
    const cards: FeishuCard[] = [];
    const selectedSymbols = lastFetchedSelectedSymbols.size > 0
      ? lastFetchedSelectedSymbols
      : new Set(agents.map((agent) => agent.symbol.toUpperCase()));

    const now = Math.floor(Date.now() / 1000);
    savePotAgentRawSnapshots(rawSnapshots, now);
    const potDataSourceHealth = evaluatePotDataSourceHealth(agents, invalidAgents, rawSnapshots, now, alertBaselinePrimed);
    const dataSourceUnreliable = potDataSourceHealth.dataSourceUnreliable;
    cards.push(...potDataSourceHealth.cards);
    if (alertBaselinePrimed && !dataSourceUnreliable) {
      cards.push(...invalidPotDataCards(invalidAgents, agents.length, rawSnapshots.length, now));
    } else if (dataSourceUnreliable && potDataSourceHealth.zeroValueAgents.length > 0) {
      console.log(`[PotMonitor] Suppressed single-agent zero alerts during official data-source anomaly (${potDataSourceHealth.zeroValueAgents.length} zero rows)`);
    }

    if (agents.length > 0) {
      const seasonId = agents[0].seasonId;
      if (currentSeasonId && seasonId !== currentSeasonId) {
        console.log(`[PotMonitor] Season changed: ${currentSeasonId} → ${seasonId}, resetting state`);
        triggeredThresholds.clear();
        rapidCooldown.clear();
        hourlyCooldown.clear();
        clearAllSnapshots();
        alertBaselinePrimed = false;
      }
      currentSeasonId = seasonId;

      savePotAgentSnapshots(agents.map((agent) => agent.snapshot), now);
      savePotMarketSnapshots(await buildPotMarketSnapshots(agents, now));

      for (const agent of agents) {
        if (alertBaselinePrimed) {
          cards.push(...await checkThresholdSignals(agent, now));
        } else {
          triggeredThresholds.set(agent.agentName, getTriggeredThresholdKeys(agent.livePnl));
        }
        savePnlSnapshot(agent.agentName, now, agent.livePnl, seasonId);
      }
    } else {
      console.log('[PotMonitor] No trackable valid Pot agents in this cycle; SelectionMonitor will still run');
    }

    const positionAdviceAgents = dataSourceUnreliable ? [] : agents;
    if (dataSourceUnreliable && agents.length === rawSnapshots.length) {
      console.log('[PositionAdvice] Paused until official Pot data source recovery is confirmed');
    } else if (dataSourceUnreliable) {
      console.log(`[PositionAdvice] Paused because Pot API returned ${agents.length}/${rawSnapshots.length} valid agents`);
    } else if (agents.length < rawSnapshots.length) {
      console.log(`[PositionAdvice] Limited to ${agents.length}/${rawSnapshots.length} current valid Pot agents; missing agents will not get stale fallback advice`);
    } else if (!POSITION_ADVICE_ALERTS_ENABLED) {
      console.log('[PositionAdvice] Alerts paused by POSITION_ADVICE_ALERTS_ENABLED=0; snapshots still saved');
    }
    let selectionMonitorCompleted = false;
    try {
      cards.push(...await runSelectionMonitor(
        selectedSymbols,
        selectionBaselinePrimed,
        positionAdviceAgents,
        {
          allowSelectionExpectationAlerts: SELECTION_EXPECTATION_ALERTS_ENABLED,
          allowPositionAdvice: POSITION_ADVICE_ALERTS_ENABLED && !dataSourceUnreliable,
          savePositionAdvice: !dataSourceUnreliable,
        },
      ));
      selectionMonitorCompleted = true;
    } catch (err) {
      console.error('[SelectionMonitor] error; Pot Monitor cards and snapshots will continue:', err);
    }

    if (!alertBaselinePrimed && agents.length > 0) {
      alertBaselinePrimed = true;
      console.log(`[PotMonitor] Primed alert baseline for ${agents.length} agents; no startup cards sent`);
    }
    if (!selectionBaselinePrimed && selectionMonitorCompleted) {
      selectionBaselinePrimed = true;
      console.log('[SelectionMonitor] Primed selection baseline; no startup alpha cards sent');
    }

    for (const card of cards) {
      console.log(`[PotMonitor] Signal: ${card.title}`);
    }
    enqueueFeishuCards(cards);
    await flushNotificationOutbox();

    pruneOldSnapshots();
    pruneOldPotAgentSnapshots(POT_AGENT_SNAPSHOT_RETENTION_SECONDS);
    pruneOldPotAgentRawSnapshots(POT_AGENT_SNAPSHOT_RETENTION_SECONDS);
    pruneOldPotMarketSnapshots(POT_MARKET_SNAPSHOT_RETENTION_SECONDS);
    pruneOldNotifications();

    if (agents.length > 0) {
      const top3 = [...agents].sort((a, b) => b.livePnl - a.livePnl).slice(0, 3);
      console.log(`[PotMonitor ${new Date().toLocaleTimeString()}] ${agents.length} agents | Top: ${top3.map(a => `${a.agentName} ${formatPnl(a.livePnl)}`).join(', ')}`);
    }
  } catch (err) {
    console.error('[PotMonitor] error:', err);
  } finally {
    potMonitorRunning = false;
  }
}

// --- MAIN ---

async function main() {
  console.log('=== Chain Radar — Pot P&L Monitor ===\n');
  getDb();
  alertBaselinePrimed = initThresholdsFromDb();
  initSelectionStateFromDb();
  const autoSell = autoSellWalletStatus();
  console.log(`[AutoSell] enabled=${autoSell.enabled ? 'yes' : 'no'} key=${autoSell.keySet ? 'set' : 'missing'} valid=${autoSell.valid ? 'yes' : 'no'}${autoSell.wallet ? ` wallet=${shortHash(autoSell.wallet)}` : ''}`);

	  console.log('Starting Pot P&L + Selection Alpha monitor...');
	  await runPotMonitor();
	  await runAutoSellHealthCheckTick();
	  await runBuybackMonitorTick();

	  if (process.env.RUN_ONCE === '1') return;

	  setInterval(runPotMonitor, MONITOR_INTERVAL_MS);
	  if (AUTO_SELL_HEALTHCHECK_ENABLED) {
	    setInterval(runAutoSellHealthCheckTick, AUTO_SELL_HEALTHCHECK_INTERVAL_MS);
	    console.log(`Auto-sell health check watches ${autoSellHealthCheckWindowLabel()} for ${AUTO_SELL_HEALTHCHECK_WINDOW_MINUTES} minute${AUTO_SELL_HEALTHCHECK_WINDOW_MINUTES === 1 ? '' : 's'}.\n`);
	  }
	  if (BUYBACK_MONITOR_ENABLED) {
	    startFlashblocksBuybackMonitor();
	    setInterval(runBuybackMonitorTick, BUYBACK_MONITOR_INTERVAL_MS);
	    console.log(`Buyback monitor scans every ${BUYBACK_MONITOR_INTERVAL_MS}ms via ${BUYBACK_MONITOR_SOURCE} (${BUYBACK_RPC_URLS.length} RPC endpoint${BUYBACK_RPC_URLS.length > 1 ? 's' : ''}) during ${buybackWindowLabel()}. Flashblocks=${BUYBACK_FLASHBLOCKS_ENABLED ? flashblocksWsUrls().length : 0} WS endpoint${BUYBACK_FLASHBLOCKS_ENABLED && flashblocksWsUrls().length === 1 ? '' : 's'}.\n`);
  }
  console.log(`Monitoring every ${Math.round(MONITOR_INTERVAL_MS / 1000)}s. Press Ctrl+C to stop.\n`);
}

export const __watcherTest = {
  buildThresholdSignalCardsForDrill,
  checkSelectionSignals,
  evaluatePotDataSourceHealth,
  isTrackedPotSeasonStatus,
  enqueueFeishuCard,
  flushNotificationOutbox,
	  feishuUrgentNotificationInputFromCard,
	  deliverFeishuUrgentNotification,
	  pushoverNotificationInputFromCard,
	  deliverPushoverNotification,
	  dueAutoSellHealthCheckKey,
	  autoSellHealthCard,
	  configuredTokenMeta,
	  extractOfficialBuybackEventsFromTransfers,
	  extractLargeBuyFallbackEventsFromTransfers,
	  largeBuyFallbackTokenAddresses,
	};

if (process.env.CHAIN_RADAR_WATCHER_TEST !== '1') {
  main().catch(console.error);
}
