import { writeFileSync, mkdirSync } from 'fs';
import { DECIMALS } from './config.js';
import type { TokenConfig } from './config.js';
import type { ClassifiedTx, HolderPosition } from './types.js';

function toFloat(amount: bigint): number {
  return Number(amount) / 10 ** DECIMALS;
}

export interface SummaryStats {
  totalHolders: number;
  activeHolders: number;
  totalBuys: number;
  totalSells: number;
  totalTransfers: number;
  currentTokenPriceUsd: number;
  currentVirtualPriceUsd: number;
}

export function writeHoldersJson(
  holders: Map<string, HolderPosition>,
  currentTokenPriceUsd: number,
  outputPath: string
): void {
  mkdirSync('output', { recursive: true });

  const sorted = [...holders.values()]
    .filter((h) => h.balance > 0n)
    .sort((a, b) => (a.balance > b.balance ? -1 : a.balance < b.balance ? 1 : 0));

  const data = sorted.map((h, i) => {
    const balance = toFloat(h.balance);
    const currentValue = balance * currentTokenPriceUsd;
    const avgCostPerToken = balance > 0 ? h.totalCostUsd / balance : 0;
    return {
      rank: i + 1,
      address: h.address,
      balance,
      totalBought: toFloat(h.totalBought),
      totalSold: toFloat(h.totalSold),
      totalCostVirtual: h.totalCostVirtual,
      totalCostUsd: h.totalCostUsd,
      avgCostUsd: avgCostPerToken,
      currentValueUsd: currentValue,
      unrealizedPnl: currentValue - h.totalCostUsd,
      realizedPnl: h.realizedPnl,
      buyMarketCap: avgCostPerToken * 1_000_000_000,
      lastTxTimestamp: h.lastTxTimestamp,
    };
  });

  writeFileSync(outputPath, JSON.stringify(data, null, 2));
  console.log(`  JSON written to ${outputPath} (${data.length} holders)`);
}

export function writeTransactionsJson(
  txs: ClassifiedTx[],
  outputPath: string
): void {
  const data = txs.map((tx) => ({
    txHash: tx.txHash,
    blockNumber: Number(tx.blockNumber),
    timestamp: tx.timestamp,
    type: tx.type,
    user: tx.user,
    counterparty: tx.counterparty,
    fatAmount: toFloat(tx.fatAmount),
    virtualAmount: tx.virtualAmount,
    usdAmount: tx.usdAmount,
  }));

  writeFileSync(outputPath, JSON.stringify(data, null, 2));
  console.log(`  JSON written to ${outputPath} (${data.length} transactions)`);
}

export function writeSummaryJson(
  stats: SummaryStats,
  token: TokenConfig,
  outputPath: string
): void {
  const data = {
    tokenName: token.symbol,
    tokenAddress: token.tokenAddress,
    chain: 'Base',
    ...stats,
    analyzedAt: new Date().toISOString(),
  };

  writeFileSync(outputPath, JSON.stringify(data, null, 2));
  console.log(`  Summary written to ${outputPath}`);
}
