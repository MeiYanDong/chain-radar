import { getHolders, getTransactions } from '@/lib/data';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { formatUsd, formatNumber, formatDate, shortenAddress } from '@/lib/utils';

export default async function AddressPage({
  params,
}: {
  params: Promise<{ addr: string }>;
}) {
  const { addr } = await params;
  const address = addr.toLowerCase();
  const holders = getHolders();
  const transactions = getTransactions();

  const holder = holders.find((h) => h.address.toLowerCase() === address);
  const txs = transactions.filter((t) => t.user.toLowerCase() === address || t.counterparty.toLowerCase() === address);

  if (!holder && txs.length === 0) {
    return (
      <div className="max-w-4xl mx-auto">
        <p className="text-zinc-400">Address not found: {addr}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-bold font-mono">{addr}</h1>

      {holder && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[
            { label: 'Balance', value: formatNumber(holder.balance / 10000, 0) + ' 万 FAT' },
            { label: '花费 (USD)', value: formatUsd(Math.round(holder.totalCostUsd)) },
            { label: '买入市值', value: formatNumber(holder.buyMarketCap / 10000, 2) + ' 万USD' },
            { label: 'Current Value', value: formatUsd(holder.currentValueUsd) },
            {
              label: '未实现收益',
              value: formatUsd(Math.round(holder.unrealizedPnl)),
              color: holder.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400',
            },
            {
              label: '已实现收益',
              value: formatUsd(Math.round(holder.realizedPnl)),
              color: holder.realizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400',
            },
          ].map((c) => (
            <Card key={c.label} className="bg-zinc-900 border-zinc-800">
              <CardContent className="pt-6">
                <p className="text-sm text-zinc-400">{c.label}</p>
                <p className={`text-xl font-semibold mt-1 ${c.color || 'text-zinc-100'}`}>
                  {c.value}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader>
          <CardTitle className="text-zinc-100">Transaction History ({txs.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-400">Date</TableHead>
                <TableHead className="text-zinc-400">Type</TableHead>
                <TableHead className="text-zinc-400">FAT Amount</TableHead>
                <TableHead className="text-zinc-400">VIRTUAL</TableHead>
                <TableHead className="text-zinc-400">USD</TableHead>
                <TableHead className="text-zinc-400">Tx</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {txs.map((tx, i) => {
                const isSender = tx.user.toLowerCase() !== address;
                return (
                  <TableRow key={`${tx.txHash}-${i}`} className="border-zinc-800">
                    <TableCell className="text-zinc-300 text-sm">{formatDate(tx.timestamp)}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          tx.type === 'BUY'
                            ? 'border-emerald-500 text-emerald-400'
                            : tx.type === 'SELL'
                            ? 'border-red-500 text-red-400'
                            : 'border-zinc-500 text-zinc-400'
                        }
                      >
                        {tx.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-zinc-100 font-mono">{formatNumber(tx.fatAmount, 0)}</TableCell>
                    <TableCell className="text-zinc-300">{tx.virtualAmount > 0 ? formatNumber(tx.virtualAmount, 2) : '-'}</TableCell>
                    <TableCell className="text-zinc-300">{tx.usdAmount > 0 ? formatUsd(tx.usdAmount) : '-'}</TableCell>
                    <TableCell>
                      <a
                        href={`https://basescan.org/tx/${tx.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 text-sm font-mono"
                      >
                        {shortenAddress(tx.txHash)}
                      </a>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
