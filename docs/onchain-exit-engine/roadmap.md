# Roadmap

## Target

Build a reusable on-chain exit engine.

The engine should support multiple trigger types and multiple execution backends, while keeping the first production-grade path self-owned and auditable.

## Product Direction

The engine is not a generic trading bot. It is a defensive and event-driven exit system:

- detect a high-value on-chain event,
- decide whether the event is trusted,
- sell a configured token position,
- prove whether the sell succeeded on-chain,
- alert clearly when the system could not complete the exit.

## Roadmap Stages

### Stage 0: Preserve The Proven Core

Status: in progress.

Keep the current direct sell path as the primary execution path.

Must preserve:

- official buyback trigger detection,
- strict `> 3000 VIRTUAL` large-buy fallback,
- preapproved metadata and allowance fast path,
- reference-based `amountOutMin`,
- fixed/dynamic gas controls,
- multi-RPC / Flashblocks broadcast,
- receipt follow-up,
- failure alerting,
- audit records.

### Stage 1: Make The Direct Engine Reusable

Goal: separate the engine from Pot Monitor assumptions.

Deliverables:

- token route registry,
- nonce manager,
- explicit execution state machine,
- trigger contracts,
- direct sell backend contract,
- local simulation suite,
- public-safe docs.

### Stage 2: Generalize Triggers

Goal: support more than AI Pot buybacks.

Trigger classes:

- known executor address buy,
- same-transaction large buy,
- pool inflow/outflow pattern,
- specific wallet action,
- specific contract event,
- manual transaction recovery,
- pending/preconfirmed signal with confirmed fallback.

### Stage 3: Add Secondary Execution Backend

Goal: integrate OKX API without replacing direct sell.

Source of truth: [OKX API Backend Roadmap](./okx-api-backend.md).

Order:

1. quote-only / dry-run,
2. spender and route verification,
3. small real sell test,
4. receipt-status storage,
5. token-level policy for when OKX is allowed,
6. fallback to direct sell when OKX is slow or unavailable.

### Stage 4: Extract To A New Repository

Target path:

```text
/Users/myandong/Projects/onchain-exit-engine
```

Extraction should happen only after the engine has its own tests, config model, docs, and runbook.

## Non-Goals

- Do not claim guaranteed first sell.
- Do not optimize for UI before execution safety.
- Do not store secrets in docs.
- Do not turn OKX API into the primary path before proof.
- Do not couple the engine to one contest, one token list, or one cloud provider.
