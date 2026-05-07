#!/usr/bin/env bash
set -euo pipefail

# Sync a private local env profile to the AWS SSM-managed host without printing
# secrets. By default this only installs the EnvironmentFile and does not restart
# the service. Set AWS_SYNC_ENV_RESTART=1 to apply it immediately.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGION="${AWS_REGION:-ap-southeast-1}"
SERVICE_NAME="${AWS_SERVICE_NAME:-virtuals-buyback-sentinel}"
APP_DIR="${AWS_APP_DIR:-/opt/virtuals-buyback-sentinel}"
ENV_PROFILE="${CHAIN_RADAR_ENV_PROFILE:-$HOME/.config/chain-radar/profiles/buyback-prod.aws.env}"
RESTART="${AWS_SYNC_ENV_RESTART:-0}"
SSM_TIMEOUT="${SSM_TIMEOUT:-1200}"

require_bin() {
  local bin="$1"
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "missing required command: $bin" >&2
    exit 127
  fi
}

require_bin aws
require_bin python3

: "${AWS_INSTANCE_ID:?Set AWS_INSTANCE_ID to the target SSM managed instance id}"
if [[ ! -f "$ENV_PROFILE" ]]; then
  echo "env profile not found: $ENV_PROFILE" >&2
  exit 2
fi

case "$(stat -f '%Lp' "$ENV_PROFILE" 2>/dev/null || stat -c '%a' "$ENV_PROFILE")" in
  600|400) ;;
  *)
    echo "env profile permissions should be 600 or 400: $ENV_PROFILE" >&2
    exit 3
    ;;
esac

export AWS_PAGER=

ACCOUNT_ID="$(aws sts get-caller-identity --region "$REGION" --query Account --output text)"
BUCKET="${AWS_DEPLOY_BUCKET:-vbs-deploy-${ACCOUNT_ID}-${REGION}}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/chain-radar-aws-env.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

ENV_KEY="deploy/$STAMP/production.env"
PARAMS_FILE="$TMP_DIR/ssm-params.json"

cd "$ROOT_DIR"

echo "[aws] ensure deploy bucket"
if ! aws s3api head-bucket --bucket "$BUCKET" --region "$REGION" >/dev/null 2>&1; then
  aws s3api create-bucket \
    --bucket "$BUCKET" \
    --region "$REGION" \
    --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
fi

echo "[aws] upload encrypted env object"
aws s3 cp "$ENV_PROFILE" "s3://$BUCKET/$ENV_KEY" \
  --region "$REGION" \
  --sse AES256 >/dev/null

ENV_URL="$(aws s3 presign "s3://$BUCKET/$ENV_KEY" --region "$REGION" --expires-in 600)"

python3 - "$ENV_URL" "$APP_DIR" "$SERVICE_NAME" "$RESTART" "$SSM_TIMEOUT" >"$PARAMS_FILE" <<'PY'
import json
import shlex
import sys

env_url, app_dir, service_name, restart, timeout = sys.argv[1:6]
remote = f'''
set -euo pipefail
APP_DIR={shlex.quote(app_dir)}
SERVICE_NAME={shlex.quote(service_name)}
ENV_FILE="$APP_DIR/env/production.env"
DROPIN_DIR="/etc/systemd/system/${{SERVICE_NAME}}.service.d"
DROPIN_FILE="$DROPIN_DIR/10-env-file.conf"

mkdir -p "$APP_DIR/env" "$DROPIN_DIR"
curl -fsSL {shlex.quote(env_url)} -o "$ENV_FILE.tmp"
chown root:root "$ENV_FILE.tmp"
chmod 600 "$ENV_FILE.tmp"
mv "$ENV_FILE.tmp" "$ENV_FILE"

cat >"$DROPIN_FILE" <<UNIT
[Service]
EnvironmentFile=$ENV_FILE
UNIT

systemctl daemon-reload
echo "env_file_installed=$ENV_FILE"
echo "dropin_installed=$DROPIN_FILE"
if [[ {shlex.quote(restart)} == "1" ]]; then
  systemctl restart "$SERVICE_NAME"
  sleep 3
  systemctl is-active "$SERVICE_NAME"
  systemctl show -p ActiveState -p SubState -p ExecMainPID -p NRestarts "$SERVICE_NAME"
else
  echo "restart=skipped"
  systemctl show -p ActiveState -p SubState -p ExecMainPID -p NRestarts "$SERVICE_NAME" || true
fi
'''
print(json.dumps({
    "commands": [f"bash -lc {shlex.quote(remote)}"],
    "executionTimeout": [timeout],
}))
PY

echo "[aws] send env sync command"
CMD_ID="$(
  aws ssm send-command \
    --region "$REGION" \
    --instance-ids "$AWS_INSTANCE_ID" \
    --document-name AWS-RunShellScript \
    --comment "sync virtuals-buyback-sentinel private env from local cli" \
    --parameters "file://$PARAMS_FILE" \
    --query 'Command.CommandId' \
    --output text
)"

echo "SSM command: $CMD_ID"
aws ssm wait command-executed --region "$REGION" --command-id "$CMD_ID" --instance-id "$AWS_INSTANCE_ID" || true
aws ssm get-command-invocation \
  --region "$REGION" \
  --command-id "$CMD_ID" \
  --instance-id "$AWS_INSTANCE_ID" \
  --query '{Status:Status,ResponseCode:ResponseCode,Stdout:StandardOutputContent,Stderr:StandardErrorContent}' \
  --output json

echo "[aws] remove temporary env object"
aws s3 rm "s3://$BUCKET/$ENV_KEY" --region "$REGION" >/dev/null || true
