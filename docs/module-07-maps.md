# Module 7 — Map integration + routing service
**Status:** VERIFIED · `pytest` 19/19 (incl. live OSRM/Nominatim shape checks) · `/trips` is now map-centric.

## 1. Concept / why
Crow-flies distance lies in cities (a 27 km straight line can be 40 km by
road). OSRM gives the TRUE driving route: full LineString geometry (stored on
trips → Module 9 matches against the road, not the beeline), real distance +
ETA. Nominatim turns typed names into coordinates (forward) and map clicks
into names (reverse). The map is the product: drivers SEE the route before
publishing; passengers will SEE detour in Module 10.

## 2. Prerequisites
- Modules 1–6 · internet (OSRM demo + Nominatim are free, no keys) · login
- Provider decision (locked): **OSRM public demo + Nominatim**. Rejected:
  Google/Mapbox (billing), Valhalla/GraphHopper self-host (ops burden).
  Self-host later = change `OSRM_URL` only. Leaflet via CDN (no npm weight).

## 3. DB changes + endpoints
No new collections. Trips now save `route_geometry` (LineString) +
routed `distance_km`/`duration_min` at create; endpoint edits clear geometry
(Module 6 code) for re-route. New: `GET /geo/search?q=` · `GET
/geo/reverse?lat=&lng=` · `POST /geo/route {src,dst}` (preview, no save) ·
`POST /trips/{id}/route/refresh` (owner, draft/published only).

## 4. Code map
- `services/routing.py` — `osrm_route()` (geometry+km+min, 1h cache, None on
  failure), `nominatim_search()` (BLR-biased viewbox, 450ms-debounced
  client-side), `nominatim_reverse()`. Real User-Agent header (Nominatim
  policy). **Fallback doctrine:** routing enriches, never blocks — offline
  saves keep crow-flies + None geometry; previews draw straight lines.
- `api/v1/geo.py` — 4 endpoints; reverse/route return offline-safe shapes.
- `api/v1/trips.py` — create now best-effort routes (verified live: Hebbal→
  E-City test asserts distance>20km whether routed or fallback).
- `tests/test_geo.py` — validation 422, search list-shape, reverse echo,
  route LineString + distance, auth gate.
- Frontend: `lib/geo.ts` · `components/RouteMap.tsx` (Leaflet CDN, night
  CSS filter, indigo route + lime dashes, glow markers) ·
  `components/PlacePicker.tsx` + `components/PickerMap.tsx` (fuzzy catalogue
  dropdown + click-to-pin map, both sharing the RouteMap loader) ·
  `lib/fuzzy.ts` + `lib/places.ts` (Karnataka catalogue, typo-tolerant
  scoring) · `/trips` rebuilt: search From/To → auto route preview on map →
  stage → publish.

> **Fix note.** The geocoder used to be unusable: `bounded=1` on a
> Bengaluru-sized viewbox hard-excluded the rest of Karnataka (so "Mandya"
> returned nothing), and the User-Agent carried an `example.com` placeholder
> that Nominatim 403s. The viewbox is now a ranking bias only, and
> `NOMINATIM_USER_AGENT` is overridable per deployment.

## 5. Integration
Trip create auto-routes; stale trips refresh via new endpoint; Module 8
search form reuses PlacePicker + RouteMap; Module 9 matching reads stored
LineStrings via `geo_trips_route`; Modules 18–19 compare live GPS to geometry.

## 6. Run + test (verified just now)
```powershell
cd backend
python -m pytest -q -p no:cacheprovider   # expect: 19 passed (~8s, live HTTP)
# Manual: POST /geo/route {Hebbal, E-City} → routed:true, ~30km, LineString 100s of points
```
Frontend: login → `/trips` → type Hebbal → pick → type Electronic City →
route draws + "🛣 Routed · 30.2 km · ~48 min" → Stage → Publish.

## 7. Common errors
| Error | Fix |
|---|---|
| `routed:false` preview | OSRM demo down/rate-limited — straight-line fallback draws; save still works, refresh later |
| Nominatim empty results | <3 chars ignored; viewbox biases BLR — clear it for other cities (code comment) |
| Leaflet blank div | CDN blocked — check network; component fails silent (form still submits) |
| `from typing Dict` SyntaxError | Py3.8 needs `import` (fixed in routing.py — same lesson as Modules 1/3) |
| 502 on refresh | routing unreachable — retry; trip keeps old geometry |

## 8. Commit message
```
feat(maps): OSRM+Nominatim routing service, geo API, map-centric publish

- best-effort auto-route on trip create, refresh endpoint, 1h caches
- Leaflet night map + search boxes + live preview; tests 19/19 green
```

## 9. SRS / report notes
- Provider comparison table (OSRM vs Google/Mapbox vs Valhalla) + why free
  OSM stack fits a college project; courtesy limits (≤1 req/s, caching,
  debouncing) as responsible-API-use evidence.
- Fallback doctrine diagram: online → routed geometry; offline → crow-flies +
  None → refresh later. Quote: "routing is enrichment, not a gate."
- Screenshot flow for report: search → preview with km/min → published trip.
