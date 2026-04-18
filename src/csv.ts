import { writeFileSync, mkdirSync } from 'fs';
import { DECIMALS } from './config.js';
import type { HolderPosition } from './types.js';

function toFloat(amount: bigint): number {
  return Number(amount) / 10 ** DECIMALS;
}

export function writeCsv(
  holders: Map<string, HolderPosition>,
  currentFatPriceUsd: number,
  outputPath: string
): void {
  mkdirSync('output', { recursive: true });

  const header =
    'address,current_balance,total_bought,total_sold,total_cost_virtual,total_cost_usd,avg_cost_usd,current_value_usd,unrealized_pnl';

  const rows: string[] = [header];

  const sorted = [...holders.values()]
    .filter((h) => h.balance > 0n)
    .sort((a, b) => (a.balance > b.balance ? -1 : a.balance < b.balance ? 1 : 0));

  for (const h of sorted) {
    const balance = toFloat(h.balance);
    const bought = toFloat(h.totalBought);
    const sold = toFloat(h.totalSold);
    const avgCost = balance > 0 ? h.totalCostUsd / balance : 0;
    const currentValue = balance * currentFatPriceUsd;
    const pnl = currentValue - h.totalCostUsd;

    rows.push(
      [
        h.address,
        balance.toFixed(2),
        bought.toFixed(2),
        sold.toFixed(2),
        h.totalCostVirtual.toFixed(4),
        h.totalCostUsd.toFixed(2),
        avgCost.toFixed(8),
        currentValue.toFixed(2),
        pnl.toFixed(2),
      ].join(',')
    );
  }

  writeFileSync(outputPath, rows.join('\n') + '\n');
  console.log(`  CSV written to ${outputPath} (${sorted.length} holders)`);
}
