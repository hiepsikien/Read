#!/usr/bin/env bash
# Pull cloud DB + uploads down to local (full replace of local DB schema).
#
# Usage:
#   ./scripts/sync-from-cloud.sh
#   ./scripts/sync-from-cloud.sh --yes
#   ./scripts/sync-from-cloud.sh --db-only
#   ./scripts/sync-from-cloud.sh --uploads-only
#   ./scripts/sync-from-cloud.sh --yes --delete-uploads
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

DO_DB=1
DO_UPLOADS=1
YES_ARGS=()
UPLOAD_EXTRA=()

for arg in "$@"; do
  case "$arg" in
    --yes|-y) YES_ARGS+=(--yes) ;;
    --db-only) DO_UPLOADS=0 ;;
    --uploads-only) DO_DB=0 ;;
    --delete-uploads) UPLOAD_EXTRA+=(--delete) ;;
    -h|--help)
      sed -n '2,11p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg" >&2
      exit 1
      ;;
  esac
done

if [[ "$DO_DB" == "1" ]]; then
  "$ROOT/scripts/sync-db.sh" pull "${YES_ARGS[@]+"${YES_ARGS[@]}"}"
fi
if [[ "$DO_UPLOADS" == "1" ]]; then
  "$ROOT/scripts/sync-uploads.sh" pull "${YES_ARGS[@]+"${YES_ARGS[@]}"}" "${UPLOAD_EXTRA[@]+"${UPLOAD_EXTRA[@]}"}"
fi

echo
echo "Done. Local API should see cloud data after restart if it was running."
