import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';

import {
  BASE_DIRECT_SELL_FLASHBLOCKS_RPC,
  DEFAULT_DIRECT_SELL_RPC_URL,
  buildDirectSellBroadcastBundles,
  createDirectSellRpcBundle,
  directSellRpcCacheKey,
  resolveDirectSellBroadcastUrls,
  resolveDirectSellRpcUrls,
  submitErc20ApproveRpc,
} from './onchain-exit-engine/rpcRuntime.js';

const account = privateKeyToAccount('0x0123456789012345678901234567890123456789012345678901234567890123');
const runtimeOptions = { readTimeoutMs: 1200, writeTimeoutMs: 1800 };

assert.deepEqual(resolveDirectSellRpcUrls({}), [DEFAULT_DIRECT_SELL_RPC_URL]);
assert.deepEqual(resolveDirectSellRpcUrls({
  primaryRpcUrl: 'https://rpc-a.example',
  fallbackRpcUrls: 'https://rpc-b.example, https://rpc-a.example, ,https://rpc-c.example',
}), ['https://rpc-a.example', 'https://rpc-b.example', 'https://rpc-c.example']);

assert.equal(
  directSellRpcCacheKey('0xwallet', ['https://rpc-a.example', 'https://rpc-b.example']),
  '0xwallet:https://rpc-a.example|https://rpc-b.example',
);

const publicBundle = createDirectSellRpcBundle(account, 'https://public.example', runtimeOptions);
assert.equal(publicBundle.url, 'https://public.example');
assert.ok(publicBundle.publicClient);
assert.ok(publicBundle.walletClient);

assert.deepEqual(resolveDirectSellBroadcastUrls(['https://public.example'], {
  protectedRpcUrls: ['https://protected.example'],
  flashblocksEnabled: true,
  flashblocksRpcUrls: ['https://flash-alt.example'],
  publicBroadcastEnabled: true,
}), [
  'https://protected.example',
  BASE_DIRECT_SELL_FLASHBLOCKS_RPC,
  'https://flash-alt.example',
  'https://public.example',
]);

assert.deepEqual(resolveDirectSellBroadcastUrls(['https://public.example'], {
  protectedRpcUrls: [],
  flashblocksEnabled: false,
  flashblocksRpcUrls: ['https://flash-alt.example'],
  publicBroadcastEnabled: false,
}), []);

const broadcastBundles = buildDirectSellBroadcastBundles(account, [publicBundle], {
  ...runtimeOptions,
  protectedRpcUrls: ['https://protected.example'],
  flashblocksEnabled: false,
  flashblocksRpcUrls: [],
  publicBroadcastEnabled: true,
});
assert.equal(broadcastBundles.length, 2);
assert.equal(broadcastBundles[0].url, 'https://protected.example');
assert.equal(broadcastBundles[1], publicBundle, 'public bundle should be reused when URL already exists');

let approveRequest: unknown;
const approveHash = await submitErc20ApproveRpc({
  url: 'mock',
  publicClient: {},
  walletClient: {
    writeContract: async (request: unknown) => {
      approveRequest = request;
      return '0xapprove0000000000000000000000000000000000000000000000000000000001';
    },
  },
}, {
  tokenAddress: '0x39dbf1e2bce3509b51876d526489d1ec606b3a77',
  spenderAddress: '0x02FE8eC3d9BBf7318eb54590bcC39198a8b47deD',
});
assert.equal(approveHash, '0xapprove0000000000000000000000000000000000000000000000000000000001');
assert.deepEqual(
  approveRequest,
  {
    address: '0x39dbf1e2bce3509b51876d526489d1ec606b3a77',
    abi: approveRequest && typeof approveRequest === 'object' && 'abi' in approveRequest
      ? (approveRequest as { abi: unknown }).abi
      : undefined,
    functionName: 'approve',
    args: [
      '0x02FE8eC3d9BBf7318eb54590bcC39198a8b47deD',
      115792089237316195423570985008687907853269984665640564039457584007913129639935n,
    ],
  },
);

console.log('rpc runtime tests passed');
