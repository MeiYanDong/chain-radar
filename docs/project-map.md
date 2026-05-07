# Project Map

Date: 2026-05-05
Timezone: Asia/Shanghai

This document is the routing map for the project. It answers one question before any code or deployment work starts:

> Which direction are we working on, what is the boundary, and which document is the source of truth?

## One-Sentence Current State

The repository name is still `chain-radar`, but the active work has moved from a historical holder-cost dashboard into a Virtuals Degen monitoring and buyback-sentinel workspace.

## Direction Map

| Direction | Status | What It Is For | What Belongs Here | What Does Not Belong Here | Source of Truth |
| --- | --- | --- | --- | --- | --- |
| Phase 1: holder cost dashboard | Paused maintenance | Historical FAT / token holder cost-basis analysis | Existing address dashboard, cost basis calculation, auxiliary review | New major product features, mainline alerts, execution logic | `docs/requirements.md`, existing web pages |
| Phase 2: Virtuals Pot Monitor | Product mainline | Observe 10 Agent competition performance, Live P&L, signal quality, Feishu alerts | Selection scoring, Burn expectation, Live P&L thresholds, outbox notifications, data-health watchdog | Wallet private keys, automatic execution claims, raw cloud secrets | `docs/plan.md`, `docs/todo.md`, phase 2 docs |
| Phase 2.4: expectation and exposure model | Completed active loop; calibration only | Map competing-agent signals into selection expectation, burn expectation, and user exposure | `fundamental_ratio`, `agent_cap_u`, target-position snapshots, P&L quality/risk functions | New UI scope unrelated to decisions, noisy alerts without action value | `docs/phases/phase-2.4-expectation-exposure-plan.md` |
| Onchain Exit Engine / Buyback Sentinel | Paused private ops track; local refinement only | Reusable on-chain event triggered exit engine, currently born from buyback auto-sell | Direct sell engine, trigger abstraction, route registry, nonce manager, approval/spender checks, gas/slippage/protected RPC controls, simulations and postmortems; OKX API only as roadmap secondary executor | Private keys/secrets, untested live switches, vague claims that are not backed by tx/log evidence, replacing the direct sell path with OKX API before proof | `docs/onchain-exit-engine/README.md`, `docs/auto-sell-volts-orcl-postmortem.md`, auto-sell tests, private runtime config |
| Cloud runtime stability | Infrastructure track | Keep monitor/sentinel running reliably on cloud without browser-only operations | AWS SSM scripts, health checks, deployment runbooks, PM2/systemd notes | AWS account id, instance id, public IP, security group id, key path, presigned URLs | `docs/cloud-stability-goal-2026-05-04.md`, `scripts/aws-ssm-*.sh` |
| Research and postmortems | Evidence track | Calibrate strategy and prevent repeated mistakes | PnL-price lag reports, VOLTS/ORCL review, Season analysis, decision records | Production trigger changes without tests, conclusions not separated from evidence | Research docs under `docs/` and `reports/` |

## Source-of-Truth Order

Use this order when documents disagree:

1. `docs/project-map.md`
   - Decides which direction a change belongs to.
   - Decides whether a change is safe for public GitHub.
   - Decides which downstream document should be updated.

2. `docs/requirements.md`
   - User-owned product framing: why the product exists, who it serves, and what it promises.
   - Agents should not edit it without explicit authorization.

3. `docs/plan.md`
   - Current product roadmap and phase state.
   - Keep it high-level; do not put command logs or implementation details here.

4. `docs/todo.md`
   - Current execution ledger and blockers.
   - Keep it focused on product/ops tasks, not code-by-code changelogs.

5. Direction-specific docs
   - `docs/onchain-exit-engine/` is the source of truth for reusable engine roadmap, plan, todo, architecture, risk model, and runbook.

6. Phase docs, runbooks, research notes, and postmortems
   - Detailed implementation, testing, deployment, evidence, and investigation records.

## Important Boundary: Product Monitor vs Private Execution

The public product framing says Chain Radar does not automatically trade for the user. That remains true for the product monitor direction.

The buyback auto-sell work is a separate private execution/ops track. It must be treated differently:

- It needs stricter tests than normal monitoring features.
- It must never commit private keys, RPC secrets, wallet balances, server identifiers, or raw live logs.
- It should describe capability and safety boundaries, not imply guaranteed execution speed or profit.
- Every live claim should be backed by a transaction hash, server log, database row, or an explicit statement that evidence is missing.

## Naming Rule

Use these names consistently:

- `Chain Radar`: historical repository name and broad product shell.
- `Virtuals Pot Monitor`: current product-monitoring mainline.
- `Onchain Exit Engine`: reusable event-triggered exit engine that may later move to its own repo.
- `Virtuals Buyback Sentinel`: the current buyback-specific implementation inside the Onchain Exit Engine track.
- `Cloud Stability`: server access, deployment, health check, and recovery track.

Do not rename the whole repository until public/private scope is settled. For branches, use names like:

- `codex/project-map`
- `codex/buyback-sentinel`
- `codex/ops-ssm`
- `codex/pot-monitor`

## GitHub Sync Rule

This repo is public, so commits should be split by direction:

| Commit Lane | Include | Exclude |
| --- | --- | --- |
| `docs/project-map` | Direction map, docs index, source-of-truth cleanup | Cloud ids, wallet details, raw logs |
| `pot-monitor` | Selection/Burn/P&L model code and tests | Auto-sell live secrets |
| `onchain-exit-engine` | Engine docs, direct sell hardening, trigger abstraction, simulations, health checks, public-safe postmortems | Private key, wallet balances, secret RPC endpoints |
| `ops-ssm` | Generic SSM helper scripts and public-safe runbook | Instance id, account id, public IP, security group id |
| `research` | Reports, lag analysis, named evidence boundaries | Unverified claims presented as facts |

Do not use `git add .` for public sync. Stage by path and review staged diff before commit.

## Work Routing Checklist

Before changing code, answer:

1. Is this Phase 1, Pot Monitor, Buyback Sentinel, Cloud Stability, or Research?
2. Which source-of-truth document must be updated?
3. Is any secret, wallet state, server id, raw log, or account metadata involved?
4. Which test proves the change?
5. Does this change affect live trading, alerts, or only offline analysis?

## Testing Gates

Minimum gates by direction:

| Direction | Required Gate |
| --- | --- |
| Pot Monitor | Relevant P&L, selection, burn, outbox, and data-health tests |
| Buyback Sentinel | Auto-sell simulations, strict `> 3000 VIRTUAL` trigger tests, health check, duplicate-sell/nonce behavior |
| Cloud Stability | SSM check or command dry-run, no hardcoded cloud ids in committed files |
| Research | Report generation or analysis command, evidence/inference separation |
| UI | Build plus browser verification when UI behavior changes |

## Onchain Exit Engine Roadmap Rule

The current execution priority is:

1. Improve and preserve the self-owned direct sell path first.
2. Keep OKX API as a second execution option, not the replacement mainline.
3. Only promote OKX API after dry-run quote comparison, preapproval verification, small real sell tests, receipt-status handling, and failure fallback are proven.

## Current Practical Next Step

The safest next GitHub sync is:

1. Commit the Onchain Exit Engine mainline first:
   - `docs/onchain-exit-engine/`
   - `src/onchain-exit-engine/`
   - engine-related `src/autoSell.ts`, `src/watcher.ts`, `src/db.ts`, tests, and package scripts.
   - project-map / docs-index updates needed to route future Agents to the engine docs.
2. Commit public-safe cloud ops cleanup second:
   - SSM helper scripts,
   - Alibaba lookup helper,
   - private deployment runbook if it remains public-safe.
3. Commit Pot Monitor or Season reports separately:
   - do not mix Council reports, dashboard/model research, or ad-hoc Feishu signal tests into the engine commit.
4. Before any public push, rerun the secret scan and verify no wallet private keys, full RPC URLs, cloud ids, public IPs, runtime DB files, or server logs are included.

This prevents the repository from mixing historical dashboard code, monitor product code, private execution logic, and cloud operations into one unclear public snapshot.
