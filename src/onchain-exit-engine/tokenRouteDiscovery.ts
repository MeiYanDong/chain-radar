import {
  createPublicClient,
  http,
  isAddress,
  type Address,
} from 'viem';
import { base } from 'viem/chains';

import { buildDirectSellQuoteRead } from './directSellTransaction.js';
import type { TokenOnboardingReadClient } from './tokenOnboardingProbe.js';

export const BLOCKSCOUT_BASE_API = 'https://base.blockscout.com/api/v2';

export interface BlockscoutTokenTransferItem {
  transaction_hash?: string;
  method?: string | null;
  from?: {
    hash?: string;
    is_contract?: boolean;
    name?: string | null;
  } | null;
  to?: {
    hash?: string;
    is_contract?: boolean;
    name?: string | null;
  } | null;
  token?: {
    address_hash?: string;
    symbol?: string | null;
  } | null;
}

export interface BlockscoutTokenTransferResponse {
  items?: BlockscoutTokenTransferItem[];
  next_page_params?: Record<string, unknown> | null;
}

export interface RouteDiscoveryCandidate {
  address: Address;
  source: 'configured' | 'explicit' | 'token_transfer_contract';
  score: number;
  method?: string;
  name?: string;
  transferCount: number;
}

export interface QuotedRouteCandidate extends RouteDiscoveryCandidate {
  amountOutRaw: bigint;
}

export interface TokenRouteDiscoveryResult {
  tokenAddress: Address;
  candidates: RouteDiscoveryCandidate[];
  quotedCandidates: QuotedRouteCandidate[];
  selected?: QuotedRouteCandidate;
  errors: string[];
}

export interface TokenRouteDiscoveryInput {
  client: TokenOnboardingReadClient;
  tokenAddress: Address;
  quoteAmountRaw: bigint;
  configuredMarketAddress?: Address;
  explicitCandidateAddresses?: Address[];
  transferItems?: BlockscoutTokenTransferItem[];
  maxCandidates?: number;
}

export interface TokenRouteDiscoveryFastInput extends Omit<TokenRouteDiscoveryInput, 'client' | 'transferItems'> {
  rpcUrls: string[];
  readTimeoutMs: number;
  transferItems?: BlockscoutTokenTransferItem[];
  blockscoutApiBase?: string;
  maxTransferPages?: number;
  maxTransfers?: number;
  fetchImpl?: typeof fetch;
}

function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

function validAddress(value: string | undefined | null): value is Address {
  return Boolean(value && isAddress(value));
}

function shortError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.split('\n')[0].slice(0, 180);
}

function createReadClient(url: string, readTimeoutMs: number): TokenOnboardingReadClient {
  return createPublicClient({
    chain: base,
    transport: http(url, { retryCount: 0, timeout: readTimeoutMs }),
  }) as TokenOnboardingReadClient;
}

function addCandidate(
  candidates: Map<string, RouteDiscoveryCandidate>,
  address: Address,
  source: RouteDiscoveryCandidate['source'],
  score: number,
  method?: string | null,
  name?: string | null,
) {
  const key = normalizeAddress(address);
  const existing = candidates.get(key);
  if (existing) {
    existing.score = Math.max(existing.score, score);
    existing.transferCount += source === 'token_transfer_contract' ? 1 : 0;
    existing.method = existing.method ?? method ?? undefined;
    existing.name = existing.name ?? name ?? undefined;
    return;
  }
  candidates.set(key, {
    address: key as Address,
    source,
    score,
    method: method ?? undefined,
    name: name ?? undefined,
    transferCount: source === 'token_transfer_contract' ? 1 : 0,
  });
}

export function candidateRoutesFromTokenTransfers(input: {
  tokenAddress: Address;
  transferItems: BlockscoutTokenTransferItem[];
  configuredMarketAddress?: Address;
  explicitCandidateAddresses?: Address[];
  maxCandidates?: number;
}): RouteDiscoveryCandidate[] {
  const token = normalizeAddress(input.tokenAddress);
  const candidates = new Map<string, RouteDiscoveryCandidate>();
  if (input.configuredMarketAddress) addCandidate(candidates, input.configuredMarketAddress, 'configured', 100);
  for (const address of input.explicitCandidateAddresses ?? []) addCandidate(candidates, address, 'explicit', 95);

  for (const item of input.transferItems) {
    if (item.token?.address_hash && normalizeAddress(item.token.address_hash) !== token) continue;
    const sides = [item.from, item.to];
    for (const side of sides) {
      if (!side?.is_contract || !validAddress(side.hash)) continue;
      const address = normalizeAddress(side.hash);
      if (address === token) continue;
      const method = item.method ?? undefined;
      const methodPenalty = method && ['claim', 'airdrop', 'transfer'].includes(method.toLowerCase()) ? -20 : 0;
      addCandidate(candidates, side.hash as Address, 'token_transfer_contract', 50 + methodPenalty, method, side.name);
    }
  }

  return [...candidates.values()]
    .sort((a, b) => b.score - a.score || b.transferCount - a.transferCount || a.address.localeCompare(b.address))
    .slice(0, input.maxCandidates ?? 40);
}

export async function fetchBlockscoutTokenTransfers(input: {
  tokenAddress: Address;
  apiBase?: string;
  maxPages?: number;
  maxTransfers?: number;
  fetchImpl?: typeof fetch;
}): Promise<BlockscoutTokenTransferItem[]> {
  const fetcher = input.fetchImpl ?? fetch;
  const apiBase = input.apiBase ?? BLOCKSCOUT_BASE_API;
  const maxPages = Math.max(1, input.maxPages ?? 5);
  const maxTransfers = Math.max(1, input.maxTransfers ?? 250);
  let url = new URL(`${apiBase}/tokens/${input.tokenAddress}/transfers`);
  const items: BlockscoutTokenTransferItem[] = [];

  for (let page = 0; page < maxPages && items.length < maxTransfers; page += 1) {
    const res = await fetcher(url, {
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
      },
    });
    if (!res.ok) throw new Error(`Blockscout HTTP ${res.status}`);
    const json = await res.json() as BlockscoutTokenTransferResponse;
    items.push(...(json.items ?? []));
    if (!json.next_page_params) break;
    url = new URL(`${apiBase}/tokens/${input.tokenAddress}/transfers`);
    for (const [key, value] of Object.entries(json.next_page_params)) {
      if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
    }
  }

  return items.slice(0, maxTransfers);
}

export async function quoteRouteCandidate(input: {
  client: TokenOnboardingReadClient;
  candidate: RouteDiscoveryCandidate;
  tokenAddress: Address;
  quoteAmountRaw: bigint;
}): Promise<QuotedRouteCandidate | null> {
  try {
    const quoted = BigInt(await input.client.readContract({
      ...buildDirectSellQuoteRead({
        marketAddress: input.candidate.address,
        tokenAddress: input.tokenAddress,
        amountIn: input.quoteAmountRaw,
      }),
    }) as bigint);
    if (quoted <= 0n) return null;
    return { ...input.candidate, amountOutRaw: quoted };
  } catch {
    return null;
  }
}

export async function discoverDirectSellRoute(input: TokenRouteDiscoveryInput): Promise<TokenRouteDiscoveryResult> {
  const candidates = candidateRoutesFromTokenTransfers({
    tokenAddress: input.tokenAddress,
    transferItems: input.transferItems ?? [],
    configuredMarketAddress: input.configuredMarketAddress,
    explicitCandidateAddresses: input.explicitCandidateAddresses,
    maxCandidates: input.maxCandidates,
  });
  const quotedCandidates: QuotedRouteCandidate[] = [];
  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      const quoted = await quoteRouteCandidate({
        client: input.client,
        candidate,
        tokenAddress: input.tokenAddress,
        quoteAmountRaw: input.quoteAmountRaw,
      });
      if (quoted) quotedCandidates.push(quoted);
    } catch (err) {
      errors.push(`${candidate.address}: ${shortError(err)}`);
    }
  }

  quotedCandidates.sort((a, b) => b.score - a.score || b.transferCount - a.transferCount || (a.amountOutRaw > b.amountOutRaw ? -1 : 1));
  return {
    tokenAddress: input.tokenAddress,
    candidates,
    quotedCandidates,
    selected: quotedCandidates[0],
    errors,
  };
}

export async function discoverDirectSellRouteFast(input: TokenRouteDiscoveryFastInput): Promise<TokenRouteDiscoveryResult> {
  const urls = [...new Set(input.rpcUrls.map((url) => url.trim()).filter(Boolean))];
  if (urls.length === 0) throw new Error('route discovery requires at least one RPC URL');
  const transferItems = input.transferItems ?? await fetchBlockscoutTokenTransfers({
    tokenAddress: input.tokenAddress,
    apiBase: input.blockscoutApiBase,
    maxPages: input.maxTransferPages,
    maxTransfers: input.maxTransfers,
    fetchImpl: input.fetchImpl,
  });
  const clients = urls.map((url) => createReadClient(url, input.readTimeoutMs));
  const candidates = candidateRoutesFromTokenTransfers({
    tokenAddress: input.tokenAddress,
    transferItems,
    configuredMarketAddress: input.configuredMarketAddress,
    explicitCandidateAddresses: input.explicitCandidateAddresses,
    maxCandidates: input.maxCandidates,
  });
  const quotedCandidates: QuotedRouteCandidate[] = [];
  const quoteOne = async (candidate: RouteDiscoveryCandidate): Promise<QuotedRouteCandidate | null> => Promise.any(clients.map(async (client) => {
    const result = await quoteRouteCandidate({
      client,
      candidate,
      tokenAddress: input.tokenAddress,
      quoteAmountRaw: input.quoteAmountRaw,
    });
    if (!result) throw new Error('candidate quote failed');
    return result;
  })).catch(() => null);

  const concurrency = Math.max(1, Math.min(8, input.maxCandidates ?? 8));
  for (let index = 0; index < candidates.length; index += concurrency) {
    const batch = candidates.slice(index, index + concurrency);
    const quoted = await Promise.all(batch.map(quoteOne));
    quotedCandidates.push(...quoted.filter((item): item is QuotedRouteCandidate => Boolean(item)));
  }

  quotedCandidates.sort((a, b) => b.score - a.score || b.transferCount - a.transferCount || (a.amountOutRaw > b.amountOutRaw ? -1 : 1));
  return {
    tokenAddress: input.tokenAddress,
    candidates,
    quotedCandidates,
    selected: quotedCandidates[0],
    errors: [],
  };
}
