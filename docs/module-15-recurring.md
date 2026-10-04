# Module 15 — Recurring commute series

**Status:** VERIFIED · `pytest tests/test_recurring.py` 6/6 · daily / weekdays /
weekly series materialised as real trips.

## 1. Concept / why
Most carpool demand is not a one-off: it is the same corridor, the same time,
every working day. Modelling that as 20 separate trips is noise. This module
creates a **series** and materialises its instances as ordinary trip documents,
tagged with `recurring_group_id`.

**Option A was chosen deliberately:** each instance is a *real* trip, so search,
booking windows, cost, segments, tracking and safety work on it unchanged and
none of them need to know a series exists. The alternative (one trip with many
dates) would have required a rewrite of every downstream module.

## 2. Prerequisites
- Module 6 trips (an instance is a trip with the same route, seats and vehicle)
- Module 14 (`check_window`) — instances are only created inside the bookable
  window, so the two modules agree on what "bookable" means

## 3. Rules (services/recurring.py — pure, single source of truth)
- `RULES = ("daily", "weekdays", "weekly")` — anything else raises.
- `materialise_dates(rule, starts_on, stops_on, weekly_days, horizon_days, max_days)`
  returns **ordered `date` objects, inclusive of `starts_on`**:
  - `daily` — every day;
  - `weekdays` — Monday–Friday only, so a weekend ride is never created;
  - `weekly` — only the listed weekdays (`0=Mon … 6=Sun`); an empty list falls
    back to the base trip's own weekday.
- **Clamping order:** `stops_on` (inclusive) always wins over the horizon, and
  both are then capped by `max_days` (default 90). An end date before the start
  yields `[]` rather than a backwards range.

Dates are *dates*, not timestamps — the time of day is copied from the base trip
by the API, so a 07:00 commute stays a 07:00 commute.

## 4. Code map — how the pieces connect
- `recurring_groups` collection: one document per series (`group_id` unique,
  driver index), plus `trips.recurring_group_id` on every instance.
- `api/v1/recurring.py` — create series, list mine, materialise, stop. Creation
  copies route/geometry/seats/vehicle/policy from the base trip and calls
  `check_window()` per date.
- `services/recurring.describe()` — the UI label ("Weekdays · Mon–Fri",
  "Weekly · Mon, Thu").
- Indexes: `uq_recurring_group` on `group_id`, `ix_recurring_driver` on
  `(driver_id, active)`.
- Stopping a series is soft: `active=false`, so ride history stays intact for
  Modules 19 and 24.

## 5. Integration
Module 14 defines the bookable window; Module 15 instantiates inside it. The
admin trip board flags series instances with `recurring`, and Module 24's demand
forecast is precisely the analysis a series makes possible.

## 6. Run + test (verified)
```powershell
cd backend
python -m pytest tests/test_recurring.py -v -p no:cacheprovider  # 6 passed
```
Pure: daily enumeration, weekdays skipping the weekend, weekly on specific days,
`stops_on` beating the horizon, the `max_days` ceiling, an end-before-start
series yielding an empty list, an invalid rule raising, and the `describe()`
labels. Live: create → materialise → instances appear in `/trips/mine` with the
`recurring` flag → stop the series.

## 7. Common errors
| Symptom | Meaning |
|---|---|
| Series creates 0 trips | `stops_on` is before `starts_on`, or every date fell outside the booking window |
| Weekend instances missing | expected for the `weekdays` rule |
| `stops_on` ignored | it is honoured; the `max_days` ceiling may still be cutting the series short |
| Old instances still visible | stopping is soft — history is kept on purpose |

## 8. Commit message
```
feat(recurring): materialise daily/weekday/weekly series as real trips
```

## 9. SRS / report notes
- The three rules table plus the clamping order is the report's recurrence
  diagram.
- Design argument for the viva: materialising real trips (Option A) costs a
  little storage and buys complete reuse of eleven downstream modules.
- Honest limitations: instances are a **fixed snapshot** at creation time — a
  change to the base trip does not propagate to future instances; there is no
  automatic cancellation of a whole series when the driver cancels one leg; and
  no subscription/notification is sent to riders when a new instance appears.
