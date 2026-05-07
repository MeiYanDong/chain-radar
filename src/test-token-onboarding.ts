import assert from 'node:assert/strict';

import { assessTokenOnboarding } from './onchain-exit-engine/tokenOnboarding.js';
import { buildTokenRouteRegistryFromEnv } from './onchain-exit-engine/routeRegistry.js';

const token = '0x39dbf1e2bce3509b51876d526489d1ec606b3a77';
const otherToken = '0x9999999999999999999999999999999999999999';
const market = '0x1A540088125d00dD3990f9dA45CA0859af4d3B01';
const spender = '0x02FE8eC3d9BBf7318eb54590bcC39198a8b47deD';

function issueCodes(result: ReturnType<typeof assessTokenOnboarding>): string[] {
  return result.issues.map((issue) => issue.code);
}

const liveRegistry = buildTokenRouteRegistryFromEnv({
  AUTO_SELL_TOKEN_SYMBOLS: `${token}:NOVA`,
  AUTO_SELL_TOKEN_DECIMALS: `${token}:18`,
  AUTO_SELL_MARKET_ADDRESS: market,
  AUTO_SELL_APPROVAL_SPENDER_ADDRESS: spender,
  AUTO_SELL_PREAPPROVED_ALLOWANCES: `${token}:${spender}`,
  EXIT_ENGINE_VERIFIED_SELL_ROUTES: `${token}:${market}:${spender}`,
});

let assessment = assessTokenOnboarding({
  registry: liveRegistry,
  tokenAddress: token,
  observedMarketAddress: market,
  observedApprovalSpenderAddress: spender,
  probe: {
    quote: { status: 'pass', amountOutRaw: 10n },
    allowance: { status: 'pass', allowanceRaw: 100n, requiredRaw: 100n },
    balance: { status: 'pass', balanceRaw: 100n },
  },
  policy: {
    requireLive: true,
    requireLargeBuyFallback: true,
    largeBuyFallbackEnabled: true,
    largeBuySymbolAllowlist: ['NOVA'],
  },
});
assert.equal(assessment.decision, 'live_ready');
assert.equal(assessment.canLive, true);
assert.deepEqual(issueCodes(assessment), []);

assessment = assessTokenOnboarding({
  registry: liveRegistry,
  tokenAddress: token,
  probe: {
    quote: { status: 'not_checked' },
    allowance: { status: 'not_checked' },
    balance: { status: 'not_checked' },
  },
});
assert.equal(assessment.decision, 'dry_run_ready');
assert.equal(assessment.canLive, false);
assert.ok(issueCodes(assessment).includes('quote_not_checked'));
assert.ok(issueCodes(assessment).includes('allowance_not_checked'));

const unverifiedRegistry = buildTokenRouteRegistryFromEnv({
  AUTO_SELL_TOKEN_SYMBOLS: `${token}:NOVA`,
  AUTO_SELL_TOKEN_DECIMALS: `${token}:18`,
  AUTO_SELL_MARKET_ADDRESS: market,
  AUTO_SELL_APPROVAL_SPENDER_ADDRESS: spender,
  AUTO_SELL_PREAPPROVED_ALLOWANCES: `${token}:${spender}`,
});
assessment = assessTokenOnboarding({
  registry: unverifiedRegistry,
  tokenAddress: token,
  probe: {
    quote: { status: 'pass', amountOutRaw: 10n },
    allowance: { status: 'pass', allowanceRaw: 100n, requiredRaw: 100n },
    balance: { status: 'pass', balanceRaw: 100n },
  },
});
assert.equal(assessment.decision, 'dry_run_ready');
assert.ok(issueCodes(assessment).includes('route_unverified'));

const noApprovalRegistry = buildTokenRouteRegistryFromEnv({
  AUTO_SELL_TOKEN_SYMBOLS: `${token}:NOVA`,
  AUTO_SELL_TOKEN_DECIMALS: `${token}:18`,
  AUTO_SELL_MARKET_ADDRESS: market,
  AUTO_SELL_APPROVAL_SPENDER_ADDRESS: spender,
  EXIT_ENGINE_VERIFIED_SELL_ROUTES: `${token}:${market}:${spender}`,
});
assessment = assessTokenOnboarding({
  registry: noApprovalRegistry,
  tokenAddress: token,
  probe: {
    quote: { status: 'pass', amountOutRaw: 10n },
    balance: { status: 'pass', balanceRaw: 100n },
  },
});
assert.equal(assessment.decision, 'approval_required');
assert.ok(issueCodes(assessment).includes('allowance_not_preapproved'));

assessment = assessTokenOnboarding({
  registry: liveRegistry,
  tokenAddress: token,
  probe: {
    quote: { status: 'pass', amountOutRaw: 0n },
    allowance: { status: 'pass', allowanceRaw: 100n, requiredRaw: 100n },
  },
});
assert.equal(assessment.decision, 'blocked');
assert.equal(assessment.canMonitor, true);
assert.ok(issueCodes(assessment).includes('quote_zero'));

const alertRegistry = buildTokenRouteRegistryFromEnv({
  AUTO_SELL_TOKEN_SYMBOLS: `${token}:NOVA`,
  AUTO_SELL_TOKEN_DECIMALS: `${token}:18`,
  EXIT_ENGINE_BACKEND_POLICIES: `${token}:alert-only`,
});
assessment = assessTokenOnboarding({ registry: alertRegistry, tokenAddress: token });
assert.equal(assessment.decision, 'monitor_only');
assert.equal(assessment.canDryRun, false);
assert.ok(issueCodes(assessment).includes('route_monitor_only'));

const okxQuoteRegistry = buildTokenRouteRegistryFromEnv({
  AUTO_SELL_TOKEN_SYMBOLS: `${token}:NOVA`,
  AUTO_SELL_TOKEN_DECIMALS: `${token}:18`,
  AUTO_SELL_MARKET_ADDRESS: market,
  AUTO_SELL_APPROVAL_SPENDER_ADDRESS: spender,
  AUTO_SELL_PREAPPROVED_ALLOWANCES: `${token}:${spender}`,
  EXIT_ENGINE_VERIFIED_SELL_ROUTES: `${token}:${market}:${spender}`,
  EXIT_ENGINE_BACKEND_POLICIES: `${token}:okx-quote-only`,
});
assessment = assessTokenOnboarding({
  registry: okxQuoteRegistry,
  tokenAddress: token,
  probe: {
    quote: { status: 'pass', amountOutRaw: 10n },
    allowance: { status: 'pass', allowanceRaw: 100n, requiredRaw: 100n },
  },
});
assert.equal(assessment.decision, 'dry_run_ready');
assert.equal(assessment.canLive, false);
assert.ok(issueCodes(assessment).includes('route_quote_only'));

assessment = assessTokenOnboarding({
  registry: liveRegistry,
  tokenAddress: otherToken,
});
assert.equal(assessment.decision, 'blocked');
assert.ok(issueCodes(assessment).includes('route_missing'));

assessment = assessTokenOnboarding({
  registry: liveRegistry,
  tokenAddress: 'not-an-address',
});
assert.equal(assessment.decision, 'blocked');
assert.ok(issueCodes(assessment).includes('invalid_token_address'));

assessment = assessTokenOnboarding({
  registry: liveRegistry,
  tokenAddress: token,
  probe: {
    quote: { status: 'pass', amountOutRaw: 10n },
    allowance: { status: 'pass', allowanceRaw: 100n, requiredRaw: 100n },
  },
  policy: {
    requireLargeBuyFallback: true,
    largeBuyFallbackEnabled: true,
    largeBuySymbolAllowlist: ['OTHER'],
  },
});
assert.equal(assessment.decision, 'blocked');
assert.ok(issueCodes(assessment).includes('large_buy_symbol_not_allowed'));

console.log('token onboarding tests passed');
