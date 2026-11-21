#!/usr/bin/env bash
# Copy the app into Home Assistant's /config/www folder over SSH.
# Requires the "Advanced SSH & Web Terminal" (or "Terminal & SSH") add-on, or any SSH access to /config.
#
#   HA_HOST=homeassistant.local ./tools/deploy.sh
#   HA_HOST=192.168.1.20 HA_SSH_USER=root HA_SSH_PORT=22 ./tools/deploy.sh
set -euo pipefail

HOST="${HA_HOST:-homeassistant.local}"
USER_="${HA_SSH_USER:-root}"
PORT="${HA_SSH_PORT:-22}"
DEST="${HA_DEST:-/config/www/ha-app}"
SRC="$(cd "$(dirname "$0")/../app" && pwd)"

echo "Deploying $SRC -> $USER_@$HOST:$DEST"
ssh -p "$PORT" "$USER_@$HOST" "mkdir -p '$DEST'"
if command -v rsync >/dev/null && ssh -p "$PORT" "$USER_@$HOST" "command -v rsync" >/dev/null 2>&1; then
  rsync -av --delete -e "ssh -p $PORT" "$SRC/" "$USER_@$HOST:$DEST/"
else
  scp -P "$PORT" -r "$SRC/." "$USER_@$HOST:$DEST/"
fi
echo
echo "Done. Open: http://$HOST:8123/local/ha-app/index.html"
echo "(If /config/www did not exist before, restart Home Assistant once so it starts serving /local.)"
