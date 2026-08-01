#!/usr/bin/env bash
# Sync uploads/ (+ TTS cache) between local disk and cloud read-api volume.
#
# Usage:
#   ./scripts/sync-uploads.sh push         # local → cloud
#   ./scripts/sync-uploads.sh pull         # cloud → local
#   ./scripts/sync-uploads.sh push --yes
#   ./scripts/sync-uploads.sh status
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=./_sync_common.sh
source "$ROOT/scripts/_sync_common.sh"
load_sync_env

MODE="${1:-}"
shift || true
DELETE_EXTRA=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=1 ;;
    --delete) DELETE_EXTRA=1 ;;
    *) die "Unknown arg: $arg (supported: --yes, --delete)" ;;
  esac
done

[[ -n "$MODE" ]] || die "Usage: $0 {push|pull|status} [--yes] [--delete]"

LOCAL_DIR="$ROOT/$LOCAL_UPLOADS_DIR"
if [[ "$LOCAL_UPLOADS_DIR" = /* ]]; then
  LOCAL_DIR="$LOCAL_UPLOADS_DIR"
fi

case "$MODE" in
  status)
    require_ssh
    echo "=== local ($LOCAL_DIR) ==="
    if [[ -d "$LOCAL_DIR" ]]; then
      find "$LOCAL_DIR" -type f | wc -l | awk '{print "files",$1}'
      du -sh "$LOCAL_DIR" | awk '{print "size",$1}'
    else
      echo "missing"
    fi
    echo "=== cloud ($CLOUD_API_CONTAINER:$CLOUD_UPLOADS_PATH) ==="
    ssh_cmd "docker exec $CLOUD_API_CONTAINER sh -c 'mkdir -p $CLOUD_UPLOADS_PATH; find $CLOUD_UPLOADS_PATH -type f | wc -l; du -sh $CLOUD_UPLOADS_PATH'"
    ;;

  push)
    require_ssh
    [[ -d "$LOCAL_DIR" ]] || die "Local uploads dir missing: $LOCAL_DIR"
    echo "=== local ==="
    find "$LOCAL_DIR" -type f | wc -l | awk '{print "files",$1}'
    du -sh "$LOCAL_DIR"
    confirm "Push local uploads to cloud container '$CLOUD_API_CONTAINER'?" || die "Aborted."

    STAGING="~/Read/uploads-staging"
    ssh_cmd "mkdir -p $STAGING && find $STAGING -mindepth 1 -delete"
    echo "Rsync → $SSH_HOST:$STAGING"
    rsync -az --progress "$LOCAL_DIR"/ "${SSH_HOST}:${STAGING}/"

    echo "docker cp → $CLOUD_API_CONTAINER:$CLOUD_UPLOADS_PATH"
    ssh_cmd "docker exec $CLOUD_API_CONTAINER mkdir -p $CLOUD_UPLOADS_PATH"
    if [[ "$DELETE_EXTRA" == "1" ]]; then
      confirm "Also DELETE cloud files not present locally?" || die "Aborted."
      ssh_cmd "docker exec $CLOUD_API_CONTAINER sh -c 'find $CLOUD_UPLOADS_PATH -mindepth 1 -delete'"
    fi
    ssh_cmd "docker cp $STAGING/. $CLOUD_API_CONTAINER:$CLOUD_UPLOADS_PATH/"
    ssh_cmd "rm -rf $STAGING"

    echo "=== cloud (after) ==="
    ssh_cmd "docker exec $CLOUD_API_CONTAINER sh -c 'find $CLOUD_UPLOADS_PATH -type f | wc -l; du -sh $CLOUD_UPLOADS_PATH'"
    echo "push ok"
    ;;

  pull)
    require_ssh
    mkdir -p "$LOCAL_DIR"
    echo "=== cloud ==="
    ssh_cmd "docker exec $CLOUD_API_CONTAINER sh -c 'find $CLOUD_UPLOADS_PATH -type f | wc -l; du -sh $CLOUD_UPLOADS_PATH'"
    confirm "Pull cloud uploads into local '$LOCAL_DIR'?" || die "Aborted."

    if [[ "$DELETE_EXTRA" == "1" ]]; then
      confirm "Also DELETE local files not present on cloud?" || die "Aborted."
      find "$LOCAL_DIR" -mindepth 1 -delete
    fi

    echo "Streaming tar from cloud…"
    ssh_cmd "docker exec $CLOUD_API_CONTAINER sh -c 'cd $CLOUD_UPLOADS_PATH && tar -cf - .'" \
      | tar -C "$LOCAL_DIR" -xf -

    echo "=== local (after) ==="
    find "$LOCAL_DIR" -type f | wc -l | awk '{print "files",$1}'
    du -sh "$LOCAL_DIR"
    echo "pull ok"
    ;;

  *)
    die "Usage: $0 {push|pull|status} [--yes] [--delete]"
    ;;
esac
