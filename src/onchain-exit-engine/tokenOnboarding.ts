import { isAddress } from 'viem';

import { validateTokenRoute, type TokenRoute, type TokenRouteRegistry } from './routeRegistry.js';

export type TokenProbeStatus = 'not_checked' | 'pass' | 'fail';
export type TokenOnboardingDecision = 'live_ready' | 'dry_run_ready' | 'approval_required' | 'monitor_only' | 'blocked';
export type TokenOnboardingIssueLevel = 'error' | 'warning';

export interface TokenOnboardingProbe {
  quote?: {
    status: TokenProbeStatus;
    amountOutRaw?: bigint;
    error?: string;
  };
  allowance?: {
    status: TokenProbeStatus;
    allowanceRaw?: bigint;
    requiredRaw?: bigint;
    error?: string;
  };
  balance?: {
    status: TokenProbeStatus;
    balanceRaw?: bigint;
    error?: string;
  };
}

export interface TokenOnboardingPolicy {
  requireLive?: boolean;
  requireLargeBuyFallback?: boolean;
  largeBuyFallbackEnabled?: boolean;
  largeBuySymbolAllowlist?: string[];
}

export interface TokenOnboardingInput {
  registry: TokenRouteRegistry;
  tokenAddress: string;
  observedMarketAddress?: string | null;
  observedApprovalSpenderAddress?: string | null;
  probe?: TokenOnboardingProbe;
  policy?: TokenOnboardingPolicy;
}

export interface TokenOnboardingIssue {
  level: TokenOnboardingIssueLevel;
  code: string;
  message: string;
}

export interface TokenOnboardingAssessment {
  tokenAddress: string;
  symbol?: string;
  route?: TokenRoute;
  decision: TokenOnboardingDecision;
  canMonitor: boolean;
  canDryRun: boolean;
  canLive: boolean;
  issues: TokenOnboardingIssue[];
  nextAction: string;
}

function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

function shortAddress(value: string): string {
  if (value.length < 14) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function addIssue(
  issues: TokenOnboardingIssue[],
  level: TokenOnboardingIssueLevel,
  code: string,
  message: string,
) {
  issues.push({ level, code, message });
}

function hasError(issues: TokenOnboardingIssue[]): boolean {
  return issues.some((issue) => issue.level === 'error');
}

function hasMonitorBlockingError(issues: TokenOnboardingIssue[]): boolean {
  const monitorBlockingCodes = new Set([
    'invalid_token_address',
    'route_missing',
    'invalid_token',
    'invalid_market',
    'invalid_spender',
    'missing_decimals',
    'market_mismatch',
    'spender_mismatch',
    'large_buy_disabled',
    'large_buy_symbol_not_allowed',
  ]);
  return issues.some((issue) => issue.level === 'error' && monitorBlockingCodes.has(issue.code));
}

function routeSupportsLargeBuyFallback(route: TokenRoute, policy: TokenOnboardingPolicy): boolean {
  if (!policy.largeBuyFallbackEnabled) return false;
  const allowlist = (policy.largeBuySymbolAllowlist ?? []).map((symbol) => symbol.toUpperCase());
  return allowlist.length === 0 || allowlist.includes(route.symbol.toUpperCase());
}

function decisionNextAction(decision: TokenOnboardingDecision): string {
  switch (decision) {
    case 'live_ready':
      return 'Token can be added as a live route after final operator review.';
    case 'dry_run_ready':
      return 'Add as dry-run first, run quote/allowance/balance probes, then do a small verified sell before live.';
    case 'approval_required':
      return 'Approve the configured spender or mark a verified preapproval before live execution.';
    case 'monitor_only':
      return 'Add for monitoring/alerts only; this route is not eligible for direct live sell.';
    case 'blocked':
      return 'Do not add this token to live routing until blocking issues are fixed.';
  }
}

export function assessTokenOnboarding(input: TokenOnboardingInput): TokenOnboardingAssessment {
  const tokenAddress = normalizeAddress(input.tokenAddress);
  const issues: TokenOnboardingIssue[] = [];
  const probe = input.probe ?? {};
  const policy = input.policy ?? {};

  if (!isAddress(tokenAddress)) {
    addIssue(issues, 'error', 'invalid_token_address', `invalid token address ${input.tokenAddress}`);
    return {
      tokenAddress,
      decision: 'blocked',
      canMonitor: false,
      canDryRun: false,
      canLive: false,
      issues,
      nextAction: decisionNextAction('blocked'),
    };
  }

  const routeValidation = validateTokenRoute(input.registry, tokenAddress, {
    marketAddress: input.observedMarketAddress,
    approvalSpenderAddress: input.observedApprovalSpenderAddress,
    requireLive: false,
    requireVerifiedSell: false,
    requirePreapprovedAllowance: false,
  });

  for (const issue of routeValidation.issues) {
    addIssue(issues, issue.level, issue.code, issue.message);
  }

  const route = routeValidation.route;
  if (!route) {
    return {
      tokenAddress,
      decision: 'blocked',
      canMonitor: false,
      canDryRun: false,
      canLive: false,
      issues,
      nextAction: decisionNextAction('blocked'),
    };
  }

  if (route.backendPolicy === 'alert_only') {
    addIssue(issues, 'warning', 'route_monitor_only', `${route.symbol} route policy is alert_only`);
  }
  if (route.backendPolicy === 'okx_quote_only') {
    addIssue(issues, 'warning', 'route_quote_only', `${route.symbol} route is OKX quote-only and cannot submit direct sells`);
  }

  if (policy.requireLargeBuyFallback) {
    if (!policy.largeBuyFallbackEnabled) {
      addIssue(issues, 'error', 'large_buy_disabled', 'large-buy fallback trigger is disabled');
    } else if (!routeSupportsLargeBuyFallback(route, policy)) {
      addIssue(
        issues,
        'error',
        'large_buy_symbol_not_allowed',
        `${route.symbol} is not included in the large-buy fallback symbol allowlist`,
      );
    }
  } else if (policy.largeBuyFallbackEnabled && !routeSupportsLargeBuyFallback(route, policy)) {
    addIssue(issues, 'warning', 'large_buy_symbol_not_allowed', `${route.symbol} will not trigger large-buy fallback monitoring`);
  }

  if (probe.quote?.status === 'fail') {
    addIssue(
      issues,
      'error',
      'quote_failed',
      probe.quote.error ? `direct sell quote failed: ${probe.quote.error}` : 'direct sell quote failed',
    );
  } else if (probe.quote?.status === 'pass' && (probe.quote.amountOutRaw ?? 0n) <= 0n) {
    addIssue(issues, 'error', 'quote_zero', `direct sell quote returned zero for ${route.symbol}`);
  } else if (probe.quote?.status !== 'pass') {
    addIssue(issues, 'warning', 'quote_not_checked', `direct sell quote has not been checked for ${route.symbol}`);
  }

  let approvalRequired = false;
  if (probe.allowance?.status === 'fail') {
    approvalRequired = true;
    addIssue(
      issues,
      'warning',
      'allowance_failed',
      probe.allowance.error ? `allowance check failed: ${probe.allowance.error}` : 'allowance check failed',
    );
  } else if (
    probe.allowance?.status === 'pass' &&
    probe.allowance.requiredRaw !== undefined &&
    (probe.allowance.allowanceRaw ?? 0n) < probe.allowance.requiredRaw
  ) {
    approvalRequired = true;
    addIssue(issues, 'warning', 'allowance_insufficient', `${route.symbol} allowance is lower than required sell amount`);
  } else if (!route.allowancePreapproved) {
    approvalRequired = true;
    addIssue(issues, 'warning', 'allowance_not_preapproved', `${route.symbol} is not marked as preapproved for ${shortAddress(route.approvalSpenderAddress)}`);
  } else if (probe.allowance?.status !== 'pass') {
    addIssue(issues, 'warning', 'allowance_not_checked', `${route.symbol} allowance is marked preapproved but not checked live`);
  }

  if (probe.balance?.status === 'fail') {
    addIssue(
      issues,
      'warning',
      'balance_failed',
      probe.balance.error ? `wallet balance check failed: ${probe.balance.error}` : 'wallet balance check failed',
    );
  } else if (probe.balance?.status === 'pass' && (probe.balance.balanceRaw ?? 0n) <= 0n) {
    addIssue(issues, 'warning', 'balance_zero', `wallet has zero ${route.symbol} balance`);
  } else if (probe.balance?.status !== 'pass') {
    addIssue(issues, 'warning', 'balance_not_checked', `wallet balance has not been checked for ${route.symbol}`);
  }

  if (!route.verifiedSell) {
    addIssue(issues, 'warning', 'route_unverified', `${route.symbol} has no verified small-sell receipt`);
  }

  const canMonitor = !hasMonitorBlockingError(issues);
  const quoteReady = probe.quote?.status === 'pass' && (probe.quote.amountOutRaw ?? 0n) > 0n;
  const allowanceReady = probe.allowance?.status === 'pass'
    ? probe.allowance.requiredRaw === undefined || (probe.allowance.allowanceRaw ?? 0n) >= probe.allowance.requiredRaw
    : route.allowancePreapproved && !approvalRequired;
  const balanceNotZero = probe.balance?.status !== 'pass' || (probe.balance.balanceRaw ?? 0n) > 0n;
  const canLive = !hasError(issues) &&
    route.backendPolicy === 'direct' &&
    route.executionMode === 'live' &&
    route.verifiedSell &&
    quoteReady &&
    allowanceReady &&
    balanceNotZero;
  const canDryRun = !hasError(issues) && route.backendPolicy !== 'alert_only';

  let decision: TokenOnboardingDecision;
  if (hasError(issues)) {
    decision = 'blocked';
  } else if (route.backendPolicy === 'alert_only') {
    decision = 'monitor_only';
  } else if (approvalRequired) {
    decision = 'approval_required';
  } else if (canLive) {
    decision = 'live_ready';
  } else {
    decision = 'dry_run_ready';
  }

  if (policy.requireLive && decision !== 'live_ready') {
    addIssue(issues, 'warning', 'live_not_ready', `${route.symbol} is not ready for live execution`);
  }

  return {
    tokenAddress,
    symbol: route.symbol,
    route,
    decision,
    canMonitor,
    canDryRun,
    canLive,
    issues,
    nextAction: decisionNextAction(decision),
  };
}
