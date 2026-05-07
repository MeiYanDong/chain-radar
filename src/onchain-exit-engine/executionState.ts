export const EXIT_EXECUTION_STATES = [
  'not_started',
  'disabled',
  'blocked',
  'detected',
  'prepared',
  'dry_run',
  'submitted',
  'confirmed',
  'reverted',
  'timeout',
  'replacement_sent',
  'manual_recovery_needed',
  'skipped',
  'failed',
] as const;

export type ExitExecutionState = typeof EXIT_EXECUTION_STATES[number];

export type LegacyAutoSellStatus =
  | 'disabled'
  | 'missing-key'
  | 'invalid-key'
  | 'no-balance'
  | 'dry-run'
  | 'sent'
  | 'failed'
  | 'skipped';

export type NormalizedReceiptStatus =
  | 'none'
  | 'success'
  | 'reverted'
  | 'unknown'
  | 'timeout'
  | 'pending'
  | 'other';

export interface LegacyAutoSellStateInput {
  status?: LegacyAutoSellStatus | string | null;
  receiptStatus?: string | null;
  sellTxHash?: string | null;
}

const FINAL_STATES = new Set<ExitExecutionState>([
  'disabled',
  'blocked',
  'dry_run',
  'confirmed',
  'reverted',
  'timeout',
  'manual_recovery_needed',
  'skipped',
  'failed',
]);

const FAILURE_STATES = new Set<ExitExecutionState>([
  'blocked',
  'reverted',
  'timeout',
  'manual_recovery_needed',
  'failed',
]);

export function normalizeReceiptStatus(status: string | null | undefined): NormalizedReceiptStatus {
  const normalized = (status ?? '').trim().toLowerCase();
  if (!normalized) return 'none';
  if (normalized === 'success') return 'success';
  if (normalized === 'reverted' || normalized === 'revert' || normalized === 'failed' || normalized === 'failure') {
    return 'reverted';
  }
  if (normalized === 'timeout' || normalized === 'timed_out' || normalized === 'timed-out') return 'timeout';
  if (normalized === 'unknown' || normalized === 'check_failed' || normalized === 'check-failed') return 'unknown';
  if (normalized === 'pending' || normalized === 'submitted') return 'pending';
  return 'other';
}

export function exitStateFromLegacyAutoSell(input: LegacyAutoSellStateInput): ExitExecutionState {
  const receiptStatus = normalizeReceiptStatus(input.receiptStatus);

  if (receiptStatus === 'success') return 'confirmed';
  if (receiptStatus === 'reverted') return 'reverted';
  if (receiptStatus === 'timeout') return 'timeout';
  if (receiptStatus === 'unknown' || receiptStatus === 'other') return 'manual_recovery_needed';
  if (receiptStatus === 'pending') return 'submitted';

  switch (input.status) {
    case undefined:
    case null:
    case '':
      return 'not_started';
    case 'disabled':
      return 'disabled';
    case 'missing-key':
    case 'invalid-key':
    case 'no-balance':
      return 'blocked';
    case 'dry-run':
      return 'dry_run';
    case 'sent':
      return input.sellTxHash ? 'submitted' : 'manual_recovery_needed';
    case 'failed':
      return 'failed';
    case 'skipped':
      return 'skipped';
    default:
      return 'manual_recovery_needed';
  }
}

export function isFinalExitState(state: ExitExecutionState): boolean {
  return FINAL_STATES.has(state);
}

export function isSuccessfulExitState(state: ExitExecutionState): boolean {
  return state === 'confirmed';
}

export function isFailureExitState(state: ExitExecutionState): boolean {
  return FAILURE_STATES.has(state);
}

export function shouldMonitorLegacyAutoSellReceipt(input: LegacyAutoSellStateInput): boolean {
  return exitStateFromLegacyAutoSell(input) === 'submitted' && Boolean(input.sellTxHash);
}

export function describeExitExecutionState(state: ExitExecutionState): string {
  switch (state) {
    case 'not_started':
      return 'No execution has started.';
    case 'disabled':
      return 'Execution is disabled by configuration.';
    case 'blocked':
      return 'Execution is blocked before submission.';
    case 'detected':
      return 'Trigger detected, execution not prepared yet.';
    case 'prepared':
      return 'Execution prepared but not submitted.';
    case 'dry_run':
      return 'Dry-run execution completed without submitting a transaction.';
    case 'submitted':
      return 'Sell transaction submitted; receipt is still the success gate.';
    case 'confirmed':
      return 'Sell transaction receipt succeeded.';
    case 'reverted':
      return 'Sell transaction receipt reverted.';
    case 'timeout':
      return 'Receipt was not confirmed before the timeout.';
    case 'replacement_sent':
      return 'Replacement transaction submitted; receipt is still pending.';
    case 'manual_recovery_needed':
      return 'Automated state is ambiguous and needs manual recovery review.';
    case 'skipped':
      return 'Execution skipped by lock or conflict policy.';
    case 'failed':
      return 'Execution failed before a successful receipt.';
  }
}
