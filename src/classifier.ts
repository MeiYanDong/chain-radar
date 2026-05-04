import { decodeEventLog, parseAbiItem } from 'viem';
import { client, getBlockTimestamp, retryOnRateLimit } from './rpc.js';
import {
  FROUTER_V3,
  VIRTUAL_TOKEN,
  TAX_RATE,
  DECIMALS,
  getKnownContracts,
} from './config.js';
import type { TokenConfig } from './config.js';
import type { TransferEvent, ClassifiedTx } from './types.js';

const transferEventAbi = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)'
);

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const router = FROUTER_V3.toLowerCase();
const virtualToken = VIRTUAL_TOKEN.toLowerCase();

function toFloat(amount: bigint): number {
  return Number(amount) / 10 ** DECIMALS;
}

interface TxGroup {
  transfers: TransferEvent[];
  blockNumber: bigint;
}

export async function classifyTransactions(
  transfers: TransferEvent[],
  token: TokenConfig
): Promise<ClassifiedTx[]> {
  const pairPool = token.pairPool.toLowerCase();
  const knownContracts = getKnownContracts(token);

  const txGroups = new Map<string, TxGroup>();
  for (const evt of transfers) {
    const key = evt.txHash;
    if (!txGroups.has(key)) {
      txGroups.set(key, { transfers: [], blockNumber: evt.blockNumber });
    }
    txGroups.get(key)!.transfers.push(evt);
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
        return classifyTxGroup(txHash as `0x${string}`, group, pairPool, knownContracts);
      })
    );

    for (const txs of batchResults) {
      results.push(...txs);
    }

    processed += batch.length;
    process.stdout.write(
      `\r  [${token.symbol}] Classifying: ${processed}/${txHashes.length} transactions`
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
  group: TxGroup,
  pairPool: string,
  knownContracts: Set<string>
): Promise<ClassifiedTx[]> {
  const results: ClassifiedTx[] = [];
  const timestamp = await getBlockTimestamp(group.blockNumber);

  const hasPairInteraction = group.transfers.some(
    (t) => t.from === pairPool || t.to === pairPool
  );

  if (hasPairInteraction) {
    let virtualTransfers: TransferEvent[] = [];
    try {
      virtualTransfers = await getVirtualTransfersFromReceipt(txHash);
    } catch {
      // receipt fetch failed
    }

    for (const t of group.transfers) {
      if (t.from === ZERO_ADDRESS || t.to === ZERO_ADDRESS) continue;

      if (t.from === pairPool && !knownContracts.has(t.to)) {
        const taxTransfer = virtualTransfers.find(
          (v) => v.to === router && v.from === t.to
        );
        let virtualPaid = 0;
        if (taxTransfer) {
          virtualPaid = toFloat(taxTransfer.amount) / TAX_RATE;
        } else {
          const toPool = virtualTransfers.find(
            (v) => v.to === pairPool && v.from === t.to
          );
          if (toPool) virtualPaid = toFloat(toPool.amount) / (1 - TAX_RATE);
        }

        results.push({
          txHash, blockNumber: group.blockNumber, timestamp,
          type: 'BUY', user: t.to, counterparty: t.from,
          fatAmount: t.amount, virtualAmount: virtualPaid, usdAmount: 0,
        });
      } else if (t.to === pairPool && !knownContracts.has(t.from)) {
        const fromPool = virtualTransfers.find(
          (v) => v.from === pairPool && v.to === t.from
        );
        const virtualReceived = fromPool ? toFloat(fromPool.amount) : 0;

        results.push({
          txHash, blockNumber: group.blockNumber, timestamp,
          type: 'SELL', user: t.from, counterparty: t.to,
          fatAmount: t.amount, virtualAmount: virtualReceived, usdAmount: 0,
        });
      }
    }
  } else {
    for (const t of group.transfers) {
      if (t.from === ZERO_ADDRESS || t.to === ZERO_ADDRESS) continue;
      if (knownContracts.has(t.from) || knownContracts.has(t.to)) continue;

      results.push({
        txHash, blockNumber: group.blockNumber, timestamp,
        type: 'TRANSFER', user: t.to, counterparty: t.from,
        fatAmount: t.amount, virtualAmount: 0, usdAmount: 0,
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
        txHash, blockNumber: receipt.blockNumber,
        logIndex: log.logIndex, token: 'VIRTUAL',
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
