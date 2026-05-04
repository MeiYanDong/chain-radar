#!/usr/bin/env bash
set -euo pipefail

REGION="${AWS_REGION:-ap-southeast-1}"

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/aws-ssm-session.sh

Starts an interactive AWS SSM Session Manager shell.

Environment:
  AWS_PROFILE       Optional AWS CLI profile name.
  AWS_REGION        Default: ap-southeast-1
  AWS_INSTANCE_ID   Required SSM managed instance id.
USAGE
}

require_bin() {
  local bin="$1"
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "missing required command: $bin" >&2
    exit 127
  fi
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

require_bin aws
require_bin session-manager-plugin
: "${AWS_INSTANCE_ID:?Set AWS_INSTANCE_ID to the target SSM managed instance id}"
INSTANCE_ID="$AWS_INSTANCE_ID"

export AWS_PAGER=
exec aws ssm start-session --region "$REGION" --target "$INSTANCE_ID"
