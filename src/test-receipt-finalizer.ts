import assert from 'node:assert/strict';

import { finalizeSellReceipt } from './onchain-exit-engine/receiptFinalizer.js';

let finalization = finalizeSellReceipt({ receiptStatus: 'success' });
assert.equal(finalization.action, 'confirm');
assert.equal(finalization.state, 'confirmed');
assert.equal(finalization.success, true);
assert.equal(finalization.shouldAlert, false);
assert.deepEqual(finalization.legacyDbUpdate, { receiptStatus: 'success' });

finalization = finalizeSellReceipt({ receiptStatus: 'reverted' });
assert.equal(finalization.action, 'fail');
assert.equal(finalization.state, 'reverted');
assert.equal(finalization.success, false);
assert.equal(finalization.shouldAlert, true);
assert.deepEqual(finalization.legacyDbUpdate, {
  receiptStatus: 'reverted',
  update: {
    status: 'failed',
    error: 'sell receipt status=reverted',
  },
});

finalization = finalizeSellReceipt({ receiptStatus: 'timeout' });
assert.equal(finalization.action, 'fail');
assert.equal(finalization.state, 'timeout');
assert.equal(finalization.shouldAlert, true);
assert.equal(finalization.legacyDbUpdate.update?.status, 'failed');

finalization = finalizeSellReceipt({ receiptStatus: 'mystery' });
assert.equal(finalization.action, 'fail');
assert.equal(finalization.state, 'manual_recovery_needed');
assert.equal(finalization.receiptStatusForDb, 'mystery');
assert.equal(finalization.legacyDbUpdate.update?.status, 'failed');

finalization = finalizeSellReceipt({ checkError: 'rpc timeout' });
assert.equal(finalization.action, 'manual_recovery');
assert.equal(finalization.state, 'manual_recovery_needed');
assert.equal(finalization.receiptStatusForDb, 'unknown');
assert.equal(finalization.shouldAlert, false);
assert.deepEqual(finalization.legacyDbUpdate, {
  receiptStatus: 'unknown',
  update: {
    error: 'receipt check failed: rpc timeout',
  },
});

console.log('receipt finalizer tests passed');
