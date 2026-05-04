#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGION="${AWS_REGION:-ap-southeast-1}"
TIMEOUT="${SSM_TIMEOUT:-1200}"

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/aws-ssm-command.sh '<remote bash command>'

Environment:
  AWS_PROFILE       Optional AWS CLI profile name.
  AWS_REGION        Default: ap-southeast-1
  AWS_INSTANCE_ID   Required SSM managed instance id.
  SSM_TIMEOUT       Default: 1200 seconds
USAGE
}

require_bin() {
  local bin="$1"
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "missing required command: $bin" >&2
    echo "Install AWS CLI locally first, then configure an AWS profile." >&2
    exit 127
  fi
}

if [[ $# -lt 1 || "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

require_bin aws
require_bin python3
: "${AWS_INSTANCE_ID:?Set AWS_INSTANCE_ID to the target SSM managed instance id}"
INSTANCE_ID="$AWS_INSTANCE_ID"

COMMAND="$*"
PARAMS_FILE="$(mktemp "${TMPDIR:-/tmp}/chain-radar-ssm-params.XXXXXX.json")"
trap 'rm -f "$PARAMS_FILE"' EXIT

python3 - "$COMMAND" "$TIMEOUT" >"$PARAMS_FILE" <<'PY'
import json
import shlex
import sys

command = sys.argv[1]
timeout = sys.argv[2]
print(json.dumps({
    "commands": [f"bash -lc {shlex.quote(command)}"],
    "executionTimeout": [timeout],
}))
PY

export AWS_PAGER=

CMD_ID="$(
  aws ssm send-command \
    --region "$REGION" \
    --instance-ids "$INSTANCE_ID" \
    --document-name AWS-RunShellScript \
    --comment "chain-radar local cli command" \
    --parameters "file://$PARAMS_FILE" \
    --query 'Command.CommandId' \
    --output text
)"

echo "SSM command: $CMD_ID"

aws ssm wait command-executed \
  --region "$REGION" \
  --command-id "$CMD_ID" \
  --instance-id "$INSTANCE_ID" || true

aws ssm get-command-invocation \
  --region "$REGION" \
  --command-id "$CMD_ID" \
  --instance-id "$INSTANCE_ID" \
  --query '{Status:Status,ResponseCode:ResponseCode,Stdout:StandardOutputContent,Stderr:StandardErrorContent}' \
  --output json
