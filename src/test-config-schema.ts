import assert from 'node:assert/strict';

import {
  buildExitEngineConfigFromEnv,
  publicExitEngineConfigFieldList,
  publicExitEngineConfigSummary,
} from './onchain-exit-engine/configSchema.js';

const nativeConfig = buildExitEngineConfigFromEnv({
  EXIT_ENGINE_ENABLED: '1',
  EXIT_ENGINE_DRY_RUN: '0',
  EXIT_ENGINE_WALLET_PRIVATE_KEY: '0xsecret-private-key',
  EXIT_ENGINE_RPC_URL: 'https://rpc.example/secret-token',
  EXIT_ENGINE_RPC_URL_FALLBACKS: 'https://fallback-a.example, https://fallback-b.example',
  EXIT_ENGINE_PROTECTED_RPC_URLS: 'https://protected.example',
  EXIT_ENGINE_FLASHBLOCKS_ENABLED: '1',
  EXIT_ENGINE_FLASHBLOCKS_RPC_URLS: 'https://flash-a.example',
  EXIT_ENGINE_PUBLIC_BROADCAST_ENABLED: '0',
  EXIT_ENGINE_SUBMIT_MODE: 'multi-rpc',
  EXIT_ENGINE_PRIMARY_FALLBACK_ENABLED: '1',
  EXIT_ENGINE_SELL_PERCENT: '75',
  EXIT_ENGINE_DEADLINE_SECONDS: '45',
  EXIT_ENGINE_BURST_TARGET: '4',
  EXIT_ENGINE_TOKEN_PENDING_LOCK: '1',
  EXIT_ENGINE_TOKEN_PENDING_TTL_MS: '60000',
  EXIT_ENGINE_ON_DEMAND_APPROVE: '0',
  EXIT_ENGINE_VERIFY_PREAPPROVED: '1',
  EXIT_ENGINE_FEE_MODE: 'dynamic',
  EXIT_ENGINE_SELL_GAS_LIMIT: '250000',
  EXIT_ENGINE_MIN_PRIORITY_GWEI: '0.2',
  EXIT_ENGINE_MAX_FEE_GWEI: '3',
  EXIT_ENGINE_PRIORITY_FEE_MULTIPLIER: '2.5',
  EXIT_ENGINE_MAX_FEE_MULTIPLIER: '1.8',
  EXIT_ENGINE_MAX_PRIORITY_FEE_GWEI: '1',
  EXIT_ENGINE_MIN_OUT_MODE: 'reference',
  EXIT_ENGINE_REQUIRE_NONZERO_MIN_OUT: '1',
  EXIT_ENGINE_FALLBACK_MIN_OUT_ZERO: '0',
  EXIT_ENGINE_SLIPPAGE_BPS: '900',
  EXIT_ENGINE_LARGE_BUY_ENABLED: '1',
  EXIT_ENGINE_BUYBACK_EXECUTOR_ADDRESS: '0x9Bda49389B29Fa4E204eD9De8f3d7d06f84dA171',
  EXIT_ENGINE_LARGE_BUY_THRESHOLD_VIRTUAL: '3000',
  EXIT_ENGINE_LARGE_BUY_THRESHOLD_USD: '0',
  EXIT_ENGINE_LARGE_BUY_VIRTUAL_USD_FALLBACK: '1.7',
  EXIT_ENGINE_LARGE_BUY_SYMBOLS: 'zmac, volts',
});
assert.equal(nativeConfig.enabled, true);
assert.equal(nativeConfig.dryRun, false);
assert.equal(nativeConfig.wallet.privateKeySet, true);
assert.equal(nativeConfig.wallet.privateKey, '0xsecret-private-key');
assert.equal(nativeConfig.rpc.primaryUrl, 'https://rpc.example/secret-token');
assert.deepEqual(nativeConfig.rpc.fallbackUrls, ['https://fallback-a.example', 'https://fallback-b.example']);
assert.equal(nativeConfig.rpc.publicBroadcastEnabled, false);
assert.equal(nativeConfig.execution.submitMode, 'multi-rpc');
assert.equal(nativeConfig.execution.sellPercent, 75);
assert.equal(nativeConfig.execution.onDemandApprove, false);
assert.equal(nativeConfig.risk.feeMode, 'dynamic');
assert.equal(nativeConfig.risk.sellGasLimit, 250000n);
assert.equal(nativeConfig.risk.minOutMode, 'reference');
assert.equal(nativeConfig.risk.requireNonzeroMinOut, true);
assert.equal(nativeConfig.risk.fallbackMinOutZero, false);
assert.equal(nativeConfig.triggers.officialBuyback.executorAddress, '0x9Bda49389B29Fa4E204eD9De8f3d7d06f84dA171');
assert.equal(nativeConfig.triggers.largeBuy.virtualUsdFallback, 1.7);
assert.deepEqual(nativeConfig.triggers.largeBuy.symbols, ['ZMAC', 'VOLTS']);
assert.equal(nativeConfig.route.marketAddress, '0x1A540088125d00dD3990f9dA45CA0859af4d3B01');
assert.deepEqual(nativeConfig.issues, []);

const broadcastDisabledConfig = buildExitEngineConfigFromEnv({
  EXIT_ENGINE_PUBLIC_BROADCAST_ENABLED: '0',
});
assert.equal(broadcastDisabledConfig.rpc.publicBroadcastEnabled, false);
assert.equal(broadcastDisabledConfig.execution.primaryFallbackEnabled, false);

const explicitPrimaryFallbackConfig = buildExitEngineConfigFromEnv({
  EXIT_ENGINE_PUBLIC_BROADCAST_ENABLED: '0',
  EXIT_ENGINE_PRIMARY_FALLBACK_ENABLED: '1',
});
assert.equal(explicitPrimaryFallbackConfig.execution.primaryFallbackEnabled, true);

const legacyConfig = buildExitEngineConfigFromEnv({
  AUTO_SELL_ENABLED: '1',
  AUTO_SELL_DRY_RUN: '0',
  AUTO_SELL_PRIVATE_KEY: '0xlegacy-secret',
  RPC_URL: 'https://legacy-rpc.example/token',
  RPC_URL_FALLBACKS: 'https://legacy-fallback.example',
  AUTO_SELL_SUBMIT_MODE: 'primary',
  AUTO_SELL_MIN_OUT_MODE: 'quote-required',
  BUYBACK_LARGE_BUY_FALLBACK_ENABLED: '1',
  BUYBACK_LARGE_BUY_THRESHOLD_VIRTUAL: '3000',
  BUYBACK_LARGE_BUY_SYMBOLS: 'nova',
});
assert.equal(legacyConfig.enabled, true);
assert.equal(legacyConfig.rpc.primaryUrl, 'https://legacy-rpc.example/token');
assert.deepEqual(legacyConfig.rpc.fallbackUrls, ['https://legacy-fallback.example']);
assert.equal(legacyConfig.execution.submitMode, 'primary');
assert.equal(legacyConfig.risk.minOutMode, 'quote-required');
assert.equal(legacyConfig.risk.requireNonzeroMinOut, true);
assert.deepEqual(legacyConfig.triggers.largeBuy.symbols, ['NOVA']);

const unsafeConfig = buildExitEngineConfigFromEnv({
  EXIT_ENGINE_ENABLED: '1',
  EXIT_ENGINE_DRY_RUN: '0',
  EXIT_ENGINE_MIN_OUT_MODE: 'zero',
});
assert.equal(unsafeConfig.issues.some((issue) => issue.code === 'wallet_private_key_missing'), true);
assert.equal(unsafeConfig.issues.some((issue) => issue.code === 'rpc_url_missing'), true);
assert.equal(unsafeConfig.issues.some((issue) => issue.code === 'zero_min_out_live'), true);

const summary = publicExitEngineConfigSummary(nativeConfig);
const summaryJson = JSON.stringify(summary);
assert.equal(summary.walletPrivateKeySet, true);
assert.equal(summary.rpc.primaryUrlSet, true);
assert.equal(summary.rpc.fallbackUrlCount, 2);
assert.equal(summary.rpc.protectedUrlCount, 1);
assert.equal(summary.risk.sellGasLimitSet, true);
assert.equal(summary.route.marketAddressSet, true);
assert.equal(summary.route.preapprovedAllowanceCount, 0);
assert.equal(summary.integrations.buybackFlashblocksWsUrlCount, 0);
assert.equal(summaryJson.includes('secret-private-key'), false);
assert.equal(summaryJson.includes('secret-token'), false);
assert.equal(summaryJson.includes('https://'), false);

const fields = publicExitEngineConfigFieldList();
assert.ok(fields.some((field) => field.key === 'EXIT_ENGINE_WALLET_PRIVATE_KEY' && field.secret));
assert.ok(fields.some((field) => field.key === 'EXIT_ENGINE_RPC_URL' && field.secret));
assert.ok(fields.some((field) => field.legacyKey === 'AUTO_SELL_ENABLED'));
assert.ok(fields.some((field) => field.key === 'EXIT_ENGINE_BUYBACK_EXECUTOR_ADDRESS'));
assert.equal(JSON.stringify(fields).includes('secret-private-key'), false);

console.log('config schema tests passed');
