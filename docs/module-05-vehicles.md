# Module 5 — Vehicle management
**Status:** VERIFIED · `pytest` 16/16 (garage CRUD + plate/ownership/admin flow live) · no DB migration (Module 2 schema reused).

## 1. Concept / why
A trip is meaningless without a trusted car: seats offered can never exceed
the car's `seats_total`, and cost split (Module 12) needs `fuel_type` +
`mileage_kmpl`. Verification (`pending → verified|rejected`, admin-only)
keeps fake plates off the platform — your Safety-first principle in action.
Ownership (`owner_id` filter on EVERY query) stops drivers editing each
other's cars; soft delete preserves trip history (Modules 6+ reference
vehicles forever).

## 2. Prerequisites
- Modules 1–4 (driver role gate, session) · Mongo running
- Admin accounts are promoted directly in DB (Module 3 rule: no self-register)

## 3. DB changes + endpoints
No new collections. Endpoints: `POST /vehicles→201` · `GET /vehicles`
(`?include_inactive`) · `GET /vehicles/{id}` (+`trips_as_vehicle` count) ·
`PATCH /vehicles/{id}` · `DELETE /vehicles/{id}` (soft) ·
`GET /vehicles/admin/pending` + `POST /vehicles/admin/{id}/verify?decision=&note=`
(admin-only; Module 21 expands into console).

## 4. Code map
- `models/vehicle.py` — VehicleIn/Update/Out + `normalise_plate()`
  (`KA 05 mn 1234`→`KA05MN1234`, kills dup-by-spacing); seats 1–7, fuel enum,
  mileage 1–60, year bounds.
- `api/v1/vehicles.py` — owner-scoped CRUD; material edits reset verification
  to pending (is_active-only flip exempt); DuplicateKey→409; bad id→404.
- `router.py` — one added line. `tests/test_vehicles.py` — passenger 403,
  create+normalise, dup-plate 409, bad fuel/seats 422, ownership isolation,
  admin pending→verify, driver-admin 403, edit→pending reset, soft delete.
- Frontend: `lib/vehicles.ts` + `/garage` (driver-guarded): add/edit form,
  plate-first cards, pending/verified/rejected badges, deactivate.

## 5. Integration
Module 6 will offer only the driver's VERIFIED+active vehicles in the publish
form and copy `seats_total` as the seat cap. `/me` driver panel already links
readiness → garage (Module 4 text anticipates this).

## 6. Run + test (verified just now)
```powershell
cd backend
python -m pytest -q -p no:cacheprovider   # expect: 16 passed
# Manual: driver login → POST /vehicles {Maruti, Swift, KA05MN4321, 3, petrol}
# → 201 pending → admin verify → verified → PATCH color → pending again
```
Frontend: login as driver → `/garage` → add car → pending badge → edit →
deactivate (list empties; `?include_inactive` path covered by API test).

## 7. Common errors
| Error | Fix |
|---|---|
| 403 on POST /vehicles | need `driver` role (`/me` → Become a driver) |
| 409 plate exists | normalised match — check spacing/case variants |
| 422 fuel/seats | fuel ∈ petrol/diesel/cng/ev/hybrid; seats 1–7 |
| edit reset my verified car | by design — admin re-checks changed cars |
| car vanished after delete | soft delete — default list hides inactive |

## 8. Commit message
```
feat(vehicles): driver garage CRUD + plate rules + admin verification

- owner-scoped CRUD, normalised unique plates, edit-resets-verification rule
- admin pending/verify endpoints, soft delete, 16/16 tests green
- frontend /garage with badges, form, cards
```

## 9. SRS / report notes
- Verification state diagram: pending → verified | rejected →(edit)→ pending.
- Ownership matrix: driver × own cars (full) / others' cars (404) / admin
  (verify only, no edit) — quote in access-control section.
- Viva line: "seats_total excludes driver; trips cap seats_offered ≤ seats_total
  (enforced Module 6); mileage feeds Module 12 cost engine."
