# Architecture

## System Shape

The engine has five layers:

```text
Trigger -> Risk Gate -> Execution Backend -> Receipt Finalizer -> Audit / Alert
```

Each layer should be testable without live trading.

## Modules

### Trigger

Purpose:

- observe chain events,
- normalize them into a trusted trigger candidate,
- reject noise before execution.

Examples:

- official buyback executor,
- large VIRTUAL buy into a pool,
- wallet action,
- contract event,
- manual tx recovery.

Trigger output:

```ts
type ExitTrigger = {
  id: string;
  source: 'confirmed' | 'pending' | 'manual';
  chainId: number;
  txHash?: string;
  blockNumber?: bigint;
  tokenAddress: string;
  referenceTokenAmount?: string;
  referenceSpendToken?: string;
  referenceSpendAmount?: string;
  detectedAtMs: number;
};
```

### Risk Gate

Purpose:

- prevent wrong-token, wrong-route, duplicate, unsafe, or underfunded exits.
- classify new token additions before they can become live routes.

Checks:

- token is configured,
- route is verified or allowed,
- direct sell quote succeeds before approval or sell submission,
- allowance is ready,
- wallet has gas,
- slippage mode is nonzero when required,
- trigger threshold is strict,
- token sell lock is available,
- nonce manager can reserve or queue.

New token onboarding decisions:

- `blocked`: invalid address, missing route, wrong market / spender, zero quote, or required trigger eligibility failure.
- `monitor_only`: alerts are allowed, but direct sell is not.
- `approval_required`: token route exists, but spender approval is not ready.
- `dry_run_ready`: route can be tested without submitting live sells.
- `live_ready`: direct route is verified, quote is non-zero, allowance is sufficient, balance is non-zero if checked, and the route has a verified small-sell receipt.

### Execution Backend

Primary backend:

- direct sell through known market contract.

Secondary future backend:

- OKX API route-generated transaction.

Backend output:

```ts
type ExitSubmission = {
  backend: 'direct' | 'okx';
  status: 'submitted' | 'failed';
  txHash?: string;
  nonce?: number;
  amountIn: string;
  amountOutMin?: string;
  error?: string;
  submittedAtMs?: number;
};
```

### Receipt Finalizer

Purpose:

- wait for the sell receipt,
- update final state,
- alert on reverted / timeout / unknown.

Rules:

- `submitted` is not success.
- Only `receipt.status === 'success'` is final success.
- Reverted receipts must be stored as failures.
- Timeout is not success and should require recovery review.

### Audit / Alert

Purpose:

- preserve enough evidence to debug later without exposing secrets.

Records:

- trigger facts,
- route facts,
- backend choice,
- nonce,
- amount in,
- min out,
- sell tx hash,
- receipt status,
- timing,
- final state,
- recovery notes.

## Current Code Mapping

Current source files:

- `src/onchain-exit-engine/executionState.ts`: first reusable engine boundary; maps legacy auto-sell status and receipt status into engine execution states.
- `src/onchain-exit-engine/routeRegistry.ts`: reusable route registry boundary; normalizes token route facts and rejects wrong market / wrong spender / unverified live routes.
- `src/onchain-exit-engine/noncePolicy.ts`: reusable nonce and burst policy boundary; defines wallet nonce reservation, duplicate token sell locks, queue-vs-reserve planning, and nonce failure recovery classification.
- `src/onchain-exit-engine/triggers.ts`: reusable trigger boundary; extracts official buyback, strict large-buy fallback, manual tx recovery, and pending-trigger execution policy.
- `src/onchain-exit-engine/directSellBackend.ts`: direct backend adapter boundary; maps legacy auto-sell output into engine backend status and validates whether a route is direct-live eligible.
- `src/onchain-exit-engine/directSellTransaction.ts`: direct sell transaction construction boundary; owns sell ABI, quote call, writeContract request shape, and multi-RPC calldata encoding.
- `src/onchain-exit-engine/directSellSubmission.ts`: direct sell submission policy boundary; owns primary vs multi-RPC fallback orchestration through injectable submitters.
- `src/onchain-exit-engine/receiptFinalizer.ts`: receipt finalizer boundary; turns receipt success/revert/timeout/unknown/check-error into engine state and legacy DB updates.
- `src/onchain-exit-engine/auditAdapter.ts`: audit adapter boundary; builds legacy `auto_sell_executions` records from trigger/event facts and backend result facts.
- `src/onchain-exit-engine/storageAdapter.ts`: storage adapter boundary; defines the persistence port for saving execution records and receipt updates without importing `src/db.ts` into engine core.
- `src/onchain-exit-engine/rpcRuntime.ts`: RPC runtime boundary; owns Base RPC client creation, fast reads, broadcast bundle resolution, primary direct sell submit, ERC20 approval submit, and raw multi-RPC broadcast.
- `src/onchain-exit-engine/configSchema.ts`: public-safe config boundary; defines neutral `EXIT_ENGINE_*` config, legacy env compatibility, private-key / RPC redaction, route settings, RPC settings, execution settings, risk settings, and integration settings.
- `src/onchain-exit-engine/tokenOnboarding.ts`: new token gate; classifies token additions into live-ready, dry-run-ready, approval-required, monitor-only, or blocked before a route can be used live.
- `src/onchain-exit-engine/tokenOnboardingProbe.ts`: read-only RPC probe for token symbol, decimals, direct sell quote, wallet balance, spender allowance, and candidate route overlay.
- `src/onchain-exit-engine/tokenRouteDiscovery.ts`: read-only token-specific route discovery; scans recent Blockscout token transfers for contract counterparties and verifies candidates with direct sell quote calls.
- `src/checkTokenOnboarding.ts`: local read-only CLI wrapper for the token onboarding gate.
- `src/watcher.ts`: trigger detection, buyback monitor, receipt follow-up, alerts; official-buyback executor, large-buy fallback, Flashblocks WS, RPC URL, token metadata, preapproval, market, and spender trigger settings now come from `ExitEngineConfig`, and auto-sell execution persistence now goes through the storage adapter.
- `src/autoSell.ts`: direct sell execution and readiness report; it now consumes `ExitEngineConfig` instead of reading legacy env keys directly, while delegating transaction construction, submission policy, RPC runtime, receipt finalization, and audit record construction to engine modules.
- `src/db.ts`: audit tables.
- `src/test-auto-sell.ts`: current simulation suite.
- `src/test-exit-execution-state.ts`: state-machine simulation suite for submitted / confirmed / reverted / timeout / unknown receipt paths.
- `src/test-route-registry.ts`: route simulation suite for verified route, unverified route, wrong market, wrong spender, missing decimals, and quote-only backend policy.
- `src/test-nonce-policy.ts`: nonce simulation suite for same-second triggers, three triggers inside one minute, duplicate token lock, and nonce / replacement error recovery actions.
- `src/test-triggers.ts`: trigger simulation suite for official executor, strict `> 3000 VIRTUAL` large-buy fallback, allowlist rejection, manual recovery, and pending execution policy.
- `src/test-direct-sell-backend.ts`: direct backend adapter tests for submitted, dry-run, blocked, confirmed, wrong backend, and unverified route cases.
- `src/test-receipt-finalizer.ts`: receipt finalizer tests for success, reverted, timeout, unknown, and receipt-check-error cases.
- `src/test-direct-sell-transaction.ts`: direct sell transaction construction tests for ABI, quote call args, write call args, and encoded calldata selector.
- `src/test-direct-sell-submission.ts`: direct sell submission policy tests for primary, multi-RPC success, fallback-to-primary, and no-fallback failure.
- `src/test-audit-adapter.ts`: audit adapter tests for legacy execution record construction and event fallback fields.
- `src/test-storage-adapter.ts`: storage adapter tests for injected save/update persistence ports and receipt-finalization application.
- `src/test-rpc-runtime.ts`: RPC runtime tests for RPC URL resolution, broadcast URL ordering, bundle reuse, and ERC20 approval request construction.
- `src/test-config-schema.ts`: config schema tests for native env, legacy env, unsafe live env, and public-safe summary redaction.
- `src/test-token-onboarding.ts`: token onboarding tests for invalid token, missing route, verified live route, unverified route, missing approval, zero quote, monitor-only route, OKX quote-only route, and large-buy allowlist rejection.
- `src/test-token-onboarding-probe.ts`: token onboarding probe tests for read-only metadata, quote, balance, allowance, and candidate route env overlay.
- `src/test-token-route-discovery.ts`: route discovery tests for transfer-derived market candidates, quote selection, and paginated Blockscout transfer fetch.

Target direction:

```text
src/onchain-exit-engine/
  triggers/
  execution/
  risk/
  audit/
  ops/
```

Do this gradually. Do not move files until tests can keep behavior stable.
