#!/usr/bin/env bash
# Forward Mac LOCAL_TUNNEL_PORT → VM localhost:5432 (shared Angi Postgres).
# Optional for tools that speak Postgres over TCP; dump/restore scripts SSH
# docker-exec by default and do not require this tunnel.
#
# Usage:
#   ./scripts/cloud-db-tunnel.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=./_sync_common.sh
source "$ROOT/scripts/_sync_common.sh"
load_sync_env

echo "Tunnel: localhost:${LOCAL_TUNNEL_PORT} → ${SSH_HOST}:127.0.0.1:5432"
echo "Cloud DB: ${CLOUD_DB_NAME} as ${CLOUD_DB_USER}"
echo "Leave this running if you use GUI clients / psql against the tunnel."
exec ssh -N -o ExitOnForwardFailure=yes \
  -L "${LOCAL_TUNNEL_PORT}:127.0.0.1:5432" \
  "$SSH_HOST"
