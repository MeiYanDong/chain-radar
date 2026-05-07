import {
  exitStateFromLegacyAutoSell,
  normalizeReceiptStatus,
  type ExitExecutionState,
  type NormalizedReceiptStatus,
} from './executionState.js';

export type ReceiptFinalizerAction = 'confirm' | 'fail' | 'manual_recovery';

export interface ReceiptFinalizerInput {
  receiptStatus?: string | null;
  checkError?: string | null;
}

export interface LegacyReceiptDbUpdate {
  receiptStatus: string;
  update?: {
    status?: string;
    error?: string | null;
  };
}

export interface ReceiptFinalization {
  action: ReceiptFinalizerAction;
  state: ExitExecutionState;
  normalizedReceiptStatus: NormalizedReceiptStatus;
  receiptStatusForDb: string;
  final: boolean;
  success: boolean;
  shouldAlert: boolean;
  error?: string;
  legacyDbUpdate: LegacyReceiptDbUpdate;
}

function receiptStatusForDb(status: NormalizedReceiptStatus, raw: string | null | undefined): string {
  if (status === 'none') return 'unknown';
  if (status === 'other') return (raw ?? 'unknown').trim().toLowerCase() || 'unknown';
  return status;
}

export function finalizeSellReceipt(input: ReceiptFinalizerInput): ReceiptFinalization {
  if (input.checkError) {
    const error = `receipt check failed: ${input.checkError}`;
    return {
      action: 'manual_recovery',
      state: 'manual_recovery_needed',
      normalizedReceiptStatus: 'unknown',
      receiptStatusForDb: 'unknown',
      final: true,
      success: false,
      shouldAlert: false,
      error,
      legacyDbUpdate: {
        receiptStatus: 'unknown',
        update: { error },
      },
    };
  }

  const normalized = normalizeReceiptStatus(input.receiptStatus);
  const dbReceiptStatus = receiptStatusForDb(normalized, input.receiptStatus);
  const state = exitStateFromLegacyAutoSell({
    status: 'sent',
    sellTxHash: '0xsubmitted',
    receiptStatus: dbReceiptStatus,
  });

  if (normalized === 'success') {
    return {
      action: 'confirm',
      state,
      normalizedReceiptStatus: normalized,
      receiptStatusForDb: dbReceiptStatus,
      final: true,
      success: true,
      shouldAlert: false,
      legacyDbUpdate: { receiptStatus: dbReceiptStatus },
    };
  }

  const error = `sell receipt status=${dbReceiptStatus}`;
  if (normalized === 'reverted' || normalized === 'timeout' || normalized === 'other') {
    return {
      action: 'fail',
      state,
      normalizedReceiptStatus: normalized,
      receiptStatusForDb: dbReceiptStatus,
      final: true,
      success: false,
      shouldAlert: true,
      error,
      legacyDbUpdate: {
        receiptStatus: dbReceiptStatus,
        update: {
          status: 'failed',
          error,
        },
      },
    };
  }

  return {
    action: 'manual_recovery',
    state: 'manual_recovery_needed',
    normalizedReceiptStatus: normalized,
    receiptStatusForDb: dbReceiptStatus,
    final: true,
    success: false,
    shouldAlert: false,
    error,
    legacyDbUpdate: {
      receiptStatus: dbReceiptStatus,
      update: { error },
    },
  };
}
