# Module 14 — Advance booking (the departure window)

**Status:** VERIFIED · `pytest tests/test_advance.py` 4/4 · per-trip policy on
`POST /trips/{id}/advance-policy`, enforced on booking creation.

## 1. Concept / why
A driver who leaves at 07:00 does not want a ride request at 06:55, and a trip
posted for next March is almost always a mistake. Both are arguments rather than
bugs, so the module turns them into **rules**:

```
opens_at  = depart_at - max_days_advance
closes_at = depart_at - min_notice_min
```

A trip is bookable only inside that window. This is the constraint that stops a
passenger from claiming the last seat two minutes before the car pulls away.

## 2. Prerequisites
- Module 6 trips (`depart_at`) and the trip `advance_policy` field
- Settings `ADVANCE_MAX_DAYS` / `ADVANCE_MIN_NOTICE_MIN` as the defaults

## 3. Rules (services/booking_window.py — pure, single source of truth)
- `normalise_policy(raw)` — coerces a missing/partial/hostile policy into the
  canonical shape, then **clamps** it: `max_days_advance` to `[1, 180]` and
  `min_notice_min` to `[0, 1440]`. A stored `0` or `99999` can never widen the
  window beyond reason.
- `window(depart_at, policy, now)` — returns `{opens_at, closes_at, policy}`.
- `check_window(...)` — returns `{bookable, reason, minutes_to_close,
  days_to_departure, window}` and **four ordered refusals**, each with a
  user-facing sentence that ends up verbatim in the ride card:
  1. departed already;
  2. too far ahead ("opens N days from now");
  3. inside the notice cut-off ("closed N min before departure");
  4. otherwise bookable, with the countdown to close.

The reason strings are returned rather than raised so the UI can disable the
button and explain itself instead of showing an error after the click.

## 4. Code map — how the pieces connect
- `POST /trips/{id}/advance-policy` — the driver sets their own policy, stored
  on the trip after `normalise_policy()`.
- Booking creation (`api/v1/bookings.py`) and search both call `check_window()`,
  so a trip can never be bookable in one place and not the other.
- `GET /trips/{id}/bookability` — exposes the verdict for the ride card.
- Schema: `trips.advance_policy` = `{max_days_advance, min_notice_min}`.
- Frontend: the ride card shows the countdown and disables the request button.

## 5. Integration
The first module to attach a *time* policy to a trip. Module 15 builds on it —
a recurring series is only materialised inside the same window, so the two agree
about what "bookable" means.

## 6. Run + test (verified)
```powershell
cd backend
python -m pytest tests/test_advance.py -v -p no:cacheprovider  # 4 passed
```
Pure: policy normalisation and clamping (including hostile values), the window
arithmetic, all four refusal branches, and the bookable case.

## 7. Common errors
| Symptom | Meaning |
|---|---|
| "booking opens 12.4 days from now" | correct — outside `max_days_advance` |
| "booking closed 5 min before departure" | inside the notice cut-off; a last-second request |
| Policy seems ignored | it was clamped on write; check the stored `advance_policy` |
| Trip bookable in search but not on the card | should be impossible — both call `check_window()` |

## 8. Commit message
```
feat(advance-booking): clamp the departure window and explain every refusal
```

## 9. SRS / report notes
- The two-sided window is the report's "advance booking" diagram.
- Fairness line: a driver sets the notice period themselves, so the same rule
  protects a commuter and a holiday traveller differently without extra config.
- Honest limitation: the window is a *policy*, not a guarantee — nothing stops a
  driver from cancelling after a booking is confirmed (Module 11), and there is
  no automatic re-match of the freed seat.
