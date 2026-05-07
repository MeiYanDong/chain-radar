export type ExitTriggerKind = 'official_buyback' | 'large_buy_fallback' | 'manual_tx_recovery';
export type ExitTriggerSource = 'confirmed' | 'pending' | 'manual';
export type PendingTriggerMode = 'wait' | 'dry_run' | 'execute';
export type TriggerExecutionAction = 'execute' | 'dry_run' | 'wait';

export interface ExitTransfer {
  tokenAddress: string;
  fromAddress: string;
  toAddress: string;
  amountRaw: bigint;
}

export interface ExitTokenMeta {
  symbol: string;
  decimals: number;
}

export interface ExitTrigger {
  id: string;
  kind: ExitTriggerKind;
  source: ExitTriggerSource;
  txHash: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number;
  tokenAmountRaw: bigint;
  referenceSpendTokenAddress?: string;
  referenceSpendAmountRaw?: bigint;
  buyerAddress?: string;
  marketAddress?: string;
  approvalSpenderAddress?: string;
  detectedAtMs: number;
  thresholdVirtualRaw?: bigint;
  virtualUsd?: number;
  thresholdUsd?: number;
}

export interface OfficialBuybackTriggerInput {
  txHash: string;
  transfers: ExitTransfer[];
  source?: Extract<ExitTriggerSource, 'confirmed' | 'pending'>;
  detectedAtMs: number;
  virtualTokenAddress: string;
  officialExecutorAddress: string;
  marketAddress?: string;
  tokenMetaByAddress?: Map<string, ExitTokenMeta>;
  excludedTokenAddresses?: string[];
}

export interface LargeBuyFallbackTriggerInput {
  txHash: string;
  transfers: ExitTransfer[];
  source?: Extract<ExitTriggerSource, 'confirmed' | 'pending'>;
  detectedAtMs: number;
  virtualTokenAddress: string;
  allowedTokenAddresses: string[];
  tokenMetaByAddress: Map<string, ExitTokenMeta>;
  thresholdVirtualRaw: bigint;
  marketAddress?: string;
  approvalSpenderAddress?: string;
  virtualUsd?: number;
  thresholdUsd?: number;
}

export interface ManualTxRecoveryInput {
  txHash: string;
  detectedAtMs: number;
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number;
  tokenAmountRaw: bigint;
  marketAddress?: string;
  approvalSpenderAddress?: string;
  referenceSpendTokenAddress?: string;
  referenceSpendAmountRaw?: bigint;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeTransfer(item: ExitTransfer): ExitTransfer {
  return {
    tokenAddress: normalizeAddress(item.tokenAddress),
    fromAddress: normalizeAddress(item.fromAddress),
    toAddress: normalizeAddress(item.toAddress),
    amountRaw: item.amountRaw,
  };
}

function tokenMeta(tokenAddress: string, tokenMetaByAddress?: Map<string, ExitTokenMeta>): ExitTokenMeta {
  return tokenMetaByAddress?.get(normalizeAddress(tokenAddress)) ?? { symbol: 'UNKNOWN', decimals: 18 };
}

function triggerId(kind: ExitTriggerKind, txHash: string, tokenAddress: string, suffix?: string): string {
  return [kind, txHash.toLowerCase(), normalizeAddress(tokenAddress), suffix ? normalizeAddress(suffix) : undefined]
    .filter(Boolean)
    .join(':');
}

export function extractOfficialBuybackTriggers(input: OfficialBuybackTriggerInput): ExitTrigger[] {
  const virtualToken = normalizeAddress(input.virtualTokenAddress);
  const executor = normalizeAddress(input.officialExecutorAddress);
  const excluded = new Set([virtualToken, ZERO_ADDRESS, ...(input.excludedTokenAddresses ?? []).map(normalizeAddress)]);
  const transfers = input.transfers.map(normalizeTransfer);
  const virtualSpentRaw = transfers
    .filter((item) => item.tokenAddress === virtualToken && item.fromAddress === executor && item.amountRaw > 0n)
    .reduce((sum, item) => sum + item.amountRaw, 0n);
  if (virtualSpentRaw <= 0n) return [];

  const boughtByToken = new Map<string, { amountRaw: bigint; approvalSpenderAddress?: string }>();
  for (const item of transfers) {
    if (item.amountRaw <= 0n) continue;
    if (item.toAddress !== executor) continue;
    if (item.fromAddress === ZERO_ADDRESS) continue;
    if (excluded.has(item.tokenAddress)) continue;
    const existing = boughtByToken.get(item.tokenAddress);
    boughtByToken.set(item.tokenAddress, {
      amountRaw: (existing?.amountRaw ?? 0n) + item.amountRaw,
      approvalSpenderAddress: existing?.approvalSpenderAddress ?? item.fromAddress,
    });
  }

  return [...boughtByToken.entries()].map(([tokenAddress, item]) => {
    const meta = tokenMeta(tokenAddress, input.tokenMetaByAddress);
    return {
      id: triggerId('official_buyback', input.txHash, tokenAddress),
      kind: 'official_buyback',
      source: input.source ?? 'confirmed',
      txHash: input.txHash,
      tokenAddress,
      tokenSymbol: meta.symbol.toUpperCase(),
      tokenDecimals: meta.decimals,
      tokenAmountRaw: item.amountRaw,
      referenceSpendTokenAddress: virtualToken,
      referenceSpendAmountRaw: virtualSpentRaw,
      buyerAddress: executor,
      marketAddress: input.marketAddress ? normalizeAddress(input.marketAddress) : undefined,
      approvalSpenderAddress: item.approvalSpenderAddress,
      detectedAtMs: input.detectedAtMs,
    };
  });
}

export function extractLargeBuyFallbackTriggers(input: LargeBuyFallbackTriggerInput): ExitTrigger[] {
  if (input.thresholdVirtualRaw <= 0n && (!input.thresholdUsd || input.thresholdUsd <= 0 || !input.virtualUsd || input.virtualUsd <= 0)) {
    return [];
  }
  const virtualToken = normalizeAddress(input.virtualTokenAddress);
  const allowedTokens = new Set(input.allowedTokenAddresses.map(normalizeAddress));
  if (allowedTokens.size === 0) return [];

  const transfers = input.transfers.map(normalizeTransfer);
  const virtualSpentByBuyer = new Map<string, bigint>();
  for (const item of transfers) {
    if (item.tokenAddress !== virtualToken) continue;
    if (item.amountRaw <= 0n) continue;
    if (item.fromAddress === ZERO_ADDRESS || item.toAddress === ZERO_ADDRESS) continue;
    if (item.fromAddress === item.toAddress) continue;
    virtualSpentByBuyer.set(item.fromAddress, (virtualSpentByBuyer.get(item.fromAddress) ?? 0n) + item.amountRaw);
  }

  const eventsByTokenBuyer = new Map<string, { amountRaw: bigint; virtualSpentRaw: bigint; buyerAddress: string; approvalSpenderAddress?: string }>();
  for (const item of transfers) {
    if (!allowedTokens.has(item.tokenAddress)) continue;
    if (item.amountRaw <= 0n) continue;
    if (item.fromAddress === ZERO_ADDRESS || item.toAddress === ZERO_ADDRESS) continue;
    const virtualSpentRaw = virtualSpentByBuyer.get(item.toAddress) ?? 0n;
    if (virtualSpentRaw <= 0n) continue;

    const exceedsVirtualThreshold = input.thresholdVirtualRaw > 0n && virtualSpentRaw > input.thresholdVirtualRaw;
    const virtualSpentUsd = input.virtualUsd && input.virtualUsd > 0
      ? Number(virtualSpentRaw) / 1e18 * input.virtualUsd
      : undefined;
    const exceedsUsdThreshold = input.thresholdVirtualRaw <= 0n &&
      input.thresholdUsd !== undefined &&
      input.thresholdUsd > 0 &&
      virtualSpentUsd !== undefined &&
      Number.isFinite(virtualSpentUsd) &&
      virtualSpentUsd > input.thresholdUsd;
    if (!exceedsVirtualThreshold && !exceedsUsdThreshold) continue;

    const key = `${item.tokenAddress}:${item.toAddress}`;
    const existing = eventsByTokenBuyer.get(key);
    eventsByTokenBuyer.set(key, {
      amountRaw: (existing?.amountRaw ?? 0n) + item.amountRaw,
      virtualSpentRaw,
      buyerAddress: item.toAddress,
      approvalSpenderAddress: existing?.approvalSpenderAddress ?? input.approvalSpenderAddress ?? item.fromAddress,
    });
  }

  return [...eventsByTokenBuyer.entries()].map(([key, item]) => {
    const [tokenAddress] = key.split(':');
    const meta = tokenMeta(tokenAddress, input.tokenMetaByAddress);
    return {
      id: triggerId('large_buy_fallback', input.txHash, tokenAddress, item.buyerAddress),
      kind: 'large_buy_fallback',
      source: input.source ?? 'confirmed',
      txHash: input.txHash,
      tokenAddress,
      tokenSymbol: meta.symbol.toUpperCase(),
      tokenDecimals: meta.decimals,
      tokenAmountRaw: item.amountRaw,
      referenceSpendTokenAddress: virtualToken,
      referenceSpendAmountRaw: item.virtualSpentRaw,
      buyerAddress: item.buyerAddress,
      marketAddress: input.marketAddress ? normalizeAddress(input.marketAddress) : undefined,
      approvalSpenderAddress: item.approvalSpenderAddress,
      detectedAtMs: input.detectedAtMs,
      thresholdVirtualRaw: input.thresholdVirtualRaw > 0n ? input.thresholdVirtualRaw : undefined,
      virtualUsd: input.virtualUsd,
      thresholdUsd: input.thresholdVirtualRaw <= 0n ? input.thresholdUsd : undefined,
    };
  });
}

export function createManualTxRecoveryTrigger(input: ManualTxRecoveryInput): ExitTrigger {
  return {
    id: triggerId('manual_tx_recovery', input.txHash, input.tokenAddress),
    kind: 'manual_tx_recovery',
    source: 'manual',
    txHash: input.txHash,
    tokenAddress: normalizeAddress(input.tokenAddress),
    tokenSymbol: input.tokenSymbol.toUpperCase(),
    tokenDecimals: input.tokenDecimals,
    tokenAmountRaw: input.tokenAmountRaw,
    referenceSpendTokenAddress: input.referenceSpendTokenAddress ? normalizeAddress(input.referenceSpendTokenAddress) : undefined,
    referenceSpendAmountRaw: input.referenceSpendAmountRaw,
    marketAddress: input.marketAddress ? normalizeAddress(input.marketAddress) : undefined,
    approvalSpenderAddress: input.approvalSpenderAddress ? normalizeAddress(input.approvalSpenderAddress) : undefined,
    detectedAtMs: input.detectedAtMs,
  };
}

export function executionActionForTrigger(
  trigger: Pick<ExitTrigger, 'source'>,
  options: { pendingMode?: PendingTriggerMode } = {},
): TriggerExecutionAction {
  if (trigger.source === 'manual' || trigger.source === 'confirmed') return 'execute';
  const pendingMode = options.pendingMode ?? 'wait';
  if (pendingMode === 'execute') return 'execute';
  if (pendingMode === 'dry_run') return 'dry_run';
  return 'wait';
}
