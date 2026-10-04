# Intelligent Private Vehicle Sharing
### AI-Based Route-Aware Matching and Minimum-Detour Pickup Optimization


Status: **25 / 25 modules complete · 121 tests passing · 92 API routes · 11 collections**

A private-vehicle sharing platform that matches riders to drivers travelling the
same corridor, picks the pickup point that costs the driver the least extra
distance, prices the share fairly, then tracks the ride and watches for safety
events while it happens.

**Design direction locked:** B — Indigo + Lime Night Mobility (dark-first, bold map glow)

**Priority order:** Safety → Route feasibility → Time compatibility → Seat
availability → Minimum detour → Cost → Preferences → AI ranking.
The model only re-orders candidates that already passed every hard gate; it can
never promote a ride that is unsafe, infeasible or full. Every recommendation is
explainable, and the numbers the driver sees are frozen at completion.

---

## At a glance

| Layer | Technology |
|---|---|
| Backend | Python 3.8+, FastAPI, Pydantic v2, Motor (async MongoDB) |
| Database | MongoDB 7 — 11 collections, JSON-schema validators, 28 indexes |
| Frontend | Next.js 14 (App Router), React 18, TypeScript, Tailwind 3 |
| Maps / routing | OSRM (route geometry), Nominatim (geocoding) |
| ML | scikit-learn + XGBoost, offline training → stdlib JSON serving |
| Realtime | Native WebSockets (Module 20) + in-app notification feed (Module 23) |
| Deploy | Multi-stage Dockerfiles, healthchecked compose, readiness probes |

| Scale | |
|---|---|
| Modules | 25 |
| Tests | 121 (`pytest`) |
| API routes | 92 under `/api/v1` |
| Pure service modules | 19 (~2 100 lines of DB-free, unit-tested business logic) |
| API modules / model modules | 23 / 14 |
| Frontend pages / components | 12 / 26 |
| Ranker AUC | **0.9115** logreg (rf 0.8928 · xgb 0.9044) on 4 000 rows |

### Four invariants worth knowing before reading the code
1. **One ruler project-wide.** Matching, pickup optimisation, per-leg costing and
   live progress all use the same equirectangular helpers in
   `services/geo_math.py`, so two features can never disagree about a distance.
2. **AI ranks, it never gates.** `services/matching.py` produces hard
   feasibility; `services/ranker.py` only re-orders the survivors.
3. **Money is frozen at completion.** Module 19 reads the settled `cost_share`
   to build a receipt; it never recomputes it, so a later pricing change cannot
   rewrite what the driver saw.
4. **Side effects can never fail their caller.** `notifications.emit()` and
   ratings writes are total — a dropped notification cannot roll back a booking,
   a trip or a safety alert.

---

## The 25 modules

| # | Module | What it does | Key files | Tests | Note |
|---|---|---|---|---|---|
| 1 | [Setup](docs/module-01-setup.md) | Monorepo, env contract, health probe, run guide | `README.md`, `docker-compose.yml` | 2 | Entry point for everything |
| 2 | [DB design](docs/module-02-db-design.md) | 11 collections, validators, 28 indexes, TTL | `database/schemas/*.json`, `core/indexes.py`, `init_db.py` | 10 | Tests pin all five schema mirrors |
| 3 | [Auth](docs/module-03-auth.md) | Phone+password JWT, OTP verify, role add | `api/v1/auth.py`, `core/security.py` | 5 | Dev OTP shown on screen; no SMS provider |
| 4 | [Profile](docs/module-04-profile.md) | Own profile edit, public card, role upgrade | `api/v1/profile.py` | 1 | Declared ratings read-only — M22 writes them |
| 5 | [Vehicles](docs/module-05-vehicles.md) | Car CRUD + admin verification queue | `api/v1/vehicles.py` | 1 | Editing a car resets verification to pending |
| 6 | [Trips](docs/module-06-trips.md) | Create/publish/cancel/delete + lifecycle | `api/v1/trips.py` | 1 | `draft → published → ongoing → completed` |
| 7 | [Maps + routing](docs/module-07-maps.md) | OSRM route geometry, Nominatim geocoding | `services/routing.py` | 2 | Routing failure never fails a save |
| 8 | [Search](docs/module-08-search.md) | Find rides by corridor, time, seats | `api/v1/search.py` | 1 | Returns feasible matches only |
| 9 | [Matching](docs/module-09-matching.md) | Route overlap %, hard feasibility gates | `services/matching.py` | 7 | The gate the AI is not allowed to move |
| 10 | [Pickup optimisation](docs/module-10-pickup-optimization.md) | Minimum-detour meeting point, walk/door | `services/pickup.py`, `services/stops.py` | 8 | Will walk up to 3 km to save a detour |
| 11 | [Bookings](docs/module-11-bookings.md) | Request → accept/reject → confirm → cancel | `api/v1/bookings.py` | 1 | Seats reserved by atomic conditional `$inc` |
| 12 | [Cost sharing](docs/module-12-cost.md) | Fuel model, 3 share policies, per-seat cap | `services/cost.py` | 8 | Shares can never exceed the trip cost |
| 13 | [Per-leg segments](docs/module-13-segments.md) | Who pays for which leg of the route | `services/segments.py` | 6 | A full rider pays more than a short hop |
| 14 | [Advance booking](docs/module-14-advance-booking.md) | Departure window policy + bookability | `services/booking_window.py` | 4 | Reason strings surface in the ride card |
| 15 | [Recurring series](docs/module-15-recurring.md) | Daily / weekday / weekly materialisation | `services/recurring.py` | 6 | Instances are real trips, tagged with a group id |
| 16 | [AI ranking](docs/module-16-ai-ranking.md) | Learned re-ranker over feasible matches | `ml/`, `services/ranker.py` | 5 | Trains offline, serves with stdlib only |
| 17 | [Live tracking](docs/module-17-tracking.md) | Driver pings → progress + trail | `services/tracking.py`, `api/v1/tracking.py` | 3 | Off-route >500 m · stale >300 s |
| 18 | [Safety](docs/module-18-safety.md) | SOS, over-speed, deviation alerts, ack | `services/safety.py`, `api/v1/safety.py` | 3 | One open alert per (trip, type) |
| 19 | [Completion](docs/module-19-completion.md) | Start/complete, booking resolution, receipt | `services/lifecycle.py` | 4 | Money and seats are frozen here |
| 20 | [Streaming](docs/module-20-streaming.md) | WebSocket push for fix/alert/ack frames | `services/hub.py`, `api/v1/live.py` | 6 | In-process hub → single worker by design |
| 21 | [Admin console](docs/module-21-admin.md) | Users, trips, alerts, moderation, suspension | `services/moderation.py`, `api/v1/admin.py` | 5 | Self-lockout + last-admin protection |
| 22 | [Ratings](docs/module-22-ratings.md) | One review per person per completed ride | `services/ratings.py`, `api/v1/ratings.py` | 7 | Aggregate recomputed, never `$inc`-drifted |
| 23 | [Notifications](docs/module-23-notifications.md) | Event catalog, in-app bell, admin SOS fan-out | `services/notify.py`, `api/v1/notifications.py` | 5 | `emit()` can never raise |
| 24 | [Analytics](docs/module-24-analytics.md) | Sustainability, demand forecast, model evaluation | `services/analytics.py`, `api/v1/analytics.py` | 13 | Negative km and unfavourable riders reported |
| 25 | [Deploy](docs/module-25-deploy.md) | Production guard, probes, images, compose, seed | `core/config.py`, `seed.py` | 7 | Refuses to boot on a dev secret |
| | **Total** | | | **121** | |

---

## Architecture

```
.
├── backend/            FastAPI + Pydantic + Motor (async MongoDB)
│   ├── app/
│   │   ├── api/v1/     23 route modules (thin: gather → call service → write)
│   │   ├── services/   19 PURE modules: no DB, no network, fully unit-tested
│   │   ├── models/     14 Pydantic request/response + document shapes
│   │   └── core/       config, security, deps, database, indexes
│   ├── tests/          121 tests, one file per module
│   ├── init_db.py      creates collections + validators + indexes (idempotent)
│   ├── seed.py         one-command demo data (Module 25)
│   └── Dockerfile      multi-stage, non-root production image
├── frontend/           Next.js 14 App Router + React 18 + TS + Tailwind
│   ├── app/            12 pages (/, /search, /requests, /trips, /me, /garage,
│   │                   /admin, /analytics, /database, /login, /register, /verify)
│   ├── components/     26 components
│   └── lib/            20 typed API clients
├── ml/                 dataset generation + ranker training → JSON weights
├── database/           schemas/*.json validators + indexes/*.mongosh.js
├── docs/               23 per-module notes (9-part template) → feeds the report
└── docker-compose.yml  dev  ·  docker-compose.prod.yml  production
```

**Why business logic lives in `services/`.** Every rule that the API, the tests
and the report all need to agree on is a pure function with no database
connection — `rating_eligibility()`, `completion_guard()`, `sustainability()`,
`speed_verdict()`. The route module then only performs writes. That is why 121
tests can cover the hard parts without a running server, and why the analytics
console can never quote a different number than a receipt.

---

.

## Run the project

### Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Python | 3.8+ | developed and tested on 3.8.0 |
| Node.js | 18.17+ (20 LTS ideal) | Next 14 needs 18.17+ |
| MongoDB | 7 | local `mongod` or `docker compose up -d mongo` |
| Docker | optional | only for the container workflow |

> **First time only:** the `frontend/node_modules` folder currently committed in
> this repo is **incomplete** (`node_modules/next/package.json` is missing).
> You must run `npm install` in `frontend/` once, or the dev server and the
> TypeScript check will fail.

### A. Run it locally (recommended)

```powershell
# 1) MongoDB — pick ONE
docker compose up -d mongo
# ...or run mongod directly on mongodb://localhost:27017

# 2) Backend
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env

# 3) Create collections, validators and indexes  ← REQUIRED, run once
python init_db.py
#    -> "indexes ensured: 28 / DB ready: vehicle_sharing_dev"

# 4) Optional: demo data (run AFTER init_db.py)
python seed.py
#    -> 6 accounts + a week of trip history, ratings, notifications

# 5) Start the API
uvicorn app.main:app --reload --port 8000
```

```powershell
# 6) Frontend (new terminal)
cd ..\frontend
npm install
copy .env.example .env.local
npm run dev
```

Open **http://localhost:3000**.

### Verify it works

| URL | Expect |
|---|---|
| http://localhost:8000/api/v1/health | `{"status":"ok","db":"connected",...}` |
| http://localhost:8000/api/v1/ready | `{"ready":true,...}` — 503 if Mongo is down |
| http://localhost:8000/api/v1/version | build `git_sha`, `app_env`, python version |
| http://localhost:8000/docs | interactive Swagger UI for all 92 routes |
| http://localhost:3000 | landing page, backend "connected" pill |


## Demo walkthrough

`python seed.py` creates six ready-to-use accounts. **All share the password
`pass1234`**, and the OTP code is displayed on the `/verify` page (there is no SMS
provider in the project, by design).

| Phone | Role | Use it for |
|---|---|---|
| `+919000000001` | admin | the console, analytics, moderation |
| `+919000000002` | driver | owns the seeded petrol car + trips |
| `+919000000003` | driver | owns a diesel car (different fuel → different CO₂) |
| `+919000000004` | passenger | has a rating and a completed ride |
| `+919000000005` | passenger | same |
| `+919000000006` | passenger | the cancelled booking in the evaluation |

**Sign in** at `/login` → open `/verify` → the dev code is shown on screen → enter
it. Use a normal window for one role and an incognito window for the other.

### The eight steps that demonstrate the system

| # | Do this | Shows off | Module |
|---|---|---|---|
| 1 | As a driver: `/garage` → add a car | admin verification gate, plate normalisation | 5 |
| 2 | As a driver: `/trips` → create a route → **Publish** | lifecycle machine, OSRM route geometry | 6, 7 |
| 3 | As a passenger: `/search` for the same corridor → open a card | overlap %, minimum-detour pickup, per-leg cost | 8–13 |
| 4 | Passenger: **Request booking** → **Confirm** | atomic seat reservation, price freeze | 11, 12 |
| 5 | Driver: `/requests` → **Accept**; press **SOS** twice | WebSocket push, two critical alerts, admin fan-out | 18, 20, 23 |
| 6 | Driver: **Start trip**, share location, then **Complete ride** | progress, off-route/stale flags, frozen receipt | 17, 19 |
| 7 | Either side: **rate the ride** from the bell or `/requests` | one review per person; the score updates in place | 22, 23 |
| 8 | Admin: `/admin` and `/analytics` | moderation queue, km/CO₂ saved, demand forecast, rule-vs-AI | 21, 24 |

Screens worth pausing on for an examiner:
- `/search` → the AI badge plus the per-feature contribution drawer (why this ride ranked here)
- `/analytics` → **negative `km_avoided`** on a detour-heavy trip — the platform reports the case where sharing cost the driver more, rather than hiding it
- `/analytics` → the "worse than solo" rider count, the fairness check

---

### Run the tests

```powershell
cd backend
python -m pytest -q                    # all 121
python -m pytest tests/test_safety.py -v   # one module
```
Tests need Mongo reachable; the ones that need it skip cleanly when it is not.

## API surface

92 routes under `/api/v1`. Full interactive reference at `/docs`.

| Group | Routes | Auth | What it covers |
|---|---|---|---|
| `/trips` | 21 | mixed | create, publish, cancel, start, complete, receipt, segments, cost, recurring |
| `/bookings` | 9 | user | request, accept, reject, confirm, cancel, mine, incoming |
| `/admin` | 8 | admin | stats, users, suspend, roles, trips, alerts, resolve |
| `/vehicles` | 7 | driver | CRUD + admin verify |
| `/auth` | 6 | mixed | register, login, OTP request/verify, me, logout |
| `/users` | 5 | user | own profile, edit, role add, password, public card |
| `/ratings` | 4 | user | submit, pending, per-booking, public card *(M22)* |
| `/notifications` | 4 | user | feed, summary, mark read, mark all *(M23)* |
| `/analytics` | 4 | admin + me | impact, demand, evaluation, my impact *(M24)* |
| `/recurring` | 4 | driver | series create, list, materialise, stop |
| `/db` | 3 | open | dev-only init, stats, schema explorer |
| `/geo` | 3 | open | geocode, reverse geocode |
| `/tracking` | 3 | audience | ping, live, trail |
| `/safety` | 3 | audience | SOS, trip alerts, ack |
| `/search` | 2 | user | find rides |
| `/stream` | 2 | audience | `WS /stream/trips/{id}`, stream stats |
| `/health` `/ready` `/version` `/rank` | 4 | open | probes and the ranker model card |

**Three ways to authenticate:**
- `Authorization: Bearer <token>` — everything except the open routes
- `?token=<jwt>` on the WebSocket (browsers cannot set headers on a WS handshake)
- no auth — `/health`, `/ready`, `/version`, `/geo`, `/rank`

---

## Database

11 collections, each with a JSON-schema validator and indexed:

`users` · `vehicles` · `trips` · `bookings` · `segments` · `locations` ·
`safety_alerts` · `phone_otps` · `recurring_groups` · `ratings` · `notifications`

- **28 indexes** covering unique constraints, 2dsphere geo, compound lookups,
  a 30-day TTL on `locations`, and a **partial unique** index that enforces the
  Module 23 dedupe rule.
- The collection set is declared in **five** places that must agree:
  `database/schemas/*.json`, `database/indexes/*.mongosh.js`,
  `app/core/indexes.py`, `init_db.py`, and `db_admin.COLLECTIONS`.
  `tests/test_db_design.py` fails the build if they drift — a real bug shipped
  here once, when M22/M23 were added to four of the five.
- Dev-only explorer: `POST /api/v1/db/init`, then `/database` in the UI shows
  every collection, its indexes and its validator.

---

## ML pipeline (Module 16)

The ranker is **trained offline and served with the standard library only** — the
backend has no ML dependency, which is what keeps it deployable anywhere.

```powershell
cd ml
python make_dataset.py --n 4000 --seed 7     # writes data/matches.csv
python train_ranker.py                       # writes artifacts/ranker.json
```

| Model | ROC-AUC (80/20 stratified, seed 7) |
|---|---|
| **Logistic regression — deployed** | **0.9115** |
| XGBoost | 0.9044 |
| Random forest | 0.8928 |

Only the logistic regression is exported, as four weights and a bias:

```json
{ "features": ["overlap01", "pickup01", "dropoff01", "time01"],
  "weights": [8.6953, 4.456, 2.9891, 2.8011], "bias": -10.4554 }
```

`services/ranker.py` applies a sigmoid to those weights, reloads the artifact when
its mtime changes, and **falls back to the rule baseline** if the file is missing,
so search can never break because of ML. The final ranking is
`0.5 × rule + 0.5 × AI` over already-feasible matches, and the UI shows each
feature's contribution so the score is explainable.

---

python -m pytest tests/test_safety.py -v   # one module
```
Tests need Mongo reachable; those that need it `skip` cleanly when it is not.

### B. Run it with Docker

```powershell
# development (live reload)
docker compose up -d --build

# production — see docs/module-25-deploy.md for the full runbook
copy .env.example .env.prod      # set a real JWT_SECRET + https CORS origin
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
docker compose -f docker-compose.prod.yml exec backend python init_db.py
```

### Troubleshooting

| Problem | Fix |

## Testing

**121 tests**, one file per module, run against a live MongoDB.

```powershell
cd backend
python -m pytest -q                             # all 121  (~27 s)
python -m pytest tests/test_analytics.py -v     # one module
python -m pytest -q -k "pure or guard"           # only the no-DB tests
```

| File | Tests | Covers |
|---|---|---|
| `test_db_design.py` | 10 | Document shapes, index mirrors, the five-way collection sync |
| `test_analytics.py` | 13 | Impact arithmetic, shrinkage, MAE/RMSE, AUC, P/R/F1 + live endpoints |
| `test_pickup.py` | 8 | Minimum-detour selection, walk vs door |
| `test_cost.py` | 8 | Share policies, rounding, the no-profit cap |
| `test_matching.py` | 7 | Overlap %, hard gates, fallback |
| `test_deploy.py` | 7 | Production guard, probes, **route shadowing** |
| `test_ratings.py` | 7 | Eligibility, one-vote-per-ride, aggregate recompute |
| `test_segments.py` | 6 | Leg occupancy and per-leg pricing |
| `test_recurring.py` | 6 | Daily/weekly materialisation and caps |
| `test_live.py` | 6 | WebSocket frames, heartbeats, hub failures |
| `test_admin.py` | 5 | Moderation guard, dashboard math |
| `test_auth.py` | 5 | Register/login/OTP, role checks |
| `test_notifications.py` | 5 | Catalog, dedupe modes, audience resolution |
| `test_ranker.py` | 5 | Feature extraction, sigmoid, artifact fallback |
| `test_advance.py` | 4 | Booking window policy |
| `test_completion.py` | 4 | Completion guard, booking resolution, receipt math |
| `test_tracking.py` | 3 | Progress projection, speed, staleness |
| `test_safety.py` | 3 | Speed/deviation ladders, SOS fan-out |
| `test_geo.py` | 2 | Distance + projection on the shared ruler |
| `test_health.py` | 2 | Liveness / readiness |
| `test_bookings.py` `test_profile.py` `test_search.py` `test_trips.py` `test_vehicles.py` | 1 each | End-to-end flow per module |

**What the suite deliberately does not cover:** the frontend (only a TypeScript
check), real OSRM/Nominatim responses (network is stubbed), and real SMS/email
delivery (no provider is configured). `filterwarnings = error` is set in
`pytest.ini`, so any new warning fails the build.

---

## Known gaps and honest limitations

Stated plainly, because an examiner will find them anyway:

**Documentation**
- *(none — all 25 modules have a note in `docs/`)*

**Product scope**
- **Notifications are in-app only.** No email or SMS provider is configured.
- **User-level updates poll** (30 s) rather than push. Module 20's WebSocket hub
  is trip-scoped; a user-scoped channel would need a shared bus.
- **The WebSocket hub is in-process**, so the backend must run a single uvicorn
  worker. Scale-out needs Redis/NATS behind `hub.broadcast()` (no caller changes).
- Driver location pings are currently driver-triggered; automatic device-GPS
  streaming is future work.
- There is **no payout ledger** — `completed` bookings are final in-app.
- Ratings cannot be moderated (an admin can suspend the author) and have no reply.

**Analytics honesty**
- CO₂ factors are **indicative direct-emission constants**; EVs count as 0
  tailpipe and grid intensity is deliberately excluded.
- The demand forecast is a **shrunk-mean baseline**, not a trained model.
- Model evaluation is **retrospective and selection-biased** — we only observe
  outcomes for matches that were actually booked, so it measures correlation.
- "Cost saved" assumes the alternative is a private car; public transport would
  reduce the apparent saving.

**Engineering**
- No CI pipeline; tests are run locally.
- `frontend/node_modules` as committed is incomplete — run `npm install`.
- No `package-lock.json`, so frontend builds are not bit-reproducible.

---

## Documentation index

Per-module notes in `docs/`, each following the same 9-part template
(concept → prerequisites → rules → code map → integration → run & test →
common errors → commit message → SRS/report notes). These feed the SRS and the
final report directly. **All 25 modules have one.**

| # | Note | # | Note |
|---|---|---|---|
| 1 | [setup](docs/module-01-setup.md) | 14 | [advance-booking](docs/module-14-advance-booking.md) |
| 2 | [db-design](docs/module-02-db-design.md) | 15 | [recurring](docs/module-15-recurring.md) |
| 3 | [auth](docs/module-03-auth.md) | 16 | [ai-ranking](docs/module-16-ai-ranking.md) |
| 4 | [profile](docs/module-04-profile.md) | 17 | [tracking](docs/module-17-tracking.md) |
| 5 | [vehicles](docs/module-05-vehicles.md) | 18 | [safety](docs/module-18-safety.md) |
| 6 | [trips](docs/module-06-trips.md) | 19 | [completion](docs/module-19-completion.md) |
| 7 | [maps](docs/module-07-maps.md) | 20 | [streaming](docs/module-20-streaming.md) |
| 8 | [search](docs/module-08-search.md) | 21 | [admin](docs/module-21-admin.md) |
| 9 | [matching](docs/module-09-matching.md) | 22 | [ratings](docs/module-22-ratings.md) |
| 10 | [pickup-optimization](docs/module-10-pickup-optimization.md) | 23 | [notifications](docs/module-23-notifications.md) |
| 11 | [bookings](docs/module-11-bookings.md) | 24 | [analytics](docs/module-24-analytics.md) |
| 12 | [cost](docs/module-12-cost.md) | 25 | [deploy](docs/module-25-deploy.md) |
| 13 | [segments](docs/module-13-segments.md) | | |

---

## Environment contract

Root `.env.example` documents every variable. `backend/app/core/config.py` is the
**only** reader (Pydantic Settings); nothing else touches `os.environ`. The
frontend reads `NEXT_PUBLIC_*` only. **Never commit a real `.env`** — and note
that `NEXT_PUBLIC_*` values are inlined at **build** time, so changing one
requires a rebuild, not a restart.

|---|---|
| `python init_db.py` never ran | Duplicate phone numbers become possible, geo/TTL/unique indexes are missing. Run it. |
| `seed.py` fails with "Document failed validation" | `init_db.py` must run first — the validators come from `database/schemas/`. |
| Frontend shows `Could not find a declaration file for module 'next/link'` | `node_modules` is incomplete. `cd frontend; npm install`. |
| Frontend page loads but every API call fails | Check `frontend/.env.local` has `NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1`. |
| `db: "disconnected"` in /health | Mongo is not running or `MONGO_URI` is wrong. |
| Live tracking never updates in the browser | The WebSocket needs the API host reachable; a reverse proxy must forward the `Upgrade` header. |
| Port 8000 or 3000 already in use | Change `BACKEND_PORT` / the `next dev -p` flag, and the CORS origin to match. |
| `Refusing to start with APP_ENV=production` | Expected — the deploy guard. Fix the JWT secret / CORS origins, or set `APP_ENV=development`. |

├── frontend/   # Next.js App Router + React + TS + Tailwind (Direction B theme)
├── backend/    # FastAPI + Pydantic + Motor (async MongoDB)
├── ml/         # Rule-based baseline first, then sklearn / XGBoost (Module 16)
├── database/   # Schema docs, geospatial index scripts, seed scripts (Module 2)
├── docs/       # Per-module notes → feeds SRS / report
├── docker-compose.yml  # mongo + backend + frontend (dev)
└── .env.example
```

