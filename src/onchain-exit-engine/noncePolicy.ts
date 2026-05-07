export type NonceReservationSource = 'chain' | 'local';
export type BurstSubmissionPolicy = 'reserve_nonce' | 'queue';
export type BurstAction = 'submit' | 'queue' | 'skip_duplicate';
export type NonceFailureKind =
  | 'nonce_too_low'
  | 'replacement_underpriced'
  | 'replacement_required'
  | 'already_known'
  | 'unknown';
export type NonceRecoveryAction =
  | 'reset_nonce_and_retry'
  | 'bump_fee_and_replace'
  | 'wait_for_receipt'
  | 'manual_review';

export interface NonceReservation {
  walletAddress: string;
  nonce: number;
  source: NonceReservationSource;
}

export interface TokenSellLock {
  tokenAddress: string;
  triggerId: string;
  sellTxHash?: string;
  expiresAtMs: number;
}

export interface ExitTriggerForPlanning {
  id: string;
  walletAddress: string;
  tokenAddress: string;
  detectedAtMs: number;
  chainPendingNonce: number;
}

export interface PlannedExitSubmission {
  id: string;
  walletAddress: string;
  tokenAddress: string;
  action: BurstAction;
  queuePosition?: number;
  nonce?: number;
  reason?: string;
}

export interface BurstPlanOptions {
  policy: BurstSubmissionPolicy;
  tokenLockTtlMs?: number;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function safeChainNonce(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

export class WalletNonceManager {
  private readonly nextNonceByWallet = new Map<string, number>();

  reserve(walletAddress: string, chainPendingNonce: number): NonceReservation {
    const wallet = normalizeKey(walletAddress);
    const chainNonce = safeChainNonce(chainPendingNonce);
    const localNext = this.nextNonceByWallet.get(wallet);
    if (localNext === undefined || chainNonce > localNext) {
      this.nextNonceByWallet.set(wallet, chainNonce + 1);
      return { walletAddress: wallet, nonce: chainNonce, source: 'chain' };
    }
    this.nextNonceByWallet.set(wallet, localNext + 1);
    return { walletAddress: wallet, nonce: localNext, source: 'local' };
  }

  sync(walletAddress: string, chainPendingNonce: number): number {
    const wallet = normalizeKey(walletAddress);
    const chainNonce = safeChainNonce(chainPendingNonce);
    const localNext = this.nextNonceByWallet.get(wallet);
    const next = localNext === undefined || chainNonce > localNext ? chainNonce : localNext;
    this.nextNonceByWallet.set(wallet, next);
    return next;
  }

  reset(walletAddress: string): void {
    this.nextNonceByWallet.delete(normalizeKey(walletAddress));
  }

  peek(walletAddress: string): number | undefined {
    return this.nextNonceByWallet.get(normalizeKey(walletAddress));
  }
}

export class TokenSellLockRegistry {
  private readonly locks = new Map<string, TokenSellLock>();
  private readonly ttlMs: number;

  constructor(ttlMs = 180_000) {
    this.ttlMs = Math.max(1_000, Math.floor(ttlMs));
  }

  acquire(tokenAddress: string, triggerId: string, nowMs = Date.now()):
    | { acquired: true; key: string }
    | { acquired: false; key: string; reason: string } {
    this.cleanup(nowMs);
    const key = normalizeKey(tokenAddress);
    const existing = this.locks.get(key);
    if (existing) {
      const suffix = existing.sellTxHash ? ` sell=${existing.sellTxHash}` : '';
      return {
        acquired: false,
        key,
        reason: `pending sell already active for token${suffix}`,
      };
    }
    this.locks.set(key, {
      tokenAddress: key,
      triggerId,
      expiresAtMs: nowMs + this.ttlMs,
    });
    return { acquired: true, key };
  }

  markSubmitted(tokenAddress: string, sellTxHash: string, nowMs = Date.now()): boolean {
    const key = normalizeKey(tokenAddress);
    const existing = this.locks.get(key);
    if (!existing) return false;
    this.locks.set(key, {
      ...existing,
      sellTxHash,
      expiresAtMs: nowMs + this.ttlMs,
    });
    return true;
  }

  release(tokenAddress: string): void {
    this.locks.delete(normalizeKey(tokenAddress));
  }

  cleanup(nowMs = Date.now()): void {
    for (const [key, lock] of this.locks.entries()) {
      if (lock.expiresAtMs <= nowMs) this.locks.delete(key);
    }
  }

  has(tokenAddress: string, nowMs = Date.now()): boolean {
    this.cleanup(nowMs);
    return this.locks.has(normalizeKey(tokenAddress));
  }
}

export function planBurstSubmissions(
  triggers: ExitTriggerForPlanning[],
  options: BurstPlanOptions,
  nonceManager = new WalletNonceManager(),
  lockRegistry = new TokenSellLockRegistry(options.tokenLockTtlMs),
): PlannedExitSubmission[] {
  const walletQueueDepth = new Map<string, number>();
  const ordered = [...triggers].sort((a, b) => a.detectedAtMs - b.detectedAtMs || a.id.localeCompare(b.id));

  return ordered.map((trigger): PlannedExitSubmission => {
    const wallet = normalizeKey(trigger.walletAddress);
    const token = normalizeKey(trigger.tokenAddress);
    const lock = lockRegistry.acquire(token, trigger.id, trigger.detectedAtMs);
    if (!lock.acquired) {
      return {
        id: trigger.id,
        walletAddress: wallet,
        tokenAddress: token,
        action: 'skip_duplicate',
        reason: lock.reason,
      };
    }

    const queuePosition = walletQueueDepth.get(wallet) ?? 0;
    walletQueueDepth.set(wallet, queuePosition + 1);

    if (options.policy === 'queue' && queuePosition > 0) {
      return {
        id: trigger.id,
        walletAddress: wallet,
        tokenAddress: token,
        action: 'queue',
        queuePosition,
        reason: 'wallet submission queue preserves nonce order',
      };
    }

    const reservation = nonceManager.reserve(wallet, trigger.chainPendingNonce);
    return {
      id: trigger.id,
      walletAddress: wallet,
      tokenAddress: token,
      action: 'submit',
      queuePosition,
      nonce: reservation.nonce,
    };
  });
}

export function classifyNonceFailure(error: unknown): NonceFailureKind {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  if (message.includes('nonce too low') || message.includes('nonce has already been used')) return 'nonce_too_low';
  if (message.includes('replacement transaction underpriced') || message.includes('replacement underpriced')) {
    return 'replacement_underpriced';
  }
  if (message.includes('replacement') && (message.includes('fee') || message.includes('price') || message.includes('tip'))) {
    return 'replacement_required';
  }
  if (message.includes('already known') || message.includes('known transaction')) return 'already_known';
  return 'unknown';
}

export function recoveryActionForNonceFailure(kind: NonceFailureKind): NonceRecoveryAction {
  switch (kind) {
    case 'nonce_too_low':
      return 'reset_nonce_and_retry';
    case 'replacement_underpriced':
    case 'replacement_required':
      return 'bump_fee_and_replace';
    case 'already_known':
      return 'wait_for_receipt';
    case 'unknown':
      return 'manual_review';
  }
}
