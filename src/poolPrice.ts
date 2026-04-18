import { client } from './rpc.js';
import { PAIR_POOL, DECIMALS } from './config.js';

export async function getCurrentFatPriceUsd(virtualPriceUsd: number): Promise<number> {
  const data = await client.call({ to: PAIR_POOL, data: '0x0902f1ac' });
  const hex = data.data!;
  const reserve0 = BigInt('0x' + hex.slice(2, 66));
  const reserve1 = BigInt('0x' + hex.slice(66, 130));
  const fatReserve = Number(reserve0) / 10 ** DECIMALS;
  const virtualReserve = Number(reserve1) / 10 ** DECIMALS;
  return (virtualReserve / fatReserve) * virtualPriceUsd;
}
