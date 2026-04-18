'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { shortenAddress, formatUsd, formatNumber, formatDate } from '@/lib/utils';
import type { Holder } from '@/lib/types';

interface Props {
  holders: Holder[];
  walletNames: Record<string, string>;
}

export function HolderTable({ holders, walletNames: initialNames }: Props) {
  const [names, setNames] = useState<Record<string, string>>(initialNames);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  async function saveName(address: string) {
    const name = editValue.trim();
    await fetch('/api/wallet-names', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, name }),
    });
    setNames(prev => {
      const next = { ...prev };
      if (name) next[address] = name;
      else delete next[address];
      return next;
    });
    setEditing(null);
  }

  function startEdit(address: string) {
    setEditing(address);
    setEditValue(names[address] || '');
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="border-zinc-800 hover:bg-transparent">
          <TableHead className="text-zinc-400">#</TableHead>
          <TableHead className="text-zinc-400">钱包地址</TableHead>
          <TableHead className="text-zinc-400 text-right">花费 (USD)</TableHead>
          <TableHead className="text-zinc-400 text-right">累计代币 (万)</TableHead>
          <TableHead className="text-zinc-400 text-right">买入市值 (万USD)</TableHead>
          <TableHead className="text-zinc-400 text-right">未实现收益</TableHead>
          <TableHead className="text-zinc-400 text-right">已实现收益</TableHead>
          <TableHead className="text-zinc-400 text-right">更新时间</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {holders.map((h) => (
          <TableRow key={h.address} className="border-zinc-800 hover:bg-zinc-800/50">
            <TableCell className="text-zinc-400">{h.rank}</TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <Link
                  href={`/address/${h.address}`}
                  className="text-blue-400 hover:text-blue-300 font-mono text-sm"
                >
                  {names[h.address] || shortenAddress(h.address)}
                </Link>
                {editing === h.address ? (
                  <form
                    className="flex items-center gap-1"
                    onSubmit={(e) => { e.preventDefault(); saveName(h.address); }}
                  >
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => saveName(h.address)}
                      className="bg-zinc-800 border border-zinc-600 rounded px-1.5 py-0.5 text-xs text-zinc-100 w-24"
                      placeholder="命名"
                    />
                  </form>
                ) : (
                  <button
                    onClick={() => startEdit(h.address)}
                    className="text-zinc-600 hover:text-zinc-400 text-xs"
                    title="编辑名称"
                  >
                    ✎
                  </button>
                )}
              </div>
            </TableCell>
            <TableCell className="text-zinc-300 text-right font-mono">
              {formatUsd(Math.round(h.totalCostUsd))}
            </TableCell>
            <TableCell className="text-zinc-100 text-right font-mono">
              {formatNumber(h.balance / 10000, 0)}
            </TableCell>
            <TableCell className="text-zinc-300 text-right font-mono">
              {formatNumber(h.buyMarketCap / 10000, 2)}
            </TableCell>
            <TableCell className={`text-right font-mono ${h.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {formatUsd(Math.round(h.unrealizedPnl))}
            </TableCell>
            <TableCell className={`text-right font-mono ${h.realizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {formatUsd(Math.round(h.realizedPnl))}
            </TableCell>
            <TableCell className="text-zinc-400 text-right text-sm">
              {h.lastTxTimestamp > 0 ? formatDate(h.lastTxTimestamp) : '-'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}