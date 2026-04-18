import { createPublicClient, http, type Log } from 'viem';
import { base } from 'viem/chains';
import { RPC_URL, BLOCK_RANGE_SIZE } from './config.js';

export const client = createPublicClient({
  chain: base,
  transport: http(RPC_URL, { retryCount: 5, retryDelay: 2000 }),
});

const timestampCache = new Map<string, number>();

export async function getBlockTimestamp(blockNumber: bigint): Promise<number> {
  const key = blockNumber.toString();
  if (timestampCache.has(key)) return timestampCache.get(key)!;

  const block = await retryOnRateLimit(() => client.getBlock({ blockNumber }));
  const ts = Number(block.timestamp);
  timestampCache.set(key, ts);
  return ts;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function retryOnRateLimit<T>(
  fn: () => Promise<T>,
  maxRetries = 5
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const isRateLimit =
        err?.code === -32016 ||
        err?.cause?.code === -32016 ||
        String(err?.details || err?.message || '').includes('rate limit');
      if (isRateLimit && i < maxRetries - 1) {
        await sleep(2000 * (i + 1));
        continue;
      }
      throw err;
    }
  }
  throw new Error('unreachable');
}

export async function* getLogsPaginated(params: {
  address: `0x${string}`;
  event: any;
  fromBlock: bigint;
  toBlock: bigint;
}): AsyncGenerator<Log[]> {
  let currentFrom = params.fromBlock;
  let rangeSize = BLOCK_RANGE_SIZE;

  while (currentFrom <= params.toBlock) {
    const currentTo =
      currentFrom + rangeSize - 1n > params.toBlock
        ? params.toBlock
        : currentFrom + rangeSize - 1n;

    try {
      const logs = await client.getLogs({
        address: params.address,
        event: params.event,
        fromBlock: currentFrom,
        toBlock: currentTo,
      });

      if (logs.length > 0) yield logs;

      currentFrom = currentTo + 1n;
      rangeSize = BLOCK_RANGE_SIZE;
      await sleep(80);
    } catch (err: any) {
      const isRateLimit =
        err?.code === -32016 ||
        err?.cause?.code === -32016 ||
        String(err?.details || err?.message || '').includes('rate limit');
      if (isRateLimit) {
        await sleep(3000);
        continue;
      }
      if (rangeSize > 100n) {
        rangeSize = rangeSize / 2n;
        continue;
      }
      throw err;
    }
  }
}
