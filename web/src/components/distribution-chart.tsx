'use client';

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { formatNumber } from '@/lib/utils';
import type { Holder } from '@/lib/types';

const COLORS = [
  '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981',
  '#06b6d4', '#f97316', '#84cc16', '#e879f9', '#6366f1',
];

function getPayloadPct(entry: unknown): string {
  if (typeof entry !== 'object' || entry === null || !('payload' in entry)) {
    return '0.0';
  }
  const payload = (entry as { payload?: { pct?: unknown } }).payload;
  return typeof payload?.pct === 'string' ? payload.pct : '0.0';
}

export function DistributionChart({ holders }: { holders: Holder[] }) {
  const totalBalance = holders.reduce((s, h) => s + h.balance, 0);
  const top10 = holders.slice(0, 10);
  const othersBalance = totalBalance - top10.reduce((s, h) => s + h.balance, 0);

  const data = [
    ...top10.map((h) => ({
      name: `${h.address.slice(0, 6)}...${h.address.slice(-4)}`,
      value: h.balance,
      pct: ((h.balance / totalBalance) * 100).toFixed(1),
    })),
    ...(othersBalance > 0
      ? [{ name: 'Others', value: othersBalance, pct: ((othersBalance / totalBalance) * 100).toFixed(1) }]
      : []),
  ];

  return (
    <div className="h-[350px]">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={120}
            innerRadius={60}
            strokeWidth={1}
            stroke="#18181b"
          >
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ background: '#27272a', border: '1px solid #3f3f46', borderRadius: 8 }}
            itemStyle={{ color: '#e4e4e7' }}
            formatter={(value: unknown, name: unknown, entry: unknown) => {
              const numericValue = typeof value === 'number' || typeof value === 'string'
                ? Number(value)
                : 0;
              return [`${formatNumber(numericValue, 0)} FAT (${getPayloadPct(entry)}%)`, String(name)];
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
