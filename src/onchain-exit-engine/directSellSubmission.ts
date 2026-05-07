import type { Hash } from 'viem';

import type { DirectSellCallInput } from './directSellTransaction.js';

export type DirectSellSubmitMode = 'primary' | 'multi-rpc';

export interface DirectSellSubmissionInput extends DirectSellCallInput {
  submitMode: DirectSellSubmitMode;
  primaryFallbackEnabled: boolean;
}

export interface DirectSellSubmissionResult {
  sellTxHash: Hash;
  submitMode: DirectSellSubmitMode;
  nonce?: number;
}

export interface DirectSellSubmissionDeps {
  submitPrimary(input: DirectSellCallInput): Promise<Hash>;
  submitMultiRpc(input: DirectSellCallInput): Promise<{ sellTxHash: Hash; nonce: number }>;
  onMultiRpcFailure?: (err: unknown) => void;
}

export async function submitDirectSellWithFallback(
  input: DirectSellSubmissionInput,
  deps: DirectSellSubmissionDeps,
): Promise<DirectSellSubmissionResult> {
  if (input.submitMode === 'multi-rpc') {
    try {
      return {
        ...await deps.submitMultiRpc(input),
        submitMode: 'multi-rpc',
      };
    } catch (err) {
      if (!input.primaryFallbackEnabled) throw err;
      deps.onMultiRpcFailure?.(err);
    }
  }

  return {
    sellTxHash: await deps.submitPrimary(input),
    submitMode: 'primary',
  };
}
