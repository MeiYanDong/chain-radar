import assert from 'node:assert/strict';

import {
  DEFAULT_DIRECT_APPROVAL_SPENDER_ADDRESS,
  DEFAULT_DIRECT_MARKET_ADDRESS,
  buildTokenRouteRegistryFromEnv,
  getTokenRoute,
  validateTokenRoute,
} from './onchain-exit-engine/routeRegistry.js';

const token = '0x39dbf1e2bce3509b51876d526489d1ec606b3a77';
const otherToken = '0x9999999999999999999999999999999999999999';
const market = '0x1A540088125d00dD3990f9dA45CA0859af4d3B01';
const spender = '0x02FE8eC3d9BBf7318eb54590bcC39198a8b47deD';
const wrongMarket = '0x2222222222222222222222222222222222222222';
const wrongSpender = '0x3333333333333333333333333333333333333333';

function issueCodes(result: ReturnType<typeof validateTokenRoute>): string[] {
  return result.issues.map((issue) => issue.code);
}

const registry = buildTokenRouteRegistryFromEnv({
  AUTO_SELL_TOKEN_SYMBOLS: `${token}:NOVA`,
  AUTO_SELL_TOKEN_DECIMALS: `${token}:18`,
  AUTO_SELL_MARKET_ADDRESS: market,
  AUTO_SELL_APPROVAL_SPENDER_ADDRESS: spender,
  AUTO_SELL_PREAPPROVED_ALLOWANCES: `${token}:${spender}`,
  EXIT_ENGINE_VERIFIED_SELL_ROUTES: `${token}:${market}:${spender}`,
});

const route = getTokenRoute(registry, token);
assert.ok(route);
assert.equal(route.tokenAddress, token);
assert.equal(route.symbol, 'NOVA');
assert.equal(route.decimals, 18);
assert.equal(route.marketAddress, market.toLowerCase());
assert.equal(route.approvalSpenderAddress, spender.toLowerCase());
assert.equal(route.backendPolicy, 'direct');
assert.equal(route.verifiedSell, true);
assert.equal(route.allowancePreapproved, true);
assert.equal(route.executionMode, 'live');

let validation = validateTokenRoute(registry, token, {
  marketAddress: market,
  approvalSpenderAddress: spender,
  requireVerifiedSell: true,
  requirePreapprovedAllowance: true,
  requireLive: true,
});
assert.equal(validation.ok, true);
assert.deepEqual(issueCodes(validation), []);

validation = validateTokenRoute(registry, token, { marketAddress: wrongMarket, requireLive: true });
assert.equal(validation.ok, false);
assert.ok(issueCodes(validation).includes('market_mismatch'));

validation = validateTokenRoute(registry, token, { approvalSpenderAddress: wrongSpender, requireLive: true });
assert.equal(validation.ok, false);
assert.ok(issueCodes(validation).includes('spender_mismatch'));

validation = validateTokenRoute(registry, otherToken);
assert.equal(validation.ok, false);
assert.deepEqual(issueCodes(validation), ['route_missing']);

const unverifiedRegistry = buildTokenRouteRegistryFromEnv({
  AUTO_SELL_TOKEN_SYMBOLS: `${token}:NOVA`,
  AUTO_SELL_TOKEN_DECIMALS: `${token}:18`,
  AUTO_SELL_MARKET_ADDRESS: market,
  AUTO_SELL_APPROVAL_SPENDER_ADDRESS: spender,
  AUTO_SELL_PREAPPROVED_ALLOWANCES: `${token}:${spender}`,
});
const unverifiedRoute = getTokenRoute(unverifiedRegistry, token);
assert.ok(unverifiedRoute);
assert.equal(unverifiedRoute.verifiedSell, false);
assert.equal(unverifiedRoute.executionMode, 'alert_only');

validation = validateTokenRoute(unverifiedRegistry, token, { requireLive: true, requireVerifiedSell: true });
assert.equal(validation.ok, false);
assert.ok(issueCodes(validation).includes('route_unverified'));
assert.ok(issueCodes(validation).includes('route_not_live'));

const dryRunRegistry = buildTokenRouteRegistryFromEnv({
  AUTO_SELL_TOKEN_SYMBOLS: `${token}:NOVA`,
  AUTO_SELL_TOKEN_DECIMALS: `${token}:18`,
  AUTO_SELL_MARKET_ADDRESS: market,
  AUTO_SELL_APPROVAL_SPENDER_ADDRESS: spender,
  EXIT_ENGINE_UNVERIFIED_ROUTE_MODE: 'dry-run',
});
assert.equal(getTokenRoute(dryRunRegistry, token)?.executionMode, 'dry_run');

const okxQuoteRegistry = buildTokenRouteRegistryFromEnv({
  AUTO_SELL_TOKEN_SYMBOLS: `${token}:NOVA`,
  AUTO_SELL_TOKEN_DECIMALS: `${token}:18`,
  AUTO_SELL_MARKET_ADDRESS: market,
  AUTO_SELL_APPROVAL_SPENDER_ADDRESS: spender,
  AUTO_SELL_PREAPPROVED_ALLOWANCES: `${token}:${spender}`,
  EXIT_ENGINE_VERIFIED_SELL_ROUTES: `${token}:${market}:${spender}`,
  EXIT_ENGINE_BACKEND_POLICIES: `${token}:okx-quote-only`,
});
const okxQuoteRoute = getTokenRoute(okxQuoteRegistry, token);
assert.ok(okxQuoteRoute);
assert.equal(okxQuoteRoute.backendPolicy, 'okx_quote_only');
assert.equal(okxQuoteRoute.executionMode, 'dry_run');
validation = validateTokenRoute(okxQuoteRegistry, token, { requireLive: true });
assert.equal(validation.ok, false);
assert.ok(issueCodes(validation).includes('route_not_live'));

const perTokenRegistry = buildTokenRouteRegistryFromEnv({
  EXIT_ENGINE_TOKEN_SYMBOLS: `${token}:NOVA,${otherToken}:ALT`,
  EXIT_ENGINE_TOKEN_DECIMALS: `${token}:18,${otherToken}:9`,
  AUTO_SELL_MARKET_ADDRESS: DEFAULT_DIRECT_MARKET_ADDRESS,
  EXIT_ENGINE_TOKEN_MARKETS: `${otherToken}:${wrongMarket}`,
  EXIT_ENGINE_TOKEN_SPENDERS: `${otherToken}:${wrongSpender}`,
  EXIT_ENGINE_PREAPPROVED_ALLOWANCES: `${otherToken}:${wrongSpender}`,
  EXIT_ENGINE_VERIFIED_SELL_ROUTES: `${otherToken}:${wrongMarket}:${wrongSpender}`,
});
assert.equal(getTokenRoute(perTokenRegistry, token)?.marketAddress, DEFAULT_DIRECT_MARKET_ADDRESS.toLowerCase());
assert.equal(getTokenRoute(perTokenRegistry, token)?.approvalSpenderAddress, DEFAULT_DIRECT_APPROVAL_SPENDER_ADDRESS.toLowerCase());
assert.equal(getTokenRoute(perTokenRegistry, otherToken)?.marketAddress, wrongMarket.toLowerCase());
assert.equal(getTokenRoute(perTokenRegistry, otherToken)?.approvalSpenderAddress, wrongSpender.toLowerCase());
assert.equal(getTokenRoute(perTokenRegistry, otherToken)?.executionMode, 'live');

const missingDecimalsRegistry = buildTokenRouteRegistryFromEnv({
  AUTO_SELL_TOKEN_SYMBOLS: `${token}:NOVA`,
  AUTO_SELL_MARKET_ADDRESS: market,
  AUTO_SELL_APPROVAL_SPENDER_ADDRESS: spender,
  AUTO_SELL_PREAPPROVED_ALLOWANCES: `${token}:${spender}`,
  EXIT_ENGINE_VERIFIED_SELL_ROUTES: `${token}:${market}:${spender}`,
});
validation = validateTokenRoute(missingDecimalsRegistry, token, { requireLive: true });
assert.equal(validation.ok, false);
assert.ok(issueCodes(validation).includes('missing_decimals'));
assert.ok(issueCodes(validation).includes('route_not_live'));

console.log('route registry tests passed');
