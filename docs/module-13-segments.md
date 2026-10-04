# Module 13 — Dynamic segment-based cost sharing + recalculation
**Status:** VERIFIED · `pytest` 50/50 (5 pure leg-splitting units + live join/leave recalculation flow) · driver "Per-leg split" strip + passenger "why?" breakdown live.

## 1. Concept / why
Module 12 split the WHOLE trip cost — unfair when someone rides 4 km of a
30 km route. Module 13 cuts the route at every board/alight point, prices each
**leg** by its own distance, and splits each leg only among the people actually
aboard it. A short-hop rider pays for their legs (cheap); a full-ride rider
pays for all of theirs. **Recalculation**: whenever a rider joins or leaves
(accept/confirm/reject/cancel), segments are rebuilt and every confirmed
booking's `cost_share` is rewritten in one place — so the first rider's share
*genuinely drops* when a second rider joins, and returns to its solo value if
that rider leaves (both asserted in tests).

## 2. Prerequisites
- Modules 9/10 projections (board/alight as route fractions), Module 12
  policies + fuel math, Module 11 confirmed bookings
- No migration and no new dependency: the `segments` collection + unique
  `(trip_id, seq)` index already exist from Module 2 — this module finally
  writes them.

## 3. DB changes + endpoints
Writes `segments` (`trip_id, seq, from/to label+point, from_frac/to_frac,
distance_km, leg_cost, occupant_booking_ids, shares, cost_per_occupant`) and
`bookings.cost_share`. Rebuild = `delete_many(trip)` + `insert_many` →
idempotent, safe against the unique index.
Endpoints: `GET /trips/{id}/segments` (422 when the trip has no geometry) ·
`GET /trips/{id}/segments/summary` (legs + totals + fuel/policy context) ·
`POST /trips/{id}/segments/rebuild` (owner-only, 403 for others, frozen after
completion).
## 4. Code map - how the pieces connect
- `services/segments.py` (pure): `build_segments(route_coords, source_label,
  dest_label, riders, seats_offered, mode, price_per_km)`.
  1. validate riders (backwards riders skipped, never crash);
  2. collect stop fracs {0, boards, alights, 1};
  3. legs = consecutive fracs, `leg_km = (hi-lo) x route_km` (same ruler as
     Modules 9/10), `leg_cost = leg_km x price_per_km`;
  4. occupancy: rider occupies a leg iff board <= seg_start and
     alight >= seg_end;
  5. per-leg split under the trip Module 12 mode (split_equal divides by
     occupants+driver, per_seat by seats_offered, split_riders by seats
     aboard); totals = sum of legs, capped at trip cost, residue on the last.
- `services/stops.py`: `stops_from_bookings()` turns confirmed bookings into
  riders using the STORED booking pickup/dropoff (the Module 10 snapshot -
  what was agreed is what is priced). Trips without geometry return board 0 /
  alight 1 (full ride), which the caller detects and routes to Module 12.
- `api/v1/segments.py`: `_split_view()` is the single read computation;
  `persist_segments(db, trip)` is the single writer used by the rebuild
  endpoint AND the bookings join/leave hook. Safety net: any confirmed rider
  the leg-builder could not place (drop-off projects upstream) is priced by
  Module 12 whole-trip distribute, so no cost_share goes stale; geometry-less
  trips fall through to `recalculate_trip_shares()` - zero regression.
- `api/v1/bookings.py`: `_recalculate(db, trip_id)` now calls the Module 13
  writer (lazy import, no router cycle) after accept/reject/confirm/cancel.
- `models/segment.py`: `SegmentOut` for the OpenAPI shape.
- Frontend: `lib/segments.ts` + `components/SegmentView.tsx` (numbered legs,
  km, leg cost, occupancy chips, cost per occupant, per-rider totals,
  collected-vs-trip-cost footer, `Recalculate` for owners) wired into
  `TripCostCard` (driver) and `CostStrip` new "why?" toggle (passenger sees
  exactly which legs they are paying for).

## 5. Integration
Consumes M9/M10 fracs + M11 confirmed bookings + M12 policies; writes
`segments` (M2 schema) and `bookings.cost_share` (read by /requests, the
booking panel, and future payment/notification modules). Tracking (M17) will
reuse `to_frac` positions to mark live progress against the same legs.

## 6. Run + test (verified just now)
```powershell
cd backend
python -m pytest tests/test_segments.py -v -p no:cacheprovider  # 6 passed
python -m pytest -q -p no:cacheprovider                          # 50 passed
```
Pure expectations that encode the fairness argument: short-hop total is less
than full-ride total; a straddler splits only the middle leg; a 2-seat rider
pays exactly double; a backwards rider yields no entry instead of an
exception. Live: pax1 solo full ride gives 1 leg and share = total/2; pax2
short hop joins, legs become >= 3 and pax1 stored share FALLS; rebuild twice
keeps the same leg count (unique index safe); passenger rebuild gives 403;
pax2 cancels and pax1 share returns to the solo value.

## 7. Common errors
| Error | Fix |
|---|---|
| legs missing | trip has no geometry, so run `POST /trips/{id}/route/refresh` then rebuild |
| share unchanged after a join | only committed riders (accepted/confirmed) move money - check the booking status |
| 422 on `/segments` | expected for geometry-less trips; read `/cost` for the whole-trip number |
| duplicate key on `uq_segments_trip_seq` | only if something inserts without the delete-first rebuild - always use `/segments/rebuild` |
| `fallback_riders` reported | that rider drop-off projects upstream of pickup, so they keep a Module 12 share instead of a broken leg |

## 8. Commit message
```
feat(segments): per-leg dynamic cost sharing + recalculation on join/leave

- services/segments (pure leg builder) + services/stops (frac extraction)
- segments GET/summary/rebuild endpoints; bookings hook rewires cost_share
- geometry-less trips fall back to M12; unplaceable riders never go stale
- 6 new tests (pure fairness + live recalc), 50/50 green
- UI: SegmentView strip in driver cost card and passenger why? toggle
```

## 9. SRS / report notes
- Diagram for the report: route line with stops S1..S4, occupancy bars per
  leg, and a table of leg cost, occupants and share, showing the short-hop
  rider paying only their own legs.
- Fairness proof for the viva: sum of shares per leg is at most leg_cost under
  every policy (split_equal divides by occupants+1; per_seat sums to leg_cost
  only when the car is full; split_riders sums to exactly leg_cost), and the
  overall cap sum <= trip_total is asserted in tests.
- State the simplification honestly: boarding ORDER is not optimised (Module
  10 optimises where to meet, not the sequence of pickups) and leg lengths use
  the same straight-line estimator as Modules 9/10.
