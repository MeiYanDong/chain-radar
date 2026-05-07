import assert from 'node:assert/strict';

import {
  buildTokenOnboardingCandidateEnv,
  readTokenOnboardingProbe,
  type TokenOnboardingReadClient,
} from './onchain-exit-engine/tokenOnboardingProbe.js';
import { buildTokenRouteRegistryFromEnv, getTokenRoute } from './onchain-exit-engine/routeRegistry.js';

const token = '0x39dbf1e2bce3509b51876d526489d1ec606b3a77';
const market = '0x1A540088125d00dD3990f9dA45CA0859af4d3B01';
const spender = '0x02FE8eC3d9BBf7318eb54590bcC39198a8b47deD';
const wallet = '0x1111111111111111111111111111111111111111';

function mockClient(overrides: Partial<Record<string, unknown>> = {}): TokenOnboardingReadClient {
  return {
    async readContract(input) {
      const key = `${input.address}:${input.functionName}`.toLowerCase();
      if (key in overrides) {
        const value = overrides[key];
        if (value instanceof Error) throw value;
        return value;
      }
      if (input.functionName === 'symbol') return 'NOVA';
      if (input.functionName === 'decimals') return 18;
      if (input.functionName === 'balanceOf') return 200n;
      if (input.functionName === 'allowance') return 150n;
      if (input.functionName === 'getAmountsOut') return 25n;
      throw new Error(`unexpected read ${String(input.functionName)}`);
    },
  };
}

let probe = await readTokenOnboardingProbe({
  client: mockClient({
    [`${market}:getAmountsOut`.toLowerCase()]: new Error('wrong quote target'),
    [`${spender}:getAmountsOut`.toLowerCase()]: 25n,
  }),
  tokenAddress: token,
  marketAddress: market,
  quoteAddress: spender,
  spenderAddress: spender,
  walletAddress: wallet,
  sellPercent: 50,
});
assert.equal(probe.symbol, 'NOVA');
assert.equal(probe.decimals, 18);
assert.equal(probe.quoteAddress, spender);
assert.equal(probe.quoteAmountRaw, 10n ** 18n);
assert.equal(probe.probe.quote?.status, 'pass');
assert.equal(probe.probe.quote?.amountOutRaw, 25n);
assert.equal(probe.probe.balance?.status, 'pass');
assert.equal(probe.probe.balance?.balanceRaw, 200n);
assert.equal(probe.probe.allowance?.status, 'pass');
assert.equal(probe.probe.allowance?.allowanceRaw, 150n);
assert.equal(probe.probe.allowance?.requiredRaw, 100n);

probe = await readTokenOnboardingProbe({
  client: mockClient({ [`${token}:decimals`.toLowerCase()]: new Error('decimals reverted') }),
  tokenAddress: token,
  marketAddress: market,
  quoteAddress: spender,
  spenderAddress: spender,
});
assert.equal(probe.decimals, undefined);
assert.equal(probe.probe.quote?.status, 'fail');
assert.match(probe.probe.quote?.error ?? '', /decimals/);
assert.equal(probe.probe.allowance?.status, 'not_checked');
assert.equal(probe.probe.balance?.status, 'not_checked');

const env = buildTokenOnboardingCandidateEnv({
  env: {
    EXIT_ENGINE_TOKEN_SYMBOLS: `${token}:OLD`,
    EXIT_ENGINE_TOKEN_DECIMALS: `${token}:9`,
  },
  tokenAddress: token,
  marketAddress: market,
  quoteAddress: spender,
  spenderAddress: spender,
  symbol: 'NOVA',
  decimals: 18,
  allowancePreapproved: true,
});
const registry = buildTokenRouteRegistryFromEnv(env);
const route = getTokenRoute(registry, token);
assert.ok(route);
assert.equal(route.symbol, 'NOVA');
assert.equal(route.decimals, 18);
assert.equal(route.marketAddress, market.toLowerCase());
assert.equal(route.approvalSpenderAddress, spender.toLowerCase());
assert.equal(route.allowancePreapproved, true);

console.log('token onboarding probe tests passed');
