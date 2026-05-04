import 'dotenv/config';
import { buildAutoSellReadinessReport } from './autoSell.js';

const checkNetwork = !process.argv.includes('--no-network');
const requireLive = !process.argv.includes('--allow-dry-run');

const report = await buildAutoSellReadinessReport({ checkNetwork, requireLive });
const errors = report.issues.filter((issue) => issue.level === 'error');
const warnings = report.issues.filter((issue) => issue.level === 'warning');

console.log('=== Auto Sell Readiness ===');
console.log(`status=${report.ok ? 'ready' : 'not-ready'}`);
console.log(`enabled=${report.enabled ? 'yes' : 'no'} dryRun=${report.dryRun ? 'yes' : 'no'} rpc=${report.rpcCount} preapprovedPairs=${report.preapprovedPairs}`);
console.log(`wallet=${report.wallet ? `${report.wallet.slice(0, 8)}...${report.wallet.slice(-6)}` : 'missing'}`);
console.log(`market=${report.marketAddress.slice(0, 8)}...${report.marketAddress.slice(-6)}`);
console.log(`spender=${report.approvalSpenderAddress.slice(0, 8)}...${report.approvalSpenderAddress.slice(-6)}`);
console.log('');

for (const check of report.checks) {
  const prefix = check.status === 'pass' ? 'PASS' : check.status === 'warn' ? 'WARN' : 'FAIL';
  console.log(`[${prefix}] ${check.key}: ${check.message}`);
}

if (errors.length > 0) {
  console.log('');
  console.log('Blocking issues:');
  for (const issue of errors) console.log(`- ${issue.message}`);
}
if (warnings.length > 0) {
  console.log('');
  console.log('Warnings:');
  for (const issue of warnings) console.log(`- ${issue.message}`);
}

if (errors.length > 0) process.exitCode = 1;
