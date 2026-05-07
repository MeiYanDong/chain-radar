import assert from 'node:assert/strict';

import {
  directSellBackendResultFromLegacyAutoSell,
  directSellRouteReadiness,
} from './onchain-exit-engine/directSellBackend.js';
import { buildTokenRouteRegistryFromEnv, validateTokenRoute } from './onchain-exit-engine/routeRegistry.js';

const token = '0x39dbf1e2bce3509b51876d526489d1ec606b3a77';
const market = '0x1A540088125d00dD3990f9dA45CA0859af4d3B01';
const spender = '0x02FE8eC3d9BBf7318eb54590bcC39198a8b47deD';
const sellTxHash = '0xsell00000000000000000000000000000000000000000000000000000000000001';

let result = directSellBackendResultFromLegacyAutoSell({
  status: 'sent',
  sellTxHash,
  marketAddress: market,
  approvalSpenderAddress: spender,
  tokenAmount: '1000',
  amountOutMin: '10',
  nonce: 12,
});
assert.equal(result.backend, 'direct');
assert.equal(result.status, 'submitted');
assert.equal(result.state, 'submitted');
assert.equal(result.final, false);
assert.equal(result.success, false);
assert.equal(result.shouldMonitorReceipt, true);
assert.equal(result.sellTxHash, sellTxHash);

result = directSellBackendResultFromLegacyAutoSell({ status: 'sent' });
assert.equal(result.status, 'blocked');
assert.equal(result.state, 'manual_recovery_needed');
assert.equal(result.shouldMonitorReceipt, false);

result = directSellBackendResultFromLegacyAutoSell({ status: 'dry-run' });
assert.equal(result.status, 'dry_run');
assert.equal(result.state, 'dry_run');
assert.equal(result.final, true);
assert.equal(result.success, false);

result = directSellBackendResultFromLegacyAutoSell({ status: 'missing-key' });
assert.equal(result.status, 'blocked');
assert.equal(result.state, 'blocked');

result = directSellBackendResultFromLegacyAutoSell({ status: 'sent', sellTxHash, receiptStatus: 'success' });
assert.equal(result.status, 'submitted');
assert.equal(result.state, 'confirmed');
assert.equal(result.final, true);
assert.equal(result.success, true);
assert.equal(result.shouldMonitorReceipt, false);

const liveRegistry = buildTokenRouteRegistryFromEnv({
  AUTO_SELL_TOKEN_SYMBOLS: `${token}:NOVA`,
  AUTO_SELL_TOKEN_DECIMALS: `${token}:18`,
  AUTO_SELL_MARKET_ADDRESS: market,
  AUTO_SELL_APPROVAL_SPENDER_ADDRESS: spender,
  AUTO_SELL_PREAPPROVED_ALLOWANCES: `${token}:${spender}`,
  EXIT_ENGINE_VERIFIED_SELL_ROUTES: `${token}:${market}:${spender}`,
});
let readiness = directSellRouteReadiness(validateTokenRoute(liveRegistry, token, {
  marketAddress: market,
  approvalSpenderAddress: spender,
  requireVerifiedSell: true,
  requirePreapprovedAllowance: true,
  requireLive: true,
}));
assert.equal(readiness.ready, true);
assert.equal(readiness.status, 'ready');

const okxRegistry = buildTokenRouteRegistryFromEnv({
  AUTO_SELL_TOKEN_SYMBOLS: `${token}:NOVA`,
  AUTO_SELL_TOKEN_DECIMALS: `${token}:18`,
  AUTO_SELL_MARKET_ADDRESS: market,
  AUTO_SELL_APPROVAL_SPENDER_ADDRESS: spender,
  AUTO_SELL_PREAPPROVED_ALLOWANCES: `${token}:${spender}`,
  EXIT_ENGINE_VERIFIED_SELL_ROUTES: `${token}:${market}:${spender}`,
  EXIT_ENGINE_BACKEND_POLICIES: `${token}:okx-quote-only`,
});
readiness = directSellRouteReadiness(validateTokenRoute(okxRegistry, token));
assert.equal(readiness.ready, false);
assert.equal(readiness.status, 'wrong_backend');

const unverifiedRegistry = buildTokenRouteRegistryFromEnv({
  AUTO_SELL_TOKEN_SYMBOLS: `${token}:NOVA`,
  AUTO_SELL_TOKEN_DECIMALS: `${token}:18`,
  AUTO_SELL_MARKET_ADDRESS: market,
  AUTO_SELL_APPROVAL_SPENDER_ADDRESS: spender,
});
readiness = directSellRouteReadiness(validateTokenRoute(unverifiedRegistry, token, { requireLive: true }));
assert.equal(readiness.ready, false);
assert.equal(readiness.status, 'blocked');
assert.ok(readiness.issues.some((issue) => issue.includes('route_not_live')));

console.log('direct sell backend tests passed');
