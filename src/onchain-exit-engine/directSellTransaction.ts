import { encodeFunctionData, parseAbi, type Address, type Hex } from 'viem';

export const DIRECT_SELL_ZERO_ASSET_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
export const DIRECT_SELL_DEFAULT_MARKET_ADDRESS = '0x1A540088125d00dD3990f9dA45CA0859af4d3B01' as const;

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
  tokenAddress: Address;
  amountIn: bigint;
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
    address: input.marketAddress,
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
