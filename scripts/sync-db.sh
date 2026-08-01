#!/usr/bin/env bash
# Sync Postgres between local Docker (read-db-1) and cloud (deploy-postgres-1 / db read).
#
# Usage:
#   ./scripts/sync-db.sh push          # local → cloud (replaces cloud schema)
#   ./scripts/sync-db.sh pull          # cloud → local (replaces local schema)
#   ./scripts/sync-db.sh push --yes    # skip confirm
#   ./scripts/sync-db.sh status        # row counts both sides
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=./_sync_common.sh
source "$ROOT/scripts/_sync_common.sh"
load_sync_env
ensure_tmp

MODE="${1:-}"
shift || true
for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=1 ;;
    *) die "Unknown arg: $arg" ;;
  esac
done

[[ -n "$MODE" ]] || die "Usage: $0 {push|pull|status} [--yes]"

case "$MODE" in
  status)
    require_local_db
    require_ssh
    echo "=== local ($LOCAL_DB_CONTAINER) ==="
    local_table_counts
    echo "=== cloud ($CLOUD_PG_CONTAINER / $CLOUD_DB_NAME) ==="
    cloud_table_counts
    ;;

  push)
    require_local_db
    require_ssh
    echo "=== local counts ==="
    local_table_counts
    echo "=== cloud counts (before) ==="
    cloud_table_counts || true
    confirm "Replace CLOUD database '$CLOUD_DB_NAME' with a full dump from local?" \
      || die "Aborted."

    STAMP="$(ts)"
    SQL="$TMP_DIR/read_local_to_cloud_${STAMP}.sql"
    echo "Dumping local → $SQL"
    docker exec "$LOCAL_DB_CONTAINER" \
      pg_dump -U "$LOCAL_DB_USER" -d "$LOCAL_DB_NAME" --clean --if-exists --no-owner --no-acl \
      > "$SQL"

    REMOTE_SQL="~/Read/tmp_sync_push_${STAMP}.sql"
    echo "Uploading dump to $SSH_HOST"
    scp -q "$SQL" "${SSH_HOST}:${REMOTE_SQL}"

    echo "Resetting cloud schema + restoring…"
    reset_cloud_schema
    ssh_cmd "docker exec -i $CLOUD_PG_CONTAINER psql -U $CLOUD_DB_USER -d $CLOUD_DB_NAME -v ON_ERROR_STOP=1" \
      < "$SQL" >/dev/null
    ssh_cmd "rm -f $REMOTE_SQL"

    echo "=== cloud counts (after) ==="
    cloud_table_counts
    echo "push ok"
    ;;

  pull)
    require_local_db
    require_ssh
    echo "=== cloud counts ==="
    cloud_table_counts
    echo "=== local counts (before) ==="
    local_table_counts || true
    confirm "Replace LOCAL database with a full dump from cloud?" \
      || die "Aborted."

    STAMP="$(ts)"
    REMOTE_SQL="~/Read/tmp_sync_pull_${STAMP}.sql"
    SQL="$TMP_DIR/read_cloud_to_local_${STAMP}.sql"
    echo "Dumping cloud…"
    ssh_cmd "docker exec $CLOUD_PG_CONTAINER pg_dump -U $CLOUD_DB_USER -d $CLOUD_DB_NAME --clean --if-exists --no-owner --no-acl > $REMOTE_SQL"
    scp -q "${SSH_HOST}:${REMOTE_SQL}" "$SQL"
    ssh_cmd "rm -f $REMOTE_SQL"

    echo "Resetting local schema + restoring…"
    reset_local_schema
    docker exec -i "$LOCAL_DB_CONTAINER" \
      psql -U "$LOCAL_DB_USER" -d "$LOCAL_DB_NAME" -v ON_ERROR_STOP=1 \
      < "$SQL" >/dev/null

    echo "=== local counts (after) ==="
    local_table_counts
    echo "pull ok"
    ;;

  *)
    die "Usage: $0 {push|pull|status} [--yes]"
    ;;
esac
