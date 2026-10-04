# Module 9 — Route-aware matching engine
**Status:** VERIFIED · `pytest` 27/27 (5 pure-geometry units + ranked-search live flow) · run twice back-to-back for stability.

## 1. Concept / why
Retrieval (Module 8) answers "which trips are *near* my day/places". Matching
answers the harder question: *does this trip actually run along MY journey?*
Two people 300 m apart on opposite sides of a highway are "near" by radius
but not shareable. So we PROJECT the passenger's pickup/dropoff onto the
driver's OSRM polyline and measure:
- **pickup_km / dropoff_km** — how far the passenger must walk to the route,
- **src_frac / dst_frac** — where they join/leave as trip progress (0→1),
- **forward** — dst_frac > src_frac (no driving backwards for them),
- **overlap_pct** — (dst_frac − src_frac)·100 = share of the driver's route
  the passenger actually rides.

Hard gates (safety-first ordering): pickup ≤ max → forward direction →
overlap ≥ min. Survivors get a transparent score
**45% overlap + 25% pickup + 15% dropoff + 15% time**. Weights are constants
(`WEIGHTS` in code) so Module 16 can LEARN them instead of guessing.

## 2. Prerequisites
- Modules 1–8 · no new packages (pure Python math: equirectangular projection
  + point-to-segment projection). Trips should have `route_geometry`
  (Module 7); unrouted trips fall back honestly.

## 3. DB changes + endpoints
No schema change (read-only over `trips.route_geometry`). `POST /search/rides`
+ `GET /search/rides` now accept four new optional knobs — `max_pickup_km`
(3), `max_detour_km` (5), `min_overlap_pct` (20), `include_excluded` (false)
— and return `results[]` (feasible, score-sorted) with a `match` block per
trip, plus optional `excluded[]` (`{id, source_name, destination_name,
reason}`) and `weights`.

## 4. Code map
- `services/matching.py` — `_xy()` (equirectangular km), `_seg_proj()`
  (point→segment distance + t), `project_onto_route()` (nearest segment →
  dist_km + frac), `match_trip()` (3 gates → weighted score → explain dict),
  `match_fallback()` (straight source→dest estimate for `route_geometry=None`,
  flags `routed=False`), `_pickup_score`/`_dropoff_score`/`_time_score`
  (linear decay; no time preference = neutral 0.6, NOT perfect).
- `api/v1/search.py` — 8 retrieval filters unchanged → matcher per survivor →
  split into `results` / `excluded` → sort by score desc → cap `limit`.
- `models/search.py` — the four knobs as validated fields (ranges: pickup
  0.5–20 km, detour 0.5–30, overlap 0–90%).
- `tests/test_matching.py` — pure: midpoint projection (frac≈0.5), full ride
  > 85, short hop < full, wrong direction rejected, far pickup rejected,
  fallback flags `routed=False`; live: ranked search returns 1 feasible
  (overlap > 80%) + 1 excluded for "direction" with a widened radius.
- Frontend: `lib/search.ts` (`MatchInfo`, `RideHit.match`, `Excluded`) ·
  `components/MatchCard.tsx` (score ring + 3 bars) ·
  `components/RideCard.tsx` (renders MatchCard; drawer map ready for M10) ·
  `/search` (tuning details panel: max pickup, min overlap; "N rides skipped
  — why?" transparency list).

## 5. Integration
Consumes Module 7 geometry; drives Module 10 (pickup-point optimisation on
the same projection), Module 11 (booking uses `match` for the accepted
snapshot), Module 12 (cost uses overlap/route share), Module 16 (learns
`WEIGHTS`), and the report's "explainable recommendation" figure.

## 6. Run + test (verified just now)
```powershell
cd backend
python -m pytest tests/test_matching.py -q -p no:cacheprovider  # 7 passed
python -m pytest -q -p no:cacheprovider                         # 27 passed
```
Frontend: publish a Hebbal→E-City trip, then `/search` the same route →
card shows a green score ring (≈99) with overlap 100% · pickup 0 km · drop
0 km; search a reverse route → trip appears under "1 ride skipped — why?
— wrong direction along route".

## 7. Common errors
| Error | Fix |
|---|---|
| `match` missing on a hit | only `/search/rides` attaches it; `/trips/*` doesn't |
| overlap much lower than expected | route wiggle: % is route-share, not crow-flies share |
| pair looks shareable but score 0 | check `excluded` reasons — pickup > max, wrong direction, or overlap < min |
| `routed: false` in card | that trip was saved while OSRM was down; call `POST /trips/{id}/route/refresh` to upgrade |
| tests interfere with each other | each live test uses its own day (+2/+3) and regex cleanup of its seeded trips (fixed this module) |

## 8. Commit message
```
feat(matching): route-overlap projection + explainable match scoring

- matching service: projection, 3 hard gates, weighted 0-100 score, explain dict
- search API: 4 knobs + results/excluded split with reasons; UI match card
- tests: 5 pure geometry + live ranked flow; 27/27 green (isolated per-test data)
```

## 9. SRS / report notes
- Algorithm box for the report: equirectangular projection (why: km-accurate
  at city scale, no proj4 dependency), point→segment projection, frac/overlap
  definitions, gate order, weight table with the justification "guessed
  baseline; learned in Module 16".
- State the honest limitation: overlap is route-share (a 100% overlap on a
  short route ≠ long ride) — Module 12 prices the actual distance.
- Include the excluded-reasons screenshot: explainability includes REJECTION,
  not just recommendation.
