#!/usr/bin/env bash
# Push local DB + uploads to cloud (full replace of cloud DB schema).
#
# Usage:
#   ./scripts/sync-to-cloud.sh           # interactive confirm
#   ./scripts/sync-to-cloud.sh --yes     # no prompts
#   ./scripts/sync-to-cloud.sh --db-only
#   ./scripts/sync-to-cloud.sh --uploads-only
#   ./scripts/sync-to-cloud.sh --yes --delete-uploads  # also prune cloud-only files
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
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg" >&2
      exit 1
      ;;
  esac
done

if [[ "$DO_DB" == "1" ]]; then
  "$ROOT/scripts/sync-db.sh" push "${YES_ARGS[@]+"${YES_ARGS[@]}"}"
fi
if [[ "$DO_UPLOADS" == "1" ]]; then
  "$ROOT/scripts/sync-uploads.sh" push "${YES_ARGS[@]+"${YES_ARGS[@]}"}" "${UPLOAD_EXTRA[@]+"${UPLOAD_EXTRA[@]}"}"
fi

echo
echo "Done. Spot-check: curl -fsS https://read-api.antunai.com/api/books | head"
