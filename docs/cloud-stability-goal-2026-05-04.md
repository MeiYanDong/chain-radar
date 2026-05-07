# Cloud Stability Goal - Buyback Auto-Sell Sentinel

Date: 2026-05-04
Timezone: Asia/Shanghai

## Goal

Land a stable cloud runtime for the buyback auto-sell sentinel, then keep iterating until the service is actually running and observable.

The target outcome is not just "can connect once". The target is:

- The monitor can run continuously on a cloud host.
- Operations do not depend on a changing local Clash Verge exit IP.
- Deployment, restart, logs, and emergency access are repeatable.
- Every attempted path records evidence, result, failure reason, and next decision.

This is the public-safe version of the ledger. Do not commit cloud account ids, instance ids, public IPs, security-group ids, key paths, presigned URLs, private RPC endpoints, or raw logs.

## Runtime Target

- Service role: buyback large-buy / official-buyback monitor plus auto-sell fast path.
- Current token focus: ZMAC.
- Large-buy trigger target: strictly greater than `3000 VIRTUAL`.
- Local validation target: build plus the auto-sell simulation suite.

## Final Runtime Decision

The final operating model is:

- Local machine is the source of truth for code, tests, deployment scripts, and private env profiles.
- AWS Singapore is the main production runtime.
- AWS operations use local AWS CLI + SSM Run Command / Session Manager, not browser-only deployment.
- Alibaba Cloud SWAS remains the old production evidence and fallback host, not the preferred long-term runtime.

Reasoning:

- Local stability is the core. If the local build, simulations, readiness checks, and private profiles are stable, either cloud target can be synced from the same source.
- AWS SSM avoids inbound SSH and local IP allowlist drift.
- Alibaba Cloud SWAS already showed brittle management behavior: SSH banner timeout, Cloud Assistant `ClientNotRunning`, and slow reboot recovery.
- Alibaba Cloud is still valuable for historical DB/log evidence and rollback comparison.

Private local config paths:

- AWS ops profile: `~/.config/chain-radar/aws-prod.env`
- Alibaba-derived production env profile: `~/.config/chain-radar/profiles/buyback-prod.aliyun.env`
- AWS candidate production env profile: `~/.config/chain-radar/profiles/buyback-prod.aws.env`

These files must stay local-only with `600` permissions and must never be committed.

## Connectivity Decision

### Public SSH Is Not the Mainline

Public SSH was rejected as the default operations path for this environment.

Reasons:

- The local network path is mediated by Clash Verge / TUN.
- Proxy groups can auto-switch exit IPs.
- Narrow SSH allowlists become brittle when the local exit IP changes.
- Static/residential proxy chains can still connect slowly or fail during SSH banner exchange.

Decision:

- Do not optimize around constantly updating SSH allowlists.
- Keep SSH only as a temporary rescue path.

### AWS SSM Is the Current Mainline

SSM became the preferred operations path because it:

- avoids inbound TCP/22 entirely,
- avoids local IP allowlist drift,
- works from the local terminal through AWS CLI and Session Manager Plugin,
- supports repeatable command execution, service checks, and deploys.

Required setup:

- EC2 instance profile with `AmazonSSMManagedInstanceCore`.
- Local AWS CLI.
- Local Session Manager Plugin.
- Local AWS credentials or console-login-backed temporary credentials.

## Local CLI Operations

Routine operations should use local scripts, not browser CloudShell:

- `bash scripts/aws-ssm-check.sh`
- `bash scripts/aws-ssm-session.sh`
- `bash scripts/aws-ssm-command.sh 'sudo systemctl restart virtuals-buyback-sentinel'`
- `bash scripts/aws-ssm-deploy-safe-monitor.sh`
- `bash scripts/aws-ssm-sync-env.sh`

Required local environment:

- `AWS_REGION`, defaulting to `ap-southeast-1`.
- `AWS_INSTANCE_ID`, required. Keep the real instance id in local shell config, not in Git.
- Optional `AWS_PROFILE`.

Recommended command shape:

```bash
set -a
source ~/.config/chain-radar/aws-prod.env
set +a

bash scripts/aws-ssm-check.sh
```

Production env sync is a sensitive operation because it transmits private RPC URLs, webhook URLs, and wallet private key material to the AWS host. Use:

```bash
set -a
source ~/.config/chain-radar/aws-prod.env
set +a

# Installs the env file but does not restart/apply it.
bash scripts/aws-ssm-sync-env.sh

# Applies it immediately by restarting the systemd service.
AWS_SYNC_ENV_RESTART=1 bash scripts/aws-ssm-sync-env.sh
```

Only run the restart/apply variant after an explicit trade-time confirmation.

## Local Source-Of-Truth Status

Observed on 2026-05-05:

- Local code validation passed: TypeScript build, threshold tests, burn model tests, position model tests, P&L price lag tests, data-health incident tests, selection alert gate tests, notification outbox tests, and auto-sell simulations.
- Auto-sell simulation coverage included 124 large-buy fallback cases.
- The copied production env profile passed no-network readiness: enabled, live mode, preapprovals, reference-based `amountOutMin`, dynamic fee mode, nonzero min-out, multi-RPC submit mode, and private key format were all valid.
- Alchemy was exhausted with HTTP `429` monthly capacity errors, so the AWS candidate env profile moved the primary RPC to Chainstack and removed Alchemy as the protected/Flashblocks-specific configured endpoint.
- With the Chainstack-first AWS candidate profile, network readiness passed RPC read and all 11 configured allowances.
- After AWS env sync and restart, production readiness passed on AWS with `status=ready`: AutoSell enabled, dry run off, 11 preapproved pairs, RPC read passing, Flashblocks trigger enabled, and wallet ETH above the configured 10-transaction burst gas estimate.
- Chainstack's Base Flashblocks endpoint was verified against the production profile: `eth_getBlockByNumber("pending")` returned pending block data, `eth_sendRawTransactionSync` exists, and `eth_subscribe("newFlashblockTransactions")` delivered a preconfirmed transaction event.
- After adding the paid Chainstack Base endpoint to `AUTO_SELL_FLASHBLOCKS_RPC_URLS`, AWS production readiness passed with `multi_rpc_endpoints: 2 RPC endpoints available for broadcast`.
- Remaining quality warning: Chainstack MEV protection docs currently list Ethereum mainnet and BNB Smart Chain mainnet, not Base. Do not label the Base endpoint as `AUTO_SELL_PROTECTED_RPC_URLS` unless Chainstack support confirms Base MEV/private routing for this node.
- Production readiness should be checked with `node dist/checkAutoSellHealth.js` on AWS. The deployed host uses `npm ci --omit=dev`, so `npm run auto-sell:health` can fail because `tsx` is not installed.

## Deployment Mode

The current safe public deployment posture is:

- systemd service runs the monitor continuously,
- auto-sell code can be deployed and tested,
- live trading remains disabled unless explicitly enabled in server-side env,
- wallet private keys are never committed.

Safe monitor defaults:

- `AUTO_SELL_ENABLED=0`
- `AUTO_SELL_DRY_RUN=1`
- no wallet private key on a public repo path.

Before live trading:

- run direct small-size sell tests,
- verify spender and market address,
- verify preapproved allowances,
- verify fixed gas and fee strategy,
- verify nonzero minimum-output mode,
- confirm the action at trade time.

## SSM Run Command Pitfall

Observed failure class:

- `AWS-RunShellScript` can execute the top-level command list under `/bin/sh`.
- Bash-only `set -euo pipefail` at the top-level command can fail with `Illegal option -o pipefail`.

Correct pattern:

- Keep the outer SSM command POSIX-compatible.
- Download or generate a real script.
- Execute Bash-only deployment logic with `bash /path/to/script.sh`.

## Current Scripts

- `scripts/aws-ssm-command.sh`: run one remote Bash command through SSM.
- `scripts/aws-ssm-check.sh`: check service state and recent logs.
- `scripts/aws-ssm-session.sh`: start an interactive SSM shell.
- `scripts/aws-ssm-deploy-safe-monitor.sh`: build, package, upload, and deploy the safe monitor through SSM.
- `scripts/aws-ssm-sync-env.sh`: upload a private local env profile through a short-lived encrypted S3 object, install it as a systemd `EnvironmentFile`, and optionally restart the AWS service.
- `scripts/aliyun-find-server.sh`: locate Alibaba Cloud hosts by public IP across SWAS, ECS public IPs, and EIP resources. The old Alibaba host class was SWAS, so ECS-only lookup is insufficient.

## Alibaba Cloud SWAS Pitfall

Observed on 2026-05-05:

- The old Alibaba Cloud production host was not ECS. It was Simple Application Server / SWAS.
- ECS `DescribeInstances` and VPC EIP lookup can return empty even when the server exists and is running under SWAS.
- Correct lookup path is `swas-open list-instances`, ideally through `scripts/aliyun-find-server.sh`.
- Public SSH can show TCP/22 as open while SSH itself hangs at `Connection timed out during banner exchange`.
- SWAS Cloud Assistant can also fail with `ClientNotRunning`, which means browserless remote commands are unavailable until the guest-side agent recovers.
- A SWAS reboot recovered SSH and Cloud Assistant in the observed run, but the instance stayed in `Stopping` for several minutes before returning to `Running`.

Post-recovery public-safe runtime observations:

- The PM2 process came back online through startup restore.
- Server-side `.env` used an Alchemy primary RPC, Chainstack fallback RPCs, and an Alchemy protected RPC path; it was not Ankr.
- The Alchemy endpoint was returning rate/plan errors for some requests, and Flashblocks WS subscription showed `429`.
- Recent auto-sell records showed VOLTS submitted and confirmed successfully, while ORCL submitted but the chain receipt failed. Fallback RPC receipt lookup showed ORCL receipt status `0x0`; latest-state simulation returned custom error selector `0xb4fa3fb3`, commonly mapped as `InvalidInput()`.

Do not commit the exact Alibaba public IPs or instance ids. Keep those in local shell history, cloud console, or private notes only.

## Fallback Decision

Alibaba Cloud or a rebuilt instance remains a fallback only if:

- SSM becomes unavailable,
- local AWS credentials are too hard to operate,
- RPC latency/egress quality is worse after sustained observation,
- or a different region materially improves chain/RPC performance.

Do not switch cloud providers merely because public SSH is inconvenient; SSM already removes the main SSH instability.

## GitHub Safety Rules

Sync to GitHub:

- source code,
- tests,
- public-safe docs,
- public-safe SSM scripts.

Do not sync:

- `.env`,
- private keys,
- RPC secrets,
- Feishu/Pushover webhooks,
- SQLite runtime databases,
- raw server logs,
- cloud account ids,
- instance ids,
- public server IPs,
- security-group ids,
- presigned URLs.

## Project Pause - 2026-05-07

The buyback sniping / auto-sell competition work is paused by user decision.

Current pause state:

- Alibaba Cloud old production monitor was stopped and PM2 state was saved.
- The Alibaba PM2 process should remain preserved, but not running.
- AWS production service was stopped and disabled through SSM after local AWS CLI login was refreshed.
- AWS service verification: `ActiveState=inactive`, `SubState=dead`, `UnitFileState=disabled`, `ExecMainPID=0`, `NRestarts=0`.
- AWS EC2 instance itself remains `running`; this preserves SSM access and the current server state while stopping the trading bot.
- No project-specific Codex heartbeat automation was found locally; only unrelated memory automations were present.

Resume checklist:

- Reauthenticate AWS locally if the CLI session expires again.
- If resuming the bot, enable and start `virtuals-buyback-sentinel.service` through SSM.
- If fully pausing cost, stop the EC2 instance from the console or CLI after confirming no other workloads are needed.
- Before resuming trading, re-check RPC routing, wallet ETH balance, token allowances, fixed gas cap, min-out mode, and auto-sell receipt monitoring.
