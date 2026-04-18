import { COINGECKO_API_KEY } from './config.js';
import type { PricePoint } from './types.js';

const BASE_URL = COINGECKO_API_KEY?.startsWith('CG-')
  ? 'https://pro-api.coingecko.com/api/v3'
  : 'https://api.coingecko.com/api/v3';

export async function fetchVirtualPriceHistory(
  fromTimestamp: number,
  toTimestamp: number
): Promise<PricePoint[]> {
  const url = `${BASE_URL}/coins/virtual-protocol/market_chart/range?vs_currency=usd&from=${fromTimestamp}&to=${toTimestamp}`;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (COINGECKO_API_KEY) {
    const key = COINGECKO_API_KEY.startsWith('CG-')
      ? 'x-cg-pro-api-key'
      : 'x-cg-demo-api-key';
    headers[key] = COINGECKO_API_KEY;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`CoinGecko API error: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { prices: [number, number][] };
  return data.prices.map(([ts, price]) => ({ timestamp: ts, price }));
}

export function interpolatePrice(
  timestampSec: number,
  history: PricePoint[]
): number {
  if (history.length === 0) return 0;

  const tsMs = timestampSec * 1000;

  if (tsMs <= history[0].timestamp) return history[0].price;
  if (tsMs >= history[history.length - 1].timestamp)
    return history[history.length - 1].price;

  let lo = 0;
  let hi = history.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (history[mid].timestamp <= tsMs) lo = mid;
    else hi = mid;
  }

  const t0 = history[lo].timestamp;
  const t1 = history[hi].timestamp;
  const p0 = history[lo].price;
  const p1 = history[hi].price;

  if (t1 === t0) return p0;
  const ratio = (tsMs - t0) / (t1 - t0);
  return p0 + (p1 - p0) * ratio;
}
