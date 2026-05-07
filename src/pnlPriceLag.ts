export interface PnlPricePoint {
  timestamp: number;
  livePnl: number;
  tokenPriceUsd: number;
}

export interface LagCorrelation {
  lagMinutes: number;
  samples: number;
  correlation: number | null;
}

export interface LagAnalysisResult {
  token: string;
  points: number;
  pricedPoints: number;
  startTimestamp: number | null;
  endTimestamp: number | null;
  correlations: LagCorrelation[];
  best: LagCorrelation | null;
  verdict: string;
}

function nearestPoint(points: PnlPricePoint[], targetTimestamp: number, maxDistanceSeconds: number): PnlPricePoint | null {
  let best: PnlPricePoint | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const distance = Math.abs(point.timestamp - targetTimestamp);
    if (distance <= maxDistanceSeconds && distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return best;
}

export function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const xMean = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const yMean = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  let numerator = 0;
  let xDenominator = 0;
  let yDenominator = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const x = xs[i] - xMean;
    const y = ys[i] - yMean;
    numerator += x * y;
    xDenominator += x * x;
    yDenominator += y * y;
  }
  const denominator = Math.sqrt(xDenominator * yDenominator);
  if (denominator === 0) return null;
  return numerator / denominator;
}

export function lagCorrelation(
  points: PnlPricePoint[],
  lagMinutes: number,
  baseWindowMinutes: number,
  maxDistanceSeconds = 90,
): LagCorrelation {
  const sorted = [...points]
    .filter((point) => Number.isFinite(point.livePnl) && Number.isFinite(point.tokenPriceUsd) && point.tokenPriceUsd > 0)
    .sort((a, b) => a.timestamp - b.timestamp);
  const pnlDeltas: number[] = [];
  const priceReturns: number[] = [];
  const baseWindowSeconds = baseWindowMinutes * 60;
  const lagSeconds = lagMinutes * 60;

  for (const point of sorted) {
    const pnlBase = nearestPoint(sorted, point.timestamp - baseWindowSeconds, maxDistanceSeconds);
    const priceBase = nearestPoint(sorted, point.timestamp + lagSeconds - baseWindowSeconds, maxDistanceSeconds);
    const priceEnd = nearestPoint(sorted, point.timestamp + lagSeconds, maxDistanceSeconds);
    if (!pnlBase || !priceBase || !priceEnd) continue;
    if (priceBase.tokenPriceUsd <= 0 || priceEnd.tokenPriceUsd <= 0) continue;
    pnlDeltas.push(point.livePnl - pnlBase.livePnl);
    priceReturns.push(Math.log(priceEnd.tokenPriceUsd / priceBase.tokenPriceUsd));
  }

  return {
    lagMinutes,
    samples: pnlDeltas.length,
    correlation: pearson(pnlDeltas, priceReturns),
  };
}

export function analyzeLagSeries(input: {
  token: string;
  points: PnlPricePoint[];
  lagMinutes: number[];
  baseWindowMinutes: number;
  minSamples?: number;
  maxDistanceSeconds?: number;
}): LagAnalysisResult {
  const sorted = [...input.points].sort((a, b) => a.timestamp - b.timestamp);
  const priced = sorted.filter((point) => Number.isFinite(point.tokenPriceUsd) && point.tokenPriceUsd > 0);
  const minSamples = input.minSamples ?? 12;
  const correlations = input.lagMinutes.map((lag) => lagCorrelation(
    priced,
    lag,
    input.baseWindowMinutes,
    input.maxDistanceSeconds ?? 90,
  ));
  const usable = correlations
    .filter((item): item is LagCorrelation & { correlation: number } => item.samples >= minSamples && item.correlation !== null)
    .sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
  const best = usable[0] ?? null;
  let verdict = '样本不足，不能判断滞后关系';
  if (best) {
    const direction = best.lagMinutes > 0
      ? `P&L 变化可能领先价格约 ${best.lagMinutes} 分钟`
      : best.lagMinutes < 0
        ? `价格可能领先 P&L 变化约 ${Math.abs(best.lagMinutes)} 分钟`
        : 'P&L 与价格变化更接近同步';
    verdict = `${direction}，相关系数 ${best.correlation.toFixed(3)}，样本 ${best.samples}`;
  }
  return {
    token: input.token,
    points: sorted.length,
    pricedPoints: priced.length,
    startTimestamp: sorted[0]?.timestamp ?? null,
    endTimestamp: sorted[sorted.length - 1]?.timestamp ?? null,
    correlations,
    best,
    verdict,
  };
}
