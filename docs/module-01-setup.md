# Module 1 — Project setup
**Status:** scaffolded · backend tests 2/2 passing · frontend install pending (network slow)

## 1. Concept / why
Monorepo (`frontend/ backend/ ml/ database/ docs/`) so the MCA report maps
1:1 to folders. Versioned API (`/api/v1`) lets all 25 modules grow without
breaking earlier ones. Env contract first so secrets never get committed.

## 2. Prerequisites
- Python 3.8 (this machine) — pins use ranges compatible with 3.8 AND 3.11+
- Node 24 · npm · MongoDB (docker or local) · Git

## 3. DB / endpoints
- No collections yet (Module 2). `GET /api/v1/health` → `{status, service, db, routing_provider}`.
- `db` is `connected` only when Mongo answers; backend still boots otherwise.

## 4. Code map (what each piece does)
- `backend/app/main.py` — FastAPI entrypoint, CORS, mounts v1 router.
- `backend/app/api/v1/router.py` — aggregation point; future modules only add `include_router`.
- `backend/app/api/v1/health.py` — the one probe endpoint.
- `backend/app/core/config.py` — ONLY env reader (Pydantic Settings).
- `backend/app/core/database.py` — shared Motor client + `ping_db()`.
- `backend/tests/test_health.py` — 2 smoke tests, no Mongo needed.
- `frontend/app/page.tsx + components/ + lib/api.ts` — Direction B landing shell, health pill, map placeholder.
- `frontend/tailwind.config.js + app/globals.css` — night/indigo/lime tokens, glow, type scale (Sora display + Inter body).
- `docker-compose.yml` — mongo + backend + frontend dev wiring.
- `.env.example` (root/backend/frontend) — full variable contract.

## 5. Integration
Nothing to integrate yet. Module 2 adds `database/` schemas + index scripts
without touching this scaffold; Module 3 adds `app/api/v1/auth.py` + registers it in `router.py`.

## 6. Run + test (verified on this machine)
```powershell
cd backend
python -m pytest -q            # expect: 2 passed
copy .env.example .env         # then: uvicorn app.main:app --reload --port 8000
# expect at http://localhost:8000/api/v1/health:
# {"status":"ok","service":"Intelligent Vehicle Sharing API","db":"disconnected","routing_provider":"osrm"}
# ("disconnected" is correct until Mongo runs — Module 2 starts it.)
```
Frontend (pending slow npm install on this machine — rerun on yours):
```powershell
cd frontend
npm.cmd install; copy .env.example .env.local; npm.cmd run dev
npm.cmd run typecheck          # expect: clean
```

## 7. Common errors
| Error | Cause → fix |
|---|---|
| `uvicorn==x not found` / motor↔pymongo conflict | Python 3.8 — keep the RANGE pins in `requirements.txt`, never exact latest |
| `TypeError: 'type' object is not subscriptable` | `list[str]` on 3.8 → use `typing.List` (already fixed in config.py) |
| `npm.ps1 cannot be loaded` | PowerShell policy → use `npm.cmd` |
| health says `disconnected` | Mongo not running — expected in Module 1 |

## 8. Commit message
```
chore(setup): scaffold monorepo, backend health API, Direction-B frontend shell

- backend: FastAPI + versioned router + /api/v1/health + Motor wiring + 2 smoke tests
- frontend: Next.js App Router + Indigo/Lime night theme + health pill + map placeholder
- tooling: env contract, compose file, VS Code recs, per-module docs
```

## 9. SRS / report notes
- Architecture figure: Next.js ↔ FastAPI `/api/v1` ↔ MongoDB (Motor); OSRM/Nominatim in Module 7; sklearn/XGBoost in Module 16.
- Priority principle (examiners love this): Safety → Route → Time → Seats → Detour → Cost → Prefs → AI; AI never overrides hard constraints; every match is explainable.
- Design decision B: dark-first Indigo `#0B1030/#7B77FF` + Lime `#C6FF4A`, Sora + Inter, glow map treatment.

