export type ExitEngineSubmitMode = 'primary' | 'multi-rpc';
export type ExitEngineFeeMode = 'fixed' | 'dynamic';
export type ExitEngineMinOutMode = 'zero' | 'quote' | 'quote-required' | 'reference' | 'quote-reference';

export interface ExitEngineConfigField {
  key: string;
  legacyKey?: string;
  required: boolean;
  secret: boolean;
  category: 'runtime' | 'wallet' | 'rpc' | 'execution' | 'risk' | 'trigger' | 'route';
  description: string;
}

export interface ExitEngineConfigIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
}

export interface ExitEngineConfig {
  enabled: boolean;
  dryRun: boolean;
  wallet: {
    privateKeySet: boolean;
    privateKey?: string;
  };
  rpc: {
    primaryUrl?: string;
    fallbackUrls: string[];
    protectedUrls: string[];
    readTimeoutMs: number;
    writeTimeoutMs: number;
    flashblocksEnabled: boolean;
    flashblocksUrls: string[];
    publicBroadcastEnabled: boolean;
  };
  execution: {
    submitMode: ExitEngineSubmitMode;
    primaryFallbackEnabled: boolean;
    sellPercent: number;
    deadlineSeconds: number;
    burstTarget: number;
    tokenPendingLock: boolean;
    tokenPendingTtlMs: number;
    onDemandApprove: boolean;
    verifyPreapproved: boolean;
  };
  risk: {
    feeMode: ExitEngineFeeMode;
    sellGasLimit?: bigint;
    minPriorityGwei: number;
    maxFeeGwei?: number;
    priorityFeeMultiplier: number;
    maxFeeMultiplier: number;
    maxPriorityFeeGwei?: number;
    minOutMode: ExitEngineMinOutMode;
    requireNonzeroMinOut: boolean;
    fallbackMinOutZero: boolean;
    slippageBps: number;
  };
  triggers: {
    officialBuyback: {
      executorAddress: string;
    };
    largeBuy: {
      enabled: boolean;
      thresholdVirtual: number;
      thresholdUsd: number;
      virtualUsdFallback: number;
      symbols: string[];
    };
  };
  route: {
    marketAddress: string;
    quoteAddress?: string;
    approvalSpenderAddress?: string;
    useTriggerMarketAddress: boolean;
    preapprovedAllowances: string[];
    tokenDecimals: string[];
    tokenSymbols: string[];
    verifyQuotes: boolean;
  };
  integrations: {
    buybackFlashblocksEnabled: boolean;
    buybackFlashblocksWsUrls: string[];
    okxLimitOrderBackupEnabled: boolean;
    okxLimitOrderPreplacedSymbols: string[];
  };
  issues: ExitEngineConfigIssue[];
}

export interface PublicExitEngineConfigSummary {
  enabled: boolean;
  dryRun: boolean;
  walletPrivateKeySet: boolean;
  rpc: {
    primaryUrlSet: boolean;
    fallbackUrlCount: number;
    protectedUrlCount: number;
    flashblocksEnabled: boolean;
    flashblocksUrlCount: number;
    publicBroadcastEnabled: boolean;
    readTimeoutMs: number;
    writeTimeoutMs: number;
  };
  execution: ExitEngineConfig['execution'];
  risk: Omit<ExitEngineConfig['risk'], 'sellGasLimit'> & { sellGasLimitSet: boolean };
  triggers: ExitEngineConfig['triggers'];
  route: {
    marketAddressSet: boolean;
    quoteAddressSet: boolean;
    approvalSpenderAddressSet: boolean;
    useTriggerMarketAddress: boolean;
    preapprovedAllowanceCount: number;
    tokenDecimalsCount: number;
    tokenSymbolsCount: number;
    verifyQuotes: boolean;
  };
  integrations: {
    buybackFlashblocksEnabled: boolean;
    buybackFlashblocksWsUrlCount: number;
    okxLimitOrderBackupEnabled: boolean;
    okxLimitOrderPreplacedSymbolCount: number;
  };
  issueCount: number;
  errorCount: number;
  warningCount: number;
}

type EnvLike = Record<string, string | undefined>;

export const EXIT_ENGINE_CONFIG_FIELDS: ExitEngineConfigField[] = [
  {
    key: 'EXIT_ENGINE_ENABLED',
    legacyKey: 'AUTO_SELL_ENABLED',
    required: true,
    secret: false,
    category: 'runtime',
    description: 'Enable live engine execution.',
  },
  {
    key: 'EXIT_ENGINE_DRY_RUN',
    legacyKey: 'AUTO_SELL_DRY_RUN',
    required: true,
    secret: false,
    category: 'runtime',
    description: 'Run without submitting transactions.',
  },
  {
    key: 'EXIT_ENGINE_WALLET_PRIVATE_KEY',
    legacyKey: 'AUTO_SELL_PRIVATE_KEY',
    required: true,
    secret: true,
    category: 'wallet',
    description: 'Execution wallet private key. Never print or store this in docs.',
  },
  {
    key: 'EXIT_ENGINE_RPC_URL',
    legacyKey: 'RPC_URL',
    required: true,
    secret: true,
    category: 'rpc',
    description: 'Primary RPC URL. Treat as secret because URLs often contain provider tokens.',
  },
  {
    key: 'EXIT_ENGINE_RPC_URL_FALLBACKS',
    legacyKey: 'RPC_URL_FALLBACKS',
    required: false,
    secret: true,
    category: 'rpc',
    description: 'Comma-separated fallback RPC URLs.',
  },
  {
    key: 'EXIT_ENGINE_PROTECTED_RPC_URLS',
    legacyKey: 'AUTO_SELL_PROTECTED_RPC_URLS',
    required: false,
    secret: true,
    category: 'rpc',
    description: 'Comma-separated protected broadcast RPC URLs.',
  },
  {
    key: 'EXIT_ENGINE_SUBMIT_MODE',
    legacyKey: 'AUTO_SELL_SUBMIT_MODE',
    required: false,
    secret: false,
    category: 'execution',
    description: 'Primary or multi-RPC submit mode.',
  },
  {
    key: 'EXIT_ENGINE_MIN_OUT_MODE',
    legacyKey: 'AUTO_SELL_MIN_OUT_MODE',
    required: false,
    secret: false,
    category: 'risk',
    description: 'Min-out strategy for direct sell.',
  },
  {
    key: 'EXIT_ENGINE_BUYBACK_EXECUTOR_ADDRESS',
    legacyKey: 'BUYBACK_EXECUTOR_ADDRESS',
    required: false,
    secret: false,
    category: 'trigger',
    description: 'Official buyback executor address.',
  },
  {
    key: 'EXIT_ENGINE_LARGE_BUY_THRESHOLD_VIRTUAL',
    legacyKey: 'BUYBACK_LARGE_BUY_THRESHOLD_VIRTUAL',
    required: false,
    secret: false,
    category: 'trigger',
    description: 'Strict greater-than VIRTUAL threshold for large-buy fallback.',
  },
  {
    key: 'EXIT_ENGINE_LARGE_BUY_VIRTUAL_USD_FALLBACK',
    legacyKey: 'BUYBACK_LARGE_BUY_VIRTUAL_USD_FALLBACK',
    required: false,
    secret: false,
    category: 'trigger',
    description: 'Fallback VIRTUAL/USD price for USD large-buy threshold checks.',
  },
  {
    key: 'EXIT_ENGINE_TOKEN_SYMBOLS',
    legacyKey: 'AUTO_SELL_TOKEN_SYMBOLS',
    required: false,
    secret: false,
    category: 'route',
    description: 'Token-address to symbol mapping.',
  },
  {
    key: 'EXIT_ENGINE_TOKEN_DECIMALS',
    legacyKey: 'AUTO_SELL_TOKEN_DECIMALS',
    required: false,
    secret: false,
    category: 'route',
    description: 'Token-address to decimals mapping.',
  },
  {
    key: 'EXIT_ENGINE_PREAPPROVED_ALLOWANCES',
    legacyKey: 'AUTO_SELL_PREAPPROVED_ALLOWANCES',
    required: false,
    secret: false,
    category: 'route',
    description: 'Token-address to spender-address preapproval mapping.',
  },
  {
    key: 'EXIT_ENGINE_QUOTE_ADDRESS',
    legacyKey: 'AUTO_SELL_QUOTE_ADDRESS',
    required: false,
    secret: false,
    category: 'route',
    description: 'Read-only quote router for direct sell amountOut checks.',
  },
];

function firstEnv(env: EnvLike, nativeKey: string, legacyKey?: string): string | undefined {
  return env[nativeKey] ?? (legacyKey ? env[legacyKey] : undefined);
}

function boolValue(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === '') return fallback;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function boolEnv(env: EnvLike, nativeKey: string, legacyKey: string | undefined, fallback: boolean): boolean {
  return boolValue(firstEnv(env, nativeKey, legacyKey), fallback);
}

function numberEnv(env: EnvLike, nativeKey: string, legacyKey: string | undefined, fallback: number): number {
  const raw = firstEnv(env, nativeKey, legacyKey);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bigintEnv(env: EnvLike, nativeKey: string, legacyKey?: string): bigint | undefined {
  const raw = firstEnv(env, nativeKey, legacyKey);
  if (!raw) return undefined;
  try {
    return BigInt(raw.trim());
  } catch {
    return undefined;
  }
}

function csvEnv(env: EnvLike, nativeKey: string, legacyKey?: string): string[] {
  return (firstEnv(env, nativeKey, legacyKey) ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function submitMode(value: string | undefined): ExitEngineSubmitMode {
  return value?.trim().toLowerCase() === 'multi-rpc' ? 'multi-rpc' : 'primary';
}

function feeMode(value: string | undefined): ExitEngineFeeMode {
  return value?.trim().toLowerCase() === 'dynamic' ? 'dynamic' : 'fixed';
}

function minOutMode(value: string | undefined): ExitEngineMinOutMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'quote') return 'quote';
  if (normalized === 'quote-required') return 'quote-required';
  if (normalized === 'reference') return 'reference';
  if (normalized === 'quote-reference') return 'quote-reference';
  return 'zero';
}

export function buildExitEngineConfigFromEnv(env: EnvLike = process.env): ExitEngineConfig {
  const enabled = boolEnv(env, 'EXIT_ENGINE_ENABLED', 'AUTO_SELL_ENABLED', false);
  const dryRun = boolEnv(env, 'EXIT_ENGINE_DRY_RUN', 'AUTO_SELL_DRY_RUN', true);
  const privateKey = firstEnv(env, 'EXIT_ENGINE_WALLET_PRIVATE_KEY', 'AUTO_SELL_PRIVATE_KEY')?.trim();
  const privateKeySet = Boolean(privateKey);
  const mode = submitMode(firstEnv(env, 'EXIT_ENGINE_SUBMIT_MODE', 'AUTO_SELL_SUBMIT_MODE'));
  const minOut = minOutMode(firstEnv(env, 'EXIT_ENGINE_MIN_OUT_MODE', 'AUTO_SELL_MIN_OUT_MODE'));
  const issues: ExitEngineConfigIssue[] = [];
  const addIssue = (level: ExitEngineConfigIssue['level'], code: string, message: string) => {
    issues.push({ level, code, message });
  };

  const primaryRpcUrl = firstEnv(env, 'EXIT_ENGINE_RPC_URL', 'RPC_URL');
  const marketAddress = firstEnv(env, 'EXIT_ENGINE_MARKET_ADDRESS', 'AUTO_SELL_MARKET_ADDRESS') ||
    '0x1A540088125d00dD3990f9dA45CA0859af4d3B01';
  const quoteAddress = firstEnv(env, 'EXIT_ENGINE_QUOTE_ADDRESS', 'AUTO_SELL_QUOTE_ADDRESS');
  const approvalSpenderAddress = firstEnv(env, 'EXIT_ENGINE_APPROVAL_SPENDER_ADDRESS', 'AUTO_SELL_APPROVAL_SPENDER_ADDRESS');
  const publicBroadcastEnabled = boolEnv(env, 'EXIT_ENGINE_PUBLIC_BROADCAST_ENABLED', 'AUTO_SELL_PUBLIC_BROADCAST_ENABLED', true);
  const primaryFallbackEnabled = boolValue(
    firstEnv(env, 'EXIT_ENGINE_PRIMARY_FALLBACK_ENABLED', 'AUTO_SELL_PRIMARY_FALLBACK_ENABLED'),
    publicBroadcastEnabled,
  );
  const fallbackMinOutZero = boolEnv(env, 'EXIT_ENGINE_FALLBACK_MIN_OUT_ZERO', 'AUTO_SELL_FALLBACK_MIN_OUT_ZERO', true);
  const requireNonzeroMinOut = boolEnv(env, 'EXIT_ENGINE_REQUIRE_NONZERO_MIN_OUT', 'AUTO_SELL_REQUIRE_NONZERO_MIN_OUT', false) ||
    minOut === 'quote-required';

  if (enabled && !privateKeySet) addIssue('error', 'wallet_private_key_missing', 'Wallet private key is required when live execution is enabled.');
  if (enabled && !dryRun && !primaryRpcUrl) addIssue('error', 'rpc_url_missing', 'Primary RPC URL is required for live execution.');
  if (!dryRun && minOut === 'zero' && !requireNonzeroMinOut) {
    addIssue('warning', 'zero_min_out_live', 'Live execution with zero min-out is allowed by config but should be reviewed.');
  }

  return {
    enabled,
    dryRun,
    wallet: {
      privateKeySet,
      privateKey,
    },
    rpc: {
      primaryUrl: primaryRpcUrl,
      fallbackUrls: csvEnv(env, 'EXIT_ENGINE_RPC_URL_FALLBACKS', 'RPC_URL_FALLBACKS'),
      protectedUrls: csvEnv(env, 'EXIT_ENGINE_PROTECTED_RPC_URLS', 'AUTO_SELL_PROTECTED_RPC_URLS'),
      readTimeoutMs: Math.max(100, Math.round(numberEnv(env, 'EXIT_ENGINE_RPC_READ_TIMEOUT_MS', 'AUTO_SELL_READ_TIMEOUT_MS', 5000))),
      writeTimeoutMs: Math.max(300, Math.round(numberEnv(env, 'EXIT_ENGINE_RPC_WRITE_TIMEOUT_MS', 'AUTO_SELL_WRITE_TIMEOUT_MS', 1800))),
      flashblocksEnabled: boolEnv(env, 'EXIT_ENGINE_FLASHBLOCKS_ENABLED', 'AUTO_SELL_FLASHBLOCKS_ENABLED', false),
      flashblocksUrls: csvEnv(env, 'EXIT_ENGINE_FLASHBLOCKS_RPC_URLS', 'AUTO_SELL_FLASHBLOCKS_RPC_URLS'),
      publicBroadcastEnabled,
    },
    execution: {
      submitMode: mode,
      primaryFallbackEnabled,
      sellPercent: clampNumber(numberEnv(env, 'EXIT_ENGINE_SELL_PERCENT', 'AUTO_SELL_PERCENT', 100), 0, 100),
      deadlineSeconds: Math.max(1, Math.round(numberEnv(env, 'EXIT_ENGINE_DEADLINE_SECONDS', 'AUTO_SELL_DEADLINE_SECONDS', 60))),
      burstTarget: Math.max(1, Math.min(20, Math.floor(numberEnv(env, 'EXIT_ENGINE_BURST_TARGET', 'AUTO_SELL_BURST_TARGET', 3)))),
      tokenPendingLock: boolEnv(env, 'EXIT_ENGINE_TOKEN_PENDING_LOCK', 'AUTO_SELL_TOKEN_PENDING_LOCK', true),
      tokenPendingTtlMs: Math.max(10_000, Math.round(numberEnv(env, 'EXIT_ENGINE_TOKEN_PENDING_TTL_MS', 'AUTO_SELL_TOKEN_PENDING_TTL_MS', 180_000))),
      onDemandApprove: boolEnv(env, 'EXIT_ENGINE_ON_DEMAND_APPROVE', 'AUTO_SELL_ON_DEMAND_APPROVE', true),
      verifyPreapproved: boolEnv(env, 'EXIT_ENGINE_VERIFY_PREAPPROVED', 'AUTO_SELL_VERIFY_PREAPPROVED', false),
    },
    risk: {
      feeMode: feeMode(firstEnv(env, 'EXIT_ENGINE_FEE_MODE', 'AUTO_SELL_FEE_MODE')),
      sellGasLimit: bigintEnv(env, 'EXIT_ENGINE_SELL_GAS_LIMIT', 'AUTO_SELL_SELL_GAS_LIMIT'),
      minPriorityGwei: Math.max(0, numberEnv(env, 'EXIT_ENGINE_MIN_PRIORITY_GWEI', 'AUTO_SELL_MIN_PRIORITY_GWEI', 0.01)),
      maxFeeGwei: numberEnv(env, 'EXIT_ENGINE_MAX_FEE_GWEI', 'AUTO_SELL_MAX_FEE_GWEI', 0) || undefined,
      priorityFeeMultiplier: Math.max(0, numberEnv(env, 'EXIT_ENGINE_PRIORITY_FEE_MULTIPLIER', 'AUTO_SELL_PRIORITY_FEE_MULTIPLIER', 2)),
      maxFeeMultiplier: Math.max(0, numberEnv(env, 'EXIT_ENGINE_MAX_FEE_MULTIPLIER', 'AUTO_SELL_MAX_FEE_MULTIPLIER', 1.5)),
      maxPriorityFeeGwei: numberEnv(env, 'EXIT_ENGINE_MAX_PRIORITY_FEE_GWEI', 'AUTO_SELL_MAX_PRIORITY_FEE_GWEI', 0) || undefined,
      minOutMode: minOut,
      requireNonzeroMinOut,
      fallbackMinOutZero,
      slippageBps: Math.max(0, Math.min(10_000, Math.floor(numberEnv(env, 'EXIT_ENGINE_SLIPPAGE_BPS', 'AUTO_SELL_SLIPPAGE_BPS', 800)))),
    },
    triggers: {
      largeBuy: {
        virtualUsdFallback: Math.max(0, numberEnv(env, 'EXIT_ENGINE_LARGE_BUY_VIRTUAL_USD_FALLBACK', 'BUYBACK_LARGE_BUY_VIRTUAL_USD_FALLBACK', 1.5)),
        enabled: boolEnv(env, 'EXIT_ENGINE_LARGE_BUY_ENABLED', 'BUYBACK_LARGE_BUY_FALLBACK_ENABLED', false),
        thresholdVirtual: Math.max(0, numberEnv(env, 'EXIT_ENGINE_LARGE_BUY_THRESHOLD_VIRTUAL', 'BUYBACK_LARGE_BUY_THRESHOLD_VIRTUAL', 3000)),
        thresholdUsd: Math.max(0, numberEnv(env, 'EXIT_ENGINE_LARGE_BUY_THRESHOLD_USD', 'BUYBACK_LARGE_BUY_THRESHOLD_USD', 0)),
        symbols: csvEnv(env, 'EXIT_ENGINE_LARGE_BUY_SYMBOLS', 'BUYBACK_LARGE_BUY_SYMBOLS').map((symbol) => symbol.toUpperCase()),
      },
      officialBuyback: {
        executorAddress: firstEnv(env, 'EXIT_ENGINE_BUYBACK_EXECUTOR_ADDRESS', 'BUYBACK_EXECUTOR_ADDRESS') ??
          '0x9Bda49389B29Fa4E204eD9De8f3d7d06f84dA171',
      },
    },
    route: {
      marketAddress,
      quoteAddress,
      approvalSpenderAddress,
      useTriggerMarketAddress: boolEnv(env, 'EXIT_ENGINE_USE_TRIGGER_MARKET_ADDRESS', 'AUTO_SELL_USE_TRIGGER_MARKET_ADDRESS', false),
      preapprovedAllowances: csvEnv(env, 'EXIT_ENGINE_PREAPPROVED_ALLOWANCES', 'AUTO_SELL_PREAPPROVED_ALLOWANCES'),
      tokenDecimals: csvEnv(env, 'EXIT_ENGINE_TOKEN_DECIMALS', 'AUTO_SELL_TOKEN_DECIMALS'),
      tokenSymbols: csvEnv(env, 'EXIT_ENGINE_TOKEN_SYMBOLS', 'AUTO_SELL_TOKEN_SYMBOLS'),
      verifyQuotes: boolEnv(env, 'EXIT_ENGINE_VERIFY_QUOTES', 'AUTO_SELL_VERIFY_QUOTES', false),
    },
    integrations: {
      buybackFlashblocksEnabled: boolEnv(env, 'EXIT_ENGINE_BUYBACK_FLASHBLOCKS_ENABLED', 'BUYBACK_FLASHBLOCKS_ENABLED', false),
      buybackFlashblocksWsUrls: csvEnv(env, 'EXIT_ENGINE_BUYBACK_FLASHBLOCKS_WS_URLS', 'BUYBACK_FLASHBLOCKS_WS_URLS'),
      okxLimitOrderBackupEnabled: boolEnv(env, 'EXIT_ENGINE_OKX_LIMIT_ORDER_BACKUP_ENABLED', 'OKX_LIMIT_ORDER_BACKUP_ENABLED', false),
      okxLimitOrderPreplacedSymbols: csvEnv(env, 'EXIT_ENGINE_OKX_LIMIT_ORDER_PREPLACED_SYMBOLS', 'OKX_LIMIT_ORDER_PREPLACED_SYMBOLS').map((symbol) => symbol.toUpperCase()),
    },
    issues,
  };
}

export function publicExitEngineConfigSummary(config: ExitEngineConfig): PublicExitEngineConfigSummary {
  const errorCount = config.issues.filter((issue) => issue.level === 'error').length;
  const warningCount = config.issues.filter((issue) => issue.level === 'warning').length;
  const { sellGasLimit: _sellGasLimit, ...publicRisk } = config.risk;
  return {
    enabled: config.enabled,
    dryRun: config.dryRun,
    walletPrivateKeySet: config.wallet.privateKeySet,
    rpc: {
      primaryUrlSet: Boolean(config.rpc.primaryUrl),
      fallbackUrlCount: config.rpc.fallbackUrls.length,
      protectedUrlCount: config.rpc.protectedUrls.length,
      flashblocksEnabled: config.rpc.flashblocksEnabled,
      flashblocksUrlCount: config.rpc.flashblocksUrls.length,
      publicBroadcastEnabled: config.rpc.publicBroadcastEnabled,
      readTimeoutMs: config.rpc.readTimeoutMs,
      writeTimeoutMs: config.rpc.writeTimeoutMs,
    },
    execution: config.execution,
    risk: {
      ...publicRisk,
      sellGasLimitSet: config.risk.sellGasLimit !== undefined,
    },
    triggers: config.triggers,
    route: {
      marketAddressSet: Boolean(config.route.marketAddress),
      quoteAddressSet: Boolean(config.route.quoteAddress),
      approvalSpenderAddressSet: Boolean(config.route.approvalSpenderAddress),
      useTriggerMarketAddress: config.route.useTriggerMarketAddress,
      preapprovedAllowanceCount: config.route.preapprovedAllowances.length,
      tokenDecimalsCount: config.route.tokenDecimals.length,
      tokenSymbolsCount: config.route.tokenSymbols.length,
      verifyQuotes: config.route.verifyQuotes,
    },
    integrations: {
      buybackFlashblocksEnabled: config.integrations.buybackFlashblocksEnabled,
      buybackFlashblocksWsUrlCount: config.integrations.buybackFlashblocksWsUrls.length,
      okxLimitOrderBackupEnabled: config.integrations.okxLimitOrderBackupEnabled,
      okxLimitOrderPreplacedSymbolCount: config.integrations.okxLimitOrderPreplacedSymbols.length,
    },
    issueCount: config.issues.length,
    errorCount,
    warningCount,
  };
}

export function publicExitEngineConfigFieldList(): ExitEngineConfigField[] {
  return EXIT_ENGINE_CONFIG_FIELDS.map((field) => ({ ...field }));
}
