# Private Deployment Runbook

This file is project-private operational context for the current `chain-radar` deployment shape.

Do not copy this file into the future public `onchain-exit-engine` repository.

## Current Runtime State

As of 2026-05-07:

- Alibaba old production PM2 monitor is stopped and saved as stopped.
- AWS `virtuals-buyback-sentinel.service` is stopped and disabled.
- AWS EC2 remains running to preserve SSM access.
- Do not restart live trading unless explicitly requested.

## Resume AWS Bot

Use this only after explicit confirmation.

```bash
set -a
source ~/.config/chain-radar/aws-prod.env
set +a

bash scripts/aws-ssm-command.sh 'sudo systemctl enable virtuals-buyback-sentinel.service && sudo systemctl start virtuals-buyback-sentinel.service && systemctl show -p ActiveState -p SubState -p UnitFileState -p ExecMainPID -p NRestarts virtuals-buyback-sentinel.service'
```

After starting, run readiness:

```bash
bash scripts/aws-ssm-command.sh 'cd /opt/virtuals-buyback-sentinel/current && set -a && source /opt/virtuals-buyback-sentinel/env/production.env && set +a && DB_PATH=/opt/virtuals-buyback-sentinel/data/chain-radar.db node dist/checkAutoSellHealth.js'
```

## Pause AWS Bot

```bash
set -a
source ~/.config/chain-radar/aws-prod.env
set +a

bash scripts/aws-ssm-command.sh 'sudo systemctl stop virtuals-buyback-sentinel.service && sudo systemctl disable virtuals-buyback-sentinel.service && systemctl show -p ActiveState -p SubState -p UnitFileState -p ExecMainPID -p NRestarts virtuals-buyback-sentinel.service'
```

Expected pause state:

- `ActiveState=inactive`
- `SubState=dead`
- `UnitFileState=disabled`
- `ExecMainPID=0`
