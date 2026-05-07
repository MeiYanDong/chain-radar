import assert from 'node:assert/strict';
import { analyzeLagSeries, pearson, type PnlPricePoint } from './pnlPriceLag.js';

assert.equal(pearson([1, 2, 3], [2, 4, 6]), 1);
assert.equal(pearson([1, 2, 3], [6, 4, 2]), -1);
assert.equal(pearson([1, 1, 1], [1, 2, 3]), null);

const points: PnlPricePoint[] = [];
for (let i = 0; i <= 30; i += 1) {
  const timestamp = i * 60;
  const livePnl = i >= 5 ? (i - 4) * 100 : 0;
  const priceMoveIndex = Math.max(0, i - 10);
  const tokenPriceUsd = 1 + priceMoveIndex * 0.01;
  points.push({ timestamp, livePnl, tokenPriceUsd });
}

const result = analyzeLagSeries({
  token: 'TEST',
  points,
  lagMinutes: [-10, -5, 0, 5, 10],
  baseWindowMinutes: 5,
  minSamples: 8,
});

assert.ok(result.best);
assert.equal(result.best?.lagMinutes, 5);
assert.ok((result.best?.correlation ?? 0) > 0.9);

console.log('pnl price lag tests passed');
