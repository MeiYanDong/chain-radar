# Extraction Decision

Date: 2026-05-07

Decision: do not extract to `/Users/myandong/Projects/onchain-exit-engine` yet.

## What Is Ready

- `npm run exit-engine:test` runs independently of the Pot Monitor tests.
- The first reusable code boundary exists:
  - `src/onchain-exit-engine/executionState.ts`
  - `src/onchain-exit-engine/routeRegistry.ts`
  - `src/onchain-exit-engine/noncePolicy.ts`
  - `src/onchain-exit-engine/triggers.ts`
  - `src/onchain-exit-engine/directSellBackend.ts`
  - `src/onchain-exit-engine/directSellTransaction.ts`
  - `src/onchain-exit-engine/directSellSubmission.ts`
  - `src/onchain-exit-engine/receiptFinalizer.ts`
  - `src/onchain-exit-engine/auditAdapter.ts`
  - `src/onchain-exit-engine/storageAdapter.ts`
  - `src/onchain-exit-engine/rpcRuntime.ts`
  - `src/onchain-exit-engine/configSchema.ts`
- The route registry, nonce policy, trigger model, execution state model, direct backend adapter, direct sell transaction builder, submission policy, receipt finalizer, audit adapter, storage adapter, RPC runtime, and config schema have focused tests.
- Watcher receipt handling now calls the receipt finalizer boundary.
- `src/autoSell.ts` now reuses the engine transaction builder for direct sell quote/write/calldata construction.
- `src/autoSell.ts` now delegates primary vs multi-RPC fallback policy to `directSellSubmission.ts`.
- `src/autoSell.ts` now delegates RPC client creation, fast reads, ERC20 approval submit, primary direct sell submit, and raw multi-RPC broadcast to `rpcRuntime.ts`.
- `src/watcher.ts` now delegates legacy auto-sell execution record construction to `auditAdapter.ts`.
- `src/watcher.ts` now delegates auto-sell execution persistence and receipt updates through `storageAdapter.ts`.
- `configSchema.ts` defines neutral `EXIT_ENGINE_*` config and legacy env compatibility without exposing private key or full RPC URL values in public summaries.
- `src/autoSell.ts` now consumes `ExitEngineConfig` for readiness and execution settings instead of reading legacy env keys directly.
- `src/watcher.ts` now consumes `ExitEngineConfig` for official-buyback executor, large-buy fallback, Flashblocks WS, RPC URL, token metadata, preapproval, market, and approval-spender trigger settings.
- OKX API is documented as quote-only / secondary roadmap, not as a live primary path.

## What Is Not Ready

- Pot Monitor scheduling, health checks, and notifications still belong to the current app runtime.

## Required Before Extraction

1. Decide whether Pot Monitor scheduling/health-check code stays in `chain-radar` or becomes a separate adapter around the engine.
2. Keep private keys, RPC URLs, DB files, server ids, and cloud-specific env files out of the new repo.
3. If extracting, copy only public-safe source, tests, and docs.

## Current Recommendation

Do not extract automatically. The reusable boundary is now close enough that extraction is a product/repo decision, not a code blocker.

The next code step should be either final extraction packaging or deeper runtime tests around live-like RPC failure modes.
