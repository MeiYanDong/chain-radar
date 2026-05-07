import assert from 'node:assert/strict';

import {
  DIRECT_SELL_ABI,
  DIRECT_SELL_DEFAULT_APPROVAL_SPENDER_ADDRESS,
  DIRECT_SELL_DEFAULT_MARKET_ADDRESS,
  DIRECT_SELL_DEFAULT_QUOTE_ADDRESS,
  DIRECT_SELL_ZERO_ASSET_ADDRESS,
  buildDirectSellCalldata,
  buildDirectSellQuoteRead,
  buildDirectSellWriteContract,
  directSellArgs,
  directSellQuoteArgs,
} from './onchain-exit-engine/directSellTransaction.js';

const marketAddress = DIRECT_SELL_DEFAULT_MARKET_ADDRESS;
const tokenAddress = '0x39dbf1e2bce3509b51876d526489d1ec606b3a77' as const;
const amountIn = 123456789n;
const amountOutMin = 987654321n;
const deadline = 1_777_300_000n;

const call = { marketAddress, tokenAddress, amountIn, amountOutMin, deadline };
assert.deepEqual(directSellArgs(call), [amountIn, tokenAddress, amountOutMin, deadline]);

const write = buildDirectSellWriteContract(call);
assert.equal(write.address, marketAddress);
assert.equal(write.abi, DIRECT_SELL_ABI);
assert.equal(write.functionName, 'sell');
assert.deepEqual(write.args, [amountIn, tokenAddress, amountOutMin, deadline]);

const quote = buildDirectSellQuoteRead({ marketAddress, tokenAddress, amountIn });
assert.equal(quote.address, DIRECT_SELL_DEFAULT_QUOTE_ADDRESS);
assert.equal(quote.abi, DIRECT_SELL_ABI);
assert.equal(quote.functionName, 'getAmountsOut');
assert.deepEqual(quote.args, [tokenAddress, DIRECT_SELL_ZERO_ASSET_ADDRESS, amountIn]);
assert.deepEqual(directSellQuoteArgs({ marketAddress, tokenAddress, amountIn }), quote.args);
assert.equal(DIRECT_SELL_DEFAULT_APPROVAL_SPENDER_ADDRESS, DIRECT_SELL_DEFAULT_QUOTE_ADDRESS);

const customQuoteAddress = '0x4444444444444444444444444444444444444444' as const;
const explicitQuote = buildDirectSellQuoteRead({ marketAddress, quoteAddress: customQuoteAddress, tokenAddress, amountIn });
assert.equal(explicitQuote.address, customQuoteAddress);

const calldata = buildDirectSellCalldata(call);
assert.equal(calldata.startsWith('0x'), true);
assert.equal(calldata.slice(0, 10), '0xb233e056');
assert.ok(calldata.length > 10);

console.log('direct sell transaction tests passed');
