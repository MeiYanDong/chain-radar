import { TOKENS, DECIMALS } from './config.js';
import type { TokenConfig } from './config.js';
import { fetchTokenTransfers } from './events.js';
import { classifyTransactions } from './classifier.js';
import { fetchVirtualPriceHistory, interpolatePrice } from './price.js';
import { computeCostBasis } from './costBasis.js';
import { writeCsv } from './csv.js';
import { writeHoldersJson, writeTransactionsJson, writeSummaryJson } from './json.js';
import {
  getDb, getLastScannedBlock, setLastScannedBlock,
  saveTransactions, saveHolders, saveSummary,
} from './db.js';
import { getCurrentTokenPriceUsd } from './poolPrice.js';

async function processToken(token: TokenConfig) {
  console.log(`\n--- Processing ${token.name} ($${token.symbol}) ---\n`);

  const db = getDb();
  const lastBlock = getLastScannedBlock(token.id);
  const startBlock = lastBlock ? lastBlock + 1n : token.deployBlock;
  const isIncremental = lastBlock !== null;

  if (isIncremental) {
    console.log(`Incremental mode: resuming from block ${startBlock}\n`);
  }

  console.log('Step 1/6: Fetching Transfer events...');
  const transfers = await fetchTokenTransfers(token, startBlock);
  console.log(`  Found ${transfers.length} new transfers\n`);

  if (transfers.length > 0) {
    console.log('Step 2/6: Classifying transactions...');
    const classified = await classifyTransactions(transfers, token);
    const newBuys = classified.filter((t) => t.type === 'BUY').length;
    const newSells = classified.filter((t) => t.type === 'SELL').length;
    const newTransfers = classified.filter((t) => t.type === 'TRANSFER').length;
    console.log(`  ${newBuys} buys, ${newSells} sells, ${newTransfers} transfers\n`);

    console.log('Step 3/6: Fetching VIRTUAL/USD price history...');
    const firstTs = classified[0].timestamp;
    const lastTs = classified[classified.length - 1].timestamp;
    const priceHistory = await fetchVirtualPriceHistory(firstTs, lastTs + 3600);
    console.log(`  Got ${priceHistory.length} price points\n`);

    console.log('Step 4/6: Attaching USD prices...');
    for (const tx of classified) {
      if (tx.virtualAmount > 0) {
        tx.usdAmount = tx.virtualAmount * interpolatePrice(tx.timestamp, priceHistory);
      }
    }
    console.log('  Done\n');

    console.log('  Saving to database...');
    saveTransactions(classified, token.id);
    const maxBlock = transfers.reduce(
      (max, t) => (t.blockNumber > max ? t.blockNumber : max), 0n
    );
    setLastScannedBlock(token.id, maxBlock);
    console.log(`  Saved. Last scanned block: ${maxBlock}\n`);
  } else {
    console.log('  No new transfers. Using cached data.\n');
  }

  console.log('Step 5/6: Computing cost basis from all data...');
  const allTxRows = db
    .prepare('SELECT * FROM transactions WHERE token = ? ORDER BY block_number, rowid')
    .all(token.id) as any[];

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
  console.log(`  ${holders.size} addresses, ${activeHolders.length} active\n`);

  console.log('Step 6/6: Writing output...');
  const latestPrices = await fetchVirtualPriceHistory(
    Math.floor(Date.now() / 1000) - 3600,
    Math.floor(Date.now() / 1000)
  );
  const currentVirtualPrice = interpolatePrice(
    Math.floor(Date.now() / 1000), latestPrices
  );
  const currentTokenPrice = await getCurrentTokenPriceUsd(token.pairPool, currentVirtualPrice);
  console.log(`  ${token.symbol}=$${currentTokenPrice.toFixed(8)} VIRTUAL=$${currentVirtualPrice.toFixed(4)}`);

  const id = token.id.toLowerCase();
  const buys = allClassified.filter((t) => t.type === 'BUY').length;
  const sells = allClassified.filter((t) => t.type === 'SELL').length;
  const txfers = allClassified.filter((t) => t.type === 'TRANSFER').length;
  const summaryData = {
    totalHolders: holders.size,
    activeHolders: activeHolders.length,
    totalBuys: buys, totalSells: sells, totalTransfers: txfers,
    currentTokenPriceUsd: currentTokenPrice,
    currentVirtualPriceUsd: currentVirtualPrice,
  };

  saveHolders(holders, currentTokenPrice, token.id);
  saveSummary({ ...summaryData, analyzedAt: new Date().toISOString() }, token.id);
  writeCsv(holders, currentTokenPrice, `output/${id}_holders.csv`);
  writeHoldersJson(holders, currentTokenPrice, `output/${id}_holders.json`);
  writeTransactionsJson(allClassified, `output/${id}_transactions.json`);
  writeSummaryJson(summaryData, token, `output/${id}_summary.json`);

  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(`${token.id}_last_updated`, Date.now().toString());
}

async function main() {
  console.log('=== Chain Radar — Multi-Token Analyzer ===\n');
  for (const token of TOKENS) {
    await processToken(token);
  }
  console.log('\nAll tokens processed!');
}

main().catch(console.error);
