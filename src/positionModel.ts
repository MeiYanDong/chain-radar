export type RiskState = 'normal' | 'yellow' | 'red_recovering' | 'red_not_recovering' | 'catastrophic';
export type CalendarPhase = 'confirmation_window' | 'burn_pot_window';
export type SignalState =
  | 'no_signal'
  | 'pre_selection_watch'
  | 'pre_selection_critical'
  | 'pre_selection_high'
  | 'watch_only'
  | 'burn_data_invalid'
  | 'burn_early_no_momentum'
  | 'pnl_negative_recovering'
  | 'pnl_negative_weakening'
  | 'pnl_negative'
  | 'pnl_positive_unconfirmed'
  | 'burn_early_signal'
  | 'burn_strengthening'
  | 'burn_confirmed'
  | 'risk_reduced'
  | 'danger_exit';
export type PositionLayer = 'no_position' | 'pre_selection' | 'confirmation' | 'burn_add' | 'reduce' | 'exit';

export interface PositionModelInput {
  selectionScore: number;
  selectionRank?: number | null;
  selectedNow: boolean;
  fundamentalScore?: number | null;
  allocationScore?: number | null;
  allocationUsd?: number | null;
  livePnlUsd?: number | null;
  delta15mUsd?: number | null;
  delta1hUsd?: number | null;
  realizedPnlUsd?: number | null;
  burnQualityScore?: number | null;
  edgeScore?: number | null;
  edgeComplete?: boolean;
  maxAgentCapU?: number;
  minActionTargetU?: number;
  nowMs?: number;
}

export interface PnlAdjustment {
  livePnlRatio: number | null;
  delta15mRatio: number | null;
  delta1hRatio: number | null;
  livePnlPoints: number;
  delta15mPoints: number;
  delta1hPoints: number;
  total: number;
}

export interface RiskResult {
  state: RiskState;
  multiplier: number;
}

export interface PositionModelResult {
  targetU: number;
  rawTargetU: number;
  stage: string;
  calendarPhase: CalendarPhase;
  signalState: SignalState;
  positionLayer: PositionLayer;
  reason: string;
  metrics: Record<string, number | string | null>;
}

const DEFAULT_MAX_AGENT_CAP_U = 200;
const DEFAULT_MIN_ACTION_TARGET_U = 10;
const POSITION_STEP_U = 5;
export const RISK_REDUCE_LOSS_USD = 2_500;
export const RISK_EXIT_LOSS_USD = 4_000;
export const LIVE_PNL_POSITION_TIERS = [
  { thresholdUsd: 1500, targetRatio: 0.45 },
  { thresholdUsd: 3000, targetRatio: 0.5 },
  { thresholdUsd: 4500, targetRatio: 0.55 },
  { thresholdUsd: 6000, targetRatio: 0.6 },
  { thresholdUsd: 7500, targetRatio: 0.65 },
  { thresholdUsd: 10000, targetRatio: 0.75 },
  { thresholdUsd: 15000, targetRatio: 0.9 },
  { thresholdUsd: 20000, targetRatio: 1 },
] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampPercent(value: number): number {
  return clamp(value, 0, 100);
}

function clampRatio(value: number): number {
  return clamp(value, 0, 1);
}

function safeNumber(value: number | null | undefined, fallback = 0): number {
  return value === null || value === undefined || !Number.isFinite(value) ? fallback : value;
}

function safeRatio(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  if (numerator === null || numerator === undefined || !Number.isFinite(numerator)) return null;
  if (denominator === null || denominator === undefined || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

function round(value: number | null | undefined, digits = 2): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const m = 10 ** digits;
  return Math.round(value * m) / m;
}

export function calendarPhaseFromTime(nowMs = Date.now()): CalendarPhase {
  const beijing = new Date(nowMs + 8 * 3_600_000);
  const day = beijing.getUTCDay();
  const minutes = day * 1440 + beijing.getUTCHours() * 60 + beijing.getUTCMinutes();
  const monday0800 = 1 * 1440 + 8 * 60;
  const tuesday0830 = 2 * 1440 + 8 * 60 + 30;
  return minutes >= monday0800 && minutes < tuesday0830
    ? 'confirmation_window'
    : 'burn_pot_window';
}

export function roundPositionU(value: number, minActionTargetU = DEFAULT_MIN_ACTION_TARGET_U): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const rounded = Math.round(value / POSITION_STEP_U) * POSITION_STEP_U;
  if (rounded < minActionTargetU) return 0;
  return rounded;
}

export function fundamentalRatioFromScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return clampRatio(clampPercent(score) / 100);
}

export function preSelectionProgress(selectionScore: number, selectionRank: number): number {
  if (selectionScore >= 75) return 1;
  if (selectionRank <= 10 && selectionScore >= 70) return 2 / 3;
  if (selectionRank <= 10 && selectionScore >= 65) return 1 / 3;
  return 0;
}

export function selectedConfirmationBaseScore(selectionScore: number, allocationScore: number): number {
  return selectionScore * 0.7 + allocationScore * 0.3;
}

export function signedPnlAdjustment(input: {
  allocationUsd?: number | null;
  livePnlUsd?: number | null;
  delta15mUsd?: number | null;
  delta1hUsd?: number | null;
}): PnlAdjustment {
  const livePnlRatio = safeRatio(input.livePnlUsd, input.allocationUsd);
  const delta15mRatio = safeRatio(input.delta15mUsd, input.allocationUsd);
  const delta1hRatio = safeRatio(input.delta1hUsd, input.allocationUsd);
  const livePnlPoints = livePnlRatio === null ? 0 : 35 * Math.tanh(livePnlRatio / 0.2);
  const delta15mPoints = 0;
  const delta1hPoints = 0;

  return {
    livePnlRatio,
    delta15mRatio,
    delta1hRatio,
    livePnlPoints,
    delta15mPoints,
    delta1hPoints,
    total: livePnlPoints + delta15mPoints + delta1hPoints,
  };
}

export function riskFromPnl(input: {
  allocationUsd?: number | null;
  livePnlUsd?: number | null;
  delta15mUsd?: number | null;
  delta1hUsd?: number | null;
  realizedPnlUsd?: number | null;
}): RiskResult {
  const livePnl = safeNumber(input.livePnlUsd);
  const realizedPnl = safeNumber(input.realizedPnlUsd);
  const liveRatio = safeRatio(input.livePnlUsd, input.allocationUsd);
  const hasCatastrophicLoss = livePnl <= -RISK_EXIT_LOSS_USD || realizedPnl <= -RISK_EXIT_LOSS_USD || (liveRatio !== null && liveRatio <= -0.5);
  if (hasCatastrophicLoss) return { state: 'catastrophic', multiplier: 0 };

  const hasYellowLoss = livePnl <= -RISK_REDUCE_LOSS_USD || (liveRatio !== null && liveRatio <= -0.15);
  if (hasYellowLoss) return { state: 'yellow', multiplier: 0.5 };
  return { state: 'normal', multiplier: 1 };
}

export function confirmationProgressFromScore(score: number): number {
  if (score >= 85) return 1;
  if (score >= 75) return 0.875;
  if (score >= 65) return 0.75;
  if (score >= 50) return 0.5;
  if (score >= 35) return 0.25;
  return 0;
}

export function burnProgressFromScore(score: number): number {
  if (!Number.isFinite(score) || score < 40) return 0;
  if (score < 50) return ((score - 40) / 10) * 0.5;
  if (score < 60) return 0.5 + ((score - 50) / 10) * 0.1;
  if (score < 80) return 0.6 + ((score - 60) / 20) * 0.2;
  if (score < 100) return 0.8 + ((score - 80) / 20) * 0.2;
  return 1;
}

export function livePnlTargetRatioFromUsd(livePnlUsd: number): number {
  if (!Number.isFinite(livePnlUsd)) return 0;
  let targetRatio = 0;
  for (const tier of LIVE_PNL_POSITION_TIERS) {
    if (livePnlUsd >= tier.thresholdUsd) targetRatio = tier.targetRatio;
  }
  return targetRatio;
}

export function realizedPnlTargetBonus(realizedPnlUsd: number | null | undefined): number {
  if (realizedPnlUsd === null || realizedPnlUsd === undefined || !Number.isFinite(realizedPnlUsd)) return 0;
  return clamp(0.1 * Math.tanh(realizedPnlUsd / 5000), -0.05, 0.1);
}

function burnStage(progress: number): string {
  if (progress >= 0.95) return 'burn_max';
  if (progress >= 0.8) return 'burn_high';
  if (progress >= 0.6) return 'burn_medium_plus';
  if (progress >= 0.5) return 'burn_medium';
  if (progress > 0) return 'burn_watch';
  return 'selected_confirmation_hold';
}

function preSelectionSignalState(progress: number, selectionScore: number): SignalState {
  if (progress === 1) return 'pre_selection_high';
  if (progress >= 2 / 3) return 'pre_selection_critical';
  if (progress > 0) return 'pre_selection_watch';
  if (selectionScore >= 65) return 'watch_only';
  return 'no_signal';
}

function selectedSignalState(input: {
  risk: RiskResult;
  burnQualityScore: number | null;
  edgeScore: number | null;
  edgeComplete: boolean;
  livePnlUsd: number;
  delta15mUsd?: number | null;
  delta1hUsd?: number | null;
  burnProgress: number;
  rawBurnTargetU: number;
  finalConfirmationTargetU: number;
}): SignalState {
  if (input.risk.multiplier === 0) return 'danger_exit';
  if (input.risk.multiplier < 1) return 'risk_reduced';
  if (input.burnQualityScore === null) return 'burn_data_invalid';
  if (input.burnProgress > 0 && input.rawBurnTargetU > input.finalConfirmationTargetU) {
    return input.burnProgress >= 0.8 ? 'burn_confirmed' : 'burn_strengthening';
  }
  if (input.burnProgress > 0) return 'burn_early_signal';
  const delta15m = safeNumber(input.delta15mUsd);
  const delta1h = safeNumber(input.delta1hUsd);
  if (input.livePnlUsd < 0 && delta15m > 0 && delta1h > 0) return 'pnl_negative_recovering';
  if (input.livePnlUsd < 0 && (delta15m < 0 || delta1h < 0)) return 'pnl_negative_weakening';
  if (input.livePnlUsd < 0) return 'pnl_negative';
  if (input.livePnlUsd > 0) return 'pnl_positive_unconfirmed';
  return 'no_signal';
}

function selectedPositionLayer(input: {
  targetU: number;
  risk: RiskResult;
  rawBurnTargetU: number;
  finalConfirmationTargetU: number;
}): PositionLayer {
  if (input.risk.multiplier === 0) return 'exit';
  if (input.risk.multiplier < 1) return 'reduce';
  if (input.targetU <= 0) return 'no_position';
  if (input.rawBurnTargetU > input.finalConfirmationTargetU) return 'burn_add';
  return 'confirmation';
}

function cleanMetrics(metrics: Record<string, number | string | null>): Record<string, number | string | null> {
  return Object.fromEntries(
    Object.entries(metrics).map(([key, value]) => [
      key,
      typeof value === 'number' ? round(value) : value,
    ]),
  );
}

export function buildPositionModel(input: PositionModelInput): PositionModelResult {
  const maxAgentCapU = safeNumber(input.maxAgentCapU, DEFAULT_MAX_AGENT_CAP_U);
  const minActionTargetU = safeNumber(input.minActionTargetU, DEFAULT_MIN_ACTION_TARGET_U);
  const selectionScore = safeNumber(input.selectionScore);
  const selectionRank = input.selectionRank && Number.isFinite(input.selectionRank)
    ? input.selectionRank
    : Number.POSITIVE_INFINITY;
  const fundamentalScore = safeNumber(input.fundamentalScore, selectionScore);
  const fundamentalRatio = fundamentalRatioFromScore(fundamentalScore);
  const agentCapU = maxAgentCapU * fundamentalRatio;
  const selectionCapU = agentCapU * 0.3;
  const confirmationCapU = agentCapU * 0.4;
  const calendarPhase = calendarPhaseFromTime(input.nowMs);

  if (!input.selectedNow) {
    const progress = preSelectionProgress(selectionScore, selectionRank);
    const rawTargetU = selectionCapU * progress;
    const targetU = roundPositionU(rawTargetU, minActionTargetU);
    const signalState = preSelectionSignalState(progress, selectionScore);
    const positionLayer: PositionLayer = targetU > 0 ? 'pre_selection' : 'no_position';
    const stage = progress === 1
      ? 'selection_high_unselected'
      : progress >= 2 / 3
        ? 'selection_top10_critical_unselected'
        : progress > 0
          ? 'selection_top10_watch_unselected'
          : selectionScore >= 65
            ? 'selection_watchlist'
            : 'selection_low';
    const reason = progress > 0
      ? `入选预期仓 ${targetU}U；该参赛者上限约 ${round(agentCapU)}U`
      : selectionScore >= 65
        ? `只观察；入选分 ${round(selectionScore)}，当前排名 #${selectionRank}，暂不值得建仓`
        : '暂无建仓理由';
    return {
      targetU,
      rawTargetU,
      stage,
      calendarPhase,
      signalState,
      positionLayer,
      reason,
      metrics: cleanMetrics({
        calendarPhase,
        signalState,
        positionLayer,
        fundamentalScore,
        fundamentalRatio,
        agentCapU,
        selectionCapU,
        preSelectionProgress: progress,
        finalTargetRawU: rawTargetU,
      }),
    };
  }

  const allocationScore = safeNumber(input.allocationScore);
  const selectedConfirmationScore = selectedConfirmationBaseScore(selectionScore, allocationScore);
  const pnl = signedPnlAdjustment(input);
  const confirmationPositionScore = selectedConfirmationScore + pnl.total;
  const confirmationProgress = confirmationProgressFromScore(confirmationPositionScore);
  const rawConfirmationTargetU = confirmationCapU * confirmationProgress;
  const risk = riskFromPnl(input);
  const riskCapU = confirmationCapU * risk.multiplier;
  const finalConfirmationTargetU = Math.min(rawConfirmationTargetU, riskCapU);
  const burnQualityScore = input.burnQualityScore ?? null;
  const edgeScore = input.edgeScore ?? null;
  const edgeComplete = Boolean(input.edgeComplete);
  const livePnlUsd = safeNumber(input.livePnlUsd);
  const livePnlTargetRatio = livePnlTargetRatioFromUsd(livePnlUsd);
  const realizedQualityTargetBonus = livePnlTargetRatio > 0
    ? realizedPnlTargetBonus(input.realizedPnlUsd)
    : 0;

  let burnProgress = 0;
  if (risk.multiplier === 1 && livePnlTargetRatio > 0 && burnQualityScore !== null) {
    burnProgress = clampRatio(livePnlTargetRatio + realizedQualityTargetBonus);
  }

  const rawBurnTargetU = agentCapU * burnProgress;
  const rawTargetU = Math.max(finalConfirmationTargetU, rawBurnTargetU);
  const targetU = roundPositionU(rawTargetU, minActionTargetU);
  const signalState = selectedSignalState({
    risk,
    burnQualityScore,
    edgeScore,
    edgeComplete,
    livePnlUsd,
    delta15mUsd: input.delta15mUsd,
    delta1hUsd: input.delta1hUsd,
    burnProgress,
    rawBurnTargetU,
    finalConfirmationTargetU,
  });
  const positionLayer = selectedPositionLayer({
    targetU,
    risk,
    rawBurnTargetU,
    finalConfirmationTargetU,
  });
  const stage = positionLayer;
  const reason = risk.multiplier < 1
    ? `进入${risk.state === 'catastrophic' ? '清仓风险' : '减仓风险'}；目标仓位按风险上限压低`
    : rawBurnTargetU > finalConfirmationTargetU
      ? `实时盈亏进入加仓档位；按当前规则提高目标仓位`
      : `入选确认仓约 ${round(finalConfirmationTargetU)}U；暂未触发回购加仓`;

  return {
    targetU,
    rawTargetU,
    stage,
    calendarPhase,
    signalState,
    positionLayer,
    reason,
    metrics: cleanMetrics({
      calendarPhase,
      signalState,
      positionLayer,
      fundamentalScore,
      fundamentalRatio,
      agentCapU,
      selectionCapU,
      confirmationCapU,
      allocationScore,
      selectedConfirmationScore,
      livePnlRatio: pnl.livePnlRatio,
      delta15mRatio: pnl.delta15mRatio,
      delta1hRatio: pnl.delta1hRatio,
      livePnlPoints: pnl.livePnlPoints,
      delta15mPoints: pnl.delta15mPoints,
      delta1hPoints: pnl.delta1hPoints,
      pnlAdjustment: pnl.total,
      confirmationPositionScore,
      confirmationProgress,
      rawConfirmationTargetU,
      riskState: risk.state,
      riskMultiplier: risk.multiplier,
      riskCapU,
      finalConfirmationTargetU,
      livePnlTargetRatio,
      realizedQualityTargetBonus,
      burnProgress,
      rawBurnTargetU,
      finalTargetRawU: rawTargetU,
    }),
  };
}
