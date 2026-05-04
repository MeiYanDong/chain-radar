import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  http,
  isAddress,
  maxUint256,
  parseAbi,
  parseGwei,
  parseUnits,
  type Address,
  type Hash,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
const DEFAULT_MARKET_ADDRESS = '0x1A540088125d00dD3990f9dA45CA0859af4d3B01' as const;
const BASE_FLASHBLOCKS_RPC = 'https://mainnet-preconf.base.org';

const SELL_ABI = parseAbi([
  'function sell(uint256 amountIn,address tokenAddress,uint256 amountOutMin,uint256 deadline) returns (bool)',
  'function getAmountsOut(address tokenAddress,address assetToken,uint256 amountIn) view returns (uint256)',
]);

type Account = ReturnType<typeof privateKeyToAccount>;
type RpcBundle = ReturnType<typeof createRpcBundle>;
type SellGasOptions = {
  gas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
};

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

function parseNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBigIntEnv(name: string, fallback: bigint): bigint {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    return BigInt(raw.trim());
  } catch {
    return fallback;
  }
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
  const urls = [
    process.env.RPC_URL || 'https://mainnet.base.org',
    ...(process.env.RPC_URL_FALLBACKS ?? '').split(','),
  ]
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(urls)];
}

function listEnv(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function symbolSetEnv(name: string): Set<string> {
  return new Set(listEnv(name).map((value) => value.toUpperCase()));
}

function rpcCacheKey(account: Account): string {
  return `${account.address}:${rpcUrls().join('|')}`;
}

function getAccount(rawKey: string): Account {
  if (cachedAccount) return cachedAccount;
  cachedAccount = privateKeyToAccount(normalizePrivateKey(rawKey));
  return cachedAccount;
}

function createRpcBundle(account: Account, url: string) {
  const readTimeout = Math.max(100, Math.round(parseNumberEnv('AUTO_SELL_READ_TIMEOUT_MS', 1200)));
  const writeTimeout = Math.max(300, Math.round(parseNumberEnv('AUTO_SELL_WRITE_TIMEOUT_MS', 1800)));
  return {
    url,
    publicClient: createPublicClient({
      chain: base,
      transport: http(url, { retryCount: 0, timeout: readTimeout }),
    }),
    walletClient: createWalletClient({
      account,
      chain: base,
      transport: http(url, { retryCount: 0, timeout: writeTimeout }),
    }),
  };
}

function getRpcBundles(account: Account): RpcBundle[] {
  const key = rpcCacheKey(account);
  if (cachedBundlesKey === key && cachedBundles.length > 0) return cachedBundles;
  cachedBundles = rpcUrls().map((url) => createRpcBundle(account, url));
  cachedBundlesKey = key;
  return cachedBundles;
}

async function readFast<T>(bundles: RpcBundle[], read: (client: RpcBundle['publicClient']) => Promise<T>): Promise<T> {
  if (bundles.length === 1) return read(bundles[0].publicClient);
  return Promise.any(bundles.map((bundle) => read(bundle.publicClient)));
}

function autoSellSubmitMode(): 'primary' | 'multi-rpc' {
  return (process.env.AUTO_SELL_SUBMIT_MODE ?? 'primary').toLowerCase() === 'multi-rpc'
    ? 'multi-rpc'
    : 'primary';
}

function autoSellBurstTarget(): number {
  return clampInt(parseNumberEnv('AUTO_SELL_BURST_TARGET', 3), 1, 20);
}

function tokenPendingLockEnabled(): boolean {
  return process.env.AUTO_SELL_TOKEN_PENDING_LOCK !== '0';
}

function tokenPendingTtlMs(): number {
  return Math.max(10_000, Math.round(parseNumberEnv('AUTO_SELL_TOKEN_PENDING_TTL_MS', 180_000)));
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
  const explicit = process.env.AUTO_SELL_PRIMARY_FALLBACK_ENABLED;
  if (explicit === '1') return true;
  if (explicit === '0') return false;
  return process.env.AUTO_SELL_PUBLIC_BROADCAST_ENABLED !== '0';
}

function sellGasLimit(): bigint {
  return parseBigIntEnv('AUTO_SELL_SELL_GAS_LIMIT', 0n);
}

function autoSellFeeMode(): 'fixed' | 'dynamic' {
  return (process.env.AUTO_SELL_FEE_MODE ?? 'fixed').toLowerCase() === 'dynamic' ? 'dynamic' : 'fixed';
}

function autoSellMinOutMode(): 'zero' | 'quote' | 'quote-required' | 'reference' | 'quote-reference' {
  const value = (process.env.AUTO_SELL_MIN_OUT_MODE ?? 'zero').toLowerCase();
  if (value === 'quote-required') return 'quote-required';
  if (value === 'reference') return 'reference';
  if (value === 'quote-reference') return 'quote-reference';
  return value === 'quote' ? 'quote' : 'zero';
}

function requireNonzeroMinOut(): boolean {
  return process.env.AUTO_SELL_REQUIRE_NONZERO_MIN_OUT === '1' || autoSellMinOutMode() === 'quote-required';
}

function slippageBps(): number {
  return Math.max(0, Math.min(10_000, Math.floor(parseNumberEnv('AUTO_SELL_SLIPPAGE_BPS', 800))));
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
  const minPriorityGwei = parseNumberEnv('AUTO_SELL_MIN_PRIORITY_GWEI', 0.01);
  const maxFeeGwei = parseNumberEnv('AUTO_SELL_MAX_FEE_GWEI', 0);
  const gas = sellGasLimit();
  return {
    ...(maxFeeGwei > 0 ? { maxFeePerGas: parseGwei(String(maxFeeGwei)) } : {}),
    ...(minPriorityGwei > 0 ? { maxPriorityFeePerGas: parseGwei(String(minPriorityGwei)) } : {}),
    ...(gas > 0n ? { gas } : {}),
  };
}

async function dynamicGasOptions(bundles: RpcBundle[]): Promise<SellGasOptions> {
  const gas = sellGasLimit();
  const fees = await readFast(bundles, async (client) => (
    await client.estimateFeesPerGas()
  )) as { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint };
  const minPriority = gweiToWei(parseNumberEnv('AUTO_SELL_MIN_PRIORITY_GWEI', 0.1));
  const priorityMultiplier = parseNumberEnv('AUTO_SELL_PRIORITY_FEE_MULTIPLIER', 2);
  const maxFeeMultiplier = parseNumberEnv('AUTO_SELL_MAX_FEE_MULTIPLIER', 1.5);
  const priorityCapGwei = parseNumberEnv('AUTO_SELL_MAX_PRIORITY_FEE_GWEI', 0);
  const maxFeeCapGwei = parseNumberEnv('AUTO_SELL_MAX_FEE_GWEI', 0);
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
  return primary.walletClient.writeContract({
    address: input.marketAddress,
    abi: SELL_ABI,
    functionName: 'sell',
    args: [input.amountIn, input.tokenAddress, input.amountOutMin, input.deadline],
    ...gasOptions,
  });
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
  if (submitBundles.length === 0) throw new Error('multi-rpc submit requires at least 1 broadcast endpoint');
  const gasOptions = await multiRpcGasOptions(readBundles);
  const data = encodeFunctionData({
    abi: SELL_ABI,
    functionName: 'sell',
    args: [input.amountIn, input.tokenAddress, input.amountOutMin, input.deadline],
  });
  const nonce = await reserveSellNonce(readBundles, account);
  const signed = await account.signTransaction({
    chainId: base.id,
    type: 'eip1559',
    to: input.marketAddress,
    data,
    value: 0n,
    nonce,
    gas: gasOptions.gas,
    maxFeePerGas: gasOptions.maxFeePerGas,
    maxPriorityFeePerGas: gasOptions.maxPriorityFeePerGas,
  });
  try {
    return {
      sellTxHash: await Promise.any(submitBundles.map((bundle) => bundle.publicClient.sendRawTransaction({ serializedTransaction: signed }))),
      nonce,
    };
  } catch (err) {
    resetNonceState(account);
    throw err;
  }
}

function broadcastBundles(account: Account, publicBundles: RpcBundle[]): RpcBundle[] {
  const publicByUrl = new Map(publicBundles.map((bundle) => [bundle.url, bundle]));
  const urls = [
    ...listEnv('AUTO_SELL_PROTECTED_RPC_URLS'),
    ...(process.env.AUTO_SELL_FLASHBLOCKS_ENABLED === '1' ? [BASE_FLASHBLOCKS_RPC, ...listEnv('AUTO_SELL_FLASHBLOCKS_RPC_URLS')] : []),
    ...(process.env.AUTO_SELL_PUBLIC_BROADCAST_ENABLED === '0' ? [] : publicBundles.map((bundle) => bundle.url)),
  ];
  const seen = new Set<string>();
  const bundles: RpcBundle[] = [];
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    bundles.push(publicByUrl.get(url) ?? createRpcBundle(account, url));
  }
  return bundles;
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
  const primary = bundles[0];
  if (autoSellSubmitMode() === 'multi-rpc') {
    try {
      const submitBundles = broadcastBundles(account, bundles);
      return {
        ...await submitSellMultiRpc(bundles, submitBundles, account, input),
        submitMode: 'multi-rpc',
      };
    } catch (err) {
      if (!primaryFallbackEnabled()) throw err;
      console.error(`[AutoSell] multi-rpc submit failed; falling back to primary: ${shortError(err).slice(0, 160)}`);
    }
  }
  return {
    sellTxHash: await submitSellPrimary(bundles, primary, input),
    submitMode: 'primary',
  };
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
    tokenAddress: Address;
    amountIn: bigint;
    tokenDecimals: number;
    referenceTokenAmount?: number;
    referenceVirtualSpent?: number;
  },
): Promise<{ amountOutMin: bigint; quotedAmountOut?: bigint; slippageBps?: number; minOutSource: 'zero' | 'quote' | 'reference' }> {
  const mode = autoSellMinOutMode();
  if (mode === 'zero') {
    if (requireNonzeroMinOut()) throw new Error('AUTO_SELL_REQUIRE_NONZERO_MIN_OUT=1 but AUTO_SELL_MIN_OUT_MODE=zero');
    return { amountOutMin: 0n, minOutSource: 'zero' };
  }
  if (mode === 'reference') {
    const reference = buildReferenceAmountOutMin(input);
    if (reference) return { ...reference, minOutSource: 'reference' };
    if (requireNonzeroMinOut()) throw new Error('reference amountOutMin unavailable');
    return { amountOutMin: 0n, minOutSource: 'zero' };
  }
  try {
    const quoted = await readFast(bundles, (client) => client.readContract({
      address: input.marketAddress,
      abi: SELL_ABI,
      functionName: 'getAmountsOut',
      args: [input.tokenAddress, ZERO_ADDRESS, input.amountIn],
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
    if (requireNonzeroMinOut() || process.env.AUTO_SELL_FALLBACK_MIN_OUT_ZERO === '0') throw err;
    return { amountOutMin: 0n, minOutSource: 'zero' };
  }
}

function parseAddressSetEnv(name: string): Set<string> {
  return new Set(
    (process.env[name] ?? '')
      .split(',')
      .map(normalizeAddress)
      .filter(Boolean),
  );
}

function parsePreapprovedPairs(): Set<string> {
  return new Set(
    (process.env.AUTO_SELL_PREAPPROVED_ALLOWANCES ?? '')
      .split(',')
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
  for (const item of (process.env.AUTO_SELL_TOKEN_DECIMALS ?? '').split(',')) {
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
  const enabled = process.env.AUTO_SELL_ENABLED === '1';
  const rawKey = process.env.AUTO_SELL_PRIVATE_KEY ?? '';
  if (!rawKey.trim()) return { enabled, keySet: false, valid: false };
  try {
    const account = getAccount(rawKey);
    return { enabled, keySet: true, valid: true, wallet: account.address };
  } catch {
    return { enabled, keySet: true, valid: false };
  }
}

export async function buildAutoSellReadinessReport(options: AutoSellReadinessOptions = {}): Promise<AutoSellReadinessReport> {
  const checkNetwork = options.checkNetwork !== false;
  const requireLive = options.requireLive !== false;
  const enabled = process.env.AUTO_SELL_ENABLED === '1';
  const dryRun = process.env.AUTO_SELL_DRY_RUN === '1';
  const rawKey = process.env.AUTO_SELL_PRIVATE_KEY ?? '';
  const marketAddress = inputAddress(process.env.AUTO_SELL_MARKET_ADDRESS || DEFAULT_MARKET_ADDRESS);
  const approvalSpenderAddress = inputAddress(process.env.AUTO_SELL_APPROVAL_SPENDER_ADDRESS || marketAddress);
  const pairs = preapprovedPairs();
  const submitMode = autoSellSubmitMode();
  const urls = rpcUrls();
  const protectedUrls = listEnv('AUTO_SELL_PROTECTED_RPC_URLS');
  const flashblocksEnabled = process.env.AUTO_SELL_FLASHBLOCKS_ENABLED === '1';
  const flashblocksUrls = flashblocksEnabled ? [BASE_FLASHBLOCKS_RPC, ...listEnv('AUTO_SELL_FLASHBLOCKS_RPC_URLS')] : [];
  const publicBroadcastEnabled = process.env.AUTO_SELL_PUBLIC_BROADCAST_ENABLED !== '0';
  const primaryFallback = primaryFallbackEnabled();
  const flashblocksTriggerEnabled = process.env.BUYBACK_FLASHBLOCKS_ENABLED === '1';
  const flashblocksTriggerUrls = listEnv('BUYBACK_FLASHBLOCKS_WS_URLS');
  const okxBackupEnabled = process.env.OKX_LIMIT_ORDER_BACKUP_ENABLED === '1';
  const okxPreplacedSymbols = symbolSetEnv('OKX_LIMIT_ORDER_PREPLACED_SYMBOLS');
  const fallbackSymbols = symbolSetEnv('BUYBACK_LARGE_BUY_SYMBOLS');
  const broadcastEndpointCount = protectedUrls.length + flashblocksUrls.length + (publicBroadcastEnabled ? urls.length : 0);
  const minOutMode = autoSellMinOutMode();
  const feeMode = autoSellFeeMode();
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
  addCheck('approval_spender', isAddress(approvalSpenderAddress) ? 'pass' : 'fail', `spender=${shortAddress(approvalSpenderAddress)}`);
  if (pairs.length === 0) {
    addCheck('preapproved_pairs', 'warn', 'AUTO_SELL_PREAPPROVED_ALLOWANCES is empty; first trigger may need on-demand approve');
  } else {
    addCheck('preapproved_pairs', 'pass', `${pairs.length} preapproved pair${pairs.length === 1 ? '' : 's'} configured`);
  }
  if (process.env.AUTO_SELL_ON_DEMAND_APPROVE === '0' && pairs.length === 0) {
    addCheck('approve_policy', 'fail', 'on-demand approve is disabled but no preapproved pairs are configured');
  } else if (process.env.AUTO_SELL_ON_DEMAND_APPROVE !== '0') {
    addCheck('approve_policy', 'warn', 'on-demand approve is enabled; unknown tokens can sell, but first trigger may be slower');
  } else {
    addCheck('approve_policy', 'pass', 'on-demand approve disabled; only preapproved fast path is allowed');
  }
  const gasLimit = parseBigIntEnv('AUTO_SELL_SELL_GAS_LIMIT', 0n);
  addCheck('sell_gas_limit', gasLimit > 0n ? 'pass' : 'warn', gasLimit > 0n ? `fixed sell gas=${gasLimit}` : 'sell gas is estimated at trigger time');
  addCheck('min_out_mode', minOutMode === 'zero' ? 'warn' : 'pass', minOutMode === 'zero' ? 'amountOutMin=0 exposes sells to sandwich/slippage loss' : `amountOutMin uses ${minOutMode}`);
  const bps = slippageBps();
  addCheck('slippage_bps', bps > 0 && bps <= 1_500 ? 'pass' : 'warn', `slippage=${bps} bps`);
  if (requireNonzeroMinOut()) {
    addCheck('nonzero_min_out', minOutMode === 'zero' ? 'fail' : 'pass', 'non-zero amountOutMin is required');
  } else {
    addCheck('nonzero_min_out', 'warn', 'AUTO_SELL_REQUIRE_NONZERO_MIN_OUT is not enabled');
  }
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
    if (parseNumberEnv('AUTO_SELL_MAX_FEE_GWEI', 0) <= 0) {
      addCheck('multi_rpc_fee', feeMode === 'dynamic' ? 'pass' : 'warn', feeMode === 'dynamic' ? 'dynamic max fee is uncapped' : 'AUTO_SELL_MAX_FEE_GWEI is empty; multi-rpc submit will estimate fees at trigger time');
    } else {
      addCheck('multi_rpc_fee', 'pass', `max fee=${parseNumberEnv('AUTO_SELL_MAX_FEE_GWEI', 0)} gwei`);
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
      if (process.env.AUTO_SELL_VERIFY_QUOTES === '1' && minOutMode !== 'zero') {
        try {
          const decimals = parseTokenDecimalsEnv().get(normalizeAddress(pair.tokenAddress)) ?? await getTokenDecimals(bundles, pair.tokenAddress);
          const quoteAmount = decimals <= 36 ? 10n ** BigInt(decimals) : 1n;
          const quoted = await readFast(bundles, (client) => client.readContract({
            address: asAddress(marketAddress),
            abi: SELL_ABI,
            functionName: 'getAmountsOut',
            args: [pair.tokenAddress, ZERO_ADDRESS, quoteAmount],
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
  const configured = inputAddress(process.env.AUTO_SELL_MARKET_ADDRESS || DEFAULT_MARKET_ADDRESS);
  if (process.env.AUTO_SELL_USE_TRIGGER_MARKET_ADDRESS === '1' && triggerMarketAddress) {
    return asAddress(triggerMarketAddress);
  }
  return asAddress(configured);
}

function shortAddress(value: string): string {
  if (value.length < 14) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

export async function executeAutoSell(input: AutoSellInput): Promise<AutoSellResult> {
  const enabled = process.env.AUTO_SELL_ENABLED === '1';
  const dryRun = process.env.AUTO_SELL_DRY_RUN === '1';
  const rawKey = process.env.AUTO_SELL_PRIVATE_KEY ?? '';
  const tokenAddress = asAddress(input.tokenAddress);
  const marketAddress = resolveSellMarketAddress(input.marketAddress);
  const approvalSpenderAddress = asAddress(
    process.env.AUTO_SELL_APPROVAL_SPENDER_ADDRESS || input.approvalSpenderAddress || marketAddress,
  );

  if (!enabled) return { status: 'disabled', marketAddress, approvalSpenderAddress };
  if (!rawKey.trim()) return { status: 'missing-key', marketAddress, approvalSpenderAddress };

  let account: Account;
  try {
    account = getAccount(rawKey);
  } catch {
    return { status: 'invalid-key', marketAddress, approvalSpenderAddress };
  }

  const tokenLock = acquireTokenSellLock(tokenAddress, input.triggerTxHash);
  if (!tokenLock.acquired) {
    return {
      status: 'skipped',
      wallet: account.address,
      marketAddress,
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
      const amountIn = bigintPercent(balance, parseNumberEnv('AUTO_SELL_PERCENT', 100));
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

      let approveTxHash: Hash | undefined;
      if (!hasPreapprovedAllowance(tokenAddress, approvalSpenderAddress)) {
        const allowance = await readFast(bundles, (client) => client.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [account.address, approvalSpenderAddress],
        }));
        if (allowance < amountIn) {
          if (process.env.AUTO_SELL_ON_DEMAND_APPROVE === '0') {
            releaseTokenSellLock(tokenLock.key);
            return {
              status: 'failed',
              ...baseResult,
              tokenAmount: formatUnits(amountIn, decimals),
              error: 'allowance too low and AUTO_SELL_ON_DEMAND_APPROVE=0',
              detectedToSubmitMs: Date.now() - input.detectedAtMs,
            };
          }
          approveTxHash = await primary.walletClient.writeContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: 'approve',
            args: [approvalSpenderAddress, maxUint256],
          });
          await primary.publicClient.waitForTransactionReceipt({ hash: approveTxHash, timeout: 20_000 });
        }
      } else if (process.env.AUTO_SELL_VERIFY_PREAPPROVED === '1') {
        const allowance = await readFast(bundles, (client) => client.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [account.address, approvalSpenderAddress],
        }));
        if (allowance < amountIn) {
          if (process.env.AUTO_SELL_ON_DEMAND_APPROVE === '0') {
            releaseTokenSellLock(tokenLock.key);
            return {
              status: 'failed',
              ...baseResult,
              tokenAmount: formatUnits(amountIn, decimals),
              error: 'allowance too low and AUTO_SELL_ON_DEMAND_APPROVE=0',
              detectedToSubmitMs: Date.now() - input.detectedAtMs,
            };
          }
          approveTxHash = await primary.walletClient.writeContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: 'approve',
            args: [approvalSpenderAddress, maxUint256],
          });
          await primary.publicClient.waitForTransactionReceipt({ hash: approveTxHash, timeout: 20_000 });
        }
      }

      const minOut = await buildAmountOutMin(bundles, {
        marketAddress,
        tokenAddress,
        amountIn,
        tokenDecimals: decimals,
        referenceTokenAmount: input.referenceTokenAmount,
        referenceVirtualSpent: input.referenceVirtualSpent,
      });
      const amountOutMin = minOut.amountOutMin;

      const deadline = BigInt(Math.floor(Date.now() / 1000) + Math.floor(parseNumberEnv('AUTO_SELL_DEADLINE_SECONDS', 60)));
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
};
