import { readFileSync } from 'fs';
import path from 'path';
import type { Holder, Transaction, Summary } from './types';
import { getWalletNames as getWalletNamesFromDb } from './db';

const OUTPUT_DIR = path.join(process.cwd(), '..', 'output');

export function getHolders(): Holder[] {
  const raw = readFileSync(path.join(OUTPUT_DIR, 'fat_holders.json'), 'utf-8');
  return JSON.parse(raw);
}

export function getTransactions(): Transaction[] {
  const raw = readFileSync(path.join(OUTPUT_DIR, 'fat_transactions.json'), 'utf-8');
  return JSON.parse(raw);
}

export function getSummary(): Summary {
  const raw = readFileSync(path.join(OUTPUT_DIR, 'fat_summary.json'), 'utf-8');
  return JSON.parse(raw);
}

export function getWalletNames(): Record<string, string> {
  return getWalletNamesFromDb();
}
