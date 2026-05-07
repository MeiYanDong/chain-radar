import assert from 'node:assert/strict';

import { buildLegacyAutoSellExecutionRecord } from './onchain-exit-engine/auditAdapter.js';

const event = {
  tx_hash: '0xtrigger000000000000000000000000000000000000000000000000000000000001',
  token_address: '0x39dbf1e2bce3509b51876d526489d1ec606b3a77',
  token_symbol: 'NOVA',
  timestamp: 1_777_300_000,
  detected_at_ms: 1_777_300_000_500,
  market_address: '0x1111111111111111111111111111111111111111',
  approval_spender_address: '0x2222222222222222222222222222222222222222',
};

let record = buildLegacyAutoSellExecutionRecord(event, {
  status: 'sent',
  wallet: '0x3333333333333333333333333333333333333333',
  marketAddress: '0x4444444444444444444444444444444444444444',
  approvalSpenderAddress: '0x5555555555555555555555555555555555555555',
  tokenAmount: '1000',
  amountOutMin: '900',
  approveTxHash: '0xapprove',
  sellTxHash: '0xsell',
  detectedToSubmitMs: 123,
});
assert.equal(record.trigger_tx_hash, event.tx_hash);
assert.equal(record.token_address, event.token_address);
assert.equal(record.token_symbol, event.token_symbol);
assert.equal(record.buyback_timestamp, event.timestamp);
assert.equal(record.detected_at_ms, event.detected_at_ms);
assert.equal(record.status, 'sent');
assert.equal(record.wallet_address, '0x3333333333333333333333333333333333333333');
assert.equal(record.market_address, '0x4444444444444444444444444444444444444444');
assert.equal(record.approval_spender_address, '0x5555555555555555555555555555555555555555');
assert.equal(record.token_amount, '1000');
assert.equal(record.amount_out_min, '900');
assert.equal(record.approve_tx_hash, '0xapprove');
assert.equal(record.sell_tx_hash, '0xsell');
assert.equal(record.detected_to_submit_ms, 123);
assert.equal(record.sell_receipt_status, null);

record = buildLegacyAutoSellExecutionRecord(event, {
  status: 'failed',
  error: 'allowance too low',
});
assert.equal(record.market_address, event.market_address);
assert.equal(record.approval_spender_address, event.approval_spender_address);
assert.equal(record.wallet_address, null);
assert.equal(record.token_amount, null);
assert.equal(record.error, 'allowance too low');

console.log('audit adapter tests passed');
