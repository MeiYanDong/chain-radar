# Change Review

Date: 2026-05-07

This review separates the current dirty worktree into commit-safe groups.

## Group 1: Onchain Exit Engine Mainline

Commit this first if syncing to GitHub.

Includes:

- `docs/onchain-exit-engine/`
- `src/onchain-exit-engine/`
- `src/autoSell.ts`
- `src/watcher.ts`
- `src/db.ts`
- `src/test-auto-sell.ts`
- `src/test-*-engine-related.ts`
- `package.json`
- docs index / project-map / todo updates that route future work to the engine docs.

Purpose:

- direct sell execution boundary,
- receipt finalization,
- storage adapter,
- neutral `EXIT_ENGINE_*` config,
- trigger abstraction,
- route registry,
- nonce and burst policy,
- simulation suite.

Validation gate:

```bash
npm run exit-engine:test
npm run auto-sell:test
npm run build -- --pretty false
```

## Group 2: Cloud Ops Cleanup

Commit separately from the engine mainline.

Includes:

- public-safe SSM helper scripts,
- Alibaba server lookup helper,
- private deployment runbook if it remains public-safe,
- cloud stability ledger.

Do not include:

- cloud account ids,
- instance ids,
- public IPs,
- security group ids,
- key paths,
- private RPC URLs,
- presigned URLs,
- raw server logs.

## Group 3: Research / Pot Season Reports

Keep separate from engine and ops.

Includes:

- `docs/pot-season6-council-report.md`
- duplicate or draft report copies,
- analysis-only markdown reports.

## Group 4: Ad-Hoc Local Tests

Keep out of the engine commit unless intentionally productized.

Includes:

- `src/test-signal.ts`

Reason:

- it directly calls live APIs and sends a Feishu test card,
- it is not part of the reusable exit engine test suite.

## Safety Scan Result

Current scan did not find real public IPs in the engine docs/source.

The only `0x...64` matches found in the reviewed engine scope are test fixtures, such as fake private keys and fake transaction hashes.

Before pushing, rerun a scan for:

- wallet private keys,
- full RPC URLs,
- webhook URLs,
- cloud ids,
- IP addresses,
- runtime database files,
- raw server logs.
