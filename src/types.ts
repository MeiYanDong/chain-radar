export interface TransferEvent {
  txHash: `0x${string}`;
  blockNumber: bigint;
  logIndex: number;
  token: 'FAT' | 'VIRTUAL';
  from: `0x${string}`;
  to: `0x${string}`;
  amount: bigint;
}

export type TxType = 'BUY' | 'SELL' | 'TRANSFER';

export interface ClassifiedTx {
  txHash: `0x${string}`;
  blockNumber: bigint;
  timestamp: number;
  type: TxType;
  user: `0x${string}`;
  counterparty: `0x${string}`;
  fatAmount: bigint;
  virtualAmount: number;
  usdAmount: number;
}

export interface HolderPosition {
  address: `0x${string}`;
  balance: bigint;
  totalBought: bigint;
  totalSold: bigint;
  totalCostVirtual: number;
  totalCostUsd: number;
  realizedPnl: number;
  lastTxTimestamp: number;
}

export interface PricePoint {
  timestamp: number;
  price: number;
}
