#!/usr/bin/env bash
# Deploy Read API to the shared vstock-api VM.
#
# Local deploy/.env.prod is the source of truth for runtime env (gitignored).
# This script rsyncs that file to the VM; docker compose --env-file reads it
# when recreating the container. Docker build does not ingest secrets.
# Postgres and the uploads volume are left alone.
#
# Usage:
#   ./scripts/deploy.sh              # confirm, rsync, rebuild, migrate, health
#   ./scripts/deploy.sh --yes        # no prompts
#   ./scripts/deploy.sh --no-migrate
#   ./scripts/deploy.sh --dry-run    # rsync -n only
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_PROD="$ROOT/deploy/.env.prod"

die() {
  echo "error: $*" >&2
  exit 1
}

ASSUME_YES=0
DO_MIGRATE=1
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=1 ;;
    --no-migrate) DO_MIGRATE=0 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      sed -n '2,15p' "$0"
      exit 0
      ;;
    *)
      die "Unknown arg: $arg (try --help)"
      ;;
  esac
done

if [[ ! -f "$ENV_PROD" ]]; then
  die "Missing $ENV_PROD — copy deploy/.env.prod.example → deploy/.env.prod and fill secrets."
fi

if git -C "$ROOT" check-ignore -q deploy/.env.prod; then
  :
else
  die "deploy/.env.prod is not gitignored. Refusing to deploy."
fi

validate_env_prod() {
  local n=0 line
  while IFS= read -r line || [[ -n "$line" ]]; do
    n=$((n + 1))
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ ! "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
      die "$ENV_PROD:$n is not KEY=value. Compose rejects spaces in keys (nano/editor chrome in the file?)."
    fi
  done < "$ENV_PROD"
}

validate_env_prod

if [[ -f "$ROOT/deploy/.env.sync" ]]; then
  # SSH_HOST only. Do not source .env.prod into this shell.
  # shellcheck disable=SC1091
  SSH_HOST_FROM_SYNC="$(
    set -a
    source "$ROOT/deploy/.env.sync"
    set +a
    printf '%s' "${SSH_HOST:-}"
  )"
  if [[ -n "$SSH_HOST_FROM_SYNC" ]]; then
    SSH_HOST="${SSH_HOST:-$SSH_HOST_FROM_SYNC}"
  fi
fi

SSH_HOST="${SSH_HOST:-angi-vm}"
REMOTE_ROOT="${REMOTE_ROOT:-Read}"
HEALTH_URL="${HEALTH_URL:-https://read-api.antunai.com/health}"
COMPOSE_FILE="docker-compose.prod.yml"
COMPOSE_PROJECT="read"

RSYNC_API=(
  rsync -avz --delete
  --exclude '.venv'
  --exclude '__pycache__'
  --exclude '.pytest_cache'
  --exclude '.mypy_cache'
  --exclude '.ruff_cache'
  --exclude 'uploads'
  --exclude '.env'
  --exclude '.env.*'
  --exclude '.DS_Store'
  --exclude '*firebase-adminsdk*.json'
  --exclude '*service-account*.json'
)

RSYNC_DEPLOY=(
  rsync -avz
  "$ROOT/deploy/docker-compose.prod.yml"
  "$ROOT/deploy/.env.prod.example"
  "$ROOT/deploy/README.md"
)

require_ssh() {
  ssh -o BatchMode=yes -o ConnectTimeout=8 "$SSH_HOST" 'true' \
    || die "Cannot SSH to $SSH_HOST (BatchMode). Check ~/.ssh/config host '$SSH_HOST'."
}

confirm() {
  local prompt="${1:-Continue?}"
  if [[ "$ASSUME_YES" == "1" ]]; then
    return 0
  fi
  read -r -p "$prompt [y/N] " ans
  [[ "$ans" == "y" || "$ans" == "Y" || "$ans" == "yes" ]]
}

remote() {
  ssh -o BatchMode=yes "$SSH_HOST" "$@"
}

hub_token_status() {
  if grep -Eq '^[[:space:]]*HUB_SYNC_TOKEN=[^[:space:]#]+' "$ENV_PROD"; then
    echo "set"
  else
    echo "empty (Hub ingest will 503)"
  fi
}

wait_health() {
  local i
  echo "Waiting for $HEALTH_URL ..."
  for i in $(seq 1 45); do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
      echo "Healthy: $(curl -fsS "$HEALTH_URL")"
      return 0
    fi
    sleep 2
  done
  die "Health check failed after ~90s: $HEALTH_URL"
}

echo "Host:     $SSH_HOST"
echo "Env:      deploy/.env.prod (local → VM)"
echo "Hub:      $(hub_token_status)"
echo "Remote:   ~/${REMOTE_ROOT}/{apps/api,deploy}"
echo "Health:   $HEALTH_URL"
echo "Migrate:  $([[ "$DO_MIGRATE" == "1" ]] && echo yes || echo no)"
echo

if [[ "$DRY_RUN" == "1" ]]; then
  echo "==> Dry-run rsync (API)"
  "${RSYNC_API[@]}" -n "$ROOT/apps/api/" "${SSH_HOST}:~/${REMOTE_ROOT}/apps/api/"
  echo
  echo "==> Dry-run rsync (deploy + .env.prod)"
  "${RSYNC_DEPLOY[@]}" -n "${SSH_HOST}:~/${REMOTE_ROOT}/deploy/"
  rsync -avz -n "$ENV_PROD" "${SSH_HOST}:~/${REMOTE_ROOT}/deploy/"
  echo
  echo "Dry-run only. No rebuild."
  exit 0
fi

confirm "Deploy API + .env.prod to ${SSH_HOST} (rebuild container, keep DB + uploads)?" \
  || die "Aborted."

require_ssh

echo "==> Rsync apps/api"
"${RSYNC_API[@]}" "$ROOT/apps/api/" "${SSH_HOST}:~/${REMOTE_ROOT}/apps/api/"

echo "==> Rsync deploy compose files"
"${RSYNC_DEPLOY[@]}" "${SSH_HOST}:~/${REMOTE_ROOT}/deploy/"

echo "==> Rsync deploy/.env.prod"
rsync -avz "$ENV_PROD" "${SSH_HOST}:~/${REMOTE_ROOT}/deploy/"
remote "chmod 600 ~/${REMOTE_ROOT}/deploy/.env.prod"

echo "==> Build and recreate read-api"
remote "cd ~/${REMOTE_ROOT}/deploy && docker compose -p ${COMPOSE_PROJECT} -f ${COMPOSE_FILE} --env-file .env.prod up -d --build"

if [[ "$DO_MIGRATE" == "1" ]]; then
  echo "==> Alembic upgrade head"
  remote "cd ~/${REMOTE_ROOT}/deploy && docker compose -p ${COMPOSE_PROJECT} -f ${COMPOSE_FILE} --env-file .env.prod exec -T read-api alembic upgrade head"
fi

wait_health
echo "Done."
