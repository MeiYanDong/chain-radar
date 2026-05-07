import {
  exitStateFromLegacyAutoSell,
  isFinalExitState,
  isFailureExitState,
  isSuccessfulExitState,
  shouldMonitorLegacyAutoSellReceipt,
  type ExitExecutionState,
  type LegacyAutoSellStateInput,
  type LegacyAutoSellStatus,
} from './executionState.js';
import type { RouteValidationResult, TokenRoute } from './routeRegistry.js';

export type DirectSellBackendName = 'direct';
export type DirectSellBackendStatus = 'disabled' | 'blocked' | 'dry_run' | 'submitted' | 'skipped' | 'failed';

export interface DirectSellBackendRequest {
  triggerId: string;
  tokenAddress: string;
  tokenSymbol: string;
  marketAddress: string;
  approvalSpenderAddress: string;
  detectedAtMs: number;
  referenceTokenAmount?: string;
  referenceSpendAmount?: string;
}

export interface LegacyAutoSellBackendInput extends LegacyAutoSellStateInput {
  status?: LegacyAutoSellStatus | string | null;
  wallet?: string | null;
  sellTxHash?: string | null;
  approveTxHash?: string | null;
  marketAddress?: string | null;
  approvalSpenderAddress?: string | null;
  tokenAmount?: string | null;
  amountOutMin?: string | null;
  quotedAmountOut?: string | null;
  slippageBps?: number | null;
  minOutSource?: 'zero' | 'quote' | 'reference' | string | null;
  detectedToSubmitMs?: number | null;
  queueWaitMs?: number | null;
  queuePosition?: number | null;
  nonce?: number | null;
  submitMode?: 'primary' | 'multi-rpc' | string | null;
  error?: string | null;
}

export interface DirectSellBackendResult {
  backend: DirectSellBackendName;
  status: DirectSellBackendStatus;
  state: ExitExecutionState;
  final: boolean;
  success: boolean;
  failure: boolean;
  shouldMonitorReceipt: boolean;
  wallet?: string;
  sellTxHash?: string;
  approveTxHash?: string;
  marketAddress?: string;
  approvalSpenderAddress?: string;
  tokenAmount?: string;
  amountOutMin?: string;
  quotedAmountOut?: string;
  slippageBps?: number;
  minOutSource?: string;
  detectedToSubmitMs?: number;
  queueWaitMs?: number;
  queuePosition?: number;
  nonce?: number;
  submitMode?: string;
  error?: string;
}

export interface DirectSellRouteReadiness {
  ready: boolean;
  route?: TokenRoute;
  status: 'ready' | 'blocked' | 'wrong_backend' | 'not_live';
  issues: string[];
}

function backendStatusFromState(state: ExitExecutionState): DirectSellBackendStatus {
  switch (state) {
    case 'disabled':
      return 'disabled';
    case 'blocked':
    case 'not_started':
    case 'manual_recovery_needed':
      return 'blocked';
    case 'dry_run':
      return 'dry_run';
    case 'submitted':
    case 'confirmed':
    case 'replacement_sent':
      return 'submitted';
    case 'skipped':
      return 'skipped';
    case 'failed':
    case 'reverted':
    case 'timeout':
    case 'detected':
    case 'prepared':
      return 'failed';
  }
}

function optionalString(value: string | null | undefined): string | undefined {
  return value ?? undefined;
}

function optionalNumber(value: number | null | undefined): number | undefined {
  return value ?? undefined;
}

export function directSellBackendResultFromLegacyAutoSell(input: LegacyAutoSellBackendInput): DirectSellBackendResult {
  const state = exitStateFromLegacyAutoSell(input);
  return {
    backend: 'direct',
    status: backendStatusFromState(state),
    state,
    final: isFinalExitState(state),
    success: isSuccessfulExitState(state),
    failure: isFailureExitState(state),
    shouldMonitorReceipt: shouldMonitorLegacyAutoSellReceipt(input),
    wallet: optionalString(input.wallet),
    sellTxHash: optionalString(input.sellTxHash),
    approveTxHash: optionalString(input.approveTxHash),
    marketAddress: optionalString(input.marketAddress),
    approvalSpenderAddress: optionalString(input.approvalSpenderAddress),
    tokenAmount: optionalString(input.tokenAmount),
    amountOutMin: optionalString(input.amountOutMin),
    quotedAmountOut: optionalString(input.quotedAmountOut),
    slippageBps: optionalNumber(input.slippageBps),
    minOutSource: optionalString(input.minOutSource),
    detectedToSubmitMs: optionalNumber(input.detectedToSubmitMs),
    queueWaitMs: optionalNumber(input.queueWaitMs),
    queuePosition: optionalNumber(input.queuePosition),
    nonce: optionalNumber(input.nonce),
    submitMode: optionalString(input.submitMode),
    error: optionalString(input.error),
  };
}

export function directSellRouteReadiness(validation: RouteValidationResult): DirectSellRouteReadiness {
  const issues = validation.issues.map((issue) => `${issue.code}: ${issue.message}`);
  if (!validation.ok || !validation.route) {
    return {
      ready: false,
      route: validation.route,
      status: 'blocked',
      issues,
    };
  }
  if (validation.route.backendPolicy !== 'direct') {
    return {
      ready: false,
      route: validation.route,
      status: 'wrong_backend',
      issues: [`backend_policy: expected direct, got ${validation.route.backendPolicy}`, ...issues],
    };
  }
  if (validation.route.executionMode !== 'live') {
    return {
      ready: false,
      route: validation.route,
      status: 'not_live',
      issues: [`execution_mode: expected live, got ${validation.route.executionMode}`, ...issues],
    };
  }
  return {
    ready: true,
    route: validation.route,
    status: 'ready',
    issues,
  };
}
