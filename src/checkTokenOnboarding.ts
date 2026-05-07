import 'dotenv/config';

import { isAddress, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { buildExitEngineConfigFromEnv } from './onchain-exit-engine/configSchema.js';
import { DIRECT_SELL_DEFAULT_MARKET_ADDRESS } from './onchain-exit-engine/directSellTransaction.js';
import { buildTokenRouteRegistryFromEnv } from './onchain-exit-engine/routeRegistry.js';
import { assessTokenOnboarding } from './onchain-exit-engine/tokenOnboarding.js';
import {
  buildTokenOnboardingCandidateEnv,
  readTokenOnboardingProbeFast,
  type TokenOnboardingProbeResult,
} from './onchain-exit-engine/tokenOnboardingProbe.js';

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : undefined;
}

function tokenArg(): string | undefined {
  return process.argv.slice(2).find((arg) => !arg.startsWith('--'));
}

function short(value: string | undefined): string {
  if (!value) return 'missing';
  if (value.length < 14) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

const tokenAddress = tokenArg();
if (!tokenAddress) {
  console.error('Usage: npm run exit-engine:token-check -- <tokenAddress> [--allow-dry-run] [--require-large-buy] [--no-network] [--market <address>] [--spender <address>]');
  process.exit(1);
}

const config = buildExitEngineConfigFromEnv(process.env);
const requireLive = !process.argv.includes('--allow-dry-run');
const checkNetwork = !process.argv.includes('--no-network');
const marketAddress = argValue('--market') || config.route.marketAddress || DIRECT_SELL_DEFAULT_MARKET_ADDRESS;
const spenderAddress = argValue('--spender') || config.route.approvalSpenderAddress || marketAddress;
let registryEnv: Record<string, string | undefined> = process.env;
let probeResult: TokenOnboardingProbeResult | undefined;
let probeError: string | undefined;

function walletAddressFromConfig(): Address | undefined {
  const privateKey = config.wallet.privateKey;
  if (!privateKey) return undefined;
  try {
    return privateKeyToAccount(privateKey as `0x${string}`).address;
  } catch {
    return undefined;
  }
}

function allowanceSatisfied(result: TokenOnboardingProbeResult | undefined): boolean {
  const allowance = result?.probe.allowance;
  if (!allowance || allowance.status !== 'pass') return false;
  if (allowance.requiredRaw === undefined) return (allowance.allowanceRaw ?? 0n) > 0n;
  if (allowance.requiredRaw <= 0n) return false;
  return (allowance.allowanceRaw ?? 0n) >= allowance.requiredRaw;
}

if (
  checkNetwork &&
  isAddress(tokenAddress) &&
  isAddress(marketAddress) &&
  isAddress(spenderAddress) &&
  (config.rpc.primaryUrl || config.rpc.fallbackUrls.length > 0)
) {
  try {
    probeResult = await readTokenOnboardingProbeFast({
      rpcUrls: [config.rpc.primaryUrl, ...config.rpc.fallbackUrls].filter(Boolean) as string[],
      readTimeoutMs: config.rpc.readTimeoutMs,
      tokenAddress: tokenAddress as Address,
      marketAddress: marketAddress as Address,
      spenderAddress: spenderAddress as Address,
      walletAddress: walletAddressFromConfig(),
      sellPercent: config.execution.sellPercent,
    });
    registryEnv = buildTokenOnboardingCandidateEnv({
      env: process.env,
      tokenAddress,
      marketAddress,
      spenderAddress,
      symbol: probeResult.symbol,
      decimals: probeResult.decimals,
      allowancePreapproved: allowanceSatisfied(probeResult),
    });
  } catch (err) {
    probeError = err instanceof Error ? err.message : String(err);
  }
}

const registry = buildTokenRouteRegistryFromEnv(registryEnv);
const assessment = assessTokenOnboarding({
  registry,
  tokenAddress,
  observedMarketAddress: marketAddress,
  observedApprovalSpenderAddress: spenderAddress,
  probe: probeResult?.probe,
  policy: {
    requireLive,
    requireLargeBuyFallback: process.argv.includes('--require-large-buy'),
    largeBuyFallbackEnabled: config.triggers.largeBuy.enabled,
    largeBuySymbolAllowlist: config.triggers.largeBuy.symbols,
  },
});

console.log('=== Token Onboarding Check ===');
console.log(`token=${short(assessment.tokenAddress)} symbol=${assessment.symbol ?? 'UNKNOWN'}`);
console.log(`decision=${assessment.decision}`);
console.log(`canMonitor=${assessment.canMonitor ? 'yes' : 'no'} canDryRun=${assessment.canDryRun ? 'yes' : 'no'} canLive=${assessment.canLive ? 'yes' : 'no'}`);
if (assessment.route) {
  console.log(`market=${short(assessment.route.marketAddress)} spender=${short(assessment.route.approvalSpenderAddress)} backend=${assessment.route.backendPolicy}`);
  console.log(`verifiedSell=${assessment.route.verifiedSell ? 'yes' : 'no'} preapproved=${assessment.route.allowancePreapproved ? 'yes' : 'no'} mode=${assessment.route.executionMode}`);
}
if (probeResult) {
  const quote = probeResult.probe.quote;
  const allowance = probeResult.probe.allowance;
  const balance = probeResult.probe.balance;
  console.log(`probe=symbol:${probeResult.symbol ?? 'unknown'} decimals:${probeResult.decimals ?? 'unknown'} quote:${quote?.status ?? 'not_checked'} allowance:${allowance?.status ?? 'not_checked'} balance:${balance?.status ?? 'not_checked'}`);
} else if (checkNetwork) {
  console.log(`probe=not_checked${probeError ? ` error=${probeError.slice(0, 160)}` : ''}`);
} else {
  console.log('probe=disabled');
}
console.log(`next=${assessment.nextAction}`);

const errors = assessment.issues.filter((issue) => issue.level === 'error');
const warnings = assessment.issues.filter((issue) => issue.level === 'warning');
if (errors.length > 0) {
  console.log('');
  console.log('Blocking issues:');
  for (const issue of errors) console.log(`- ${issue.code}: ${issue.message}`);
}
if (warnings.length > 0) {
  console.log('');
  console.log('Warnings:');
  for (const issue of warnings) console.log(`- ${issue.code}: ${issue.message}`);
}

if (assessment.decision === 'blocked' || (requireLive && !assessment.canLive)) process.exitCode = 1;
