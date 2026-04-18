import { getHolders, getTransactions, getSummary, getWalletNames } from '@/lib/data';
import { DashboardClient } from '@/components/dashboard-client';

export const dynamic = 'force-dynamic';

export default function Dashboard() {
  const holders = getHolders();
  const transactions = getTransactions();
  const summary = getSummary();
  const walletNames = getWalletNames();

  return (
    <DashboardClient
      initialHolders={holders}
      initialTransactions={transactions}
      initialSummary={summary}
      walletNames={walletNames}
    />
  );
}
