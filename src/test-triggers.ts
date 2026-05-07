import assert from 'node:assert/strict';
import { parseUnits } from 'viem';

import {
  createManualTxRecoveryTrigger,
  executionActionForTrigger,
  extractLargeBuyFallbackTriggers,
  extractOfficialBuybackTriggers,
  type ExitTransfer,
} from './onchain-exit-engine/triggers.js';

const txHash = '0xabc0000000000000000000000000000000000000000000000000000000000001';
const virtual = '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b';
const token = '0x39dbf1e2bce3509b51876d526489d1ec606b3a77';
const otherToken = '0x9999999999999999999999999999999999999999';
const executor = '0x9bda49389b29fa4e204ed9de8f3d7d06f84da171';
const buyer = '0x1111111111111111111111111111111111111111';
const market = '0x2222222222222222222222222222222222222222';
const spender = '0x3333333333333333333333333333333333333333';
const zero = '0x0000000000000000000000000000000000000000';
const tokenMeta = new Map([
  [token, { symbol: 'NOVA', decimals: 18 }],
  [otherToken, { symbol: 'ALT', decimals: 18 }],
]);

function transfer(
  tokenAddress: string,
  fromAddress: string,
  toAddress: string,
  amount: string,
  decimals = 18,
): ExitTransfer {
  return {
    tokenAddress,
    fromAddress,
    toAddress,
    amountRaw: parseUnits(amount, decimals),
  };
}

let official = extractOfficialBuybackTriggers({
  txHash,
  detectedAtMs: 1_777_300_000_000,
  virtualTokenAddress: virtual,
  officialExecutorAddress: executor,
  marketAddress: market,
  tokenMetaByAddress: tokenMeta,
  transfers: [
    transfer(virtual, executor, market, '3000.3193'),
    transfer(token, market, executor, '100000'),
    transfer(token, zero, executor, '999999'),
  ],
});
assert.equal(official.length, 1);
assert.equal(official[0].kind, 'official_buyback');
assert.equal(official[0].source, 'confirmed');
assert.equal(official[0].tokenAddress, token);
assert.equal(official[0].tokenSymbol, 'NOVA');
assert.equal(official[0].buyerAddress, executor);
assert.equal(official[0].marketAddress, market);
assert.equal(official[0].approvalSpenderAddress, market);
assert.equal(official[0].referenceSpendAmountRaw, parseUnits('3000.3193', 18));

official = extractOfficialBuybackTriggers({
  txHash,
  detectedAtMs: 1_777_300_000_000,
  virtualTokenAddress: virtual,
  officialExecutorAddress: executor,
  tokenMetaByAddress: tokenMeta,
  transfers: [
    transfer(virtual, buyer, market, '3000.3193'),
    transfer(token, market, executor, '100000'),
  ],
});
assert.equal(official.length, 0, 'official trigger requires executor to spend VIRTUAL');

const threshold = parseUnits('3000', 18);
let largeBuy = extractLargeBuyFallbackTriggers({
  txHash,
  detectedAtMs: 1_777_300_000_000,
  virtualTokenAddress: virtual,
  allowedTokenAddresses: [token],
  tokenMetaByAddress: tokenMeta,
  thresholdVirtualRaw: threshold,
  marketAddress: market,
  transfers: [
    transfer(virtual, buyer, market, '3000.3193'),
    transfer(token, market, buyer, '88888'),
  ],
});
assert.equal(largeBuy.length, 1);
assert.equal(largeBuy[0].kind, 'large_buy_fallback');
assert.equal(largeBuy[0].buyerAddress, buyer);
assert.equal(largeBuy[0].referenceSpendAmountRaw, parseUnits('3000.3193', 18));
assert.equal(largeBuy[0].thresholdVirtualRaw, threshold);

largeBuy = extractLargeBuyFallbackTriggers({
  txHash,
  detectedAtMs: 1_777_300_000_000,
  virtualTokenAddress: virtual,
  allowedTokenAddresses: [token],
  tokenMetaByAddress: tokenMeta,
  thresholdVirtualRaw: threshold,
  transfers: [
    transfer(virtual, buyer, market, '3000'),
    transfer(token, market, buyer, '88888'),
  ],
});
assert.equal(largeBuy.length, 0, 'large-buy threshold is strict >, not >=');

largeBuy = extractLargeBuyFallbackTriggers({
  txHash,
  detectedAtMs: 1_777_300_000_000,
  virtualTokenAddress: virtual,
  allowedTokenAddresses: [otherToken],
  tokenMetaByAddress: tokenMeta,
  thresholdVirtualRaw: threshold,
  transfers: [
    transfer(virtual, buyer, market, '3000.3193'),
    transfer(token, market, buyer, '88888'),
  ],
});
assert.equal(largeBuy.length, 0, 'large-buy fallback requires token allowlist match');

const manual = createManualTxRecoveryTrigger({
  txHash,
  detectedAtMs: 1_777_300_000_000,
  tokenAddress: token,
  tokenSymbol: 'nova',
  tokenDecimals: 18,
  tokenAmountRaw: parseUnits('12345', 18),
  marketAddress: market,
  approvalSpenderAddress: spender,
  referenceSpendTokenAddress: virtual,
  referenceSpendAmountRaw: parseUnits('3000.3193', 18),
});
assert.equal(manual.kind, 'manual_tx_recovery');
assert.equal(manual.source, 'manual');
assert.equal(manual.tokenSymbol, 'NOVA');
assert.equal(manual.approvalSpenderAddress, spender);

assert.equal(executionActionForTrigger({ source: 'confirmed' }), 'execute');
assert.equal(executionActionForTrigger({ source: 'manual' }), 'execute');
assert.equal(executionActionForTrigger({ source: 'pending' }), 'wait');
assert.equal(executionActionForTrigger({ source: 'pending' }, { pendingMode: 'dry_run' }), 'dry_run');
assert.equal(executionActionForTrigger({ source: 'pending' }, { pendingMode: 'execute' }), 'execute');

console.log('trigger tests passed');
