# Plan

## Current Version

Working version name:

```text
Onchain Exit Engine v0.1
```

v0.1 is still inside `chain-radar`. Its purpose is to make the current direct sell engine reusable and safer before adding OKX API or extracting to a new repository.

## Main Decision

Use the self-owned direct sell path as the primary execution backend.

OKX API is a roadmap secondary backend. It must start as quote-only / dry-run and must not bypass receipt checks or fallback rules.

## Scope

### In Scope

- execution state machine,
- token route registry,
- nonce manager,
- direct sell backend boundary,
- trigger abstraction,
- audit schema cleanup,
- simulation tests,
- local-only readiness checks,
- migration path from Buyback Sentinel to Onchain Exit Engine.

### Out Of Scope

- restarting live deployment services,
- submitting real trades,
- moving to a new repository immediately,
- building a polished UI,
- making OKX API the primary path,
- committing secrets or runtime data.

## v0.1 Deliverables

1. Documentation boundary.
   - This folder is the source of truth for the reusable engine.

2. Execution state model.
   - The engine should record `detected`, `prepared`, `submitted`, `confirmed`, `reverted`, `timeout`, and `manual_recovery_needed`.
   - Current status: implemented as `src/onchain-exit-engine/executionState.ts`, with `src/test-exit-execution-state.ts` covering legacy auto-sell status plus receipt outcomes.

3. Token route registry.
   - Store per-token route facts:
     - token address,
     - symbol,
     - decimals,
     - sell market,
     - approval spender,
     - min-out mode,
     - verified small-sell status,
     - backend policy.
   - Current status: implemented as `src/onchain-exit-engine/routeRegistry.ts`, with `src/test-route-registry.ts` covering verified, unverified, wrong-market, wrong-spender, missing-decimals, and OKX quote-only cases.

4. Nonce and burst policy.
   - One wallet must have one nonce manager.
   - Duplicate token sells must be blocked.
   - Multiple token triggers must either queue or reserve nonces explicitly.
   - Current status: implemented as `src/onchain-exit-engine/noncePolicy.ts`, with `src/test-nonce-policy.ts` covering same-second multi-token triggers, three triggers inside one minute, duplicate-token locks, and nonce / replacement error recovery actions.

5. Stronger simulation suite.
   - Simulate nonce conflicts, reverted receipts, duplicate triggers, large-buy boundaries, allowance failures, gas/fee failures, and RPC split-brain.
   - Current status: trigger extraction is implemented as `src/onchain-exit-engine/triggers.ts`, with `src/test-triggers.ts` covering official executor detection, strict large-buy boundaries, allowlist rejection, manual recovery, and pending trigger behavior.

6. Direct backend and receipt boundary.
   - Direct sell backend output should be represented as an engine backend result, not only legacy `AutoSellResult`.
   - Receipt finalization should be a single contract shared by watcher and tests.
   - Transaction construction should be owned by the engine, not duplicated in `src/autoSell.ts`.
   - Submission fallback policy and audit record construction should be owned by the engine boundary.
   - Low-level RPC runtime and broadcast plumbing should be owned by the engine boundary.
   - Current status: adapter/finalizer/transaction/submission/audit/storage/RPC boundaries are implemented as `src/onchain-exit-engine/directSellBackend.ts`, `src/onchain-exit-engine/receiptFinalizer.ts`, `src/onchain-exit-engine/directSellTransaction.ts`, `src/onchain-exit-engine/directSellSubmission.ts`, `src/onchain-exit-engine/auditAdapter.ts`, `src/onchain-exit-engine/storageAdapter.ts`, and `src/onchain-exit-engine/rpcRuntime.ts`; watcher receipt handling now calls the receipt finalizer and storage adapter, and `src/autoSell.ts` reuses the transaction/submission/RPC runtime builders.

7. Public-safe config schema.
   - The standalone engine should prefer neutral `EXIT_ENGINE_*` keys.
   - Legacy `AUTO_SELL_*` / `BUYBACK_*` keys remain compatibility inputs while still inside `chain-radar`.
   - Current status: implemented as `src/onchain-exit-engine/configSchema.ts`, with `src/test-config-schema.ts` covering native config, legacy config, unsafe live config, primary-fallback defaults, buyback trigger fields, and public-safe summary redaction. `src/autoSell.ts` now consumes `ExitEngineConfig` for execution, readiness, RPC, fee, min-out, route, approval, and integration settings. `src/watcher.ts` consumes it for official-buyback executor, large-buy fallback, Flashblocks WS, RPC URL, token metadata, preapproval, market, and spender trigger settings.

## Success Criteria

v0.1 is complete when:

- direct sell behavior is documented as an engine contract,
- local tests prove the important failure paths,
- route/spender assumptions are explicit,
- receipt status is the only final success proof,
- a future Agent can continue from `todo.md` without reading the old full conversation.
