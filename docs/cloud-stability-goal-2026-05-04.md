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

Required local environment:

- `AWS_REGION`, defaulting to `ap-southeast-1`.
- `AWS_INSTANCE_ID`, required. Keep the real instance id in local shell config, not in Git.
- Optional `AWS_PROFILE`.

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
