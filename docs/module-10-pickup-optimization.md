# Module 10 — Minimum-detour pickup point optimisation
**Status:** VERIFIED · `pytest` 35/35 (7 pure optimiser units + live endpoint test, run twice) · `/search` cards now carry a pickup optimiser.

## 1. Concept / why
Module 9 says *whether* a trip is shareable; Module 10 answers *where exactly
to meet*. Both extremes are bad: door pickup costs the driver a deviation,
nearest-route-point may mean a long walk. We search the shared route segment
for the meeting point minimising

    cost = detour_km + walk_weight · walk_km        (walk_weight = 0.3)

The driver's extra distance for "leave route at C, collect at door P, rejoin
at B" is exactly the triangle expression **|C→P| + |P→B| − |C→B|** (0 when P
is on-segment) — straight-line legs, same documented estimate doctrine as
Module 9, and NO per-candidate OSRM calls, so ~50 candidates evaluate in
milliseconds. Three strategies: `walk` (driver detour 0), `door` (ranked by
deviation), `auto` (cheaper of the two per candidate). The candidate set is a
grid every 0.4 km **plus the passenger's exact projection foot** (otherwise
the grid never reports a 0 m walk), and candidates are clamped between the
projected join point (−15% slack) and the leave point — the optimiser can
never propose a pickup that makes the driver drive backwards.

## 2. Prerequisites
- Modules 7–9 (route geometry on trips, projection helpers) · Mongo + login
- Refactor included: shared geometry moved to `services/geo_math.py`
  (haversine, projection, cumulative lengths, `point_at_km`, `simplify`);
  `matching.py` and `trips.py` now import from it (one implementation,
  re-exported so Module 9 tests/callers are untouched).

## 3. DB changes + endpoints
No schema change (booking stores the choice in Module 11). New:
- `POST /trips/{id}/pickup-options` `{pickup_coordinates, dropoff_coordinates,
  mode=auto|walk|door, max_walk_km=1.5, step_km=0.4, walk_weight=0.3,
  label_places=true}` → `{chosen{strategy, coordinates, walk_km/min,
  detour_km/min, km_from_start, frac, label, why}, alternates[≤2],
  considered, route_km, baseline_detour_km, saved_detour_km, reason, trip{…}}`
- `GET /trips/{id}/route?max_points=200` → simplified LineString for map
  rendering (also reused by Module 17's live tracking view).
## 4. Code map
- `services/geo_math.py` � the single geometry toolkit (see section 2).
- `services/pickup.py` � `_minutes`, `_deviation_km` (triangle, clamped >= 0),
  `_candidates` (grid + projection foot + sub-metre dedupe),
  `optimise_pickup_point` (windowing, evaluate, rank, chosen/alternates,
  baseline and savings, the `why` sentence). Constants: WALK_SPEED 4.8 km/h,
  CITY_SPEED 25 km/h, REJOIN_AHEAD 0.5 km.
- `api/v1/pickup.py` � both endpoints; labels via Nominatim reverse (cached,
  best-effort); 422 bad coords; 404 unknown trip; 422 completed/cancelled.
- `tests/test_pickup.py` � pure: chosen+why exist, walk wins when door is
  1 km off-route, door wins when nearly on-route, forced modes respected,
  candidate never past dropoff, no-geometry/wrong-direction reasons, savings
  >= 0; live: endpoint on a seeded routed trip, route simplification bounds,
  422/404 paths.
- Frontend: `lib/pickup.ts`; `components/PickupChooser.tsx` (Optimise /
  Force walk / Force door, chosen card with walk/detour/board metrics,
  "saves X km vs your exact door", alternates switcher, map with route +
  your-location pin + meeting-point pin + colour-coded connector);
  `RouteMap` extended with `pins`/`dashes` (stringified deps to avoid redraw
  loops); `RideCard` drawer embeds the chooser with the searched From/To.

## 5. Integration
Consumes Module 7 geometry + Module 9 projection; the passenger-selected
point flows into Module 11 booking (`pickup.point`, `pickup_distance_m`,
`detour_km`); Module 13 prices per-segment cost from the same board/alight
positions; Module 17 reuses `GET /trips/{id}/route` for the tracking map.

## 6. Run + test (verified just now)
```powershell
cd backend
python -m pytest -q -p no:cacheprovider   # expect: 35 passed (twice for stability)
```
Offline demo (no server needed) - expect:
`Walk 97 m (~1 min) to a point already on the route - driver detour 0 km` + saved 0.107:
```powershell
python -c "from app.services.pickup import optimise_pickup_point; r=optimise_pickup_point([[77.5946,13.0358],[77.60,13.03],[77.61,13.02],[77.62,13.0],[77.63,12.98],[77.65,12.92],[77.66,12.88],[77.67,12.8452]],[77.615,13.012],[77.665,12.875]); print(r['chosen']['why'], r['saved_detour_km'])"
```
Frontend: `/search` -> pick From/To -> Search -> card -> View ->
"Optimise point" -> chosen strategy card + alternates + map (red pin = you,
lime pin = meeting point, dashed connector = walk or detour leg).

## 7. Common errors
| Error | Fix |
|---|---|
| `chosen: null` + drop-off not downstream | passenger dropoff projects before pickup on THIS route - wrong direction; matching should have excluded it |
| `chosen: null` + no route geometry | trip saved while OSRM was down -> `POST /trips/{id}/route/refresh` first |
| labels missing | `label_places:false` sent or Nominatim unreachable - coordinates still returned |
| walk 97 m not 0 m | projection foot snapped to polyline; sub-metre dedupe keeps it honest |
| detour_min looks tiny | city-speed 25 km/h is display-only; ranking uses km |

## 8. Commit message
```
feat(pickup): minimum-detour meeting-point optimiser + chooser UI

- geo_math extraction (shared haversine/projection/polyline tools)
- triangle-deviation candidates along shared segment, walk/door/auto strategies
- /trips/{id}/pickup-options + /route (simplified) endpoints, 35/35 tests
- PickupChooser card with alternates, savings claim, pins + connector map
```

## 9. SRS / report notes
- Algorithm figure: route polyline, projection foot C, candidate grid,
  deviation triangle |C-P|+|P-B|-|C-B|, cost = walk_weight*walk + detour.
- Honest limitations: straight-line legs (no per-candidate OSRM), fixed
  walk_weight 0.3 (learnable in Module 16), single-passenger optimisation
  (multi-stop sequencing is future work - Module 13 handles cost, not order).
- Viva line: "we optimise the MEETING POINT, not the route: feasibility gates
  from Module 9 are hard constraints; the optimiser only chooses where in the
  already-feasible window to meet."
