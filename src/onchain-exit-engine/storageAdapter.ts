import type { LegacyAutoSellExecutionAuditRecord } from './auditAdapter.js';
import type { LegacyReceiptDbUpdate } from './receiptFinalizer.js';

export interface LegacyAutoSellReceiptUpdateInput {
  triggerTxHash: string;
  tokenAddress: string;
  receiptStatus: string;
  update?: {
    status?: string;
    error?: string | null;
  };
  nowMs?: number;
}

export interface LegacyAutoSellExecutionStorage {
  saveExecution(record: LegacyAutoSellExecutionAuditRecord, nowMs?: number): void;
  updateReceipt(input: LegacyAutoSellReceiptUpdateInput): number;
}

export interface LegacyAutoSellExecutionDbPort {
  saveAutoSellExecution(record: LegacyAutoSellExecutionAuditRecord, nowMs?: number): void;
  updateAutoSellExecutionReceipt(
    triggerTxHash: string,
    tokenAddress: string,
    receiptStatus: string,
    update?: LegacyAutoSellReceiptUpdateInput['update'],
    nowMs?: number,
  ): number;
}

export function createLegacyAutoSellExecutionStorage(port: LegacyAutoSellExecutionDbPort): LegacyAutoSellExecutionStorage {
  return {
    saveExecution(record, nowMs) {
      port.saveAutoSellExecution(record, nowMs);
    },
    updateReceipt(input) {
      return port.updateAutoSellExecutionReceipt(
        input.triggerTxHash,
        input.tokenAddress,
        input.receiptStatus,
        input.update,
        input.nowMs,
      );
    },
  };
}

export function applyLegacyReceiptFinalization(
  storage: LegacyAutoSellExecutionStorage,
  triggerTxHash: string,
  tokenAddress: string,
  finalization: LegacyReceiptDbUpdate,
  nowMs?: number,
): number {
  return storage.updateReceipt({
    triggerTxHash,
    tokenAddress,
    receiptStatus: finalization.receiptStatus,
    update: finalization.update,
    nowMs,
  });
}
