'use client';

import { useRouter } from 'next/navigation';
import { useLiveData } from '@/hooks/use-live-updates';
import { SummaryCards } from '@/components/summary-cards';
import { HolderTable } from '@/components/holder-table';
import { DistributionChart } from '@/components/distribution-chart';
import { ActivityChart } from '@/components/activity-chart';
import { AddressSearch } from '@/components/address-search';
import { LiveIndicator } from '@/components/live-indicator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Holder, Transaction, Summary } from '@/lib/types';

const TOKEN_OPTIONS = [
  { id: 'fat', label: '$FAT', name: 'Fat Tiger' },
  { id: 'argo', label: '$ARGO', name: 'Argonaut AI' },
];

interface Props {
  initialHolders: Holder[];
  initialTransactions: Transaction[];
  initialSummary: Summary;
  walletNames: Record<string, string>;
  tokenId: string;
}

export function DashboardClient({ initialHolders, initialTransactions, initialSummary, walletNames, tokenId }: Props) {
  const router = useRouter();
  const { holders, transactions, summary } = useLiveData({
    holders: initialHolders,
    transactions: initialTransactions,
    summary: initialSummary,
  }, tokenId);

  const top20 = holders.slice(0, 20);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{summary.tokenName || tokenId.toUpperCase()} Dashboard</h1>
            <div className="flex gap-1">
              {TOKEN_OPTIONS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => router.push(`/?token=${t.id}`)}
                  className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                    tokenId === t.id
                      ? 'bg-zinc-100 text-zinc-900'
                      : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-sm text-zinc-400">
              Analyzed {new Date(summary.analyzedAt).toLocaleString()}
            </p>
            <LiveIndicator />
          </div>
        </div>
        <AddressSearch tokenId={tokenId} />
      </div>

      <SummaryCards summary={summary} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-zinc-100">Holder Leaderboard</CardTitle>
          </CardHeader>
          <CardContent>
            <HolderTable holders={top20} walletNames={walletNames} />
          </CardContent>
        </Card>

        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-zinc-100">Distribution (Top 10)</CardTitle>
          </CardHeader>
          <CardContent>
            <DistributionChart holders={holders} />
          </CardContent>
        </Card>
      </div>

      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader>
          <CardTitle className="text-zinc-100">Trading Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <ActivityChart transactions={transactions} />
        </CardContent>
      </Card>
    </div>
  );
}