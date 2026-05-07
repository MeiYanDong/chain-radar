import { encodeFunctionData, parseAbi, type Address, type Hex } from 'viem';

export const DIRECT_SELL_ZERO_ASSET_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
export const DIRECT_SELL_DEFAULT_MARKET_ADDRESS = '0x1A540088125d00dD3990f9dA45CA0859af4d3B01' as const;
export const DIRECT_SELL_DEFAULT_QUOTE_ADDRESS = '0x02FE8eC3d9BBf7318eb54590bcC39198a8b47deD' as const;
export const DIRECT_SELL_DEFAULT_APPROVAL_SPENDER_ADDRESS = DIRECT_SELL_DEFAULT_QUOTE_ADDRESS;

export const DIRECT_SELL_ABI = parseAbi([
  'function sell(uint256 amountIn,address tokenAddress,uint256 amountOutMin,uint256 deadline) returns (bool)',
  'function getAmountsOut(address tokenAddress,address assetToken,uint256 amountIn) view returns (uint256)',
]);

export interface DirectSellCallInput {
  marketAddress: Address;
  tokenAddress: Address;
  amountIn: bigint;
  amountOutMin: bigint;
  deadline: bigint;
}

export interface DirectSellQuoteInput {
  marketAddress: Address;
  quoteAddress?: Address;
  tokenAddress: Address;
  amountIn: bigint;
}

function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

export function isDefaultDirectSellMarketAddress(marketAddress: string): boolean {
  return normalizeAddress(marketAddress) === normalizeAddress(DIRECT_SELL_DEFAULT_MARKET_ADDRESS);
}

export function defaultDirectSellQuoteAddress(marketAddress: string): Address {
  return isDefaultDirectSellMarketAddress(marketAddress)
    ? DIRECT_SELL_DEFAULT_QUOTE_ADDRESS
    : marketAddress as Address;
}

export function defaultDirectSellApprovalSpenderAddress(marketAddress: string): Address {
  return isDefaultDirectSellMarketAddress(marketAddress)
    ? DIRECT_SELL_DEFAULT_APPROVAL_SPENDER_ADDRESS
    : marketAddress as Address;
}

export function resolveDirectSellQuoteAddress(input: Pick<DirectSellQuoteInput, 'marketAddress' | 'quoteAddress'>): Address {
  return input.quoteAddress ?? defaultDirectSellQuoteAddress(input.marketAddress);
}

export function directSellArgs(input: DirectSellCallInput): readonly [bigint, Address, bigint, bigint] {
  return [input.amountIn, input.tokenAddress, input.amountOutMin, input.deadline] as const;
}

export function directSellQuoteArgs(input: DirectSellQuoteInput): readonly [Address, typeof DIRECT_SELL_ZERO_ASSET_ADDRESS, bigint] {
  return [input.tokenAddress, DIRECT_SELL_ZERO_ASSET_ADDRESS, input.amountIn] as const;
}

export function buildDirectSellWriteContract(input: DirectSellCallInput) {
  return {
    address: input.marketAddress,
    abi: DIRECT_SELL_ABI,
    functionName: 'sell',
    args: directSellArgs(input),
  } as const;
}

export function buildDirectSellQuoteRead(input: DirectSellQuoteInput) {
  return {
    address: resolveDirectSellQuoteAddress(input),
    abi: DIRECT_SELL_ABI,
    functionName: 'getAmountsOut',
    args: directSellQuoteArgs(input),
  } as const;
}

export function buildDirectSellCalldata(input: DirectSellCallInput): Hex {
  return encodeFunctionData({
    abi: DIRECT_SELL_ABI,
    functionName: 'sell',
    args: directSellArgs(input),
  });
}
