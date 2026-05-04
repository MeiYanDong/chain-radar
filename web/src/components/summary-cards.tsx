'use client';

import { Card, CardContent } from '@/components/ui/card';
import { formatUsd, formatNumber } from '@/lib/utils';
import type { Summary } from '@/lib/types';

export function SummaryCards({ summary }: { summary: Summary }) {
  const cards = [
    { label: 'Active Holders', value: formatNumber(summary.activeHolders, 0) },
    { label: 'Token Price', value: formatUsd(summary.currentTokenPriceUsd) },
    { label: 'Total Buys', value: formatNumber(summary.totalBuys, 0) },
    { label: 'Total Sells', value: formatNumber(summary.totalSells, 0) },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map((c) => (
        <Card key={c.label} className="bg-zinc-900 border-zinc-800">
          <CardContent className="pt-6">
            <p className="text-sm text-zinc-400">{c.label}</p>
            <p className="text-2xl font-semibold text-zinc-100 mt-1">{c.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
