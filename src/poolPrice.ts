import { client } from './rpc.js';
import { DECIMALS } from './config.js';

export async function getCurrentTokenPriceUsd(pairPool: `0x${string}`, virtualPriceUsd: number): Promise<number> {
  const data = await client.call({ to: pairPool, data: '0x0902f1ac' });
  const hex = data.data!;
  const reserve0 = BigInt('0x' + hex.slice(2, 66));
  const reserve1 = BigInt('0x' + hex.slice(66, 130));
  const tokenReserve = Number(reserve0) / 10 ** DECIMALS;
  const virtualReserve = Number(reserve1) / 10 ** DECIMALS;
  return (virtualReserve / tokenReserve) * virtualPriceUsd;
}
