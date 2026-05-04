import { readFileSync, existsSync } from 'fs';
import path from 'path';
import type { Holder, Transaction, Summary } from './types';
import { getWalletNames as getWalletNamesFromDb } from './db';

const OUTPUT_DIR = path.join(process.cwd(), '..', 'output');

export const AVAILABLE_TOKENS = ['fat', 'argo'] as const;
export type TokenId = (typeof AVAILABLE_TOKENS)[number];

export function getHolders(tokenId: TokenId = 'fat'): Holder[] {
  const file = path.join(OUTPUT_DIR, `${tokenId}_holders.json`);
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, 'utf-8'));
}

export function getTransactions(tokenId: TokenId = 'fat'): Transaction[] {
  const file = path.join(OUTPUT_DIR, `${tokenId}_transactions.json`);
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, 'utf-8'));
}

export function getSummary(tokenId: TokenId = 'fat'): Summary {
  const file = path.join(OUTPUT_DIR, `${tokenId}_summary.json`);
  if (!existsSync(file)) {
    return {
      tokenName: tokenId.toUpperCase(),
      tokenAddress: '',
      chain: 'Base',
      totalHolders: 0, activeHolders: 0,
      totalBuys: 0, totalSells: 0, totalTransfers: 0,
      currentTokenPriceUsd: 0, currentVirtualPriceUsd: 0,
      analyzedAt: new Date().toISOString(),
    };
  }
  return JSON.parse(readFileSync(file, 'utf-8'));
}

export function getWalletNames(): Record<string, string> {
  return getWalletNamesFromDb();
}
