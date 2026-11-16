# Module 10 — Minimum-detour pickup point optimisation
**Status:** VERIFIED · pytest backend/tests (146 passed in 15.28s) · Minimum-detour pickup optimization with passenger-segment pricing verified end-to-end.

## 1. Concept / why
Module 9 establishes whether a trip is shareable along a corridor; Module 10 answers where exactly to meet while minimising driver detour and passenger walking distance.
Both extremes are suboptimal: door-to-door pickup costs the driver unnecessary detour and delay, whereas forcing a passenger to the nearest straight-line route point can result in an unreasonable walk.

We evaluate candidates along the driver route polyline:
1. **Densification**: The driver route is densified to <= 100 m between vertices, precomputing cumulative distances using haversine.
2. **Pickup projection & candidates**: Passenger source S is projected onto segments using equirectangular projection with cos(lat) scaling. If offset <= PICKUP_SNAP_KM (default 0.5 km), the pickup snaps to the route point with detour_km = 0 (passenger walks the short gap). If off-route within MAX_PICKUP_KM, the driver detours to S with detour distance computed via routing/haversine.
3. **Destination tolerance**: Dropoff T is accepted if it lies on the route corridor (offset <= MAX_DROP_KM) OR within DEST_TOLERANCE_KM (default 2.0 km) of the driver destination.
4. **Direction rule**: Drop progress along route must be greater than pickup progress (drop.along_km > pickup.along_km + MIN_SHARED_KM).
5. **Passenger-Segment pricing**: Distance charged is passenger_distance_km = drop.along_km - pickup.along_km (the shared corridor segment), NOT the driver full trip distance.

## 2. Prerequisites
- Modules 7–9 (OSRM routing geometry on trips, projection helpers) · MongoDB + FastAPI auth
- Settings in backend/app/core/config.py:
  - PICKUP_SNAP_KM=0.5
  - MAX_PICKUP_KM=3.0
  - MAX_DROP_KM=2.0
  - DEST_TOLERANCE_KM=2.0
  - MIN_SHARED_KM=0.5
  - MAX_DETOUR_KM=3.0
  - MAX_EXTRA_MIN=10.0
  - FUEL_PRICE_PER_LITRE=100.0
  - COST_SPLIT_POLICY=EQUAL_SPLIT
  - INCLUDE_DETOUR_COST=false

## 3. DB changes + endpoints
- POST /api/v1/search/rides & GET /api/v1/search/rides:
  Candidate retrieval pre-filters trips using the route polyline bounding box (+ margin), allowing passengers boarding mid-route (e.g. Yelahanka on a Devanahalli -> Hebbal trip) to match.
  Hits include: pickup, drop, passenger_distance_km, detour_km, extra_time_min, route_quality, estimated, estimated_contribution.
- POST /api/v1/trips/{id}/pickup-options:
  Detailed alternative meeting points for the interactive PickupChooser widget.
- POST /api/v1/bookings:
  Snapshots pickup, dropoff, passenger_distance_km, detour_km, estimated_contribution.

## 4. Code map
- backend/app/services/pickup.py:
  - densify_route(coords, max_step_km=0.1): densifies polylines to <= 100 m.
  - project_point(route, point, cum_kms): segment projection with t in [0, 1] and cos(lat) local scaling.
  - evaluate_pickup_detour(...): evaluates candidate pickup and drop points, enforces gates, calculates detour, extra time, and passenger distance.
  - optimise_pickup_point(...): backward-compatible evaluator for /trips/{id}/pickup-options.
- backend/app/services/matching.py:
  - Calls evaluate_pickup_detour. Returns passenger_distance_km, detour_km, extra_time_min, pickup, drop, route_quality.
  - Overlap gate evaluates passenger journey coverage passenger_overlap_pct >= min_overlap_pct while preserving overlap_pct driver route share.
- backend/app/api/v1/search.py:
  - Fixes retrieval pre-filter by verifying route bounding box with margin.
  - Enriches results with estimated_contribution based on passenger_distance_km.
- frontend/components/MatchCard.tsx:
  - Displays 'On route · 0 km detour' or 'Detour +X km', pickup and drop labels, passenger distance, walk distance, estimated contribution, and straight-line fallback warning.
- frontend/lib/places.ts:
  - Includes Devanahalli [77.7120, 13.2437] alongside Hebbal and Yelahanka.

## 5. Integration
- Driver trip created with real OSRM polyline (e.g. Devanahalli -> Hebbal, 28.19 km).
- Passenger searches midway (e.g. Yelahanka -> Hebbal).
- Matcher projects Yelahanka onto the route (along_km ~ 20.9 km, offset 0.35 km <= 0.5 km snap radius).
- Results returned with:
  - detour_km: 0.0 km ('On route · 0 km detour')
  - passenger_distance_km: 7.29 km (shared corridor segment)
  - estimated_contribution: Rs 19.24 (based on 7.29 km shared segment, not 28.19 km full driver route)
  - pickup: [77.5995, 13.0999] (Meeting point on route)
  - drop: [77.5918, 13.0382] (Driver destination)

## 6. Run + test (verified)
`powershell
# Run backend tests
cd backend
python -m pytest -q
# Expect: 146 passed

# Verify detour example diagnostic script
python backend/scripts/debug_detour_example.py

# Check frontend typecheck
cd ../frontend
npm run typecheck
`

## 7. Common errors
| Error | Fix |
|---|---|
| Trip not found in search results | Check if origin is far from driver start: ensure candidate bounding box pre-filter is enabled in search.py |
| detour_km > 0 when passenger is near route | Ensure snap_distance_km <= PICKUP_SNAP_KM (default 0.5 km) snaps pickup to route with 0 detour |
| Short passenger leg excluded by overlap gate | Gate now checks passenger_overlap_pct = shared_km / passenger_journey_km * 100 >= MIN_OVERLAP_PCT |
| Fare labelled as taxi fare | Compliance: always labeled 'Estimated Travel Contribution', computed strictly from fuel costs |

## 8. Commit message
`
feat(pickup): minimum-detour pickup optimization with passenger-segment pricing

- Densify route polylines to <= 100m and project points with segment clamping and cos(lat) equirectangular scaling
- Snapped on-route pickup with detour_km = 0, off-route detour evaluation with fallback estimation
- Destination tolerance gate for passenger destinations near driver destination
- Passenger-segment fuel contribution pricing based on passenger_distance_km
- Bounding-box spatial pre-filter in search retrieval to include mid-route pickups
- MatchCard frontend updates with detour badges, meeting points, and travel contribution
`

## 9. SRS / report notes
- Algorithm: Densified polyline interpolation, segment orthogonal projection with parameter t in [0, 1], candidate multi-criteria ranking (detour -> walk -> shared length).
- Pricing compliance: Travel contributions adhere to non-commercial ride-sharing guidelines; fuel cost is divided equally across occupants for the shared passenger segment only.
