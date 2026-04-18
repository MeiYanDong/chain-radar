import { DECIMALS } from './config.js';
import type { ClassifiedTx, HolderPosition } from './types.js';

function toFloat(amount: bigint): number {
  return Number(amount) / 10 ** DECIMALS;
}

export function computeCostBasis(
  txs: ClassifiedTx[]
): Map<string, HolderPosition> {
  const holders = new Map<string, HolderPosition>();

  function getHolder(address: `0x${string}`): HolderPosition {
    if (!holders.has(address)) {
      holders.set(address, {
        address,
        balance: 0n,
        totalBought: 0n,
        totalSold: 0n,
        totalCostVirtual: 0,
        totalCostUsd: 0,
        realizedPnl: 0,
        lastTxTimestamp: 0,
      });
    }
    return holders.get(address)!;
  }

  for (const tx of txs) {
    if (tx.type === 'BUY') {
      const h = getHolder(tx.user);
      h.balance += tx.fatAmount;
      h.totalBought += tx.fatAmount;
      h.totalCostVirtual += tx.virtualAmount;
      h.totalCostUsd += tx.usdAmount;
      h.lastTxTimestamp = tx.timestamp;
    } else if (tx.type === 'SELL') {
      const h = getHolder(tx.user);
      if (h.balance > 0n) {
        const proportion =
          toFloat(tx.fatAmount) / toFloat(h.balance);
        const capped = Math.min(proportion, 1);
        const costOfSold = h.totalCostUsd * capped;
        h.realizedPnl += tx.usdAmount - costOfSold;
        h.totalCostVirtual -= h.totalCostVirtual * capped;
        h.totalCostUsd -= h.totalCostUsd * capped;
      }
      h.balance -= tx.fatAmount;
      h.totalSold += tx.fatAmount;
      if (h.balance < 0n) h.balance = 0n;
      h.lastTxTimestamp = tx.timestamp;
    } else if (tx.type === 'TRANSFER') {
      const sender = getHolder(tx.counterparty);
      const receiver = getHolder(tx.user);

      let transferCostVirtual = 0;
      let transferCostUsd = 0;

      if (sender.balance > 0n) {
        const senderAvgVirtual =
          sender.totalCostVirtual / toFloat(sender.balance);
        const senderAvgUsd = sender.totalCostUsd / toFloat(sender.balance);
        const amount = toFloat(tx.fatAmount);
        transferCostVirtual = senderAvgVirtual * amount;
        transferCostUsd = senderAvgUsd * amount;

        sender.totalCostVirtual -= transferCostVirtual;
        sender.totalCostUsd -= transferCostUsd;
      }

      sender.balance -= tx.fatAmount;
      if (sender.balance < 0n) sender.balance = 0n;

      receiver.balance += tx.fatAmount;
      receiver.totalCostVirtual += transferCostVirtual;
      receiver.totalCostUsd += transferCostUsd;
      sender.lastTxTimestamp = tx.timestamp;
      receiver.lastTxTimestamp = tx.timestamp;
    }
  }

  return holders;
}
