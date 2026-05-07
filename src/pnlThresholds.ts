export type ThresholdPrefix = '+' | '-';

export function triggeredThresholdKeys(
  livePnl: number,
  positiveThresholds: number[],
  negativeThresholds: number[],
): Set<string> {
  const triggered = new Set<string>();
  for (const threshold of positiveThresholds) {
    if (livePnl >= threshold) triggered.add(`+${threshold}`);
  }
  for (const threshold of negativeThresholds) {
    if (livePnl <= -threshold) triggered.add(`-${threshold}`);
  }
  return triggered;
}

export function highestTriggeredTier(
  triggered: Set<string>,
  prefix: ThresholdPrefix,
  thresholds: number[],
): number {
  return thresholds
    .filter((threshold) => triggered.has(`${prefix}${threshold}`))
    .sort((a, b) => b - a)[0] ?? 0;
}

export function positiveTierForLivePnl(livePnl: number, thresholds: number[]): number {
  return thresholds
    .filter((threshold) => livePnl >= threshold)
    .sort((a, b) => b - a)[0] ?? 0;
}

export function positiveTierWithDropBuffer(
  livePnl: number,
  previousTier: number,
  thresholds: number[],
  dropBufferRatio: number,
): number {
  const rawTier = positiveTierForLivePnl(livePnl, thresholds);
  if (rawTier > previousTier) return rawTier;
  if (previousTier > 0 && livePnl >= previousTier * dropBufferRatio) return previousTier;
  return rawTier;
}

export function negativeTierForLivePnl(livePnl: number, thresholds: number[]): number {
  const loss = Math.abs(Math.min(livePnl, 0));
  return thresholds
    .filter((threshold) => loss >= threshold)
    .sort((a, b) => b - a)[0] ?? 0;
}

export function negativeTierWithRecoveryBuffer(
  livePnl: number,
  previousTier: number,
  thresholds: number[],
  dropBufferRatio: number,
): number {
  const loss = Math.abs(Math.min(livePnl, 0));
  const rawTier = negativeTierForLivePnl(livePnl, thresholds);
  if (rawTier > previousTier) return rawTier;
  if (previousTier > 0 && loss >= previousTier * dropBufferRatio) return previousTier;
  return rawTier;
}

export function replaceTierKeys(
  triggered: Set<string>,
  prefix: ThresholdPrefix,
  thresholds: number[],
  currentTier: number,
) {
  for (const threshold of thresholds) triggered.delete(`${prefix}${threshold}`);
  for (const threshold of thresholds.filter((value) => value <= currentTier)) {
    triggered.add(`${prefix}${threshold}`);
  }
}

export function nextTierAfterSentTransition(
  latestTier: number,
  previousTier: number,
  currentTier: number,
): number {
  if (previousTier === currentTier) return latestTier;
  if (currentTier > previousTier) return Math.max(latestTier, currentTier);
  return latestTier === previousTier ? currentTier : latestTier;
}
