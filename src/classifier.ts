import { decodeEventLog, parseAbiItem } from 'viem';
import { client, getBlockTimestamp, retryOnRateLimit } from './rpc.js';
import {
  PAIR_POOL,
  FROUTER_V3,
  VIRTUAL_TOKEN,
  KNOWN_CONTRACTS,
  TAX_RATE,
  DECIMALS,
} from './config.js';
import type { TransferEvent, ClassifiedTx } from './types.js';

const transferEventAbi = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)'
);

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const pairPool = PAIR_POOL.toLowerCase();
const router = FROUTER_V3.toLowerCase();
const virtualToken = VIRTUAL_TOKEN.toLowerCase();

function toFloat(amount: bigint): number {
  return Number(amount) / 10 ** DECIMALS;
}

interface TxGroup {
  fatTransfers: TransferEvent[];
  blockNumber: bigint;
}

export async function classifyTransactions(
  fatTransfers: TransferEvent[]
): Promise<ClassifiedTx[]> {
  const txGroups = new Map<string, TxGroup>();
  for (const evt of fatTransfers) {
    const key = evt.txHash;
    if (!txGroups.has(key)) {
      txGroups.set(key, { fatTransfers: [], blockNumber: evt.blockNumber });
    }
    txGroups.get(key)!.fatTransfers.push(evt);
  }

  const results: ClassifiedTx[] = [];
  const txHashes = [...txGroups.keys()];
  const batchSize = 20;
  let processed = 0;

  for (let i = 0; i < txHashes.length; i += batchSize) {
    const batch = txHashes.slice(i, i + batchSize);

    const batchResults = await Promise.all(
      batch.map(async (txHash) => {
        const group = txGroups.get(txHash)!;
        return classifyTxGroup(txHash as `0x${string}`, group);
      })
    );

    for (const txs of batchResults) {
      results.push(...txs);
    }

    processed += batch.length;
    process.stdout.write(
      `\r  Classifying: ${processed}/${txHashes.length} transactions`
    );

    if (i + batchSize < txHashes.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log();
  results.sort((a, b) =>
    a.blockNumber !== b.blockNumber
      ? Number(a.blockNumber - b.blockNumber)
      : 0
  );
  return results;
}

async function classifyTxGroup(
  txHash: `0x${string}`,
  group: TxGroup
): Promise<ClassifiedTx[]> {
  const results: ClassifiedTx[] = [];
  const timestamp = await getBlockTimestamp(group.blockNumber);

  const hasPairInteraction = group.fatTransfers.some(
    (t) => t.from === pairPool || t.to === pairPool
  );

  if (hasPairInteraction) {
    let virtualTransfers: TransferEvent[] = [];
    try {
      virtualTransfers = await getVirtualTransfersFromReceipt(txHash);
    } catch {
      // receipt fetch failed, proceed without VIRTUAL data
    }

    for (const fat of group.fatTransfers) {
      if (fat.from === ZERO_ADDRESS || fat.to === ZERO_ADDRESS) continue;

      if (fat.from === pairPool && !KNOWN_CONTRACTS.has(fat.to)) {
        // BUY: FAT flows from pair pool to user
        const taxTransfer = virtualTransfers.find(
          (v) => v.to === router && v.from === fat.to
        );
        let virtualPaid = 0;
        if (taxTransfer) {
          virtualPaid = toFloat(taxTransfer.amount) / TAX_RATE;
        } else {
          const toPool = virtualTransfers.find(
            (v) => v.to === pairPool && v.from === fat.to
          );
          if (toPool) virtualPaid = toFloat(toPool.amount) / (1 - TAX_RATE);
        }

        results.push({
          txHash,
          blockNumber: group.blockNumber,
          timestamp,
          type: 'BUY',
          user: fat.to,
          counterparty: fat.from,
          fatAmount: fat.amount,
          virtualAmount: virtualPaid,
          usdAmount: 0,
        });
      } else if (fat.to === pairPool && !KNOWN_CONTRACTS.has(fat.from)) {
        // SELL: FAT flows from user to pair pool
        const fromPool = virtualTransfers.find(
          (v) => v.from === pairPool && v.to === fat.from
        );
        const virtualReceived = fromPool ? toFloat(fromPool.amount) : 0;

        results.push({
          txHash,
          blockNumber: group.blockNumber,
          timestamp,
          type: 'SELL',
          user: fat.from,
          counterparty: fat.to,
          fatAmount: fat.amount,
          virtualAmount: virtualReceived,
          usdAmount: 0,
        });
      }
    }
  } else {
    for (const fat of group.fatTransfers) {
      if (fat.from === ZERO_ADDRESS || fat.to === ZERO_ADDRESS) continue;
      if (KNOWN_CONTRACTS.has(fat.from) || KNOWN_CONTRACTS.has(fat.to)) continue;

      results.push({
        txHash,
        blockNumber: group.blockNumber,
        timestamp,
        type: 'TRANSFER',
        user: fat.to,
        counterparty: fat.from,
        fatAmount: fat.amount,
        virtualAmount: 0,
        usdAmount: 0,
      });
    }
  }

  return results;
}

async function getVirtualTransfersFromReceipt(
  txHash: `0x${string}`
): Promise<TransferEvent[]> {
  const receipt = await retryOnRateLimit(() =>
    client.getTransactionReceipt({ hash: txHash })
  );
  const results: TransferEvent[] = [];

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== virtualToken) continue;
    try {
      const { args } = decodeEventLog({
        abi: [transferEventAbi],
        data: log.data,
        topics: log.topics,
      });
      results.push({
        txHash,
        blockNumber: receipt.blockNumber,
        logIndex: log.logIndex,
        token: 'VIRTUAL',
        from: (args as any).from.toLowerCase() as `0x${string}`,
        to: (args as any).to.toLowerCase() as `0x${string}`,
        amount: (args as any).value,
      });
    } catch {
      // not a Transfer event
    }
  }

  return results;
}
