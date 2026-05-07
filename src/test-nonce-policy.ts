import assert from 'node:assert/strict';

import {
  TokenSellLockRegistry,
  WalletNonceManager,
  classifyNonceFailure,
  planBurstSubmissions,
  recoveryActionForNonceFailure,
} from './onchain-exit-engine/noncePolicy.js';

const wallet = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const tokenA = '0x1111111111111111111111111111111111111111';
const tokenB = '0x2222222222222222222222222222222222222222';
const tokenC = '0x3333333333333333333333333333333333333333';

const nonceManager = new WalletNonceManager();
let reservation = nonceManager.reserve(wallet, 7);
assert.equal(reservation.nonce, 7);
assert.equal(reservation.source, 'chain');
reservation = nonceManager.reserve(wallet, 7);
assert.equal(reservation.nonce, 8);
assert.equal(reservation.source, 'local');
reservation = nonceManager.reserve(wallet, 12);
assert.equal(reservation.nonce, 12);
assert.equal(reservation.source, 'chain');
assert.equal(nonceManager.peek(wallet), 13);
nonceManager.reset(wallet);
assert.equal(nonceManager.peek(wallet), undefined);
assert.equal(nonceManager.reserve(wallet, 4).nonce, 4);

const locks = new TokenSellLockRegistry(10_000);
assert.deepEqual(locks.acquire(tokenA, 'trigger-1', 1_000), { acquired: true, key: tokenA });
const duplicate = locks.acquire(tokenA, 'trigger-2', 1_001);
assert.equal(duplicate.acquired, false);
assert.match(duplicate.reason, /pending sell already active/);
assert.equal(locks.markSubmitted(tokenA, '0xsell', 1_100), true);
assert.equal(locks.has(tokenA, 2_000), true);
locks.release(tokenA);
assert.equal(locks.has(tokenA, 2_000), false);
assert.deepEqual(locks.acquire(tokenA, 'trigger-3', 20_000), { acquired: true, key: tokenA });
assert.equal(locks.has(tokenA, 31_000), false, 'expired lock should clear');

const sameSecondReservePlan = planBurstSubmissions([
  { id: 'a', walletAddress: wallet, tokenAddress: tokenA, detectedAtMs: 100_000, chainPendingNonce: 21 },
  { id: 'b', walletAddress: wallet, tokenAddress: tokenB, detectedAtMs: 100_000, chainPendingNonce: 21 },
], { policy: 'reserve_nonce' });
assert.deepEqual(sameSecondReservePlan.map((item) => item.action), ['submit', 'submit']);
assert.deepEqual(sameSecondReservePlan.map((item) => item.nonce), [21, 22]);

const oneMinuteReservePlan = planBurstSubmissions([
  { id: 'a', walletAddress: wallet, tokenAddress: tokenA, detectedAtMs: 200_000, chainPendingNonce: 30 },
  { id: 'b', walletAddress: wallet, tokenAddress: tokenB, detectedAtMs: 230_000, chainPendingNonce: 30 },
  { id: 'c', walletAddress: wallet, tokenAddress: tokenC, detectedAtMs: 259_999, chainPendingNonce: 30 },
], { policy: 'reserve_nonce' });
assert.deepEqual(oneMinuteReservePlan.map((item) => item.action), ['submit', 'submit', 'submit']);
assert.deepEqual(oneMinuteReservePlan.map((item) => item.nonce), [30, 31, 32]);

const queuePlan = planBurstSubmissions([
  { id: 'a', walletAddress: wallet, tokenAddress: tokenA, detectedAtMs: 300_000, chainPendingNonce: 40 },
  { id: 'b', walletAddress: wallet, tokenAddress: tokenB, detectedAtMs: 300_001, chainPendingNonce: 40 },
  { id: 'c', walletAddress: wallet, tokenAddress: tokenC, detectedAtMs: 300_002, chainPendingNonce: 40 },
], { policy: 'queue' });
assert.deepEqual(queuePlan.map((item) => item.action), ['submit', 'queue', 'queue']);
assert.deepEqual(queuePlan.map((item) => item.queuePosition), [0, 1, 2]);
assert.equal(queuePlan[0].nonce, 40);
assert.equal(queuePlan[1].nonce, undefined);
assert.equal(queuePlan[2].nonce, undefined);

const duplicatePlan = planBurstSubmissions([
  { id: 'a', walletAddress: wallet, tokenAddress: tokenA, detectedAtMs: 400_000, chainPendingNonce: 50 },
  { id: 'b', walletAddress: wallet, tokenAddress: tokenA, detectedAtMs: 400_001, chainPendingNonce: 50 },
], { policy: 'reserve_nonce' });
assert.deepEqual(duplicatePlan.map((item) => item.action), ['submit', 'skip_duplicate']);
assert.match(duplicatePlan[1].reason ?? '', /pending sell already active/);

assert.equal(classifyNonceFailure('nonce too low'), 'nonce_too_low');
assert.equal(classifyNonceFailure('replacement transaction underpriced'), 'replacement_underpriced');
assert.equal(classifyNonceFailure('replacement fee too low'), 'replacement_required');
assert.equal(classifyNonceFailure('already known'), 'already_known');
assert.equal(classifyNonceFailure('some rpc timeout'), 'unknown');
assert.equal(recoveryActionForNonceFailure('nonce_too_low'), 'reset_nonce_and_retry');
assert.equal(recoveryActionForNonceFailure('replacement_underpriced'), 'bump_fee_and_replace');
assert.equal(recoveryActionForNonceFailure('replacement_required'), 'bump_fee_and_replace');
assert.equal(recoveryActionForNonceFailure('already_known'), 'wait_for_receipt');
assert.equal(recoveryActionForNonceFailure('unknown'), 'manual_review');

console.log('nonce policy tests passed');
