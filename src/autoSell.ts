import {
  erc20Abi,
  formatUnits,
  isAddress,
  parseGwei,
  parseUnits,
  type Address,
  type Hash,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  DIRECT_SELL_DEFAULT_MARKET_ADDRESS,
  buildDirectSellQuoteRead,
  defaultDirectSellApprovalSpenderAddress,
  defaultDirectSellQuoteAddress,
} from './onchain-exit-engine/directSellTransaction.js';
import { submitDirectSellWithFallback } from './onchain-exit-engine/directSellSubmission.js';
import { buildExitEngineConfigFromEnv, type ExitEngineConfig } from './onchain-exit-engine/configSchema.js';
import {
  BASE_DIRECT_SELL_FLASHBLOCKS_RPC,
  buildDirectSellBroadcastBundles,
  createDirectSellRpcBundle,
  directSellRpcCacheKey,
  readFast,
  resolveDirectSellRpcUrls,
  submitDirectSellMultiRpcRaw,
  submitErc20ApproveRpc,
  submitDirectSellPrimaryRpc,
  type DirectSellGasOptions,
  type DirectSellRpcBundle,
} from './onchain-exit-engine/rpcRuntime.js';

type Account = ReturnType<typeof privateKeyToAccount>;
type RpcBundle = DirectSellRpcBundle;
type SellGasOptions = DirectSellGasOptions;

const tokenDecimalsCache = new Map<string, number>();
let cachedAccount: Account | null = null;
let cachedBundlesKey = '';
let cachedBundles: RpcBundle[] = [];
let autoSellQueueTail: Promise<void> = Promise.resolve();
let autoSellQueueDepth = 0;
let nonceState: { account: string; nextNonce: number } | null = null;
const pendingTokenSells = new Map<string, { triggerTxHash: string; sellTxHash?: string; expiresAtMs: number }>();

export interface AutoSellInput {
  tokenAddress: string;
  tokenSymbol: string;
  marketAddress?: string;
  quoteAddress?: string;
  approvalSpenderAddress?: string;
  triggerTxHash: string;
  detectedAtMs: number;
  referenceTokenAmount?: number;
  referenceVirtualSpent?: number;
}

export interface AutoSellResult {
  status: 'disabled' | 'missing-key' | 'invalid-key' | 'no-balance' | 'dry-run' | 'sent' | 'failed' | 'skipped';
  wallet?: string;
  sellTxHash?: string;
  approveTxHash?: string;
  marketAddress?: string;
  quoteAddress?: string;
  approvalSpenderAddress?: string;
  tokenAmount?: string;
  amountOutMin?: string;
  quotedAmountOut?: string;
  slippageBps?: number;
  minOutSource?: 'zero' | 'quote' | 'reference';
  detectedToSubmitMs?: number;
  queueWaitMs?: number;
  queuePosition?: number;
  nonce?: number;
  submitMode?: 'primary' | 'multi-rpc';
  error?: string;
}

export type AutoSellReadinessLevel = 'error' | 'warning';
export type AutoSellReadinessCheckStatus = 'pass' | 'warn' | 'fail';

export interface AutoSellReadinessIssue {
  level: AutoSellReadinessLevel;
  key: string;
  message: string;
}

export interface AutoSellReadinessCheck {
  key: string;
  status: AutoSellReadinessCheckStatus;
  message: string;
}

export interface AutoSellReadinessReport {
  ok: boolean;
  enabled: boolean;
  dryRun: boolean;
  wallet?: string;
  marketAddress: string;
  quoteAddress: string;
  approvalSpenderAddress: string;
  rpcCount: number;
  preapprovedPairs: number;
  checks: AutoSellReadinessCheck[];
  issues: AutoSellReadinessIssue[];
}

export interface AutoSellReadinessOptions {
  checkNetwork?: boolean;
  requireLive?: boolean;
}

function currentExitEngineConfig(): ExitEngineConfig {
  return buildExitEngineConfigFromEnv(process.env);
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

function normalizePrivateKey(value: string): `0x${string}` {
  const trimmed = value.trim();
  return (trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`) as `0x${string}`;
}

function asAddress(value: string): Address {
  return value as Address;
}

function shortError(err: unknown): string {
  const anyErr = err as { shortMessage?: string; message?: string };
  return anyErr.shortMessage ?? anyErr.message ?? String(err);
}

function rpcUrls(): string[] {
  const config = currentExitEngineConfig();
  return resolveDirectSellRpcUrls({
    primaryRpcUrl: config.rpc.primaryUrl,
    fallbackRpcUrls: config.rpc.fallbackUrls.join(','),
  });
}

function rpcCacheKey(account: Account): string {
  return directSellRpcCacheKey(account.address, rpcUrls());
}

function getAccount(rawKey: string): Account {
  if (cachedAccount) return cachedAccount;
  cachedAccount = privateKeyToAccount(normalizePrivateKey(rawKey));
  return cachedAccount;
}

function rpcRuntimeOptions() {
  const config = currentExitEngineConfig();
  return {
    readTimeoutMs: config.rpc.readTimeoutMs,
    writeTimeoutMs: config.rpc.writeTimeoutMs,
  };
}

function getRpcBundles(account: Account): RpcBundle[] {
  const key = rpcCacheKey(account);
  if (cachedBundlesKey === key && cachedBundles.length > 0) return cachedBundles;
  const options = rpcRuntimeOptions();
  cachedBundles = rpcUrls().map((url) => createDirectSellRpcBundle(account, url, options));
  cachedBundlesKey = key;
  return cachedBundles;
}

function autoSellSubmitMode(): 'primary' | 'multi-rpc' {
  return currentExitEngineConfig().execution.submitMode;
}

function autoSellBurstTarget(): number {
  return currentExitEngineConfig().execution.burstTarget;
}

function tokenPendingLockEnabled(): boolean {
  return currentExitEngineConfig().execution.tokenPendingLock;
}

function tokenPendingTtlMs(): number {
  return currentExitEngineConfig().execution.tokenPendingTtlMs;
}

function cleanupExpiredTokenSellLocks(nowMs = Date.now()) {
  for (const [token, pending] of pendingTokenSells.entries()) {
    if (pending.expiresAtMs <= nowMs) pendingTokenSells.delete(token);
  }
}

function acquireTokenSellLock(
  tokenAddress: Address,
  triggerTxHash: string,
): { acquired: true; key: string } | { acquired: false; reason: string } {
  if (!tokenPendingLockEnabled()) return { acquired: true, key: normalizeAddress(tokenAddress) };
  const nowMs = Date.now();
  cleanupExpiredTokenSellLocks(nowMs);
  const key = normalizeAddress(tokenAddress);
  const existing = pendingTokenSells.get(key);
  if (existing) {
    const suffix = existing.sellTxHash
      ? ` sell=${existing.sellTxHash.slice(0, 10)}...${existing.sellTxHash.slice(-6)}`
      : '';
    return { acquired: false, reason: `pending sell already active for token${suffix}` };
  }
  pendingTokenSells.set(key, {
    triggerTxHash,
    expiresAtMs: nowMs + tokenPendingTtlMs(),
  });
  return { acquired: true, key };
}

function releaseTokenSellLock(tokenKey: string) {
  pendingTokenSells.delete(tokenKey);
}

function markTokenSellSubmitted(tokenKey: string, sellTxHash: Hash, bundles: RpcBundle[]) {
  if (!tokenPendingLockEnabled()) return;
  const existing = pendingTokenSells.get(tokenKey);
  if (!existing) return;
  pendingTokenSells.set(tokenKey, {
    ...existing,
    sellTxHash,
    expiresAtMs: Date.now() + tokenPendingTtlMs(),
  });
  const timeout = setTimeout(() => {
    const current = pendingTokenSells.get(tokenKey);
    if (current?.sellTxHash === sellTxHash) pendingTokenSells.delete(tokenKey);
  }, tokenPendingTtlMs());
  timeout.unref?.();
  void readFast(bundles, (client) => client.waitForTransactionReceipt({ hash: sellTxHash, timeout: tokenPendingTtlMs() }))
    .catch(() => null)
    .finally(() => {
      clearTimeout(timeout);
      const current = pendingTokenSells.get(tokenKey);
      if (current?.sellTxHash === sellTxHash) pendingTokenSells.delete(tokenKey);
    });
}

async function withAutoSellQueue<T>(
  run: (queue: { queueWaitMs: number; queuePosition: number }) => Promise<T>,
): Promise<T> {
  const enqueuedAtMs = Date.now();
  const queuePosition = autoSellQueueDepth;
  autoSellQueueDepth += 1;
  const previous = autoSellQueueTail.catch(() => undefined);
  let release!: () => void;
  autoSellQueueTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  autoSellQueueDepth = Math.max(0, autoSellQueueDepth - 1);
  try {
    return await run({ queueWaitMs: Date.now() - enqueuedAtMs, queuePosition });
  } finally {
    release();
  }
}

async function reserveSellNonce(bundles: RpcBundle[], account: Account): Promise<number> {
  const accountKey = normalizeAddress(account.address);
  const chainNonce = await readFast(bundles, (client) => client.getTransactionCount({ address: account.address, blockTag: 'pending' }));
  if (!nonceState || nonceState.account !== accountKey || chainNonce > nonceState.nextNonce) {
    nonceState = { account: accountKey, nextNonce: chainNonce };
  }
  const nonce = nonceState.nextNonce;
  nonceState.nextNonce += 1;
  return nonce;
}

function resetNonceState(account?: Account) {
  if (!account || nonceState?.account === normalizeAddress(account.address)) nonceState = null;
}

function primaryFallbackEnabled(): boolean {
  return currentExitEngineConfig().execution.primaryFallbackEnabled;
}

function sellGasLimit(): bigint {
  return currentExitEngineConfig().risk.sellGasLimit ?? 0n;
}

function autoSellFeeMode(): 'fixed' | 'dynamic' {
  return currentExitEngineConfig().risk.feeMode;
}

function autoSellMinOutMode(): 'zero' | 'quote' | 'quote-required' | 'reference' | 'quote-reference' {
  return currentExitEngineConfig().risk.minOutMode;
}

function requireNonzeroMinOut(): boolean {
  return currentExitEngineConfig().risk.requireNonzeroMinOut;
}

function slippageBps(): number {
  return currentExitEngineConfig().risk.slippageBps;
}

function gweiToWei(value: number): bigint {
  return parseGwei(String(value));
}

function multiplyWei(value: bigint, multiplier: number): bigint {
  if (!Number.isFinite(multiplier) || multiplier <= 0) return value;
  return (value * BigInt(Math.round(multiplier * 100))) / 100n;
}

function capWei(value: bigint, capGwei: number): bigint {
  if (!Number.isFinite(capGwei) || capGwei <= 0) return value;
  const cap = gweiToWei(capGwei);
  return value > cap ? cap : value;
}

function configuredFixedGasOptions(): SellGasOptions {
  const config = currentExitEngineConfig();
  const minPriorityGwei = config.risk.minPriorityGwei;
  const maxFeeGwei = config.risk.maxFeeGwei ?? 0;
  const gas = sellGasLimit();
  return {
    ...(maxFeeGwei > 0 ? { maxFeePerGas: parseGwei(String(maxFeeGwei)) } : {}),
    ...(minPriorityGwei > 0 ? { maxPriorityFeePerGas: parseGwei(String(minPriorityGwei)) } : {}),
    ...(gas > 0n ? { gas } : {}),
  };
}

async function dynamicGasOptions(bundles: RpcBundle[]): Promise<SellGasOptions> {
  const config = currentExitEngineConfig();
  const gas = sellGasLimit();
  const fees = await readFast(bundles, async (client) => (
    await client.estimateFeesPerGas()
  )) as { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint };
  const minPriority = gweiToWei(config.risk.minPriorityGwei);
  const priorityMultiplier = config.risk.priorityFeeMultiplier;
  const maxFeeMultiplier = config.risk.maxFeeMultiplier;
  const priorityCapGwei = config.risk.maxPriorityFeeGwei ?? 0;
  const maxFeeCapGwei = config.risk.maxFeeGwei ?? 0;
  const estimatedPriority = fees.maxPriorityFeePerGas ?? 0n;
  let maxPriorityFeePerGas = multiplyWei(estimatedPriority > minPriority ? estimatedPriority : minPriority, priorityMultiplier);
  maxPriorityFeePerGas = capWei(maxPriorityFeePerGas, priorityCapGwei);
  const estimatedMax = fees.maxFeePerGas ?? maxPriorityFeePerGas * 2n;
  let maxFeePerGas = multiplyWei(estimatedMax > maxPriorityFeePerGas ? estimatedMax : maxPriorityFeePerGas * 2n, maxFeeMultiplier);
  maxFeePerGas = capWei(maxFeePerGas, maxFeeCapGwei);
  if (maxFeePerGas < maxPriorityFeePerGas) maxFeePerGas = maxPriorityFeePerGas;
  return {
    ...(gas > 0n ? { gas } : {}),
    maxFeePerGas,
    maxPriorityFeePerGas,
  };
}

async function gasOptionsForSell(bundles: RpcBundle[]): Promise<SellGasOptions> {
  return autoSellFeeMode() === 'dynamic'
    ? dynamicGasOptions(bundles)
    : configuredFixedGasOptions();
}

async function multiRpcGasOptions(bundles: RpcBundle[]): Promise<Required<SellGasOptions>> {
  const options = await gasOptionsForSell(bundles);
  if (!options.gas || !options.maxPriorityFeePerGas) {
    throw new Error('multi-rpc submit requires AUTO_SELL_SELL_GAS_LIMIT and AUTO_SELL_MIN_PRIORITY_GWEI');
  }
  if (!options.maxFeePerGas) {
    const fees = await readFast(bundles, async (client) => (
      await client.estimateFeesPerGas()
    )) as { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint };
    const estimatedPriority = fees.maxPriorityFeePerGas ?? 0n;
    const priority = options.maxPriorityFeePerGas > estimatedPriority
      ? options.maxPriorityFeePerGas
      : estimatedPriority;
    const estimatedMax = fees.maxFeePerGas ?? 0n;
    options.maxPriorityFeePerGas = priority > 0n ? priority : options.maxPriorityFeePerGas;
    options.maxFeePerGas = estimatedMax > options.maxPriorityFeePerGas
      ? estimatedMax
      : options.maxPriorityFeePerGas * 2n;
  }
  if (options.maxFeePerGas < options.maxPriorityFeePerGas) {
    options.maxFeePerGas = options.maxPriorityFeePerGas * 2n;
  }
  return options as Required<SellGasOptions>;
}

async function submitSellPrimary(
  bundles: RpcBundle[],
  primary: RpcBundle,
  input: {
    marketAddress: Address;
    tokenAddress: Address;
    amountIn: bigint;
    amountOutMin: bigint;
    deadline: bigint;
  },
): Promise<Hash> {
  const gasOptions = await gasOptionsForSell(bundles);
  return submitDirectSellPrimaryRpc(primary, input, gasOptions);
}

async function submitSellMultiRpc(
  readBundles: RpcBundle[],
  submitBundles: RpcBundle[],
  account: Account,
  input: {
    marketAddress: Address;
    tokenAddress: Address;
    amountIn: bigint;
    amountOutMin: bigint;
    deadline: bigint;
  },
): Promise<{ sellTxHash: Hash; nonce: number }> {
  const gasOptions = await multiRpcGasOptions(readBundles);
  const nonce = await reserveSellNonce(readBundles, account);
  try {
    return await submitDirectSellMultiRpcRaw({
      account,
      submitBundles,
      sellInput: input,
      gasOptions,
      nonce,
    });
  } catch (err) {
    resetNonceState(account);
    throw err;
  }
}

function broadcastBundles(account: Account, publicBundles: RpcBundle[]): RpcBundle[] {
  const config = currentExitEngineConfig();
  return buildDirectSellBroadcastBundles(account, publicBundles, {
    ...rpcRuntimeOptions(),
    protectedRpcUrls: config.rpc.protectedUrls,
    flashblocksEnabled: config.rpc.flashblocksEnabled,
    flashblocksRpcUrls: config.rpc.flashblocksUrls,
    publicBroadcastEnabled: config.rpc.publicBroadcastEnabled,
  });
}

async function submitSellTransaction(
  bundles: RpcBundle[],
  account: Account,
  input: {
    marketAddress: Address;
    tokenAddress: Address;
    amountIn: bigint;
    amountOutMin: bigint;
    deadline: bigint;
  },
): Promise<{ sellTxHash: Hash; submitMode: 'primary' | 'multi-rpc'; nonce?: number }> {
  return submitDirectSellWithFallback(
    {
      ...input,
      submitMode: autoSellSubmitMode(),
      primaryFallbackEnabled: primaryFallbackEnabled(),
    },
    {
      submitPrimary: (sellInput) => submitSellPrimary(bundles, bundles[0], sellInput),
      submitMultiRpc: (sellInput) => submitSellMultiRpc(bundles, broadcastBundles(account, bundles), account, sellInput),
      onMultiRpcFailure: (err) => {
        console.error(`[AutoSell] multi-rpc submit failed; falling back to primary: ${shortError(err).slice(0, 160)}`);
      },
    },
  );
}

function buildReferenceAmountOutMin(
  input: {
    amountIn: bigint;
    tokenDecimals: number;
    referenceTokenAmount?: number;
    referenceVirtualSpent?: number;
  },
): { amountOutMin: bigint; slippageBps: number } | null {
  const { referenceTokenAmount, referenceVirtualSpent } = input;
  if (!Number.isFinite(referenceTokenAmount) || !Number.isFinite(referenceVirtualSpent)) return null;
  if ((referenceTokenAmount ?? 0) <= 0 || (referenceVirtualSpent ?? 0) <= 0) return null;
  const tokenAmount = Number(formatUnits(input.amountIn, input.tokenDecimals));
  if (!Number.isFinite(tokenAmount) || tokenAmount <= 0) return null;
  const expectedVirtual = (tokenAmount * referenceVirtualSpent!) / referenceTokenAmount!;
  if (!Number.isFinite(expectedVirtual) || expectedVirtual <= 0) return null;
  const bps = slippageBps();
  const expectedRaw = parseUnits(expectedVirtual.toFixed(18), 18);
  return {
    amountOutMin: (expectedRaw * BigInt(10_000 - bps)) / 10_000n,
    slippageBps: bps,
  };
}

async function buildAmountOutMin(
  bundles: RpcBundle[],
  input: {
    marketAddress: Address;
    quoteAddress?: Address;
    tokenAddress: Address;
    amountIn: bigint;
    tokenDecimals: number;
    prequotedAmountOut?: bigint;
    referenceTokenAmount?: number;
    referenceVirtualSpent?: number;
  },
): Promise<{ amountOutMin: bigint; quotedAmountOut?: bigint; slippageBps?: number; minOutSource: 'zero' | 'quote' | 'reference' }> {
  const mode = autoSellMinOutMode();
  if (mode === 'zero') {
    if (requireNonzeroMinOut()) throw new Error('AUTO_SELL_REQUIRE_NONZERO_MIN_OUT=1 but AUTO_SELL_MIN_OUT_MODE=zero');
    return { amountOutMin: 0n, quotedAmountOut: input.prequotedAmountOut, minOutSource: 'zero' };
  }
  if (mode === 'reference') {
    const reference = buildReferenceAmountOutMin(input);
    if (reference) return { ...reference, quotedAmountOut: input.prequotedAmountOut, minOutSource: 'reference' };
    if (requireNonzeroMinOut()) throw new Error('reference amountOutMin unavailable');
    return { amountOutMin: 0n, quotedAmountOut: input.prequotedAmountOut, minOutSource: 'zero' };
  }
  try {
    const quoted = input.prequotedAmountOut ?? await readFast(bundles, (client) => client.readContract({
      ...buildDirectSellQuoteRead(input),
    }));
    if (quoted <= 0n) throw new Error('quote returned zero');
    const bps = slippageBps();
    const amountOutMin = (quoted * BigInt(10_000 - bps)) / 10_000n;
    if (amountOutMin <= 0n && requireNonzeroMinOut()) throw new Error('quoted amountOutMin is zero');
    return { amountOutMin, quotedAmountOut: quoted, slippageBps: bps, minOutSource: 'quote' };
  } catch (err) {
    if (mode === 'quote-reference') {
      const reference = buildReferenceAmountOutMin(input);
      if (reference) return { ...reference, minOutSource: 'reference' };
    }
    if (requireNonzeroMinOut() || !currentExitEngineConfig().risk.fallbackMinOutZero) throw err;
    return { amountOutMin: 0n, minOutSource: 'zero' };
  }
}

async function verifyDirectSellRouteQuote(
  bundles: RpcBundle[],
  input: {
    marketAddress: Address;
    quoteAddress?: Address;
    tokenAddress: Address;
    amountIn: bigint;
  },
): Promise<{ ok: boolean; quotedAmountOut?: bigint; error?: string }> {
  try {
    const quoted = await readFast(bundles, (client) => client.readContract({
      ...buildDirectSellQuoteRead(input),
    }));
    if (quoted <= 0n) return { ok: false, error: 'quote returned zero' };
    return { ok: true, quotedAmountOut: quoted };
  } catch (err) {
    return { ok: false, error: shortError(err) };
  }
}

function parsePreapprovedPairs(): Set<string> {
  return new Set(
    currentExitEngineConfig().route.preapprovedAllowances
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => item.split(':').map(normalizeAddress).join(':')),
  );
}

function preapprovedPairs(): { tokenAddress: Address; spenderAddress: Address }[] {
  const pairs: { tokenAddress: Address; spenderAddress: Address }[] = [];
  for (const item of parsePreapprovedPairs()) {
    const [token, spender] = item.split(':');
    if (!token || !spender) continue;
    pairs.push({ tokenAddress: asAddress(token), spenderAddress: asAddress(spender) });
  }
  return pairs;
}

function hasPreapprovedAllowance(tokenAddress: Address, spenderAddress: Address): boolean {
  const token = normalizeAddress(tokenAddress);
  const spender = normalizeAddress(spenderAddress);
  return parsePreapprovedPairs().has(`${token}:${spender}`);
}

function parseTokenDecimalsEnv(): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of currentExitEngineConfig().route.tokenDecimals) {
    const [token, decimals] = item.split(':');
    if (!token || !decimals) continue;
    const parsed = Number(decimals);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 255) {
      map.set(normalizeAddress(token), parsed);
    }
  }
  return map;
}

async function getTokenDecimals(bundles: RpcBundle[], tokenAddress: Address): Promise<number> {
  const key = normalizeAddress(tokenAddress);
  const configured = parseTokenDecimalsEnv().get(key);
  if (configured !== undefined) {
    tokenDecimalsCache.set(key, configured);
    return configured;
  }
  const cached = tokenDecimalsCache.get(key);
  if (cached !== undefined) return cached;
  const decimals = Number(await readFast(bundles, (client) => client.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'decimals',
  })));
  tokenDecimalsCache.set(key, decimals);
  return decimals;
}

function bigintPercent(value: bigint, percent: number): bigint {
  const bps = BigInt(Math.max(0, Math.min(10000, Math.floor(percent * 100))));
  return (value * bps) / 10000n;
}

export function autoSellWalletStatus(): { enabled: boolean; keySet: boolean; valid: boolean; wallet?: string } {
  const config = currentExitEngineConfig();
  const enabled = config.enabled;
  const rawKey = config.wallet.privateKey ?? '';
  if (!rawKey.trim()) return { enabled, keySet: false, valid: false };
  try {
    const account = getAccount(rawKey);
    return { enabled, keySet: true, valid: true, wallet: account.address };
  } catch {
    return { enabled, keySet: true, valid: false };
  }
}

export async function buildAutoSellReadinessReport(options: AutoSellReadinessOptions = {}): Promise<AutoSellReadinessReport> {
  const config = currentExitEngineConfig();
  const checkNetwork = options.checkNetwork !== false;
  const requireLive = options.requireLive !== false;
  const enabled = config.enabled;
  const dryRun = config.dryRun;
  const rawKey = config.wallet.privateKey ?? '';
  const marketAddress = inputAddress(config.route.marketAddress || DIRECT_SELL_DEFAULT_MARKET_ADDRESS);
  const quoteAddress = inputAddress(config.route.quoteAddress || defaultDirectSellQuoteAddress(marketAddress));
  const approvalSpenderAddress = inputAddress(config.route.approvalSpenderAddress || defaultDirectSellApprovalSpenderAddress(marketAddress));
  const pairs = preapprovedPairs();
  const submitMode = config.execution.submitMode;
  const urls = rpcUrls();
  const protectedUrls = config.rpc.protectedUrls;
  const flashblocksEnabled = config.rpc.flashblocksEnabled;
  const flashblocksUrls = flashblocksEnabled ? [BASE_DIRECT_SELL_FLASHBLOCKS_RPC, ...config.rpc.flashblocksUrls] : [];
  const publicBroadcastEnabled = config.rpc.publicBroadcastEnabled;
  const primaryFallback = config.execution.primaryFallbackEnabled;
  const flashblocksTriggerEnabled = config.integrations.buybackFlashblocksEnabled;
  const flashblocksTriggerUrls = config.integrations.buybackFlashblocksWsUrls;
  const okxBackupEnabled = config.integrations.okxLimitOrderBackupEnabled;
  const okxPreplacedSymbols = new Set(config.integrations.okxLimitOrderPreplacedSymbols);
  const fallbackSymbols = new Set(config.triggers.largeBuy.symbols);
  const broadcastEndpointCount = protectedUrls.length + flashblocksUrls.length + (publicBroadcastEnabled ? urls.length : 0);
  const minOutMode = config.risk.minOutMode;
  const feeMode = config.risk.feeMode;
  const checks: AutoSellReadinessCheck[] = [];
  const issues: AutoSellReadinessIssue[] = [];

  function addCheck(key: string, status: AutoSellReadinessCheckStatus, message: string) {
    checks.push({ key, status, message });
    if (status === 'fail') issues.push({ level: 'error', key, message });
    if (status === 'warn') issues.push({ level: 'warning', key, message });
  }

  addCheck('enabled', enabled ? 'pass' : 'fail', enabled ? 'AUTO_SELL_ENABLED=1' : 'AUTO_SELL_ENABLED is not 1');
  addCheck('dry_run', requireLive && dryRun ? 'fail' : 'pass', dryRun ? 'AUTO_SELL_DRY_RUN=1' : 'AUTO_SELL_DRY_RUN=0');
  addCheck('market_address', isAddress(marketAddress) ? 'pass' : 'fail', `market=${shortAddress(marketAddress)}`);
  addCheck('quote_address', isAddress(quoteAddress) ? 'pass' : 'fail', `quote=${shortAddress(quoteAddress)}`);
  addCheck('approval_spender', isAddress(approvalSpenderAddress) ? 'pass' : 'fail', `spender=${shortAddress(approvalSpenderAddress)}`);
  if (pairs.length === 0) {
    addCheck('preapproved_pairs', 'warn', 'AUTO_SELL_PREAPPROVED_ALLOWANCES is empty; first trigger may need on-demand approve');
  } else {
    addCheck('preapproved_pairs', 'pass', `${pairs.length} preapproved pair${pairs.length === 1 ? '' : 's'} configured`);
  }
  if (!config.execution.onDemandApprove && pairs.length === 0) {
    addCheck('approve_policy', 'fail', 'on-demand approve is disabled but no preapproved pairs are configured');
  } else if (config.execution.onDemandApprove) {
    addCheck('approve_policy', 'warn', 'on-demand approve is enabled; unknown tokens can sell, but first trigger may be slower');
  } else {
    addCheck('approve_policy', 'pass', 'on-demand approve disabled; only preapproved fast path is allowed');
  }
  const gasLimit = config.risk.sellGasLimit ?? 0n;
  addCheck('sell_gas_limit', gasLimit > 0n ? 'pass' : 'warn', gasLimit > 0n ? `fixed sell gas=${gasLimit}` : 'sell gas is estimated at trigger time');
  addCheck('min_out_mode', minOutMode === 'zero' ? 'warn' : 'pass', minOutMode === 'zero' ? 'amountOutMin=0 exposes sells to sandwich/slippage loss' : `amountOutMin uses ${minOutMode}`);
  const bps = slippageBps();
  addCheck('slippage_bps', bps > 0 && bps <= 1_500 ? 'pass' : 'warn', `slippage=${bps} bps`);
  if (requireNonzeroMinOut()) {
    addCheck('nonzero_min_out', minOutMode === 'zero' ? 'fail' : 'pass', 'non-zero amountOutMin is required');
  } else {
    addCheck('nonzero_min_out', 'warn', 'AUTO_SELL_REQUIRE_NONZERO_MIN_OUT is not enabled');
  }
  addCheck('direct_quote_gate', 'pass', 'direct sell route quote is required before approve or sell submission');
  addCheck('fee_mode', feeMode === 'dynamic' ? 'pass' : 'warn', `fee mode=${feeMode}`);
  addCheck(
    'sell_queue',
    'pass',
    `single-wallet nonce queue enabled; burst target=${autoSellBurstTarget()}; token pending lock=${tokenPendingLockEnabled() ? 'on' : 'off'}`,
  );
  addCheck(
    'flashblocks_trigger',
    flashblocksTriggerEnabled ? 'pass' : 'warn',
    flashblocksTriggerEnabled
      ? `Flashblocks preconfirm trigger enabled (${flashblocksTriggerUrls.length || 1} WS endpoint${(flashblocksTriggerUrls.length || 1) === 1 ? '' : 's'})`
      : 'Flashblocks preconfirm trigger is disabled; watcher waits for confirmed block logs',
  );
  if (okxBackupEnabled) {
    const missingOkxSymbols = [...fallbackSymbols].filter((symbol) => !okxPreplacedSymbols.has(symbol));
    addCheck(
      'okx_limit_backup',
      missingOkxSymbols.length === 0 && okxPreplacedSymbols.size > 0 ? 'pass' : 'warn',
      missingOkxSymbols.length === 0 && okxPreplacedSymbols.size > 0
        ? `${okxPreplacedSymbols.size} pre-placed OKX limit-order symbol${okxPreplacedSymbols.size === 1 ? '' : 's'} declared`
        : `OKX limit-order backup enabled but missing declared coverage for: ${missingOkxSymbols.slice(0, 10).join(', ') || 'all symbols'}`,
    );
  } else {
    addCheck('okx_limit_backup', 'warn', 'OKX limit-order backup is not enabled; direct bot is the only sell path');
  }
  addCheck('submit_mode', 'pass', `submit mode=${submitMode}`);
  if (submitMode === 'multi-rpc') {
    if (broadcastEndpointCount < 1) {
      addCheck('multi_rpc_endpoints', 'fail', 'multi-rpc submit has no broadcast endpoint');
    } else if (broadcastEndpointCount < 2) {
      addCheck('multi_rpc_endpoints', 'warn', 'multi-rpc submit has only 1 broadcast endpoint');
    } else {
      addCheck('multi_rpc_endpoints', 'pass', `${broadcastEndpointCount} RPC endpoints available for broadcast`);
    }
    if (gasLimit <= 0n) {
      addCheck('multi_rpc_gas', 'warn', 'multi-rpc submit needs fixed gas for the fastest path');
    } else {
      addCheck('multi_rpc_gas', 'pass', 'multi-rpc submit has fixed gas');
    }
    const maxFeeGwei = config.risk.maxFeeGwei ?? 0;
    if (maxFeeGwei <= 0) {
      addCheck('multi_rpc_fee', feeMode === 'dynamic' ? 'pass' : 'warn', feeMode === 'dynamic' ? 'dynamic max fee is uncapped' : 'AUTO_SELL_MAX_FEE_GWEI is empty; multi-rpc submit will estimate fees at trigger time');
    } else {
      addCheck('multi_rpc_fee', 'pass', `max fee=${maxFeeGwei} gwei`);
    }
    if (protectedUrls.length > 0) {
      addCheck('protected_rpc', 'pass', `${protectedUrls.length} protected RPC endpoint${protectedUrls.length === 1 ? '' : 's'} configured`);
    } else if (flashblocksEnabled) {
      addCheck('protected_rpc', 'warn', 'Flashblocks preconf enabled, but no protected/private RPC is configured');
    } else {
      addCheck('protected_rpc', 'warn', 'no protected/private RPC configured; public mempool exposure remains possible');
    }
    addCheck(
      'public_broadcast',
      publicBroadcastEnabled ? 'warn' : 'pass',
      publicBroadcastEnabled ? 'public broadcast fallback is enabled' : 'public broadcast fallback disabled',
    );
    addCheck(
      'primary_fallback',
      primaryFallback ? 'warn' : 'pass',
      primaryFallback ? 'primary RPC fallback is enabled after multi-rpc failure' : 'primary RPC fallback disabled after multi-rpc failure',
    );
  }

  let account: Account | null = null;
  if (!rawKey.trim()) {
    addCheck('private_key', 'fail', 'AUTO_SELL_PRIVATE_KEY is missing');
  } else {
    try {
      account = getAccount(rawKey);
      addCheck('private_key', 'pass', `wallet=${shortAddress(account.address)}`);
    } catch {
      addCheck('private_key', 'fail', 'AUTO_SELL_PRIVATE_KEY format is invalid');
    }
  }

  addCheck('rpc_config', urls.length > 0 ? 'pass' : 'fail', `${urls.length} RPC endpoint${urls.length === 1 ? '' : 's'} configured`);

  if (checkNetwork && account) {
    const bundles = getRpcBundles(account);
    try {
      const block = await readFast(bundles, (client) => client.getBlockNumber());
      addCheck('rpc_read', 'pass', `latest block=${block}`);
    } catch (err) {
      addCheck('rpc_read', 'fail', `RPC read failed: ${shortError(err).slice(0, 120)}`);
    }

    try {
      const nativeBalance = await readFast(bundles, (client) => client.getBalance({ address: account.address }));
      const gasOptions = await gasOptionsForSell(bundles);
      if (!gasOptions.gas || !gasOptions.maxFeePerGas) {
        addCheck('native_gas_balance', 'warn', `ETH balance=${formatUnits(nativeBalance, 18)}; gas cost cannot be bounded before submit`);
      } else {
        const singleRequired = gasOptions.gas * gasOptions.maxFeePerGas;
        const required = singleRequired * BigInt(autoSellBurstTarget());
        const recommended = required * 2n;
        const balanceText = formatUnits(nativeBalance, 18);
        const singleRequiredText = formatUnits(singleRequired, 18);
        const requiredText = formatUnits(required, 18);
        const recommendedText = formatUnits(recommended, 18);
        if (nativeBalance < required) {
          addCheck('native_gas_balance', 'fail', `ETH balance=${balanceText}; burst max gas=${requiredText} (${autoSellBurstTarget()} tx; single=${singleRequiredText})`);
        } else if (nativeBalance < recommended) {
          addCheck('native_gas_balance', 'warn', `ETH balance=${balanceText}; burst max gas=${requiredText} (${autoSellBurstTarget()} tx; single=${singleRequiredText}); recommended>=${recommendedText}`);
        } else {
          addCheck('native_gas_balance', 'pass', `ETH balance=${balanceText}; burst max gas=${requiredText} (${autoSellBurstTarget()} tx; single=${singleRequiredText})`);
        }
      }
    } catch (err) {
      addCheck('native_gas_balance', 'fail', `ETH gas balance check failed: ${shortError(err).slice(0, 120)}`);
    }

    for (const pair of pairs) {
      const pairKey = `${normalizeAddress(pair.tokenAddress)}:${normalizeAddress(pair.spenderAddress)}`;
      if (!isAddress(pair.tokenAddress) || !isAddress(pair.spenderAddress)) {
        addCheck(`allowance:${pairKey}`, 'fail', `invalid preapproved pair ${pairKey}`);
        continue;
      }
      try {
        const allowance = await readFast(bundles, (client) => client.readContract({
          address: pair.tokenAddress,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [account.address, pair.spenderAddress],
        }));
        if (allowance > 0n) {
          addCheck(`allowance:${pairKey}`, 'pass', `${shortAddress(pair.tokenAddress)} allowance is non-zero`);
        } else {
          addCheck(`allowance:${pairKey}`, 'fail', `${shortAddress(pair.tokenAddress)} allowance is zero`);
        }
      } catch (err) {
        addCheck(`allowance:${pairKey}`, 'fail', `allowance check failed for ${shortAddress(pair.tokenAddress)}: ${shortError(err).slice(0, 120)}`);
      }
      if (config.route.verifyQuotes && minOutMode !== 'zero') {
        try {
          const decimals = parseTokenDecimalsEnv().get(normalizeAddress(pair.tokenAddress)) ?? await getTokenDecimals(bundles, pair.tokenAddress);
          const quoteAmount = decimals <= 36 ? 10n ** BigInt(decimals) : 1n;
          const quoted = await readFast(bundles, (client) => client.readContract({
            ...buildDirectSellQuoteRead({
              marketAddress: asAddress(marketAddress),
              quoteAddress: asAddress(quoteAddress),
              tokenAddress: pair.tokenAddress,
              amountIn: quoteAmount,
            }),
          }));
          addCheck(
            `quote:${normalizeAddress(pair.tokenAddress)}`,
            quoted > 0n ? 'pass' : 'fail',
            quoted > 0n ? `${shortAddress(pair.tokenAddress)} quote is non-zero` : `${shortAddress(pair.tokenAddress)} quote returned zero`,
          );
        } catch (err) {
          addCheck(`quote:${normalizeAddress(pair.tokenAddress)}`, 'fail', `quote check failed for ${shortAddress(pair.tokenAddress)}: ${shortError(err).slice(0, 120)}`);
        }
      }
    }
  }

  return {
    ok: issues.every((issue) => issue.level !== 'error'),
    enabled,
    dryRun,
    wallet: account?.address,
    marketAddress,
    quoteAddress,
    approvalSpenderAddress,
    rpcCount: urls.length,
    preapprovedPairs: pairs.length,
    checks,
    issues,
  };
}

function inputAddress(value: string): string {
  return value.trim();
}

function resolveSellMarketAddress(triggerMarketAddress?: string): Address {
  const config = currentExitEngineConfig();
  const configured = inputAddress(config.route.marketAddress || DIRECT_SELL_DEFAULT_MARKET_ADDRESS);
  if (config.route.useTriggerMarketAddress && triggerMarketAddress) {
    return asAddress(triggerMarketAddress);
  }
  return asAddress(configured);
}

function resolveQuoteAddress(marketAddress: Address, triggerQuoteAddress?: string): Address {
  const config = currentExitEngineConfig();
  return asAddress(config.route.quoteAddress || triggerQuoteAddress || defaultDirectSellQuoteAddress(marketAddress));
}

function resolveApprovalSpenderAddress(marketAddress: Address, triggerApprovalSpenderAddress?: string): Address {
  const config = currentExitEngineConfig();
  if (config.route.approvalSpenderAddress) return asAddress(config.route.approvalSpenderAddress);
  const defaultSpender = defaultDirectSellApprovalSpenderAddress(marketAddress);
  if (normalizeAddress(defaultSpender) !== normalizeAddress(marketAddress)) return defaultSpender;
  return asAddress(triggerApprovalSpenderAddress || marketAddress);
}

function shortAddress(value: string): string {
  if (value.length < 14) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

export async function executeAutoSell(input: AutoSellInput): Promise<AutoSellResult> {
  const config = currentExitEngineConfig();
  const enabled = config.enabled;
  const dryRun = config.dryRun;
  const rawKey = config.wallet.privateKey ?? '';
  const tokenAddress = asAddress(input.tokenAddress);
  const marketAddress = resolveSellMarketAddress(input.marketAddress);
  const quoteAddress = resolveQuoteAddress(marketAddress, input.quoteAddress);
  const approvalSpenderAddress = resolveApprovalSpenderAddress(marketAddress, input.approvalSpenderAddress);

  if (!enabled) return { status: 'disabled', marketAddress, quoteAddress, approvalSpenderAddress };
  if (!rawKey.trim()) return { status: 'missing-key', marketAddress, quoteAddress, approvalSpenderAddress };

  let account: Account;
  try {
    account = getAccount(rawKey);
  } catch {
    return { status: 'invalid-key', marketAddress, quoteAddress, approvalSpenderAddress };
  }

  const tokenLock = acquireTokenSellLock(tokenAddress, input.triggerTxHash);
  if (!tokenLock.acquired) {
    return {
      status: 'skipped',
      wallet: account.address,
      marketAddress,
      quoteAddress,
      approvalSpenderAddress,
      error: tokenLock.reason,
      detectedToSubmitMs: Date.now() - input.detectedAtMs,
      submitMode: autoSellSubmitMode(),
    };
  }

  return withAutoSellQueue(async ({ queueWaitMs, queuePosition }) => {
    const bundles = getRpcBundles(account);
    const primary = bundles[0];
    const baseResult = {
      wallet: account.address,
      marketAddress,
      quoteAddress,
      approvalSpenderAddress,
      queueWaitMs,
      queuePosition,
    };

    try {
      const decimalsPromise = getTokenDecimals(bundles, tokenAddress);
      const balance = await readFast(bundles, (client) => client.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account.address],
      }));
      const amountIn = bigintPercent(balance, config.execution.sellPercent);
      const decimals = await decimalsPromise;
      if (amountIn <= 0n) {
        releaseTokenSellLock(tokenLock.key);
        return {
          status: 'no-balance',
          ...baseResult,
          tokenAmount: '0',
          detectedToSubmitMs: Date.now() - input.detectedAtMs,
        };
      }

      const quoteGate = await verifyDirectSellRouteQuote(bundles, {
        marketAddress,
        quoteAddress,
        tokenAddress,
        amountIn,
      });
      if (!quoteGate.ok || quoteGate.quotedAmountOut === undefined) {
        releaseTokenSellLock(tokenLock.key);
        return {
          status: 'failed',
          ...baseResult,
          tokenAmount: formatUnits(amountIn, decimals),
          error: `direct sell route quote failed: ${quoteGate.error ?? 'unknown error'}`,
          detectedToSubmitMs: Date.now() - input.detectedAtMs,
          submitMode: autoSellSubmitMode(),
        };
      }

      let approveTxHash: Hash | undefined;
      if (!hasPreapprovedAllowance(tokenAddress, approvalSpenderAddress)) {
        const allowance = await readFast(bundles, (client) => client.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [account.address, approvalSpenderAddress],
        }));
        if (allowance < amountIn) {
          if (!config.execution.onDemandApprove) {
            releaseTokenSellLock(tokenLock.key);
            return {
              status: 'failed',
              ...baseResult,
              tokenAmount: formatUnits(amountIn, decimals),
              error: 'allowance too low and AUTO_SELL_ON_DEMAND_APPROVE=0',
              detectedToSubmitMs: Date.now() - input.detectedAtMs,
            };
          }
          approveTxHash = await submitErc20ApproveRpc(primary, { tokenAddress, spenderAddress: approvalSpenderAddress });
          await primary.publicClient.waitForTransactionReceipt({ hash: approveTxHash, timeout: 20_000 });
        }
      } else if (config.execution.verifyPreapproved) {
        const allowance = await readFast(bundles, (client) => client.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [account.address, approvalSpenderAddress],
        }));
        if (allowance < amountIn) {
          if (!config.execution.onDemandApprove) {
            releaseTokenSellLock(tokenLock.key);
            return {
              status: 'failed',
              ...baseResult,
              tokenAmount: formatUnits(amountIn, decimals),
              error: 'allowance too low and AUTO_SELL_ON_DEMAND_APPROVE=0',
              detectedToSubmitMs: Date.now() - input.detectedAtMs,
            };
          }
          approveTxHash = await submitErc20ApproveRpc(primary, { tokenAddress, spenderAddress: approvalSpenderAddress });
          await primary.publicClient.waitForTransactionReceipt({ hash: approveTxHash, timeout: 20_000 });
        }
      }

      const minOut = await buildAmountOutMin(bundles, {
        marketAddress,
        quoteAddress,
        tokenAddress,
        amountIn,
        tokenDecimals: decimals,
        prequotedAmountOut: quoteGate.quotedAmountOut,
        referenceTokenAmount: input.referenceTokenAmount,
        referenceVirtualSpent: input.referenceVirtualSpent,
      });
      const amountOutMin = minOut.amountOutMin;

      const deadline = BigInt(Math.floor(Date.now() / 1000) + Math.floor(config.execution.deadlineSeconds));
      if (dryRun) {
        releaseTokenSellLock(tokenLock.key);
        return {
          status: 'dry-run',
          ...baseResult,
          approveTxHash,
          tokenAmount: formatUnits(amountIn, decimals),
          amountOutMin: formatUnits(amountOutMin, 18),
          quotedAmountOut: minOut.quotedAmountOut !== undefined ? formatUnits(minOut.quotedAmountOut, 18) : undefined,
          slippageBps: minOut.slippageBps,
          minOutSource: minOut.minOutSource,
          detectedToSubmitMs: Date.now() - input.detectedAtMs,
          submitMode: autoSellSubmitMode(),
        };
      }

      const submitted = await submitSellTransaction(bundles, account, {
        marketAddress,
        tokenAddress,
        amountIn,
        amountOutMin,
        deadline,
      });
      markTokenSellSubmitted(tokenLock.key, submitted.sellTxHash, bundles);

      return {
        status: 'sent',
        ...baseResult,
        approveTxHash,
        sellTxHash: submitted.sellTxHash,
        submitMode: submitted.submitMode,
        nonce: submitted.nonce,
        tokenAmount: formatUnits(amountIn, decimals),
        amountOutMin: formatUnits(amountOutMin, 18),
        quotedAmountOut: minOut.quotedAmountOut !== undefined ? formatUnits(minOut.quotedAmountOut, 18) : undefined,
        slippageBps: minOut.slippageBps,
        minOutSource: minOut.minOutSource,
        detectedToSubmitMs: Date.now() - input.detectedAtMs,
      };
    } catch (err) {
      releaseTokenSellLock(tokenLock.key);
      return {
        status: 'failed',
        ...baseResult,
        error: shortError(err),
        detectedToSubmitMs: Date.now() - input.detectedAtMs,
        submitMode: autoSellSubmitMode(),
      };
    }
  });
}

export const __autoSellTest = {
  resetRuntimeState() {
    autoSellQueueTail = Promise.resolve();
    autoSellQueueDepth = 0;
    nonceState = null;
    pendingTokenSells.clear();
  },
  acquireTokenSellLock(tokenAddress: string, triggerTxHash: string) {
    return acquireTokenSellLock(asAddress(tokenAddress), triggerTxHash);
  },
  releaseTokenSellLock(tokenKey: string) {
    releaseTokenSellLock(tokenKey);
  },
  pendingTokenSellCount() {
    cleanupExpiredTokenSellLocks();
    return pendingTokenSells.size;
  },
  runQueued<T>(run: (queue: { queueWaitMs: number; queuePosition: number }) => Promise<T>) {
    return withAutoSellQueue(run);
  },
  verifyDirectSellRouteQuote,
};
