# Module 17 — Live trip tracking (driver pings, passenger live view)

**Status:** VERIFIED · `pytest tests/test_tracking.py` 3/3 (2 pure progress/speed units + live ping/live/trail flow) · ShareLocation + LiveTrack (10s poll) live in driver cards + passenger booking panel.

> **Module 20 supersedes the transport here:** `LiveTrack` is now socket-first
> (push + 30 s poll net, push/polling badge, alert chip, driver ping over the
> socket with HTTP fallback) and `ShareLocation.tsx` was deleted — `LiveTrack`
> takes `canPing/pingAt`. The REST ping/live/trail contract underneath is
> unchanged, so everything below still holds.

## 1. Concept / why
Passengers waiting at a pickup point ask one question: *where is my driver?*
Module 17 answers it with the cheapest reliable primitive — a driver heartbeat
(`POST /tracking/ping`) projected onto the trip route as a progress fraction,
readable by the trip audience as a live view + trail polyline. No WebSockets
yet (that is Module 20's upgrade): 10-second polling carries the MVP, and the
same `locations` collection feeds Module 18 safety (speed/deviation alerts)
without new storage.

## 2. Prerequisites
- `locations` collection + TTL-30d + 2dsphere index from Module 2 (privacy by
  expiry — raw GPS never accumulates)
- Trip lifecycle from Module 6 (published → ongoing is the tracking transition)
- Route geometry from Module 7 (progress needs a polyline; geometry-less trips
  return `frac: null` instead of failing)

## 3. Privacy + audience contract
- WRITE: the trip's driver only (403 otherwise), only while the trip is
  published/ongoing (422 when draft/completed/cancelled).
- READ: the driver + passengers holding an ACTIVE booking
  (requested/accepted/confirmed) on that trip — outsiders get 403 even with a
  valid login. Cancelled/rejected riders lose the live view with their status.
- RETENTION: 30-day TTL on `recorded_at`; trail capped at 100 fixes (200 max).

## 4. Code map - how the pieces connect
- `services/tracking.py` (pure): `progress_frac()` (project → frac/dist_along/
  remaining/off_route on the M9/M10/M13 ruler), `speed_kmph()` (consecutive-fix
  estimate, None when unknowable), `is_stale()` (>300s = stale).
  `OFF_ROUTE_M = 500`, `STALE_S = 300` live here for M18 to reuse.
- `api/v1/tracking.py`: `POST /ping` (validate → project → insert → auto-flip
  published→ongoing on first ping, `started` flag tells the UI),
  `GET /live/{trip}` (latest fix + progress + stale), `GET /trail/{trip}`
  (newest-first fixes for the map). `_assert_audience()` is the single gate.
- Frontend: `lib/tracking.ts` (ping/live/trail), `LiveTrack.tsx` (LIVE badge,
  progress bar, off-route/stale chips, trail-or-route map, 10s poll —
  upgraded to socket-first push in Module 20),
  `ShareLocation.tsx` (driver one-tap ping of the trip start — device-GPS
  wiring is future work — merged INTO `LiveTrack` in Module 20 and deleted),
  `TripCard` (driver console) + `BookingPanel`
  confirmed state (passenger) both embed `LiveTrack`.

## 5. Integration
Writes `locations` (M2 schema, no migration); flips trip status (M6 machine);
progress reuses M9 projection + M13 frac semantics. M18 safety reads the same
fixes; M20 upgrades polling to sockets without changing the audience rule.

## 6. Run + test (verified just now)
```powershell
cd backend
python -m pytest tests/test_tracking.py -v -p no:cacheprovider  # 3 passed
python -m pytest -q -p no:cacheprovider                          # 68 passed
```
Pure: midpoint frac ≈ 0.5, far point off-route >500m; 0.01°/60s ≈ 66 km/h;
zero-delta → None; stale boundaries. Live: empty live before first ping;
outsider 403, passenger ping 403, bad coords 422; first ping auto-starts;
second ping advances progress; trail count 2 newest-first.

## 7. Common errors
| Error | Fix |
|---|---|
| 403 on `/live` | you need an active booking (or be the driver) — cancelled riders lose access |
| 422 on `/ping` | trip is draft/completed/cancelled — only published/ongoing accept fixes |
| empty fix, stale true | driver has not pinged yet — expected before departure |
| `frac: null` | trip has no route geometry — run route refresh, progress needs a polyline |

## 8. Commit message
```
feat(tracking): driver pings + audience-scoped live view and trail

- services/tracking (pure progress/speed/stale) + tracking router
- first ping auto-starts published->ongoing; TTL-30d locations storage
- LiveTrack (10s poll) + ShareLocation in driver + passenger UI
- 3 new tests (pure + live), 68/68 green
```

## 9. SRS / report notes
- Sequence figure: driver ping → project → store → passenger poll → map, with
  the audience gate as a swim-lane guard and the auto-start transition marked.
- Privacy paragraph: audience-scoped reads, 30-day TTL, capped trails — raw
  GPS is ephemeral trip operations data, not a movement archive.
- Honest limitation: polling (not push) + manual share button (not device
  GPS) — Module 20 upgrades transport; the API contract already supports it.
