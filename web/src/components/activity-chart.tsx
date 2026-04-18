'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { Transaction } from '@/lib/types';

export function ActivityChart({ transactions }: { transactions: Transaction[] }) {
  const byDay = new Map<string, { date: string; buys: number; sells: number; transfers: number }>();

  for (const tx of transactions) {
    const date = new Date(tx.timestamp * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (!byDay.has(date)) byDay.set(date, { date, buys: 0, sells: 0, transfers: 0 });
    const d = byDay.get(date)!;
    if (tx.type === 'BUY') d.buys += tx.usdAmount;
    else if (tx.type === 'SELL') d.sells += tx.usdAmount;
    else d.transfers++;
  }

  const data = [...byDay.values()];

  return (
    <div className="h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <XAxis dataKey="date" tick={{ fill: '#a1a1aa', fontSize: 12 }} />
          <YAxis tick={{ fill: '#a1a1aa', fontSize: 12 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
          <Tooltip
            contentStyle={{ background: '#27272a', border: '1px solid #3f3f46', borderRadius: 8 }}
            itemStyle={{ color: '#e4e4e7' }}
            formatter={(value) => [`$${Number(value).toFixed(2)}`, '']}
          />
          <Legend wrapperStyle={{ color: '#a1a1aa' }} />
          <Bar dataKey="buys" name="Buys" fill="#10b981" radius={[2, 2, 0, 0]} />
          <Bar dataKey="sells" name="Sells" fill="#ef4444" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
