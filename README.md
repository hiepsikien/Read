# Read

Mobile-friendly book reading product with **web**, **native (Expo/React Native)**, and a shared **FastAPI** backend.

> **Tài liệu dự án (Tiếng Việt):** [docs/PROJECT.md](./docs/PROJECT.md)

## Architecture

| App | Path | Role |
|-----|------|------|
| Web | `apps/web` | Next.js — full MVP library / reader / publisher |
| API | `apps/api` | FastAPI + PostgreSQL — auth, books, split, purchase |
| Mobile | `apps/mobile` | Expo (iOS + Android) — library → detail → reader → purchase |

Shared typed client: `packages/api-client`.

## Demo accounts

| Role | Email | Password |
|------|-------|----------|
| Reader | `reader@read.app` | `reader123` |
| Publisher | `publisher@read.app` | `publisher123` |

## Run locally

### 1. Database

```bash
docker compose up -d db
```

### 2. API

```bash
python3 -m venv apps/api/.venv
apps/api/.venv/bin/pip install -r apps/api/requirements.txt
cp apps/api/.env.example apps/api/.env
cd apps/api && .venv/bin/uvicorn app.main:app --reload --port 8000
```

API: http://localhost:8000 · Docs: http://localhost:8000/docs

### 3. Web

```bash
npm install
cp apps/web/.env.local.example apps/web/.env.local
npm run dev:web
```

Open http://localhost:3000.

### 4. Mobile (reader MVP)

```bash
cd apps/mobile
npm install
npx expo start
```

Set `EXPO_PUBLIC_API_URL` to your machine LAN IP when testing on a physical device (not `localhost`).

Mobile is intentionally **outside** the npm workspaces (Expo + Next conflict on React); it links `@read/api-client` via `file:`.

## Scripts

```bash
npm run api:test   # pytest — chapter split + access rules
npm run build      # Next.js production build
```

## Stack

- **Web:** Next.js 15 (App Router) + TypeScript + Tailwind
- **Mobile:** React Native via Expo (cross-platform iOS/Android)
- **API:** FastAPI + SQLAlchemy + Alembic + PostgreSQL
- **Auth:** JWT Bearer (web + mobile)
- **Docs:** `pdf` / `docx` text extract; smart chapter split on the API
- **Payments:** mock purchase (no Stripe yet)

## Docs

- [docs/PROJECT.md](./docs/PROJECT.md) — product goals, MVP decisions, architecture, phases
