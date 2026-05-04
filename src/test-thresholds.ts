import assert from 'node:assert/strict';
import {
  highestTriggeredTier,
  negativeTierWithRecoveryBuffer,
  nextTierAfterSentTransition,
  positiveTierWithDropBuffer,
  replaceTierKeys,
  triggeredThresholdKeys,
} from './pnlThresholds.js';

const positiveThresholds = [1500, 3000, 4500, 6000, 7500, 10000, 15000, 20000];
const negativeThresholds = [2500, 4000];
const buffer = 0.9;

function keys(livePnl: number) {
  return triggeredThresholdKeys(livePnl, positiveThresholds, negativeThresholds);
}

function positive(livePnl: number, previousTier: number) {
  return positiveTierWithDropBuffer(livePnl, previousTier, positiveThresholds, buffer);
}

function negative(livePnl: number, previousTier: number) {
  return negativeTierWithRecoveryBuffer(livePnl, previousTier, negativeThresholds, buffer);
}

assert.equal(positive(3107, 1500), 3000, 'rising from +1500 to +3000 must notify');
assert.equal(positive(4510, 3000), 4500, 'rising from +3000 to +4500 must notify');
assert.equal(positive(2800, 3000), 3000, 'small pullback above 90% buffer stays in previous tier');
assert.equal(positive(2600, 3000), 1500, 'pullback below 90% buffer drops to lower positive tier');
assert.equal(positive(1300, 1500), 0, 'pullback below +1500 buffer returns to confirmation');

assert.equal(negative(-4200, 2500), 4000, 'worsening from -2500 to -4000 must notify');
assert.equal(negative(-3700, 4000), 4000, 'small recovery above 90% loss buffer stays in previous risk tier');
assert.equal(negative(-3500, 4000), 2500, 'recovery below 90% loss buffer drops to lower risk tier');
assert.equal(negative(-2000, 2500), 0, 'recovery above -2500 buffer exits risk tier');

const triggered = keys(3107);
assert.equal(highestTriggeredTier(triggered, '+', positiveThresholds), 3000);
replaceTierKeys(triggered, '+', positiveThresholds, 4500);
assert.equal(highestTriggeredTier(triggered, '+', positiveThresholds), 4500);
assert.equal(triggered.has('+1500'), true);
assert.equal(triggered.has('+3000'), true);
assert.equal(triggered.has('+4500'), true);
assert.equal(triggered.has('+6000'), false);

assert.equal(nextTierAfterSentTransition(1500, 1500, 3000), 3000, 'sent upward alert advances state');
assert.equal(nextTierAfterSentTransition(4500, 1500, 3000), 4500, 'stale upward alert cannot roll state back');
assert.equal(nextTierAfterSentTransition(3000, 3000, 1500), 1500, 'sent pullback alert can lower unchanged state');
assert.equal(nextTierAfterSentTransition(4500, 3000, 1500), 4500, 'stale pullback alert cannot override newer state');

console.log('threshold tests passed');
