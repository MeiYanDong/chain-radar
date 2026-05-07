import { getHolders, getTransactions, getSummary, getWalletNames, AVAILABLE_TOKENS } from '@/lib/data';
import type { TokenId } from '@/lib/data';
import { DashboardClient } from '@/components/dashboard-client';

export const dynamic = 'force-dynamic';

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const params = await searchParams;
  const tokenId = (AVAILABLE_TOKENS.includes(params.token as TokenId) ? params.token : 'fat') as TokenId;

  const holders = getHolders(tokenId);
  const transactions = getTransactions(tokenId);
  const summary = getSummary(tokenId);
  const walletNames = getWalletNames();

  return (
    <DashboardClient
      initialHolders={holders}
      initialTransactions={transactions}
      initialSummary={summary}
      walletNames={walletNames}
      tokenId={tokenId}
    />
  );
}
