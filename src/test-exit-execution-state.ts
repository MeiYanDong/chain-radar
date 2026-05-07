import assert from 'node:assert/strict';

import {
  EXIT_EXECUTION_STATES,
  describeExitExecutionState,
  exitStateFromLegacyAutoSell,
  isFailureExitState,
  isFinalExitState,
  isSuccessfulExitState,
  normalizeReceiptStatus,
  shouldMonitorLegacyAutoSellReceipt,
  type LegacyAutoSellStatus,
} from './onchain-exit-engine/executionState.js';

const submittedHash = '0xsell00000000000000000000000000000000000000000000000000000000000001';

const explicitCases: Array<{
  name: string;
  input: Parameters<typeof exitStateFromLegacyAutoSell>[0];
  expected: ReturnType<typeof exitStateFromLegacyAutoSell>;
}> = [
  { name: 'empty state is not started', input: {}, expected: 'not_started' },
  { name: 'disabled remains disabled', input: { status: 'disabled' }, expected: 'disabled' },
  { name: 'missing key blocks execution', input: { status: 'missing-key' }, expected: 'blocked' },
  { name: 'invalid key blocks execution', input: { status: 'invalid-key' }, expected: 'blocked' },
  { name: 'no balance blocks execution', input: { status: 'no-balance' }, expected: 'blocked' },
  { name: 'dry run is explicit', input: { status: 'dry-run' }, expected: 'dry_run' },
  { name: 'sent with hash is submitted, not success', input: { status: 'sent', sellTxHash: submittedHash }, expected: 'submitted' },
  { name: 'sent without hash needs recovery', input: { status: 'sent' }, expected: 'manual_recovery_needed' },
  { name: 'failed remains failed', input: { status: 'failed' }, expected: 'failed' },
  { name: 'skipped remains skipped', input: { status: 'skipped' }, expected: 'skipped' },
  {
    name: 'receipt success overrides legacy failed state',
    input: { status: 'failed', receiptStatus: 'success', sellTxHash: submittedHash },
    expected: 'confirmed',
  },
  {
    name: 'receipt success is the only final success path',
    input: { status: 'sent', receiptStatus: 'success', sellTxHash: submittedHash },
    expected: 'confirmed',
  },
  {
    name: 'receipt reverted overrides submitted state',
    input: { status: 'sent', receiptStatus: 'reverted', sellTxHash: submittedHash },
    expected: 'reverted',
  },
  {
    name: 'receipt timeout is not success',
    input: { status: 'sent', receiptStatus: 'timeout', sellTxHash: submittedHash },
    expected: 'timeout',
  },
  {
    name: 'unknown receipt needs manual recovery',
    input: { status: 'sent', receiptStatus: 'unknown', sellTxHash: submittedHash },
    expected: 'manual_recovery_needed',
  },
  {
    name: 'unrecognized receipt status needs manual recovery',
    input: { status: 'sent', receiptStatus: 'mystery', sellTxHash: submittedHash },
    expected: 'manual_recovery_needed',
  },
];

for (const testCase of explicitCases) {
  assert.equal(exitStateFromLegacyAutoSell(testCase.input), testCase.expected, testCase.name);
}

assert.equal(normalizeReceiptStatus(undefined), 'none');
assert.equal(normalizeReceiptStatus(null), 'none');
assert.equal(normalizeReceiptStatus(''), 'none');
assert.equal(normalizeReceiptStatus('success'), 'success');
assert.equal(normalizeReceiptStatus('revert'), 'reverted');
assert.equal(normalizeReceiptStatus('failed'), 'reverted');
assert.equal(normalizeReceiptStatus('timed-out'), 'timeout');
assert.equal(normalizeReceiptStatus('check-failed'), 'unknown');
assert.equal(normalizeReceiptStatus('submitted'), 'pending');
assert.equal(normalizeReceiptStatus('mystery'), 'other');

assert.equal(isSuccessfulExitState('submitted'), false, 'submitted is not success');
assert.equal(isSuccessfulExitState('confirmed'), true, 'only confirmed is success');
assert.equal(isFinalExitState('submitted'), false, 'submitted must wait for receipt');
assert.equal(isFinalExitState('replacement_sent'), false, 'replacement must wait for receipt');
assert.equal(isFinalExitState('confirmed'), true);
assert.equal(isFinalExitState('reverted'), true);
assert.equal(isFailureExitState('blocked'), true);
assert.equal(isFailureExitState('reverted'), true);
assert.equal(isFailureExitState('timeout'), true);
assert.equal(isFailureExitState('manual_recovery_needed'), true);
assert.equal(isFailureExitState('disabled'), false);
assert.equal(isFailureExitState('dry_run'), false);

assert.equal(
  shouldMonitorLegacyAutoSellReceipt({ status: 'sent', sellTxHash: submittedHash }),
  true,
  'submitted sell with hash must be monitored',
);
assert.equal(
  shouldMonitorLegacyAutoSellReceipt({ status: 'sent', receiptStatus: 'success', sellTxHash: submittedHash }),
  false,
  'confirmed receipt should not be monitored again',
);
assert.equal(
  shouldMonitorLegacyAutoSellReceipt({ status: 'sent' }),
  false,
  'sent without hash is recovery state, not monitorable',
);

const legacyStatuses: Array<LegacyAutoSellStatus | undefined | null | string> = [
  undefined,
  null,
  '',
  'disabled',
  'missing-key',
  'invalid-key',
  'no-balance',
  'dry-run',
  'sent',
  'failed',
  'skipped',
  'future-legacy-status',
];
const receiptStatuses = [
  undefined,
  null,
  '',
  'success',
  'reverted',
  'failed',
  'timeout',
  'timed_out',
  'unknown',
  'pending',
  'mystery-receipt-status',
];
const sellTxHashes = [undefined, null, submittedHash];
let simulatedCases = 0;

for (const status of legacyStatuses) {
  for (const receiptStatus of receiptStatuses) {
    for (const sellTxHash of sellTxHashes) {
      simulatedCases += 1;
      const state = exitStateFromLegacyAutoSell({ status, receiptStatus, sellTxHash });
      assert.ok(EXIT_EXECUTION_STATES.includes(state), `state must be known for case ${simulatedCases}`);
      assert.ok(describeExitExecutionState(state).length > 0, `state must be described for case ${simulatedCases}`);

      if (normalizeReceiptStatus(receiptStatus) === 'success') {
        assert.equal(state, 'confirmed', `success receipt must confirm case ${simulatedCases}`);
        assert.equal(isSuccessfulExitState(state), true, `success helper must agree for case ${simulatedCases}`);
      }
      if (normalizeReceiptStatus(receiptStatus) === 'reverted') {
        assert.equal(state, 'reverted', `reverted receipt must fail case ${simulatedCases}`);
      }
      if (normalizeReceiptStatus(receiptStatus) === 'timeout') {
        assert.equal(state, 'timeout', `timeout receipt must not confirm case ${simulatedCases}`);
      }
      if (state === 'submitted') {
        assert.equal(isSuccessfulExitState(state), false, `submitted must never be success case ${simulatedCases}`);
        assert.equal(isFinalExitState(state), false, `submitted must never be final case ${simulatedCases}`);
      }
    }
  }
}

assert.ok(simulatedCases >= 100, `expected at least 100 simulated cases, got ${simulatedCases}`);

console.log(`exit execution state tests passed (${simulatedCases} simulated cases)`);
