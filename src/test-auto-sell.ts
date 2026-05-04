import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseUnits } from 'viem';

const tempDir = mkdtempSync(path.join(tmpdir(), 'chain-radar-auto-sell-'));
process.env.CHAIN_RADAR_WATCHER_TEST = '1';
process.env.DB_PATH = path.join(tempDir, 'test.db');
process.env.AUTO_SELL_ENABLED = '0';
process.env.AUTO_SELL_DRY_RUN = '0';
process.env.AUTO_SELL_PRIVATE_KEY = '';
process.env.AUTO_SELL_PREAPPROVED_ALLOWANCES = '0x39dbf1e2bce3509b51876d526489d1ec606b3a77:0x02FE8eC3d9BBf7318eb54590bcC39198a8b47deD';
process.env.AUTO_SELL_TOKEN_SYMBOLS = '0x39dbf1e2bce3509b51876d526489d1ec606b3a77:NOVA';
process.env.AUTO_SELL_TOKEN_DECIMALS = '0x39dbf1e2bce3509b51876d526489d1ec606b3a77:18';
process.env.BUYBACK_LARGE_BUY_FALLBACK_ENABLED = '1';
process.env.BUYBACK_LARGE_BUY_THRESHOLD_VIRTUAL = '3000';
process.env.BUYBACK_LARGE_BUY_THRESHOLD_USD = '0';
process.env.BUYBACK_LARGE_BUY_SYMBOLS = 'NOVA';

try {
  const {
    getLatestAutoSellExecutions,
    saveAutoSellExecution,
    saveBuybackEvent,
  } = await import('./db.js');
  const { buildAutoSellReadinessReport, executeAutoSell, __autoSellTest } = await import('./autoSell.js');
  const { __watcherTest } = await import('./watcher.js');

  saveBuybackEvent({
    tx_hash: '0xtrigger000000000000000000000000000000000000000000000000000000000001',
    token_address: '0x39dbf1e2bce3509b51876d526489d1ec606b3a77',
    token_symbol: 'nova',
    timestamp: 1_777_300_000,
    token_amount: 999,
    virtual_spent: 0.1,
    market_address: '0x1A540088125d00dD3990f9dA45CA0859af4d3B01',
    approval_spender_address: '0x02FE8eC3d9BBf7318eb54590bcC39198a8b47deD',
    detected_at_ms: 1_777_300_000_500,
  });

  saveAutoSellExecution({
    trigger_tx_hash: '0xtrigger000000000000000000000000000000000000000000000000000000000001',
    token_address: '0x39DBF1E2BCE3509B51876D526489D1EC606B3A77',
    token_symbol: 'nova',
    buyback_timestamp: 1_777_300_000,
    detected_at_ms: 1_777_300_000_500,
    wallet_address: '0x4A371B9B1BF1E7BC0700DFF666631F0FC5C96624',
    market_address: '0x1A540088125d00dD3990f9dA45CA0859af4d3B01',
    approval_spender_address: '0x02FE8eC3d9BBf7318eb54590bcC39198a8b47deD',
    status: 'sent',
    token_amount: '999',
    amount_out_min: '0',
    sell_tx_hash: '0xsell00000000000000000000000000000000000000000000000000000000000001',
    detected_to_submit_ms: 320,
  }, 1_777_300_001_000);

  let executions = getLatestAutoSellExecutions();
  assert.equal(executions.length, 1);
  assert.equal(executions[0].token_symbol, 'NOVA');
  assert.equal(executions[0].token_address, '0x39dbf1e2bce3509b51876d526489d1ec606b3a77');
  assert.equal(executions[0].wallet_address, '0x4a371b9b1bf1e7bc0700dff666631f0fc5c96624');
  assert.equal(executions[0].status, 'sent');
  assert.equal(executions[0].sell_tx_hash, '0xsell00000000000000000000000000000000000000000000000000000000000001');

  saveAutoSellExecution({
    trigger_tx_hash: '0xtrigger000000000000000000000000000000000000000000000000000000000001',
    token_address: '0x39dbf1e2bce3509b51876d526489d1ec606b3a77',
    token_symbol: 'NOVA',
    buyback_timestamp: 1_777_300_000,
    status: 'failed',
    error: 'allowance too low',
  }, 1_777_300_002_000);

  executions = getLatestAutoSellExecutions();
  assert.equal(executions.length, 1, 'execution should upsert by trigger tx and token');
  assert.equal(executions[0].status, 'failed');
  assert.equal(executions[0].error, 'allowance too low');

  const report = await buildAutoSellReadinessReport({ checkNetwork: false });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((issue) => issue.key === 'enabled'));
  assert.ok(report.issues.some((issue) => issue.key === 'private_key'));
  assert.ok(report.checks.some((check) => check.key === 'sell_queue' && check.status === 'pass'));

  const monday1550Beijing = new Date('2026-05-04T07:50:00.000Z');
  const monday1601Beijing = new Date('2026-05-04T08:01:00.000Z');
  assert.equal(__watcherTest.dueAutoSellHealthCheckKey(monday1550Beijing), '2026-05-04:2390');
  assert.equal(__watcherTest.dueAutoSellHealthCheckKey(monday1601Beijing), null);

  assert.deepEqual(__watcherTest.configuredTokenMeta('0x39DBF1E2BCE3509B51876D526489D1EC606B3A77'), {
    symbol: 'NOVA',
    decimals: 18,
  });
  assert.deepEqual(__watcherTest.largeBuyFallbackTokenAddresses(), ['0x39dbf1e2bce3509b51876d526489d1ec606b3a77']);

  const buyer = '0x1111111111111111111111111111111111111111';
  const market = '0x2222222222222222222222222222222222222222';
  const novaToken = '0x39dbf1e2bce3509b51876d526489d1ec606b3a77';
  const virtualToken = '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b';
  const otherToken = '0x9999999999999999999999999999999999999999';
  const zeroAddress = '0x0000000000000000000000000000000000000000';
  const buybackExecutor = '0x9bda49389b29fa4e204ed9de8f3d7d06f84da171';

  const canonicalMarket = '0x1A540088125d00dD3990f9dA45CA0859af4d3B01';
  process.env.AUTO_SELL_MARKET_ADDRESS = canonicalMarket;
  process.env.AUTO_SELL_USE_TRIGGER_MARKET_ADDRESS = '0';
  const canonicalMarketResult = await executeAutoSell({
    tokenAddress: novaToken,
    tokenSymbol: 'NOVA',
    marketAddress: market,
    triggerTxHash: numberedTx(8_001),
    detectedAtMs: 1_777_300_009_000,
  });
  assert.equal(canonicalMarketResult.status, 'disabled');
  assert.equal(canonicalMarketResult.marketAddress, canonicalMarket);

  process.env.AUTO_SELL_USE_TRIGGER_MARKET_ADDRESS = '1';
  const triggerMarketResult = await executeAutoSell({
    tokenAddress: novaToken,
    tokenSymbol: 'NOVA',
    marketAddress: market,
    triggerTxHash: numberedTx(8_002),
    detectedAtMs: 1_777_300_009_000,
  });
  assert.equal(triggerMarketResult.status, 'disabled');
  assert.equal(triggerMarketResult.marketAddress, market);
  process.env.AUTO_SELL_USE_TRIGGER_MARKET_ADDRESS = '0';

  type TestTransfer = {
    token: string;
    from: string;
    to: string;
    value: bigint;
    txHash: `0x${string}`;
    blockNumber: bigint;
  };

  function numberedTx(seed: number): `0x${string}` {
    return `0x${seed.toString(16).padStart(64, '0')}`;
  }

  function numberedAddress(seed: number): string {
    return `0x${seed.toString(16).padStart(40, '0')}`;
  }

  function transfer(
    token: string,
    from: string,
    to: string,
    amount: string,
    txHash = numberedTx(9_000),
    decimals = 18,
  ): TestTransfer {
    return {
      token: token.toLowerCase(),
      from: from.toLowerCase(),
      to: to.toLowerCase(),
      value: parseUnits(amount, decimals),
      txHash,
      blockNumber: 1n,
    };
  }

  function virtualTransfer(amount: string, from = buyer, to = market, txHash = numberedTx(9_001)): TestTransfer {
    return transfer(virtualToken, from, to, amount, txHash);
  }

  function novaTransfer(amount: string, from = market, to = buyer, txHash = numberedTx(9_002)): TestTransfer {
    return transfer(novaToken, from, to, amount, txHash);
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  __autoSellTest.resetRuntimeState();
  const firstLock = __autoSellTest.acquireTokenSellLock(novaToken, numberedTx(7_001));
  assert.equal(firstLock.acquired, true, 'first token lock should be acquired');
  const duplicateLock = __autoSellTest.acquireTokenSellLock(novaToken, numberedTx(7_002));
  assert.equal(duplicateLock.acquired, false, 'duplicate token lock should be rejected');
  if (!duplicateLock.acquired) assert.match(duplicateLock.reason, /pending sell already active/);
  if (firstLock.acquired) __autoSellTest.releaseTokenSellLock(firstLock.key);
  assert.equal(__autoSellTest.pendingTokenSellCount(), 0);

  __autoSellTest.resetRuntimeState();
  const queueOrder: string[] = [];
  const firstQueued = __autoSellTest.runQueued(async (queue) => {
    queueOrder.push(`first:start:${queue.queuePosition}`);
    await sleep(20);
    queueOrder.push('first:end');
    return queue;
  });
  const secondQueued = __autoSellTest.runQueued(async (queue) => {
    queueOrder.push(`second:start:${queue.queuePosition}`);
    queueOrder.push('second:end');
    return queue;
  });
  const [firstQueue, secondQueue] = await Promise.all([firstQueued, secondQueued]);
  assert.deepEqual(queueOrder, ['first:start:0', 'first:end', 'second:start:1', 'second:end']);
  assert.equal(firstQueue.queuePosition, 0);
  assert.equal(secondQueue.queuePosition, 1);
  assert.ok(secondQueue.queueWaitMs >= firstQueue.queueWaitMs);

  let simulatedLargeBuyCases = 0;
  function assertLargeBuyCase(
    name: string,
    transfers: TestTransfer[],
    expectedCount: number,
    check?: (events: ReturnType<typeof __watcherTest.extractLargeBuyFallbackEventsFromTransfers>) => void,
  ) {
    simulatedLargeBuyCases += 1;
    const events = __watcherTest.extractLargeBuyFallbackEventsFromTransfers(
      numberedTx(10_000 + simulatedLargeBuyCases),
      transfers,
      market,
      1_777_300_010_000 + simulatedLargeBuyCases,
      1.6,
    );
    assert.equal(events.length, expectedCount, name);
    check?.(events);
  }

  const officialBuyback = await __watcherTest.extractOfficialBuybackEventsFromTransfers(
    '0xbuyback00000000000000000000000000000000000000000000000000000001',
    [
      {
        token: '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b',
        from: '0x9bda49389b29fa4e204ed9de8f3d7d06f84da171',
        to: market,
        value: 2_000_000000000000000000n,
        txHash: '0xbuyback00000000000000000000000000000000000000000000000000000001',
        blockNumber: 1n,
      },
      {
        token: '0x39dbf1e2bce3509b51876d526489d1ec606b3a77',
        from: market,
        to: '0x9bda49389b29fa4e204ed9de8f3d7d06f84da171',
        value: 123_000000000000000000n,
        txHash: '0xbuyback00000000000000000000000000000000000000000000000000000001',
        blockNumber: 1n,
      },
    ],
    market,
    1_777_300_009_000,
  );
  assert.equal(officialBuyback.length, 1);
  assert.equal(officialBuyback[0].trigger_source, 'official_buyback_address');
  assert.equal(officialBuyback[0].token_symbol, 'NOVA');
  assert.equal(officialBuyback[0].virtual_spent, 2000);
  assert.equal(officialBuyback[0].market_address, market);

  const largeBuy = __watcherTest.extractLargeBuyFallbackEventsFromTransfers(
    '0xlargebuy00000000000000000000000000000000000000000000000000000001',
    [
      {
        token: '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b',
        from: buyer,
        to: market,
        value: 3_001_000000000000000000n,
        txHash: '0xlargebuy00000000000000000000000000000000000000000000000000000001',
        blockNumber: 1n,
      },
      {
        token: '0x39dbf1e2bce3509b51876d526489d1ec606b3a77',
        from: market,
        to: buyer,
        value: 123_000000000000000000n,
        txHash: '0xlargebuy00000000000000000000000000000000000000000000000000000001',
        blockNumber: 1n,
      },
    ],
    market,
    1_777_300_010_000,
    1.6,
  );
  assert.equal(largeBuy.length, 1);
  assert.equal(largeBuy[0].trigger_source, 'large_buy_fallback');
  assert.equal(largeBuy[0].token_symbol, 'NOVA');
  assert.equal(largeBuy[0].buyer_address, buyer);
  assert.equal(largeBuy[0].virtual_spent, 3001);
  assert.equal(largeBuy[0].virtual_spent_usd, 4801.6);
  assert.equal(largeBuy[0].threshold_virtual, 3000);

  const equalThresholdBuy = __watcherTest.extractLargeBuyFallbackEventsFromTransfers(
    '0xlargebuy00000000000000000000000000000000000000000000000000000002',
    [
      {
        token: '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b',
        from: buyer,
        to: market,
        value: 3_000_000000000000000000n,
        txHash: '0xlargebuy00000000000000000000000000000000000000000000000000000002',
        blockNumber: 1n,
      },
      {
        token: '0x39dbf1e2bce3509b51876d526489d1ec606b3a77',
        from: market,
        to: buyer,
        value: 123_000000000000000000n,
        txHash: '0xlargebuy00000000000000000000000000000000000000000000000000000002',
        blockNumber: 1n,
      },
    ],
    market,
    1_777_300_010_000,
    10,
  );
  assert.equal(equalThresholdBuy.length, 0, 'fallback should require strictly more than 3000 VIRTUAL');

  const tokenOnlyBuy = __watcherTest.extractLargeBuyFallbackEventsFromTransfers(
    '0xlargebuy00000000000000000000000000000000000000000000000000000003',
    [
      {
        token: '0x39dbf1e2bce3509b51876d526489d1ec606b3a77',
        from: market,
        to: buyer,
        value: 123_000000000000000000n,
        txHash: '0xlargebuy00000000000000000000000000000000000000000000000000000003',
        blockNumber: 1n,
      },
    ],
    market,
    1_777_300_010_000,
    1.6,
  );
  assert.equal(tokenOnlyBuy.length, 0, 'fallback should require VIRTUAL spent in the same tx');

  const boundaryCases: Array<[string, number]> = [
    ['0', 0],
    ['1', 0],
    ['2999.999999999999999999', 0],
    ['3000', 0],
    ['3000.000000000000000001', 1],
    ['3000.0001', 1],
    ['3000.3193', 1],
    ['3001', 1],
    ['1000000', 1],
  ];
  for (const [amount, expected] of boundaryCases) {
    assertLargeBuyCase(`boundary virtual=${amount}`, [
      virtualTransfer(amount),
      novaTransfer('123'),
    ], expected, (events) => {
      if (amount === '3000.3193') {
        assert.equal(events[0]?.virtual_spent, 3000.3193, '3000.3193 VIRTUAL should be recorded');
        assert.equal(events[0]?.threshold_virtual, 3000);
      }
    });
  }

  for (let i = 0; i < 60; i += 1) {
    const amount = 2940 + i * 2;
    assertLargeBuyCase(`sweep amount ${amount}`, [
      virtualTransfer(String(amount)),
      novaTransfer('10'),
    ], amount > 3000 ? 1 : 0);
  }

  for (let i = 0; i < 20; i += 1) {
    const first = 1000 + i * 10;
    const second = 1999 + i * 0.2;
    const total = first + second;
    assertLargeBuyCase(`split virtual total ${total}`, [
      virtualTransfer(String(first)),
      virtualTransfer(second.toFixed(1)),
      novaTransfer('25'),
    ], total > 3000 ? 1 : 0);
  }

  for (let i = 0; i < 10; i += 1) {
    const buyerA = numberedAddress(200 + i);
    const buyerB = numberedAddress(300 + i);
    assertLargeBuyCase(`multi-buyer one over threshold ${i}`, [
      virtualTransfer('2999.9', buyerA, market),
      novaTransfer('12', market, buyerA),
      virtualTransfer(`${3000 + i + 0.3193}`, buyerB, market),
      novaTransfer('13', market, buyerB),
    ], 1, (events) => {
      assert.equal(events[0]?.buyer_address, buyerB);
    });
  }

  for (let i = 0; i < 5; i += 1) {
    const scenarioBuyer = numberedAddress(500 + i);
    assertLargeBuyCase(`token aggregation ${i}`, [
      virtualTransfer(`${3001 + i}`, scenarioBuyer, market),
      novaTransfer('10', market, scenarioBuyer),
      novaTransfer('15.5', market, scenarioBuyer),
      novaTransfer('0.5', market, scenarioBuyer),
    ], 1, (events) => {
      assert.equal(events[0]?.token_amount, 26);
    });
  }

  const noiseCases: Array<[string, TestTransfer[], number]> = [
    ['no virtual transfer', [novaTransfer('1')], 0],
    ['virtual exactly threshold with high usd display', [virtualTransfer('3000'), novaTransfer('1')], 0],
    ['virtual below threshold with high usd display', [virtualTransfer('2999.999999999999999999'), novaTransfer('1')], 0],
    ['zero token transfer ignored', [virtualTransfer('3001'), novaTransfer('0')], 0],
    ['wrong token ignored', [virtualTransfer('3001'), transfer(otherToken, market, buyer, '1')], 0],
    ['token mint ignored', [virtualTransfer('3001'), novaTransfer('1', zeroAddress, buyer)], 0],
    ['token burn ignored', [virtualTransfer('3001'), novaTransfer('1', market, zeroAddress)], 0],
    ['token to official executor ignored by fallback', [virtualTransfer('3001', buybackExecutor, market), novaTransfer('1', market, buybackExecutor)], 0],
    ['virtual from zero ignored', [virtualTransfer('3001', zeroAddress, market), novaTransfer('1')], 0],
    ['virtual to zero ignored', [virtualTransfer('3001', buyer, zeroAddress), novaTransfer('1')], 0],
    ['virtual self transfer ignored', [virtualTransfer('3001', buyer, buyer), novaTransfer('1')], 0],
    ['zero virtual transfer ignored', [virtualTransfer('0'), novaTransfer('1')], 0],
    ['token recipient differs from virtual spender', [virtualTransfer('3001', numberedAddress(700), market), novaTransfer('1', market, buyer)], 0],
    ['virtual spender receives wrong token only', [virtualTransfer('3001'), transfer(otherToken, market, buyer, '1')], 0],
    ['allowed token sent before virtual still triggers', [novaTransfer('2'), virtualTransfer('3001')], 1],
    ['virtual sent to router address still triggers', [virtualTransfer('3001', buyer, numberedAddress(800)), novaTransfer('2')], 1],
    ['multiple virtual transfers sum just below threshold', [virtualTransfer('1500'), virtualTransfer('1499.999999999999999999'), novaTransfer('2')], 0],
    ['multiple virtual transfers sum exactly threshold', [virtualTransfer('1500'), virtualTransfer('1500'), novaTransfer('2')], 0],
    ['multiple virtual transfers sum one wei above threshold', [virtualTransfer('1500'), virtualTransfer('1500.000000000000000001'), novaTransfer('2')], 1],
    ['token amount one wei with large virtual triggers', [virtualTransfer('3001'), novaTransfer('0.000000000000000001')], 1],
  ];
  for (const [name, transfers, expected] of noiseCases) {
    assertLargeBuyCase(name, transfers, expected);
  }

  assert.ok(
    simulatedLargeBuyCases >= 100,
    `expected at least 100 large-buy fallback simulations, got ${simulatedLargeBuyCases}`,
  );

  const card = __watcherTest.autoSellHealthCard(report);
  assert.ok(card);
  assert.match(card.title, /自动卖出未就绪/);
  assert.equal(card.template, 'red');
  assert.ok(card.voice);

  console.log(`auto sell tests passed (${simulatedLargeBuyCases} large-buy fallback simulations)`);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
