#!/usr/bin/env bash
# Shared helpers for Read local ↔ cloud sync scripts.
# shellcheck disable=SC2034

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYNC_ENV="${SYNC_ENV:-$ROOT/deploy/.env.sync}"
TMP_DIR="${TMP_DIR:-$ROOT/tmp/sync}"

die() {
  echo "error: $*" >&2
  exit 1
}

load_sync_env() {
  if [[ ! -f "$SYNC_ENV" ]]; then
    die "Missing $SYNC_ENV — copy deploy/.env.sync.example → deploy/.env.sync and fill secrets."
  fi
  # shellcheck disable=SC1090
  set -a
  source "$SYNC_ENV"
  set +a

  SSH_HOST="${SSH_HOST:-angi-vm}"
  LOCAL_TUNNEL_PORT="${LOCAL_TUNNEL_PORT:-15432}"
  CLOUD_DB_USER="${CLOUD_DB_USER:-read}"
  CLOUD_DB_NAME="${CLOUD_DB_NAME:-read}"
  LOCAL_DB_CONTAINER="${LOCAL_DB_CONTAINER:-read-db-1}"
  LOCAL_DB_USER="${LOCAL_DB_USER:-read}"
  LOCAL_DB_NAME="${LOCAL_DB_NAME:-read}"
  CLOUD_PG_CONTAINER="${CLOUD_PG_CONTAINER:-deploy-postgres-1}"
  CLOUD_API_CONTAINER="${CLOUD_API_CONTAINER:-read-api}"
  LOCAL_UPLOADS_DIR="${LOCAL_UPLOADS_DIR:-uploads}"
  CLOUD_UPLOADS_PATH="${CLOUD_UPLOADS_PATH:-/data/uploads}"

  if [[ -z "${CLOUD_DB_PASSWORD:-}" || "$CLOUD_DB_PASSWORD" == change-me* ]]; then
    die "Set CLOUD_DB_PASSWORD in $SYNC_ENV (same as READ_DB_PASSWORD on the VM)."
  fi
}

confirm() {
  local prompt="${1:-Continue?}"
  if [[ "${ASSUME_YES:-0}" == "1" || "${YES:-0}" == "1" ]]; then
    return 0
  fi
  read -r -p "$prompt [y/N] " ans
  [[ "$ans" == "y" || "$ans" == "Y" || "$ans" == "yes" ]]
}

require_local_db() {
  docker inspect -f '{{.State.Running}}' "$LOCAL_DB_CONTAINER" 2>/dev/null | grep -qx true \
    || die "Local DB container '$LOCAL_DB_CONTAINER' is not running. Try: npm run db:up"
}

require_ssh() {
  ssh -o BatchMode=yes -o ConnectTimeout=8 "$SSH_HOST" 'true' \
    || die "Cannot SSH to $SSH_HOST"
}

ssh_cmd() {
  ssh -o BatchMode=yes "$SSH_HOST" "$@"
}

ts() {
  date +%Y%m%d_%H%M%S
}

ensure_tmp() {
  mkdir -p "$TMP_DIR"
}

local_table_counts() {
  docker exec "$LOCAL_DB_CONTAINER" psql -U "$LOCAL_DB_USER" -d "$LOCAL_DB_NAME" -Atc \
    "SELECT 'users='||count(*) FROM users
     UNION ALL SELECT 'books='||count(*) FROM books
     UNION ALL SELECT 'chapters='||count(*) FROM chapters
     UNION ALL SELECT 'glossary='||count(*) FROM glossary_entries;"
}

cloud_table_counts() {
  ssh_cmd "docker exec $CLOUD_PG_CONTAINER psql -U $CLOUD_DB_USER -d $CLOUD_DB_NAME -Atc \"
    SELECT 'users='||count(*) FROM users
    UNION ALL SELECT 'books='||count(*) FROM books
    UNION ALL SELECT 'chapters='||count(*) FROM chapters
    UNION ALL SELECT 'glossary='||count(*) FROM glossary_entries;\""
}

reset_cloud_schema() {
  ssh_cmd "docker exec -i $CLOUD_PG_CONTAINER psql -U $CLOUD_DB_USER -d $CLOUD_DB_NAME" <<SQL
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO $CLOUD_DB_USER;
GRANT ALL ON SCHEMA public TO public;
ALTER SCHEMA public OWNER TO $CLOUD_DB_USER;
SQL
}

reset_local_schema() {
  docker exec -i "$LOCAL_DB_CONTAINER" psql -U "$LOCAL_DB_USER" -d "$LOCAL_DB_NAME" <<SQL
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO $LOCAL_DB_USER;
GRANT ALL ON SCHEMA public TO public;
ALTER SCHEMA public OWNER TO $LOCAL_DB_USER;
SQL
}
