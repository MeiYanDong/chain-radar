import assert from 'node:assert/strict';

import { submitDirectSellWithFallback } from './onchain-exit-engine/directSellSubmission.js';
import type { DirectSellCallInput } from './onchain-exit-engine/directSellTransaction.js';

const call: DirectSellCallInput = {
  marketAddress: '0x1A540088125d00dD3990f9dA45CA0859af4d3B01',
  tokenAddress: '0x39dbf1e2bce3509b51876d526489d1ec606b3a77',
  amountIn: 1000n,
  amountOutMin: 900n,
  deadline: 1_777_300_000n,
};

let primaryCalls = 0;
let multiCalls = 0;
let fallbackErrors = 0;

let result = await submitDirectSellWithFallback(
  { ...call, submitMode: 'primary', primaryFallbackEnabled: true },
  {
    submitPrimary: async () => {
      primaryCalls += 1;
      return '0xprimary0000000000000000000000000000000000000000000000000000000001';
    },
    submitMultiRpc: async () => {
      multiCalls += 1;
      return {
        sellTxHash: '0xmulti000000000000000000000000000000000000000000000000000000000001',
        nonce: 12,
      };
    },
  },
);
assert.equal(result.submitMode, 'primary');
assert.equal(result.sellTxHash, '0xprimary0000000000000000000000000000000000000000000000000000000001');
assert.equal(primaryCalls, 1);
assert.equal(multiCalls, 0);

result = await submitDirectSellWithFallback(
  { ...call, submitMode: 'multi-rpc', primaryFallbackEnabled: true },
  {
    submitPrimary: async () => {
      primaryCalls += 1;
      return '0xprimary0000000000000000000000000000000000000000000000000000000002';
    },
    submitMultiRpc: async () => {
      multiCalls += 1;
      return {
        sellTxHash: '0xmulti000000000000000000000000000000000000000000000000000000000002',
        nonce: 13,
      };
    },
  },
);
assert.equal(result.submitMode, 'multi-rpc');
assert.equal(result.sellTxHash, '0xmulti000000000000000000000000000000000000000000000000000000000002');
assert.equal(result.nonce, 13);
assert.equal(primaryCalls, 1);
assert.equal(multiCalls, 1);

result = await submitDirectSellWithFallback(
  { ...call, submitMode: 'multi-rpc', primaryFallbackEnabled: true },
  {
    submitPrimary: async () => {
      primaryCalls += 1;
      return '0xprimary0000000000000000000000000000000000000000000000000000000003';
    },
    submitMultiRpc: async () => {
      multiCalls += 1;
      throw new Error('multi failed');
    },
    onMultiRpcFailure: () => {
      fallbackErrors += 1;
    },
  },
);
assert.equal(result.submitMode, 'primary');
assert.equal(result.sellTxHash, '0xprimary0000000000000000000000000000000000000000000000000000000003');
assert.equal(primaryCalls, 2);
assert.equal(multiCalls, 2);
assert.equal(fallbackErrors, 1);

await assert.rejects(
  () => submitDirectSellWithFallback(
    { ...call, submitMode: 'multi-rpc', primaryFallbackEnabled: false },
    {
      submitPrimary: async () => {
        throw new Error('primary must not be called');
      },
      submitMultiRpc: async () => {
        throw new Error('multi failed');
      },
    },
  ),
  /multi failed/,
);

console.log('direct sell submission tests passed');
