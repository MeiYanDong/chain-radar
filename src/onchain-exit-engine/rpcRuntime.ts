import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  maxUint256,
  type Address,
  type Hash,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

import { buildDirectSellCalldata, buildDirectSellWriteContract, type DirectSellCallInput } from './directSellTransaction.js';

export const BASE_DIRECT_SELL_FLASHBLOCKS_RPC = 'https://mainnet-preconf.base.org';
export const DEFAULT_DIRECT_SELL_RPC_URL = 'https://mainnet.base.org';

export type DirectSellRuntimeAccount = ReturnType<typeof privateKeyToAccount>;

export interface DirectSellRpcBundle {
  url: string;
  publicClient: any;
  walletClient: any;
}

export interface DirectSellRpcRuntimeOptions {
  readTimeoutMs: number;
  writeTimeoutMs: number;
}

export interface DirectSellGasOptions {
  gas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}

export interface RequiredDirectSellGasOptions {
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export interface DirectSellBroadcastOptions extends DirectSellRpcRuntimeOptions {
  protectedRpcUrls: string[];
  flashblocksEnabled: boolean;
  flashblocksRpcUrls: string[];
  publicBroadcastEnabled: boolean;
  flashblocksRpcUrl?: string;
}

function splitCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function resolveDirectSellRpcUrls(input: {
  primaryRpcUrl?: string;
  fallbackRpcUrls?: string;
  defaultRpcUrl?: string;
}): string[] {
  return unique([
    input.primaryRpcUrl || input.defaultRpcUrl || DEFAULT_DIRECT_SELL_RPC_URL,
    ...splitCsv(input.fallbackRpcUrls),
  ]);
}

export function directSellRpcCacheKey(accountAddress: string, urls: string[]): string {
  return `${accountAddress}:${urls.join('|')}`;
}

export function createDirectSellRpcBundle(
  account: DirectSellRuntimeAccount,
  url: string,
  options: DirectSellRpcRuntimeOptions,
): DirectSellRpcBundle {
  return {
    url,
    publicClient: createPublicClient({
      chain: base,
      transport: http(url, { retryCount: 0, timeout: options.readTimeoutMs }),
    }),
    walletClient: createWalletClient({
      account,
      chain: base,
      transport: http(url, { retryCount: 0, timeout: options.writeTimeoutMs }),
    }),
  };
}

export async function readFast<T = any>(
  bundles: DirectSellRpcBundle[],
  read: (client: DirectSellRpcBundle['publicClient']) => Promise<T> | T,
): Promise<T> {
  if (bundles.length === 1) return read(bundles[0].publicClient);
  return Promise.any(bundles.map((bundle) => read(bundle.publicClient)));
}

export function resolveDirectSellBroadcastUrls(
  publicRpcUrls: string[],
  options: Omit<DirectSellBroadcastOptions, keyof DirectSellRpcRuntimeOptions>,
): string[] {
  return unique([
    ...options.protectedRpcUrls,
    ...(options.flashblocksEnabled
      ? [options.flashblocksRpcUrl || BASE_DIRECT_SELL_FLASHBLOCKS_RPC, ...options.flashblocksRpcUrls]
      : []),
    ...(options.publicBroadcastEnabled ? publicRpcUrls : []),
  ]);
}

export function buildDirectSellBroadcastBundles(
  account: DirectSellRuntimeAccount,
  publicBundles: DirectSellRpcBundle[],
  options: DirectSellBroadcastOptions,
): DirectSellRpcBundle[] {
  const publicByUrl = new Map(publicBundles.map((bundle) => [bundle.url, bundle]));
  return resolveDirectSellBroadcastUrls(publicBundles.map((bundle) => bundle.url), options)
    .map((url) => publicByUrl.get(url) ?? createDirectSellRpcBundle(account, url, options));
}

export async function submitDirectSellPrimaryRpc(
  primary: DirectSellRpcBundle,
  input: DirectSellCallInput,
  gasOptions: DirectSellGasOptions,
): Promise<Hash> {
  return primary.walletClient.writeContract({
    ...buildDirectSellWriteContract(input),
    ...gasOptions,
  });
}

export async function submitErc20ApproveRpc(
  primary: DirectSellRpcBundle,
  input: {
    tokenAddress: Address;
    spenderAddress: Address;
    amount?: bigint;
  },
): Promise<Hash> {
  return primary.walletClient.writeContract({
    address: input.tokenAddress,
    abi: erc20Abi,
    functionName: 'approve',
    args: [input.spenderAddress, input.amount ?? maxUint256],
  });
}

export async function submitDirectSellMultiRpcRaw(input: {
  account: DirectSellRuntimeAccount;
  submitBundles: DirectSellRpcBundle[];
  sellInput: DirectSellCallInput;
  gasOptions: RequiredDirectSellGasOptions;
  nonce: number;
}): Promise<{ sellTxHash: Hash; nonce: number }> {
  if (input.submitBundles.length === 0) throw new Error('multi-rpc submit requires at least 1 broadcast endpoint');
  const signed = await input.account.signTransaction({
    chainId: base.id,
    type: 'eip1559',
    to: input.sellInput.marketAddress,
    data: buildDirectSellCalldata(input.sellInput),
    value: 0n,
    nonce: input.nonce,
    gas: input.gasOptions.gas,
    maxFeePerGas: input.gasOptions.maxFeePerGas,
    maxPriorityFeePerGas: input.gasOptions.maxPriorityFeePerGas,
  });
  return {
    sellTxHash: await Promise.any(input.submitBundles.map((bundle) => (
      bundle.publicClient.sendRawTransaction({ serializedTransaction: signed })
    ))),
    nonce: input.nonce,
  };
}
