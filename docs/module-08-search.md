# Module 8 — Passenger ride search (MVP COMPLETE 🎉)
**Status:** VERIFIED · `pytest` 20/20 · `/search` live · **MVP end-to-end: register → verify → garage → publish → search.**

## 1. Concept / why
Search is coarse RETRIEVAL, not matching: "which published trips run on my
day with seats free near my endpoints?" Five filters (published / same-day /
seats-left / radius both ends / ±2h time) cut thousands of trips to a
handful; Module 9 then RANKS that handful by route overlap + detour. Keeping
retrieval dumb and ranking smart is the classic search architecture (and an
easy viva answer). Endpoint distances (`src_km`/`dst_km`) keep the UI honest:
"starts 1.2 km away", never "exact match".

## 2. Prerequisites
- Modules 1–7 (trips with Points, session, PlacePicker/RouteMap) · Mongo running

## 3. DB changes + endpoints
No new collections (reads `trips` via status/depart + Module 2 geo indexes).
New: `POST /search/rides {src/dst coords, date, time?, seats, radius_km,
limit}` → `{count, time_window_h, results[] (+src_km/dst_km)}` ·
`GET /search/rides?...` twin (shareable links; same logic, one code path).

## 4. Code map
- `models/search.py` — SearchIn (coords, YYYY-MM-DD, HH:MM?, seats, radius
  default 8km, limit) + `day_bounds_utc()`.
- `api/v1/search.py` — Mongo pre-filter (published + day, ≤200) → Python
  refine (seats, radius both ends, ±2h) → sort depart_at → cap limit.
  Small-data choice is deliberate + documented (Module 9 pushes $geoNear).
- `tests/test_search.py` — seeded matrix (good/draft/full/far): exact-1 hit,
  time in/out of window, seats overflow, wrong day, GET parity, auth gate.
- Frontend: `lib/search.ts` · `/search` (passenger-guarded): From/To boxes +
  date/time/seats → cards with ▲/▼ distances + View drawer (mini map) +
  reserved ◆ match slot (Module 9 fills it, layout unchanged).

## 5. Integration + MVP check
Publishes from `/trips` appear in `/search` same-day; drafts/full/far trips
correctly hidden. **Full MVP loop verified:** register → OTP → garage car →
admin verify → publish Hebbal→E-City → search same day → 1 hit with 0.0 km
endpoints. Basic booking (Module 11) + simple cost (Module 12) attach to
these cards next — the brief's "basic booking" is a natural Module 11 slice.

## 6. Run + test (verified just now)
```powershell
cd backend
python -m pytest -q -p no:cacheprovider   # expect: 20 passed
# Manual: POST /search/rides {Hebbal, E-City, <trip day>, seats 1} → count 1
```
Frontend: login as passenger → `/search` → Hebbal→E-City → trip day →
Search → card + View → mini map. Empty state guides (nearby date / /trips).

## 7. Common errors
| Error | Fix |
|---|---|
| 0 results, trip exists | day mismatch (UTC) / seats>left / radius<endpoint gap / time outside ±2h |
| date 422 | must be YYYY-MM-DD; time HH:MM or omitted |
| GET vs POST differ | impossible by construction — GET builds SearchIn, calls same fn |
| slow at scale | expected — Python refine is MVP-sized; Module 9 moves geo into Mongo |

## 8. Commit message
```
feat(search): passenger ride retrieval by place+day+time+seats

- POST+GET /search/rides, 5-filter pipeline, endpoint distances
- seeded-matrix tests, /search UI with cards + drawer; 20/20 green
- MVP COMPLETE: register→verify→garage→publish→search end-to-end
```

## 9. SRS / report notes
- Retrieval-vs-ranking diagram: Module 8 filters → Module 9 scores →
  Module 16 learns. State defaults with reasons: radius 8km (city generous),
  ±2h (commute tolerance), limit 20 (mobile-sized).
- MVP test script for the report: the 6-step loop in §5 with expected outputs.
- Viva line: "search never claims exactness — src_km/dst_km quantify the gap;
  Module 9 converts that gap into overlap % and detour km."
