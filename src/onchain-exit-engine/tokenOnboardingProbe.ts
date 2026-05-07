import {
  createPublicClient,
  erc20Abi,
  http,
  isAddress,
  type Address,
} from 'viem';
import { base } from 'viem/chains';

import { buildDirectSellQuoteRead } from './directSellTransaction.js';
import type { TokenOnboardingProbe } from './tokenOnboarding.js';

export interface TokenOnboardingReadClient {
  readContract(input: {
    address: Address;
    abi: unknown;
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
}

export interface TokenOnboardingProbeInput {
  client: TokenOnboardingReadClient;
  tokenAddress: Address;
  marketAddress: Address;
  spenderAddress: Address;
  walletAddress?: Address;
  sellPercent?: number;
}

export interface TokenOnboardingProbeResult {
  tokenAddress: Address;
  marketAddress: Address;
  spenderAddress: Address;
  walletAddress?: Address;
  symbol?: string;
  decimals?: number;
  quoteAmountRaw?: bigint;
  probe: TokenOnboardingProbe;
}

export interface TokenOnboardingFastProbeInput extends Omit<TokenOnboardingProbeInput, 'client'> {
  rpcUrls: string[];
  readTimeoutMs: number;
}

export interface TokenOnboardingCandidateEnvInput {
  env: Record<string, string | undefined>;
  tokenAddress: string;
  marketAddress: string;
  spenderAddress: string;
  symbol?: string;
  decimals?: number;
  allowancePreapproved?: boolean;
}

function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

function validDecimals(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 255 ? parsed : undefined;
}

function bigintPercent(value: bigint, percent: number): bigint {
  const bps = BigInt(Math.max(0, Math.min(10_000, Math.floor(percent * 100))));
  return value * bps / 10_000n;
}

function shortError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.split('\n')[0].slice(0, 220);
}

function appendAddressValue(raw: string | undefined, address: string, value: string): string {
  const normalized = normalizeAddress(address);
  const items = (raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => normalizeAddress(item.split(':')[0] ?? '') !== normalized);
  items.push(`${normalized}:${value}`);
  return items.join(',');
}

function appendAddressPair(raw: string | undefined, tokenAddress: string, spenderAddress: string): string {
  const token = normalizeAddress(tokenAddress);
  const spender = normalizeAddress(spenderAddress);
  const pair = `${token}:${spender}`;
  const items = (raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item.toLowerCase() !== pair);
  items.push(pair);
  return items.join(',');
}

function createReadClient(url: string, readTimeoutMs: number): TokenOnboardingReadClient {
  return createPublicClient({
    chain: base,
    transport: http(url, { retryCount: 0, timeout: readTimeoutMs }),
  }) as TokenOnboardingReadClient;
}

export async function readTokenOnboardingProbe(input: TokenOnboardingProbeInput): Promise<TokenOnboardingProbeResult> {
  const result: TokenOnboardingProbeResult = {
    tokenAddress: input.tokenAddress,
    marketAddress: input.marketAddress,
    spenderAddress: input.spenderAddress,
    walletAddress: input.walletAddress,
    probe: {
      quote: { status: 'not_checked' },
      allowance: { status: 'not_checked' },
      balance: { status: 'not_checked' },
    },
  };

  const [symbolResult, decimalsResult] = await Promise.allSettled([
    input.client.readContract({
      address: input.tokenAddress,
      abi: erc20Abi,
      functionName: 'symbol',
    }),
    input.client.readContract({
      address: input.tokenAddress,
      abi: erc20Abi,
      functionName: 'decimals',
    }),
  ]);

  if (symbolResult.status === 'fulfilled' && typeof symbolResult.value === 'string' && symbolResult.value.trim()) {
    result.symbol = symbolResult.value.trim().toUpperCase();
  }

  if (decimalsResult.status === 'fulfilled') {
    result.decimals = validDecimals(decimalsResult.value);
  }

  if (result.decimals === undefined) {
    result.probe.quote = { status: 'fail', error: 'token decimals could not be read' };
  } else {
    const quoteAmountRaw = result.decimals <= 36 ? 10n ** BigInt(result.decimals) : 1n;
    result.quoteAmountRaw = quoteAmountRaw;
    try {
      const quoted = await input.client.readContract({
        ...buildDirectSellQuoteRead({
          marketAddress: input.marketAddress,
          tokenAddress: input.tokenAddress,
          amountIn: quoteAmountRaw,
        }),
      });
      result.probe.quote = { status: 'pass', amountOutRaw: BigInt(quoted as bigint) };
    } catch (err) {
      result.probe.quote = { status: 'fail', error: shortError(err) };
    }
  }

  if (!input.walletAddress) return result;

  let balanceRaw: bigint | undefined;
  try {
    balanceRaw = BigInt(await input.client.readContract({
      address: input.tokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [input.walletAddress],
    }) as bigint);
    result.probe.balance = { status: 'pass', balanceRaw };
  } catch (err) {
    result.probe.balance = { status: 'fail', error: shortError(err) };
  }

  const requiredRaw = balanceRaw !== undefined ? bigintPercent(balanceRaw, input.sellPercent ?? 100) : undefined;
  try {
    const allowanceRaw = BigInt(await input.client.readContract({
      address: input.tokenAddress,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [input.walletAddress, input.spenderAddress],
    }) as bigint);
    result.probe.allowance = { status: 'pass', allowanceRaw, requiredRaw };
  } catch (err) {
    result.probe.allowance = { status: 'fail', requiredRaw, error: shortError(err) };
  }

  return result;
}

export async function readTokenOnboardingProbeFast(input: TokenOnboardingFastProbeInput): Promise<TokenOnboardingProbeResult> {
  const urls = [...new Set(input.rpcUrls.map((url) => url.trim()).filter(Boolean))];
  if (urls.length === 0) throw new Error('token onboarding probe requires at least one RPC URL');
  if (!isAddress(input.tokenAddress) || !isAddress(input.marketAddress) || !isAddress(input.spenderAddress)) {
    throw new Error('token onboarding probe requires valid token, market, and spender addresses');
  }
  const results = await Promise.allSettled(urls.map((url) => readTokenOnboardingProbe({
    ...input,
    client: createReadClient(url, input.readTimeoutMs),
  })));
  const fulfilled = results
    .filter((result): result is PromiseFulfilledResult<TokenOnboardingProbeResult> => result.status === 'fulfilled')
    .map((result) => result.value);
  if (fulfilled.length === 0) throw new Error('all token onboarding probes failed');
  return fulfilled.find((result) => result.probe.quote?.status === 'pass') ??
    fulfilled.find((result) => result.decimals !== undefined) ??
    fulfilled[0];
}

export function buildTokenOnboardingCandidateEnv(input: TokenOnboardingCandidateEnvInput): Record<string, string | undefined> {
  const env = { ...input.env };
  const token = normalizeAddress(input.tokenAddress);
  const market = normalizeAddress(input.marketAddress);
  const spender = normalizeAddress(input.spenderAddress);

  if (input.symbol) {
    env.EXIT_ENGINE_TOKEN_SYMBOLS = appendAddressValue(
      env.EXIT_ENGINE_TOKEN_SYMBOLS ?? env.AUTO_SELL_TOKEN_SYMBOLS,
      token,
      input.symbol.toUpperCase(),
    );
  }
  if (input.decimals !== undefined) {
    env.EXIT_ENGINE_TOKEN_DECIMALS = appendAddressValue(
      env.EXIT_ENGINE_TOKEN_DECIMALS ?? env.AUTO_SELL_TOKEN_DECIMALS,
      token,
      String(input.decimals),
    );
  }
  env.EXIT_ENGINE_TOKEN_MARKETS = appendAddressValue(
    env.EXIT_ENGINE_TOKEN_MARKETS ?? env.AUTO_SELL_TOKEN_MARKETS,
    token,
    market,
  );
  env.EXIT_ENGINE_TOKEN_SPENDERS = appendAddressValue(
    env.EXIT_ENGINE_TOKEN_SPENDERS ?? env.AUTO_SELL_TOKEN_SPENDERS,
    token,
    spender,
  );
  if (input.allowancePreapproved) {
    env.EXIT_ENGINE_PREAPPROVED_ALLOWANCES = appendAddressPair(
      env.EXIT_ENGINE_PREAPPROVED_ALLOWANCES ?? env.AUTO_SELL_PREAPPROVED_ALLOWANCES,
      token,
      spender,
    );
  }

  return env;
}
