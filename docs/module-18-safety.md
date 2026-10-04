# Module 18 — Safety net (SOS + auto speed/deviation alerts)

**Status:** VERIFIED · `pytest tests/test_safety.py` 3/3 (2 pure verdict units + live SOS/auto/ack flow) · SafetyBanner (SOS + open-alert feed + driver ack) in driver cards + passenger confirmed panel.

## 1. Concept / why
Safety is priority #1 in the project brief — above route, time, seats, and AI.
Module 18 makes that concrete with two mechanisms on the SAME `locations`
stream as tracking (no new storage, no new dependency): a **panic button**
(passenger or driver raises CRITICAL SOS) and **auto-detectors** (every ping
evaluates speed + route-deviation verdicts). Examiners get a clean story:
*detect → alert → acknowledge*, with severity ladders and dedupe rules stated
up front.

## 2. Prerequisites
- Module 17 tracking stream (`locations` + audience gate + ping hook point)
- `safety_alerts` collection + indexes from Module 2 (no migration)
- Trip lifecycle (alerts only on published/ongoing trips)

## 3. Detectors + severity ladder
- **Speed** (limit 80 km/h): margin +0–20 → medium, +20–40 → high, +40+ →
  critical. `None` speed (ShareLocation without GPS) never fires.
- **Deviation** (>500 m off route, shared `OFF_ROUTE_M` with tracking) →
  high. Unrouted trips (`off_route_m: null`) never fire — no geometry, no
  verdict.
- **SOS** → always critical, created with the latest fix as `point` (or null
  before the first ping) + `raised_by` in details.
- **Dedupe**: at most one OPEN alert per (trip, type) for auto-detectors —
  a 10s ping cadence cannot spam. SOS is NEVER deduped: every press is a cry
  for help and inserts its own row.

## 4. Code map - how the pieces connect
- `services/safety.py` (pure): `speed_verdict()` / `deviation_verdict()` —
  shared by the hook and the tests; thresholds are module constants.
- `api/v1/safety.py`: `auto_check(db, trip, lng, lat, speed)` (called from
  the tracking ping — lazy import in `tracking.py`, so no router cycle),
  `POST /sos` (audience-checked, booking optionally linked),
  `GET /trip/{id}` (audience feed, open-first, ≤50), `POST /{id}/ack`
  (driver of the trip or admin; open→acknowledged only).
- `api/v1/tracking.py`: ping response gains `alerts[]` (0–2 new alerts
  inline) so the driver app can flash them instantly.
- Frontend: `lib/safety.ts` (sos/trip/ack + severity colours),
  `SafetyBanner.tsx` (SOS input + button, open-count chip, top-5 alert list,
  driver-only Acknowledge, 10s poll in step with LiveTrack), wired into
  `TripCard` (driver, `isDriverForce`) and `BookingPanel` confirmed state
  (passenger).

## 5. Integration
Writes `safety_alerts` (M2 schema); reads `locations` latest fix for SOS
context. Admin (M21) resolves; notifications (M23) fan out on insert — both
consume this module's rows without changing them.

## 6. Run + test (verified just now)
```powershell
cd backend
python -m pytest tests/test_safety.py -v -p no:cacheprovider  # 3 passed
python -m pytest -q -p no:cacheprovider                          # 71 passed
```
Pure: speed ladder boundaries (80/90/105/130), deviation 500/501 boundary.
Live: speeding ping → 1 medium speed alert inline; repeat on-route ping →
deduped; off-route ping → deviation; 2 SOS presses → 2 critical rows; feed
open = 4 open-first; passenger ack 403, driver ack ok, double-ack 422.

## 7. Common errors
| Error | Fix |
|---|---|
| 403 on `/safety/trip` | same audience as live tracking — need an active booking or be the driver |
| 403 on ack | only the trip driver (or admin) acknowledges — passengers raise, drivers own |
| 422 on SOS | trip is draft/completed/cancelled — alerts only make sense mid-operation |
| no auto alert on fast ping | speed None never fires; deviation needs route geometry |

## 8. Commit message
```
feat(safety): SOS panic button + auto speed/deviation alerts

- services/safety verdicts + safety router (sos/feed/ack/auto_check)
- tracking ping hook returns new alerts inline (deduped per trip+type)
- SafetyBanner with SOS + severity feed in driver + passenger UI
- 3 new tests (pure + live), 71/71 green
```

## 9. SRS / report notes
- State-machine figure: open → acknowledged → resolved (resolve in M21),
  with auto-create and SOS-create as entry arrows and dedupe noted.
- Severity table (the ladder above) + the dedupe-vs-SOS contrast — shows
  judgement, not just code: spam protection for machines, none for humans.
- Honest limitation: no SMS/call escalation or admin push yet (M21/M23);
  alerts are in-app rows today, with the point + raised_by context ready.
