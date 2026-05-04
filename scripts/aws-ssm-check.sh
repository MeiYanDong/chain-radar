#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

exec bash "$ROOT_DIR/scripts/aws-ssm-command.sh" '
sudo systemctl is-active virtuals-buyback-sentinel
sudo systemctl show -p ActiveState -p SubState -p ExecMainPID -p NRestarts virtuals-buyback-sentinel
sudo journalctl -u virtuals-buyback-sentinel -n 80 --no-pager
'
