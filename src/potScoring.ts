export interface BurnMarketLike {
  market_cap_usd?: number | null;
  fdv_usd?: number | null;
  liquidity_usd?: number | null;
  marketCapUsd?: number | null;
  fdvUsd?: number | null;
  liquidityUsd?: number | null;
}

export interface BurnImpactResult {
  score: number;
  marketImpactScore: number;
  liquidityImpactScore: number;
  marketImpactRatio: number | null;
  liquidityImpactRatio: number | null;
  marketRatio: number | null;
  liquidityRatio: number | null;
}

export interface PotBurnQualityResult {
  total: number;
  estimatedBurnUsd: number;
  impact: BurnImpactResult;
  parts: {
    pot_live_pnl_foundation_score: number;
    burn_impact_score: number;
    burn_impact_market_score: number;
    burn_impact_liquidity_score: number;
    pot_realized_quality_points: number;
  };
}

export interface PotEdgeResult {
  total: number;
  complete: boolean;
  missingFields: string[];
  parts: {
    delta_15m_score: number | null;
    delta_1h_score: number | null;
    burn_impact_score: number;
    pot_live_pnl_edge_score: number;
  };
}

export function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function symmetricTanhScore(value: number, scale: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(scale) || scale <= 0) return 50;
  return clampPercent(50 + 50 * Math.tanh(value / scale));
}

export function positiveTanhScore(value: number, scale: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(scale) || scale <= 0) return 0;
  return clampPercent(100 * Math.tanh(Math.max(0, value) / scale));
}

export function estimatedBurnUsd(potLivePnlUsd: number): number {
  return Math.max(0, potLivePnlUsd) * 0.5;
}

export function potRealizedQualityPoints(potRealizedPnlUsd: number): number {
  if (!Number.isFinite(potRealizedPnlUsd)) return 0;
  return 20 * Math.tanh(potRealizedPnlUsd / 5000);
}

export function burnImpactScore(
  estimatedBurnUsdValue: number,
  market: BurnMarketLike | null,
): BurnImpactResult {
  const marketCapUsd = market?.market_cap_usd ?? market?.marketCapUsd ?? market?.fdv_usd ?? market?.fdvUsd ?? null;
  const liquidityUsd = market?.liquidity_usd ?? market?.liquidityUsd ?? null;
  const marketImpactRatio = marketCapUsd && marketCapUsd > 0 ? estimatedBurnUsdValue / marketCapUsd : null;
  const liquidityImpactRatio = liquidityUsd && liquidityUsd >= 100 ? estimatedBurnUsdValue / liquidityUsd : null;
  const marketImpactScore = marketImpactRatio === null ? 0 : positiveTanhScore(marketImpactRatio, 0.003);
  const liquidityImpactScore = liquidityImpactRatio === null ? 0 : positiveTanhScore(liquidityImpactRatio, 0.02);

  return {
    score: marketImpactScore * 0.6 + liquidityImpactScore * 0.4,
    marketImpactScore,
    liquidityImpactScore,
    marketImpactRatio,
    liquidityImpactRatio,
    marketRatio: marketImpactRatio,
    liquidityRatio: liquidityImpactRatio,
  };
}

export function potBurnQualityScore(input: {
  potLivePnlUsd: number;
  potRealizedPnlUsd: number;
  market: BurnMarketLike | null;
}): PotBurnQualityResult {
  const potLivePnlFoundationScore = positiveTanhScore(input.potLivePnlUsd, 5000);
  const estimatedBurn = estimatedBurnUsd(input.potLivePnlUsd);
  const impact = burnImpactScore(estimatedBurn, input.market);
  const realizedQualityPoints = potRealizedQualityPoints(input.potRealizedPnlUsd);
  const total = clampPercent(
    potLivePnlFoundationScore * 0.7
    + impact.score * 0.2
    + realizedQualityPoints,
  );

  return {
    total,
    estimatedBurnUsd: estimatedBurn,
    impact,
    parts: {
      pot_live_pnl_foundation_score: potLivePnlFoundationScore,
      burn_impact_score: impact.score,
      burn_impact_market_score: impact.marketImpactScore,
      burn_impact_liquidity_score: impact.liquidityImpactScore,
      pot_realized_quality_points: realizedQualityPoints,
    },
  };
}

export function potEdgeScore(input: {
  potLivePnlUsd: number;
  potDelta15mUsd: number | null;
  potDelta1hUsd: number | null;
  burnImpactScore: number;
}): PotEdgeResult {
  const delta15mScore = input.potDelta15mUsd === null ? null : symmetricTanhScore(input.potDelta15mUsd, 2000);
  const delta1hScore = input.potDelta1hUsd === null ? null : symmetricTanhScore(input.potDelta1hUsd, 5000);
  const livePnlEdgeScore = positiveTanhScore(input.potLivePnlUsd, 5000);
  const total = clampPercent(livePnlEdgeScore * 0.8 + input.burnImpactScore * 0.2);

  return {
    total,
    complete: true,
    missingFields: [],
    parts: {
      delta_15m_score: delta15mScore,
      delta_1h_score: delta1hScore,
      burn_impact_score: input.burnImpactScore,
      pot_live_pnl_edge_score: livePnlEdgeScore,
    },
  };
}
