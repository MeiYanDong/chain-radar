#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGION="${AWS_REGION:-ap-southeast-1}"
SERVICE_NAME="${AWS_SERVICE_NAME:-virtuals-buyback-sentinel}"
APP_DIR="${AWS_APP_DIR:-/opt/virtuals-buyback-sentinel}"
SSM_TIMEOUT="${SSM_TIMEOUT:-3600}"

require_bin() {
  local bin="$1"
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "missing required command: $bin" >&2
    echo "Install AWS CLI locally first, then configure an AWS profile." >&2
    exit 127
  fi
}

require_bin aws
require_bin python3
require_bin tar
: "${AWS_INSTANCE_ID:?Set AWS_INSTANCE_ID to the target SSM managed instance id}"
INSTANCE_ID="$AWS_INSTANCE_ID"

export AWS_PAGER=

cd "$ROOT_DIR"
echo "[local] build"
npm run build -- --pretty false

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="${AWS_DEPLOY_BUCKET:-vbs-deploy-${ACCOUNT_ID}-${REGION}}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/chain-radar-aws-deploy.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

PKG="$TMP_DIR/virtuals-buyback-sentinel-$STAMP.tgz"
REMOTE_SCRIPT="$TMP_DIR/remote-deploy.sh"
PARAMS_FILE="$TMP_DIR/ssm-params.json"
PKG_KEY="deploy/$STAMP/app.tgz"
SCRIPT_KEY="deploy/$STAMP/remote-deploy.sh"

echo "[local] package safe bundle"
tar -czf "$PKG" \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='node_modules' \
  --exclude='data' \
  --exclude='output' \
  package.json package-lock.json tsconfig.json .env.example src dist docs

cat >"$REMOTE_SCRIPT" <<'REMOTE'
#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:?APP_DIR required}"
SERVICE_NAME="${SERVICE_NAME:?SERVICE_NAME required}"
PKG_URL="${PKG_URL:?PKG_URL required}"
RELEASE="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE_DIR="$APP_DIR/releases/$RELEASE"
PKG="/tmp/${SERVICE_NAME}-${RELEASE}.tgz"

echo "REMOTE_DEPLOY_START $(date -Is)"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "node/npm missing; install them before running deploy or set up bootstrap separately" >&2
  exit 20
fi

mkdir -p "$RELEASE_DIR" "$APP_DIR/data" "$APP_DIR/backups"

if [[ -d "$APP_DIR/current" ]]; then
  BACKUP="$APP_DIR/backups/$RELEASE"
  mkdir -p "$BACKUP"
  cp -a "$APP_DIR/current/." "$BACKUP/" 2>/dev/null || true
  echo "backup=$BACKUP"
fi

curl -fsSL "$PKG_URL" -o "$PKG"
tar -xzf "$PKG" -C "$RELEASE_DIR"

ln -sfn "$RELEASE_DIR" "$APP_DIR/current"
cd "$APP_DIR/current"
npm ci --omit=dev

cat >/etc/systemd/system/${SERVICE_NAME}.service <<UNIT
[Unit]
Description=Virtuals Buyback Sentinel safe monitor
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR/current
ExecStart=/usr/bin/node dist/watcher.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=DB_PATH=$APP_DIR/data/chain-radar.db
Environment=FEISHU_WEBHOOK=
Environment=AUTO_SELL_ENABLED=0
Environment=AUTO_SELL_DRY_RUN=1
Environment=BUYBACK_MONITOR_ENABLED=1
Environment=BUYBACK_MONITOR_SOURCE=rpc
Environment=BUYBACK_MONITOR_INTERVAL_MS=1000
Environment=BUYBACK_WINDOW_MODE=always
Environment=BUYBACK_LARGE_BUY_FALLBACK_ENABLED=1
Environment=BUYBACK_LARGE_BUY_THRESHOLD_VIRTUAL=3000
Environment=BUYBACK_LARGE_BUY_SYMBOLS=ZMAC
Environment=AUTO_SELL_TOKEN_SYMBOLS=0xF62711E12D3Bf4FF4CF7cD3dAD6E76Cd22272EeC:ZMAC
Environment=AUTO_SELL_TOKEN_DECIMALS=0xF62711E12D3Bf4FF4CF7cD3dAD6E76Cd22272EeC:18

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"
sleep 3
systemctl is-active "$SERVICE_NAME"
systemctl show -p ActiveState -p SubState -p ExecMainPID -p NRestarts "$SERVICE_NAME"
journalctl -u "$SERVICE_NAME" -n 80 --no-pager

echo "REMOTE_DEPLOY_DONE $(date -Is)"
REMOTE

echo "[aws] ensure deploy bucket"
if ! aws s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  aws s3api create-bucket \
    --bucket "$BUCKET" \
    --region "$REGION" \
    --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
fi

echo "[aws] upload bundle"
aws s3 cp "$PKG" "s3://$BUCKET/$PKG_KEY" --region "$REGION" >/dev/null
aws s3 cp "$REMOTE_SCRIPT" "s3://$BUCKET/$SCRIPT_KEY" --region "$REGION" >/dev/null

PKG_URL="$(aws s3 presign "s3://$BUCKET/$PKG_KEY" --region "$REGION" --expires-in 3600)"
SCRIPT_URL="$(aws s3 presign "s3://$BUCKET/$SCRIPT_KEY" --region "$REGION" --expires-in 3600)"

python3 - "$SCRIPT_URL" "$PKG_URL" "$APP_DIR" "$SERVICE_NAME" "$SSM_TIMEOUT" >"$PARAMS_FILE" <<'PY'
import json
import shlex
import sys

script_url, pkg_url, app_dir, service_name, timeout = sys.argv[1:6]
command = (
    f"curl -fsSL {shlex.quote(script_url)} -o /tmp/vbs-remote-deploy.sh && "
    f"chmod +x /tmp/vbs-remote-deploy.sh && "
    f"APP_DIR={shlex.quote(app_dir)} SERVICE_NAME={shlex.quote(service_name)} "
    f"PKG_URL={shlex.quote(pkg_url)} bash /tmp/vbs-remote-deploy.sh"
)
print(json.dumps({
    "commands": [f"bash -lc {shlex.quote(command)}"],
    "executionTimeout": [timeout],
}))
PY

echo "[aws] send deploy command"
CMD_ID="$(
  aws ssm send-command \
    --region "$REGION" \
    --instance-ids "$INSTANCE_ID" \
    --document-name AWS-RunShellScript \
    --comment "deploy virtuals-buyback-sentinel safe monitor from local cli" \
    --parameters "file://$PARAMS_FILE" \
    --query 'Command.CommandId' \
    --output text
)"

echo "SSM command: $CMD_ID"
aws ssm wait command-executed --region "$REGION" --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" || true
aws ssm get-command-invocation \
  --region "$REGION" \
  --command-id "$CMD_ID" \
  --instance-id "$INSTANCE_ID" \
  --query '{Status:Status,ResponseCode:ResponseCode,Stdout:StandardOutputContent,Stderr:StandardErrorContent}' \
  --output json
