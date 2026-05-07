#!/usr/bin/env bash
set -euo pipefail

# Deploys the monitor to the small cloud server without building on the server.
# The server only receives already-built dist/ files and restarts PM2.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${SERVER_IP:?Set SERVER_IP to the target host. Do not commit production IPs.}"
SERVER_USER="${SERVER_USER:-root}"
REMOTE_DIR="${REMOTE_DIR:-/opt/chain-radar}"
PM2_NAME="${PM2_NAME:-chain-radar-pot-monitor}"
KNOWN_HOSTS="${KNOWN_HOSTS:-/tmp/chain-radar-known-hosts}"

if [[ -n "${SERVER_PASSWORD:-}" ]]; then
  export SSHPASS="$SERVER_PASSWORD"
  SSH_BASE=(sshpass -e ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=2 -o StrictHostKeyChecking=no -o UserKnownHostsFile="$KNOWN_HOSTS")
  RSYNC_SSH="sshpass -e ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=2 -o StrictHostKeyChecking=no -o UserKnownHostsFile=$KNOWN_HOSTS"
else
  SSH_BASE=(ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=2 -o StrictHostKeyChecking=no -o UserKnownHostsFile="$KNOWN_HOSTS")
  RSYNC_SSH="ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=2 -o StrictHostKeyChecking=no -o UserKnownHostsFile=$KNOWN_HOSTS"
fi

remote() {
  "${SSH_BASE[@]}" "$SERVER_USER@$SERVER_IP" "$@"
}

echo "[deploy] Local build"
cd "$ROOT_DIR"
npm run build

echo "[deploy] Remote backup"
remote "set -e; ts=\$(date +%Y%m%d-%H%M%S); mkdir -p /opt/chain-radar-backups/\$ts; cd '$REMOTE_DIR'; cp -a src dist docs package.json package-lock.json tsconfig.json .env.example /opt/chain-radar-backups/\$ts/ 2>/dev/null || true; echo backup=/opt/chain-radar-backups/\$ts"

echo "[deploy] Sync source, docs, package files, and local dist"
rsync -az --delete -e "$RSYNC_SSH" "$ROOT_DIR/src/" "$SERVER_USER@$SERVER_IP:$REMOTE_DIR/src/"
rsync -az --delete -e "$RSYNC_SSH" "$ROOT_DIR/docs/" "$SERVER_USER@$SERVER_IP:$REMOTE_DIR/docs/"
rsync -az --delete -e "$RSYNC_SSH" "$ROOT_DIR/dist/" "$SERVER_USER@$SERVER_IP:$REMOTE_DIR/dist/"
rsync -az -e "$RSYNC_SSH" \
  "$ROOT_DIR/package.json" \
  "$ROOT_DIR/package-lock.json" \
  "$ROOT_DIR/tsconfig.json" \
  "$ROOT_DIR/.env.example" \
  "$SERVER_USER@$SERVER_IP:$REMOTE_DIR/"

if [[ "${REMOTE_NPM_INSTALL:-0}" == "1" ]]; then
  echo "[deploy] Remote production dependencies"
  remote "set -e; cd '$REMOTE_DIR'; npm install --omit=dev"
fi

echo "[deploy] Remote one-shot validation"
remote "set -e; cd '$REMOTE_DIR'; tmp_db=\$(mktemp /tmp/chain-radar-validate.XXXXXX.db); trap 'rm -f \"\$tmp_db\" \"\$tmp_db-wal\" \"\$tmp_db-shm\"' EXIT; FEISHU_WEBHOOK= BUYBACK_MONITOR_ENABLED=0 AUTO_SELL_ENABLED=0 RUN_ONCE=1 DB_PATH=\"\$tmp_db\" node dist/watcher.js"

echo "[deploy] Restart PM2 with dist/watcher.js"
remote "set -e; cd '$REMOTE_DIR'; pm2 delete '$PM2_NAME' >/dev/null 2>&1 || true; pm2 start dist/watcher.js --name '$PM2_NAME' --update-env; pm2 save; pm2 list"

echo "[deploy] Tail PM2 logs"
remote "pm2 logs '$PM2_NAME' --lines 40 --nostream"

echo "[deploy] Done"
