# Todo

This is the execution ledger for extracting and hardening the reusable engine.

## Phase 1: Documentation Boundary

- [x] Create `docs/onchain-exit-engine/`.
- [x] Write README, roadmap, plan, todo, architecture, risk model, runbook, and postmortem index.
- [x] Update project map and docs index to point future engine work here.
- [x] Keep the old VOLTS / ORCL postmortem linked as evidence, without moving it yet.

## Phase 2: Direct Sell State Machine

- [x] Define execution statuses:
  - `detected`
  - `prepared`
  - `submitted`
  - `confirmed`
  - `reverted`
  - `timeout`
  - `replacement_sent`
  - `manual_recovery_needed`
- [x] Map current `AutoSellResult` and `auto_sell_executions` fields to the new statuses.
- [x] Ensure `receipt.status` is the final success gate.
- [x] Add tests for success, revert, timeout, and unknown receipt.

## Phase 3: Route Registry

- [x] Add a token route registry design.
- [x] Represent token address, symbol, decimals, market address, approval spender, backend policy, and verified sell status.
- [x] Mark unverified token routes as dry-run or alert-only.
- [x] Add tests for wrong market and wrong spender handling.

## Phase 4: Nonce And Burst Handling

- [x] Define wallet-level nonce manager contract.
- [x] Define duplicate sell lock contract.
- [x] Simulate two tokens triggering within the same second.
- [x] Simulate three triggers within one minute.
- [x] Simulate nonce rejected / underpriced / replacement-required paths.

## Phase 5: Trigger Generalization

- [x] Extract official buyback trigger into a trigger module.
- [x] Extract large-buy fallback into a trigger module.
- [x] Add manual tx recovery as a trigger module.
- [x] Define pending trigger behavior and confirmed fallback behavior.

## Phase 6: OKX API Roadmap Entry

- [x] Add OKX quote-only backend design.
- [x] Record OKX API latency, route, spender, estimated output, and price impact.
- [x] Require preapproval verification before any OKX submit path.
- [x] Require small real sell receipt success before OKX can become a live secondary backend.

## Phase 7: Extraction Decision

- [x] Confirm engine tests pass independently of Pot Monitor tests.
- [x] Confirm no engine docs depend on private cloud state.
- [x] Decide whether to create `/Users/myandong/Projects/onchain-exit-engine`.
- [ ] If extracting, copy only public-safe source, tests, and docs; leave secrets and runtime DB behind.

Current decision: do not extract yet. See [Extraction Decision](./extraction-decision.md).

## Phase 8: Direct Backend And Receipt Boundary

- [x] Add direct sell backend adapter contract.
- [x] Add tests for legacy `AutoSellResult` to direct backend result mapping.
- [x] Add receipt finalizer contract.
- [x] Wire watcher receipt handling through the receipt finalizer.
- [x] Add tests for success, reverted, timeout, unknown, and receipt-check-error finalization.
- [x] Move actual direct sell transaction construction out of `src/autoSell.ts`.
- [x] Move direct sell submission fallback orchestration out of `src/autoSell.ts`.
- [x] Move audit record construction behind an engine adapter.
- [x] Move low-level RPC client / broadcast plumbing out of `src/autoSell.ts`.

## Phase 9: Public-Safe Config Schema

- [x] Define neutral `EXIT_ENGINE_*` config schema.
- [x] Provide legacy `AUTO_SELL_*` / `BUYBACK_*` env compatibility mapping.
- [x] Mark private key and RPC URL fields as secret.
- [x] Add public-safe summary that omits private keys, full RPC URLs, and bigint gas values.
- [x] Add tests for native config, legacy config, unsafe live config, and public-safe summary redaction.
- [x] Replace direct `process.env` reads in `src/autoSell.ts` with the config object.
- [x] Move watcher trigger env reads to the neutral config boundary before extracting to a standalone repo.
- [x] Move audit persistence behind an engine storage adapter before extracting to a standalone repo.
- [x] Decide final repo extraction timing: do not extract automatically now; if extracting later, copy only public-safe engine files.

## Phase 10: Token Onboarding Gate

- [x] Add a reusable token onboarding validator.
- [x] Classify new tokens as `blocked`, `monitor_only`, `approval_required`, `dry_run_ready`, or `live_ready`.
- [x] Require token route, symbol, decimals, market, spender, preapproval, verified sell route, quote, allowance, and large-buy eligibility checks before live status.
- [x] Enforce direct sell quote gate in the execution path before any approval or sell submission.
- [x] Add a read-only CLI entrypoint for local token checks.
- [x] Add tests for invalid token, missing route, unverified route, missing approval, zero quote, monitor-only route, OKX quote-only route, large-buy allowlist rejection, and fully live-ready route.
- [x] Add Chainstack/RPC read-only probes for symbol / decimals / quote / allowance / balance so the CLI can move from static config gate to live read-only gate.
- [x] Run a documented real read-only RPC smoke test against ZMAC and archive the public-safe result.
- [x] Add token-specific market / spender discovery from recent token transfer contract candidates before judging non-default Virtuals markets.
- [ ] Expand route discovery beyond token transfers if a target token only exposes routes through factory events or non-transfer registry metadata.
