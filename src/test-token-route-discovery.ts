import assert from 'node:assert/strict';

import {
  candidateRoutesFromTokenTransfers,
  discoverDirectSellRoute,
  fetchBlockscoutTokenTransfers,
  type BlockscoutTokenTransferItem,
} from './onchain-exit-engine/tokenRouteDiscovery.js';
import type { TokenOnboardingReadClient } from './onchain-exit-engine/tokenOnboardingProbe.js';

const token = '0x39dbf1e2bce3509b51876d526489d1ec606b3a77';
const configuredMarket = '0x1A540088125d00dD3990f9dA45CA0859af4d3B01';
const transferMarket = '0x2222222222222222222222222222222222222222';
const dropContract = '0x3333333333333333333333333333333333333333';
const wallet = '0x4444444444444444444444444444444444444444';

const transfers: BlockscoutTokenTransferItem[] = [
  {
    transaction_hash: '0xaaa',
    method: 'claim',
    token: { address_hash: token, symbol: 'NOVA' },
    from: { hash: dropContract, is_contract: true, name: 'CumulativeMerkleDrop' },
    to: { hash: wallet, is_contract: false },
  },
  {
    transaction_hash: '0xbbb',
    method: 'swap',
    token: { address_hash: token, symbol: 'NOVA' },
    from: { hash: transferMarket, is_contract: true, name: 'TokenMarket' },
    to: { hash: wallet, is_contract: false },
  },
  {
    transaction_hash: '0xccc',
    method: 'transfer',
    token: { address_hash: token, symbol: 'NOVA' },
    from: { hash: wallet, is_contract: false },
    to: { hash: transferMarket, is_contract: true, name: 'TokenMarket' },
  },
];

const candidates = candidateRoutesFromTokenTransfers({
  tokenAddress: token,
  transferItems: transfers,
  configuredMarketAddress: configuredMarket,
});
assert.equal(candidates[0].address, configuredMarket.toLowerCase());
assert.ok(candidates.some((candidate) => candidate.address === transferMarket.toLowerCase()));
assert.ok(candidates.some((candidate) => candidate.address === dropContract.toLowerCase()));
assert.equal(candidates.find((candidate) => candidate.address === transferMarket.toLowerCase())?.transferCount, 2);

const client: TokenOnboardingReadClient = {
  async readContract(input) {
    if (input.address.toLowerCase() === transferMarket.toLowerCase() && input.functionName === 'getAmountsOut') return 42n;
    throw new Error('quote reverted');
  },
};

const discovery = await discoverDirectSellRoute({
  client,
  tokenAddress: token,
  quoteAmountRaw: 10n ** 18n,
  configuredMarketAddress: configuredMarket,
  transferItems: transfers,
});
assert.equal(discovery.candidates.length, 3);
assert.equal(discovery.quotedCandidates.length, 1);
assert.equal(discovery.selected?.address, transferMarket.toLowerCase());
assert.equal(discovery.selected?.amountOutRaw, 42n);

let fetchCalls = 0;
const fetched = await fetchBlockscoutTokenTransfers({
  tokenAddress: token,
  apiBase: 'https://example.invalid/api/v2',
  maxPages: 2,
  fetchImpl: async (url) => {
    fetchCalls += 1;
    const body = fetchCalls === 1
      ? { items: [transfers[0]], next_page_params: { page: 2 } }
      : { items: [transfers[1]], next_page_params: null };
    assert.ok(String(url).startsWith('https://example.invalid/api/v2/tokens/'));
    return new Response(JSON.stringify(body), { status: 200 });
  },
});
assert.equal(fetchCalls, 2);
assert.equal(fetched.length, 2);

console.log('token route discovery tests passed');
