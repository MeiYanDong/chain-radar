# Onchain Exit Engine

Date: 2026-05-07
Timezone: Asia/Shanghai

This folder is the independent documentation boundary for the reusable exit engine that currently lives inside `chain-radar`.

The engine started as the Virtuals Buyback Sentinel, but the target is broader:

> When a trusted on-chain trigger appears, exit a configured token position quickly, safely, and with an auditable final receipt.

## Current Boundary

This is not a separate repository yet. Keep it inside `chain-radar` until the code can build, test, and run without depending on the Pot Monitor product loop.

Do not move secrets, runtime databases, server logs, wallet balances, or cloud identifiers into this folder.

## Read Order

1. [Roadmap](./roadmap.md)
2. [Plan](./plan.md)
3. [Todo](./todo.md)
4. [Architecture](./architecture.md)
5. [Risk Model](./risk-model.md)
6. [Runbook](./runbook.md)
7. [Config Schema](./config-schema.md)
8. [OKX API Backend Roadmap](./okx-api-backend.md)
9. [Extraction Decision](./extraction-decision.md)
10. [Change Review](./change-review.md)
11. [Token Onboarding Smoke Tests](./token-onboarding-smoke.md)
12. [Postmortems](./postmortems/README.md)

## Source-Of-Truth Rule

- `roadmap.md`: long-term direction.
- `plan.md`: current version scope and decisions.
- `todo.md`: executable checklist and progress ledger.
- `architecture.md`: module boundaries and contracts.
- `risk-model.md`: execution risk, safety gates, and failure classes.
- `runbook.md`: operational commands and recovery sequence.
- `config-schema.md`: public-safe config contract and legacy env mapping.
- `okx-api-backend.md`: secondary backend roadmap and safety gates.
- `extraction-decision.md`: current repo-extraction decision and blockers.
- `change-review.md`: current worktree grouping for safe commits and public sync.
- `token-onboarding-smoke.md`: public-safe read-only evidence for token onboarding checks.
- `postmortems/`: evidence records that should shape future design.

If a document conflicts with live code or a verified transaction/log, preserve the evidence and update the document.

## Extraction Rule

Only move this into `/Users/myandong/Projects/onchain-exit-engine` after:

- direct sell is modularized under a clear engine boundary,
- tests cover triggers, execution, nonce, receipt, and failure paths,
- runtime config is separated from Pot Monitor config,
- docs can explain the system without referencing unrelated Chain Radar phases,
- production runbooks do not depend on mixed project assumptions.
