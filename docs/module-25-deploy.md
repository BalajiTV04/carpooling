# Module 25 — Deploy & harden (the runbook)

**Status:** VERIFIED · `pytest tests/test_deploy.py` 7/7 · `python init_db.py`
and `python seed.py` both run clean against a live Mongo · full suite green.

## 1. What this module actually changes
Nothing user-facing. Modules 1–24 are the product; this module is what makes
them *deployable and demonstrable*:

- a production configuration guard that refuses to boot on unsafe settings;
- liveness / readiness / version probes a load balancer can use;
- production images (multi-stage, non-root, no live reload);
- a production compose file (credentialed DB, healthchecked, no open DB port);
- a one-command demo seed;
- and a test that would have caught the worst bug in the project.

## 2. Prerequisites
- Docker + Compose v2
- A `.env.prod` (never committed) with a real `JWT_SECRET` and https origins

## 3. Rules
- **`config.validate_production(settings)`** — pure, returns a list of problems:
  - `JWT_SECRET` still the shipped dev value → **blocked** (anyone could forge a
    token; this is the single most important check)
  - `JWT_SECRET` shorter than 32 chars → blocked
  - `CORS_ORIGINS` empty → blocked
  - a `CORS_ORIGINS` entry that is plain http and not localhost → blocked
- **`app/main.py`** raises at import time *only* when `APP_ENV=production`. In
  development the guard is a no-op, so local runs and the test suite are
  unaffected. Failing at startup is the point: a bad deploy should never accept
  traffic.

## 4. Probes
| Route | Meaning | Use it for |
|---|---|---|
| `GET /health` | always 200 while the process is up; reports `db` separately | the frontend's Connected/Disconnected pill |
| `GET /ready` | **200 only when Mongo answers, else 503** | Docker healthcheck, load balancer, `depends_on: service_healthy` |
| `GET /version` | `git_sha`, `app_env`, python version | identifying which build is live |

Liveness and readiness are deliberately different: an instance with no database
is *running* but cannot *serve*, and only `/ready` says so.

## 5. Running it

### Development (unchanged)
```powershell
docker compose up -d mongo
cd backend; python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt; copy .env.example .env
python init_db.py          # REQUIRED: collections + validators + indexes
python seed.py             # optional: demo accounts and a week of history
uvicorn app.main:app --reload --port 8000
cd ..\frontend; npm install; copy .env.example .env.local; npm run dev
```

### Production
```powershell
copy .env.example .env.prod
# edit .env.prod: JWT_SECRET (32+ random chars), CORS_ORIGINS (https),
#                  NEXT_PUBLIC_API_URL, MONGO_ROOT_USER/PASSWORD
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.prod ps   # wait: healthy
curl http://localhost:8000/api/v1/ready        # {"ready": true, ...}
curl http://localhost:8000/api/v1/version      # confirms GIT_SHA
```
Then, once, against the production database:
```powershell
docker compose -f docker-compose.prod.yml exec backend python init_db.py
```

## 6. Gotchas that will bite you
1. **`NEXT_PUBLIC_*` is inlined at BUILD time.** Setting it in the container's
   environment at `run` time does nothing — the bundle is already compiled. It is
   a build ARG in `docker-compose.prod.yml`; changing it needs a rebuild.
2. **Single uvicorn worker, on purpose.** Module 20's WebSocket hub is an
   in-process registry, so `--workers 2` would give each worker its own watchers
   and half the clients would silently stop receiving frames. Scale-out needs a
   shared bus (Redis pub/sub or NATS) behind `hub.broadcast()`; no caller changes.
3. **A reverse proxy must forward the `Upgrade` header** for
   `WS /api/v1/stream/trips/{id}`, or live tracking silently degrades to nothing.
   `lib/live.ts` derives the socket origin from `NEXT_PUBLIC_API_URL`, so one
   host variable is all that moves.
4. **`python init_db.py` is not optional.** Without it there are no unique, geo,
   TTL or partial indexes — duplicate phone numbers become possible and the
   Module 23 dedupe guarantee does not exist.
5. **`npm run build` runs `tsc`.** A type error fails the image build. That is
   intended; commit a `package-lock.json` (there is none yet) so builds are
   reproducible.

## 7. The bug this module found
Writing the route-shape test turned up a **pre-existing, shipped** defect:
`GET /trips/mine` was declared *after* `GET /trips/{trip_id}`. FastAPI matches in
registration order, so the catch-all consumed the literal string `mine` as a trip
id and the driver's entire **My Trips** page returned `404 "trip not found"` —
with no other symptom and no warning. Fixed by moving the route, and
`test_no_literal_route_is_shadowed_by_a_catch_all` now checks **every** router in
the project so it cannot happen again. A manual smoke pass over the real pages
found two more issues: `init_db.py` was missing the Module 22/23 collections (so
they had no validators or indexes), and the Module 23 dedupe index was declared
`sparse` when a compound sparse index still indexes SOS rows — now a
`partialFilterExpression` index, which is the only primitive that means what we
needed.
