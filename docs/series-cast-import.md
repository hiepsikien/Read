# Series cast import — resume later

**Status:** Implemented on branch; **not deployed / not E2E-tested against production yet.**  
**Branch:** `feat/series-cast-import`  
**Remote:** `origin/feat/series-cast-import`  
**PR draft link:** https://github.com/hiepsikien/Read/pull/new/feat/series-cast-import

## What this is

Flexible cast inheritance across episodes in the same series (e.g. Đại Lộ Đại Dương S1):

1. **Update** characters that match by name/alias.
2. **Carry forward** source characters missing on the target (even if they do not speak yet).
3. **Skip** target rows that are already `cast_locked` (local edits win).
4. Imported rows are locked against rebuild; admins can still edit age/voice in the UI.
5. Cast UI defaults filter to **Matched** (speaking / glossary-matched) — the audio editorial focus.

## Key files

| Path | Role |
|------|------|
| `apps/api/app/cast_import.py` | Match + carry-forward logic |
| `apps/api/app/routers/admin.py` | `GET …/cast` adds `import_sources`; `POST …/cast/import-from` |
| `apps/api/tests/test_cast_import.py` | Unit tests |
| `apps/api/tests/test_admin_book_cast.py` | API integration test |
| `packages/api-client/src/index.ts` | `adminImportBookCast`, `import_sources` types |
| `apps/mobile/components/AdminBookCastPanel.tsx` | Import UI + Matched filter |

## Resume checklist

```bash
git fetch origin
git checkout feat/series-cast-import
git merge origin/main   # keep branch current before testing
```

### Why production app alone is not enough

Mobile `.env` often points at `https://read-api.antunai.com`. That API **does not** have `POST /api/admin/books/{id}/cast/import-from` until this branch is deployed. UI-only checkout against prod will fail or miss the feature.

### Local test (when ready)

1. API on this branch (e.g. `apps/api` → `.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`).
2. Point mobile at that API (`localhost` for simulator, LAN IP for device), then `npx expo start -c`.
3. Login as **admin**.
4. Need **≥2 episodes in the same series**.
5. Flow:
   - Ep1 → Admin → book → **Audio cast** → cast / lock → Mark ready  
   - Ep2 → upload glossary → **Import cast from episode** (pick Ep1)  
   - Filter **Matched** for speaking cast; scope **all** to see carried-forward rows  
   - Optionally change age/voice → Save → Mark ready  

### Production / real series data

Deploy (or temporarily run) API from this branch against the environment that has the series data, then point the admin client at that API. Do not assume prod already has the endpoint.

## Commit reference

Feature commit: `5832c7e` — *Add flexible series cast inheritance across episodes.*  
Later: merge from `main` as needed (e.g. `1e5f661`).
