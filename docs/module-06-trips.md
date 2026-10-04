# Module 6 — Trip creation
**Status:** VERIFIED · `pytest` 17/17 · driver console live at `/trips`.

## 1. Concept / why
A trip is a driver's OFFER: source→dest Points, UTC `depart_at`, seats from a
VERIFIED car. Draft→publish split lets drivers stage without going visible;
`publish` re-checks every gate (phone/vehicle may have changed since staging).
`seats_booked` (written by Module 11) can never exceed `seats_offered`, and
`seats_offered` can never exceed the car's `seats_total` — capacity flows
car → trip → booking, never the reverse.

## 2. Prerequisites
- Modules 3–5 (driver role, verified phone, verified vehicle) · Mongo running
- No new deps; haversine in stdlib (crow-flies estimate until Module 7 routes)

## 3. DB changes + endpoints
No new collections. Endpoints: `POST /trips→201 draft` ·
`GET /trips/mine?status=` · `GET /trips/{id}` (any login — passengers need it
for Module 8) · `PATCH /trips/{id}` (draft/published; seat-floor =
seats_booked; endpoint move clears route_geometry for Module 7 re-route) ·
`POST /trips/{id}/publish` · `POST /trips/{id}/cancel` · `DELETE /trips/{id}`
(draft/cancelled only).

## 4. Code map
- `models/trip.py` — PlaceIn ([lng,lat] checked), TripIn (future-only
  depart_at), TripUpdateIn, TripOut (+seats_left).
- `api/v1/trips.py` — 7 ordered gates (role→phone→owned→active→verified→
  capacity→500m separation); haversine distance stored as estimate;
  lifecycle transitions guarded; publish re-validates vehicle.
- `tests/test_trips.py` — unverified-403, past/close/over-cap 422s,
  draft shape + distance>20km, passenger 403-create/200-view, publish×2,
  seat-floor, cancel→edit-422→delete.
- Frontend: `lib/trips.ts` + `lib/places.ts` (Karnataka place catalogue) +
  `/trips` console: verified-only car picker, fuzzy/map From/To, date/time,
  seat stepper capped by car, draft→publish cards with occupancy bars.

## 5. Integration
Reads garage (verified cars) + profile (phone_verified); writes trips the
Module 8 search will query via `geo_trips_source/dest` + status/depart
indexes. Module 7 fills `route_geometry/duration_min` on publish/edit.

## 6. Run + test (verified just now)
```powershell
cd backend
python -m pytest -q -p no:cacheprovider   # expect: 17 passed
# Manual: driver+verified phone+verified car → POST /trips {Hebbal→E-City, future, 2}
# → 201 draft, distance_km≈27 → POST /{id}/publish → published
```
Frontend: `/trips` → pick car → Hebbal→E-City → date/time → seats → Stage →
Publish; cards show occupancy + lifecycle buttons.

## 7. Common errors
| Error | Fix |
|---|---|
| 403 verify phone / vehicle not verified | `/verify` first; garage → admin verify |
| 422 seats exceed capacity | seats_offered ≤ car's seats_total |
| 422 too close | presets ≥500m apart; same preset twice rejected |
| 422 past depart | datetime-local must be future; server compares in UTC |
| 422 only drafts publish | already published/cancelled — check status filter |

## 8. Commit message
```
feat(trips): driver publish flow with gates + lifecycle + console

- 7 ordered gates, draft→publish→cancel lifecycle, seat-floor protection
- crow-flies distance estimate (Module 7 upgrades to routed)
- tests 17/17 green; /trips console with verified-car picker + cards
```

## 9. SRS / report notes
- Gate-order table (§4) + lifecycle diagram draft→published→{ongoing,
  completed, cancelled}; delete only draft/cancelled (history preserved).
- State the estimate honestly: "Module 6 stores haversine distance;
  Module 7 replaces with OSRM routed distance + geometry."
- Capacity chain for viva: vehicle.seats_total ≥ trip.seats_offered ≥
  Σ booking.seats (floor enforced against seats_booked).
