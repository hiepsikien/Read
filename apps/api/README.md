# Read API

FastAPI backend for the Read web and mobile clients.

## Setup

```bash
# from repo root
docker compose up -d db   # Postgres on localhost:5433
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
.venv/bin/uvicorn app.main:app --reload --port 8000
```

## Tests

```bash
.venv/bin/pytest -q
```

## Migrations

Schema is created on startup (`create_all`) for local MVP. Alembic lives in `alembic/` for production-style migrations:

```bash
.venv/bin/alembic upgrade head
```
