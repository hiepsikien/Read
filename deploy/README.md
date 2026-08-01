# Deploy Read API on shared `vstock-api` VM

Shares the Angi Postgres container (**separate** database `read` + role `read`) and Caddy on `angi_net`.

## Domains

DNS A record → `34.124.179.140`:

- `read-api.antunai.com`

## Sync local ↔ cloud

One-time:

```bash
cp deploy/.env.sync.example deploy/.env.sync
# Set CLOUD_DB_PASSWORD = READ_DB_PASSWORD from deploy/.env.prod (or VM)
```

```bash
# Compare row counts / upload sizes
npm run sync:status
# or: ./scripts/sync-db.sh status && ./scripts/sync-uploads.sh status

# Push local DB + uploads → cloud (replaces cloud schema)
./scripts/sync-to-cloud.sh
./scripts/sync-to-cloud.sh --yes              # no prompts
./scripts/sync-to-cloud.sh --db-only
./scripts/sync-to-cloud.sh --uploads-only

# Pull cloud → local
./scripts/sync-from-cloud.sh

# Optional: Postgres GUI over SSH tunnel
./scripts/cloud-db-tunnel.sh   # localhost:15432 → VM :5432
```

`push` / `pull` for DB **drop + restore** the target schema. Uploads default to merge; add `--delete-uploads` to prune extras on the destination.

## One-time: Postgres role + database

On the VM (password = `POSTGRES_PASSWORD` from `~/check-food/deploy/.env.prod`):

```bash
# Generate a password for Read, then:
export READ_DB_PASSWORD='...'

docker exec -i deploy-postgres-1 psql -U checkfood -d postgres <<SQL
CREATE USER read WITH PASSWORD '${READ_DB_PASSWORD}';
CREATE DATABASE read OWNER read;
GRANT ALL PRIVILEGES ON DATABASE read TO read;
\\c read
GRANT ALL ON SCHEMA public TO read;
ALTER DATABASE read OWNER TO read;
SQL
```

## One-time / update: Caddy route

In `~/check-food/deploy/Caddyfile`, add:

```caddy
read-api.antunai.com {
	encode gzip
	reverse_proxy read-api:8000
}
```

Then reload Caddy:

```bash
cd ~/check-food/deploy
docker compose -f docker-compose.prod.yml --env-file .env.prod exec caddy caddy reload --config /etc/caddy/Caddyfile
# or: docker compose ... up -d caddy
```

## Deploy / update API

From Mac (rsync source + compose):

```bash
rsync -avz --delete \
  --exclude '.venv' --exclude '__pycache__' --exclude '.pytest_cache' --exclude 'uploads' \
  --exclude '.env' --exclude '*firebase-adminsdk*.json' --exclude '*service-account*.json' \
  apps/api/ angi-vm:~/Read/apps/api/

rsync -avz deploy/docker-compose.prod.yml deploy/.env.prod.example deploy/README.md \
  angi-vm:~/Read/deploy/
```

On VM:

```bash
cd ~/Read/deploy
cp .env.prod.example .env.prod   # first time only — fill READ_DB_PASSWORD etc.
docker compose -p read -f docker-compose.prod.yml --env-file .env.prod up -d --build
curl -fsS https://read-api.antunai.com/health
```

## Scale later

Rebuild the same image and run on Cloud Run + Cloud SQL + GCS; this compose is temporary shared-VM hosting.

## Network note

Read joins external `angi_net`. The compose **service name must be `read-api`**, never `api` — Angi already uses DNS alias `api` for Caddy.
