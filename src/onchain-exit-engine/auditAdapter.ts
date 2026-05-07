export interface LegacyAutoSellAuditEvent {
  tx_hash: string;
  token_address: string;
  token_symbol: string;
  timestamp: number;
  detected_at_ms?: number | null;
  market_address?: string | null;
  approval_spender_address?: string | null;
}

export interface LegacyAutoSellAuditResult {
  status: string;
  wallet?: string | null;
  marketAddress?: string | null;
  approvalSpenderAddress?: string | null;
  tokenAmount?: string | null;
  amountOutMin?: string | null;
  approveTxHash?: string | null;
  sellTxHash?: string | null;
  detectedToSubmitMs?: number | null;
  error?: string | null;
}

export interface LegacyAutoSellExecutionAuditRecord {
  trigger_tx_hash: string;
  token_address: string;
  token_symbol: string;
  buyback_timestamp: number;
  detected_at_ms?: number | null;
  wallet_address?: string | null;
  market_address?: string | null;
  approval_spender_address?: string | null;
  status: string;
  token_amount?: string | null;
  amount_out_min?: string | null;
  approve_tx_hash?: string | null;
  sell_tx_hash?: string | null;
  detected_to_submit_ms?: number | null;
  error?: string | null;
  sell_receipt_status?: string | null;
}

export function buildLegacyAutoSellExecutionRecord(
  event: LegacyAutoSellAuditEvent,
  result: LegacyAutoSellAuditResult,
): LegacyAutoSellExecutionAuditRecord {
  return {
    trigger_tx_hash: event.tx_hash,
    token_address: event.token_address,
    token_symbol: event.token_symbol,
    buyback_timestamp: event.timestamp,
    detected_at_ms: event.detected_at_ms ?? null,
    wallet_address: result.wallet ?? null,
    market_address: result.marketAddress ?? event.market_address ?? null,
    approval_spender_address: result.approvalSpenderAddress ?? event.approval_spender_address ?? null,
    status: result.status,
    token_amount: result.tokenAmount ?? null,
    amount_out_min: result.amountOutMin ?? null,
    approve_tx_hash: result.approveTxHash ?? null,
    sell_tx_hash: result.sellTxHash ?? null,
    detected_to_submit_ms: result.detectedToSubmitMs ?? null,
    error: result.error ?? null,
    sell_receipt_status: null,
  };
}
