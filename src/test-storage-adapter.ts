import assert from 'node:assert/strict';

import {
  applyLegacyReceiptFinalization,
  createLegacyAutoSellExecutionStorage,
  type LegacyAutoSellReceiptUpdateInput,
} from './onchain-exit-engine/storageAdapter.js';
import type { LegacyAutoSellExecutionAuditRecord } from './onchain-exit-engine/auditAdapter.js';

const saved: { record: LegacyAutoSellExecutionAuditRecord; nowMs?: number }[] = [];
const receiptUpdates: LegacyAutoSellReceiptUpdateInput[] = [];

const storage = createLegacyAutoSellExecutionStorage({
  saveAutoSellExecution(record, nowMs) {
    saved.push({ record, nowMs });
  },
  updateAutoSellExecutionReceipt(triggerTxHash, tokenAddress, receiptStatus, update, nowMs) {
    receiptUpdates.push({ triggerTxHash, tokenAddress, receiptStatus, update, nowMs });
    return 1;
  },
});

const record: LegacyAutoSellExecutionAuditRecord = {
  trigger_tx_hash: '0xtrigger',
  token_address: '0xtoken',
  token_symbol: 'NOVA',
  buyback_timestamp: 1_777_300_000,
  status: 'sent',
  sell_tx_hash: '0xsell',
};

storage.saveExecution(record, 1_777_300_001_000);
assert.equal(saved.length, 1);
assert.equal(saved[0].record, record);
assert.equal(saved[0].nowMs, 1_777_300_001_000);

const changed = applyLegacyReceiptFinalization(
  storage,
  '0xtrigger',
  '0xtoken',
  {
    receiptStatus: 'reverted',
    update: {
      status: 'failed',
      error: 'sell receipt status=reverted',
    },
  },
  1_777_300_002_000,
);

assert.equal(changed, 1);
assert.deepEqual(receiptUpdates, [
  {
    triggerTxHash: '0xtrigger',
    tokenAddress: '0xtoken',
    receiptStatus: 'reverted',
    update: {
      status: 'failed',
      error: 'sell receipt status=reverted',
    },
    nowMs: 1_777_300_002_000,
  },
]);

console.log('storage adapter tests passed');
