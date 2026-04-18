import { parseAbiItem, decodeEventLog } from 'viem';
import { client } from './rpc.js';
import { FAT_TOKEN, DECIMALS } from './config.js';
import { fetchAllFatTransfers } from './events.js';
import { classifyTransactions } from './classifier.js';
import { fetchVirtualPriceHistory, interpolatePrice } from './price.js';
import { computeCostBasis } from './costBasis.js';
import { getCurrentFatPriceUsd } from './poolPrice.js';
import { writeHoldersJson, writeTransactionsJson, writeSummaryJson } from './json.js';
import {
  getDb, getLastScannedBlock, setLastScannedBlock,
  saveTransactions, saveHolders, saveSummary,
} from './db.js';
import type { TransferEvent } from './types.js';

const transferEventAbi = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)'
);

let currentVirtualPriceUsd = 0;

async function refreshVirtualPrice() {
  try {
    const now = Math.floor(Date.now() / 1000);
    const history = await fetchVirtualPriceHistory(now - 3600, now);
    currentVirtualPriceUsd = interpolatePrice(now, history);
    console.log(`  VIRTUAL/USD: $${currentVirtualPriceUsd.toFixed(4)}`);
  } catch (err) {
    console.error('  Failed to refresh VIRTUAL price:', err);
  }
}

async function refreshAllData() {
  const db = getDb();
  if (currentVirtualPriceUsd <= 0) return;

  const allTxRows = db
    .prepare('SELECT * FROM transactions ORDER BY block_number, rowid')
    .all() as any[];

  if (allTxRows.length === 0) return;

  const allClassified = allTxRows.map((row: any) => ({
    txHash: row.tx_hash as `0x${string}`,
    blockNumber: BigInt(row.block_number),
    timestamp: row.timestamp,
    type: row.type as 'BUY' | 'SELL' | 'TRANSFER',
    user: row.user_addr as `0x${string}`,
    counterparty: row.counterparty as `0x${string}`,
    fatAmount: BigInt(Math.round(row.fat_amount * 10 ** DECIMALS)),
    virtualAmount: row.virtual_amount,
    usdAmount: row.usd_amount,
  }));

  const holders = computeCostBasis(allClassified);
  const activeHolders = [...holders.values()].filter((h) => h.balance > 0n);

  const fatPrice = await getCurrentFatPriceUsd(currentVirtualPriceUsd);

  const buys = allClassified.filter((t) => t.type === 'BUY').length;
  const sells = allClassified.filter((t) => t.type === 'SELL').length;
  const txfers = allClassified.filter((t) => t.type === 'TRANSFER').length;

  const summaryData = {
    totalHolders: holders.size, activeHolders: activeHolders.length,
    totalBuys: buys, totalSells: sells, totalTransfers: txfers,
    currentFatPriceUsd: fatPrice, currentVirtualPriceUsd: currentVirtualPriceUsd,
  };

  saveHolders(holders, fatPrice);
  saveSummary({ ...summaryData, analyzedAt: new Date().toISOString() });
  writeHoldersJson(holders, fatPrice, 'output/fat_holders.json');
  writeTransactionsJson(allClassified, 'output/fat_transactions.json');
  writeSummaryJson(summaryData, 'output/fat_summary.json');

  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('last_updated', Date.now().toString());

  return { activeHolders: activeHolders.length, fatPrice };
}

async function processNewTransfers(transfers: TransferEvent[]) {
  if (transfers.length === 0) return;

  console.log(`\n[${new Date().toLocaleTimeString()}] ${transfers.length} new transfer(s) detected`);

  const classified = await classifyTransactions(transfers);
  if (classified.length === 0) return;

  for (const tx of classified) {
    if (tx.virtualAmount > 0 && currentVirtualPriceUsd > 0) {
      tx.usdAmount = tx.virtualAmount * currentVirtualPriceUsd;
    }
  }

  saveTransactions(classified);
  const maxBlock = transfers.reduce(
    (max, t) => (t.blockNumber > max ? t.blockNumber : max), 0n
  );
  setLastScannedBlock(maxBlock);

  const result = await refreshAllData();
  if (result) {
    console.log(`  Processed: ${classified.length} txs | ${result.activeHolders} active holders | FAT=$${result.fatPrice.toFixed(8)}`);
  }
}

// --- MAIN ---

async function main() {
  console.log('=== FAT Token Watcher ===\n');

  getDb();
  const lastBlock = getLastScannedBlock();
  console.log(`Last scanned block: ${lastBlock ?? 'none'}`);

  console.log('Fetching initial VIRTUAL/USD price...');
  await refreshVirtualPrice();

  // Catch up: fetch any transfers since last scanned block
  if (lastBlock) {
    const currentBlock = await client.getBlockNumber();
    const gap = currentBlock - lastBlock;
    if (gap > 0n) {
      console.log(`\nCatching up: ${gap} blocks behind (${lastBlock + 1n} → ${currentBlock})`);
      const missedTransfers = await fetchAllFatTransfers(lastBlock + 1n);
      if (missedTransfers.length > 0) {
        console.log(`  Found ${missedTransfers.length} missed transfers, processing...`);
        await processNewTransfers(missedTransfers);
      } else {
        console.log('  No missed transfers');
      }
    }
  }

  console.log('\nInitial data refresh...');
  const init = await refreshAllData();
  if (init) {
    console.log(`  ${init.activeHolders} active holders | FAT=$${init.fatPrice.toFixed(8)}`);
  }

  setInterval(async () => {
    await refreshVirtualPrice();
    try {
      const r = await refreshAllData();
      if (r) console.log(`[${new Date().toLocaleTimeString()}] Price refresh | FAT=$${r.fatPrice.toFixed(8)}`);
    } catch (err) {
      console.error('Price refresh error:', err);
    }
  }, 60_000);

  console.log('Watching for new FAT Transfer events...\n');

  let lastPolledBlock = await client.getBlockNumber();

  setInterval(async () => {
    try {
      const currentBlock = await client.getBlockNumber();
      if (currentBlock <= lastPolledBlock) return;

      const logs = await client.getLogs({
        address: FAT_TOKEN,
        event: transferEventAbi,
        fromBlock: lastPolledBlock + 1n,
        toBlock: currentBlock,
      });

      lastPolledBlock = currentBlock;

      if (logs.length === 0) return;

      const transfers: TransferEvent[] = logs.map((log) => {
        const { args } = decodeEventLog({
          abi: [transferEventAbi],
          data: log.data,
          topics: log.topics,
        });
        return {
          txHash: log.transactionHash!,
          blockNumber: log.blockNumber!,
          logIndex: log.logIndex!,
          token: 'FAT' as const,
          from: (args as any).from.toLowerCase() as `0x${string}`,
          to: (args as any).to.toLowerCase() as `0x${string}`,
          amount: (args as any).value,
        };
      });

      await processNewTransfers(transfers);
    } catch (err: any) {
      console.error('Poll error:', err.message);
    }
  }, 4_000);
}

main().catch(console.error);
