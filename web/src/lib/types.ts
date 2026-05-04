export interface Holder {
  rank: number;
  address: string;
  balance: number;
  totalBought: number;
  totalSold: number;
  totalCostVirtual: number;
  totalCostUsd: number;
  avgCostUsd: number;
  currentValueUsd: number;
  unrealizedPnl: number;
  realizedPnl: number;
  buyMarketCap: number;
  lastTxTimestamp: number;
}

export interface Transaction {
  txHash: string;
  blockNumber: number;
  timestamp: number;
  type: 'BUY' | 'SELL' | 'TRANSFER';
  user: string;
  counterparty: string;
  fatAmount: number;
  virtualAmount: number;
  usdAmount: number;
}

export interface Summary {
  tokenName: string;
  tokenAddress: string;
  chain: string;
  totalHolders: number;
  activeHolders: number;
  totalBuys: number;
  totalSells: number;
  totalTransfers: number;
  currentTokenPriceUsd: number;
  currentVirtualPriceUsd: number;
  analyzedAt: string;
}
