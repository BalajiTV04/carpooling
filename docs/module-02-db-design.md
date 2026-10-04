# Module 2 — Database design
**Status:** VERIFIED LIVE · `python init_db.py` created 7 collections + 19 indexes · seed inserted 1 driver + 1 vehicle + 1 trip · `pytest` 9/9 passing.

## 1. Concept / why
MongoDB stores each aggregate as one rich document, so a trip (source/dest
Points + LineString route + seats + depart_at) reads in ONE query — no joins
at matching time. GeoJSON + `2dsphere` turns "who drives near me" (Module 9)
into an index lookup instead of string-matching city names. Validators
($jsonSchema) enforce shape at the DB layer even if a buggy route tries to
write junk; TTL on `locations` auto-deletes GPS after 30 days (privacy:
tracking exists only inside active trips, per your brief).

## 2. Prerequisites
- Module 1 scaffold (config.py, database.py Motor client) · MongoDB running
- `cd backend; copy .env.example .env` (MONGO_URI/MONGO_DB)
- Motor ODM decision: **Motor + hand-written Pydantic docs, NO Beanie.**
  Why: Beanie hides validators/indexes behind decorators (bad for an MCA
  report — examiners want to SEE $jsonSchema + 2dsphere); Motor keeps every
  query explicit for Modules 9/10 geo queries; and Beanie's latest needs
  Python 3.9+ async features while this machine runs 3.8.

## 3. DB design + API endpoints
Seven collections (full field tables in `database/schemas/*.json`):
users (E.164 phone login key, roles[]) · vehicles (plate unique, verified
flag) · trips (3×2dsphere: source/dest/route LineString) · bookings (pickup/
dropoff Points + match/cost fields pre-declared) · segments (unique
trip+seq, Module 13) · locations (2dsphere + TTL 30d) · safety_alerts
(sos/speed/deviation).
New endpoints (dev-only admin): `POST /api/v1/db/init`, `GET /api/v1/db/stats`,
`GET /api/v1/db/schema/{collection}`.

## 4. Code map
- `database/schemas/*.json` — 7 validators + `00-overview.md` ER sketch.
- `database/indexes/01-indexes.mongosh.js` — 19 indexes, mongosh path.
- `backend/app/core/indexes.py` — SAME 19 indexes for the API (kept in sync by hand).
- `backend/app/models/{common,users_vehicles,trips_bookings,telemetry_safety}.py` — Pydantic shapes; `GeoPoint` rejects out-of-range [lng,lat].
- `backend/init_db.py` — idempotent: create/collMod + ensure indexes. Rerun safe.
- `backend/database/seed/seed_dev.py` — flag-guarded (skips when users non-empty): Hebbal→Electronic City trip.
- `backend/app/api/v1/db_admin.py` — init/stats/schema endpoints, registered in `router.py`.
- `frontend/app/database/page.tsx + lib/db.ts + components/CollectionCard.tsx` — station-timeline "data map" UI with live counts + init button.

## 5. Integration
Zero changes to Module 1 files except ONE added line in `router.py`
(include db_admin). Modules 3/5/6 will write through these Pydantic docs +
validators; Modules 9/10 will query the 2dsphere indexes created today.

## 6. Run + test (all verified on this machine just now)
```powershell
cd backend
python -m pytest -q            # expect: 9 passed (2 health + 7 db-design)
python init_db.py              # expect: "created ×7, indexes ensured: 19"
python -m database.seed.seed_dev  # expect: "seeded: 1 driver + 1 vehicle + 1 trip"
uvicorn app.main:app --reload --port 8000
# GET /api/v1/db/stats → trips.count=1, geo_* present
```
Frontend: `http://localhost:3000/database` → 7 "stops", live counts, Initialise button.
Expected failure mode: backend down → page renders the Module 2 contract from FALLBACK (by design, not a bug).

## 7. Common errors
| Error | Fix |
|---|---|
| `ServerSelectionTimeout` | mongod not running → `net start MongoDB` or `docker compose up -d mongo` |
| `list[str] subscriptable` (3.8) | use `typing.List` (fixed in Module 1; same rule for all new files) |
| `pydantic v1 style validator` | this repo uses Pydantic v2 → `@field_validator`, `model_config` |
| coordinates swapped | ALWAYS [lng, lat]; GeoPoint raises otherwise — seed uses [77.59, 13.03] correctly |
| seed duplicates | seed_dev skips when users non-empty — wipe via mongosh to reseed |

## 8. Commit message
```
feat(db): seven collections, validators, 19 indexes, seed + explorer UI

- schemas + mongosh index script + backend index mirror (incl. 2dsphere ×5, TTL 30d)
- Pydantic docs, init_db.py, flag-guarded dev seed, /api/v1/db/* admin endpoints
- frontend /database data-map page with live stats; docs/module-02 written
- verified: pytest 9/9, live Mongo seeded 1 driver + 1 vehicle + 1 trip
```

## 9. SRS / report notes
- Draw ER: users 1—N vehicles 1—N trips 1—N {bookings, segments, locations, safety_alerts}.
- State why NoSQL: route LineString + variable match_explain fit documents; geo queries need 2dsphere; TTL gives free privacy compliance.
- Quote index table: 5 geo + 4 unique + TTL; matching-engine queries (Module 9) will cite `geo_trips_route`.
- Privacy line for viva: "locations TTL 30d + trip-scoped writes only — no background tracking."
