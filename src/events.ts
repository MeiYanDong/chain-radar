import { parseAbiItem, decodeEventLog } from 'viem';
import { client, getLogsPaginated } from './rpc.js';
import type { TokenConfig } from './config.js';
import type { TransferEvent } from './types.js';

const transferEventAbi = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)'
);

export async function fetchTokenTransfers(
  token: TokenConfig,
  fromBlock: bigint = token.deployBlock
): Promise<TransferEvent[]> {
  const currentBlock = await client.getBlockNumber();
  const events: TransferEvent[] = [];

  if (fromBlock > currentBlock) return events;

  console.log(
    `  [${token.symbol}] Scanning blocks ${fromBlock} to ${currentBlock} (${currentBlock - fromBlock} blocks)`
  );

  let processed = 0n;
  const total = currentBlock - fromBlock;

  for await (const logs of getLogsPaginated({
    address: token.tokenAddress,
    event: transferEventAbi,
    fromBlock,
    toBlock: currentBlock,
  })) {
    for (const log of logs) {
      const { args } = decodeEventLog({
        abi: [transferEventAbi],
        data: log.data,
        topics: log.topics,
      });

      events.push({
        txHash: log.transactionHash!,
        blockNumber: log.blockNumber!,
        logIndex: log.logIndex!,
        token: token.symbol,
        from: (args as any).from.toLowerCase() as `0x${string}`,
        to: (args as any).to.toLowerCase() as `0x${string}`,
        amount: (args as any).value,
      });
    }

    if (logs.length > 0) {
      processed = logs[logs.length - 1].blockNumber! - fromBlock;
      const pct = Number((processed * 100n) / total);
      process.stdout.write(`\r  [${token.symbol}] Progress: ${pct}%`);
    }
  }

  console.log(`\r  [${token.symbol}] Progress: 100% — ${events.length} transfers found`);
  events.sort((a, b) =>
    a.blockNumber !== b.blockNumber
      ? Number(a.blockNumber - b.blockNumber)
      : a.logIndex - b.logIndex
  );
  return events;
}
