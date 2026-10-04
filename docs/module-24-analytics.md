# Module 24 — Impact analytics: sustainability, demand, evaluation

**Status:** VERIFIED · `pytest tests/test_analytics.py` 13/13 (12 pure + live
endpoints) · full suite green · `/analytics` page with personal impact for
everyone and platform panels for admins.

## 1. Concept / why
The synopsis's PROPOSED SYSTEM list ended with three items this project had not
built: **Demand Forecasting**, **Sustainability Analytics**, and **Model
Evaluation** ("MAE and RMSE … precision, recall and F1-score where matching
outcomes can be labelled"). This module builds all three from data the platform
already collects — no new collection, no new dependency, no new data source.

The hardest part was being honest about the counterfactual, which is where most
"carbon saved" claims go wrong. See §3.

## 2. Prerequisites
- Module 13 `segments` (they already record which bookings occupy which leg —
  the only honest basis for per-rider distance)
- Module 12 `cost_share` (frozen at completion) and vehicle `fuel_type` /
  `mileage_kmpl`
- Module 16's ranker artifact (for the offline AUC comparison)
- No new collection: the M2 index set is unchanged at 11 collections

## 3. Rules (services/analytics.py — pure, single source of truth)

### Sustainability — the counterfactual
The driver's own journey happens **in both worlds**, so it cancels out. What
sharing actually changes is:

- each rider's **separate car disappears** → one vehicle removed per rider;
- the driver's trip gains **only the pickup detours**.

So:
```
solo_km      = Σ rider_km(b)          # n separate journeys that would have happened
extra_km     = the detour the pickups cost the driver
km_avoided   = solo_km - extra_km
vehicles_avoided = number of riders
```
`rider_km` comes from the segments that list the booking in
`occupant_booking_ids`; if segments are missing we fall back to the booking's own
pickup→dropoff distance **on the same equirectangular ruler as M9/M10/M13**, and
the API says so in the response.

**Nothing is clamped.** A single rider with a 15 km detour and a 10 km leg yields
`vehicles_avoided = 1` but `km_avoided = −5` — one car genuinely removed, at a
net fuel cost. That case is pinned by a test rather than hidden, because it is
exactly the situation a reviewer should be suspicious of.

`unfavourable_riders` counts riders whose share cost **more** than going alone.
A sharing platform that quietly makes people worse off is not sharing.

CO₂ factors (kg per vehicle-km) are indicative direct-emission constants living
beside the module, the same way `SPEED_LIMIT_KMPH` (M18) and `OFF_ROUTE_M` (M17)
live in theirs: petrol 0.171, diesel 0.168, CNG 0.054, hybrid 0.100, **EV 0.0**.
EV is zero **by construction** — this counts tailpipe emissions only, and grid
intensity is a different question that we deliberately do not mix in.

### Demand
Departures are bucketed by `(weekday, hour)` — 168 slots — and predicted with a
**Laplace-shrunk mean** toward the global average: `(n + k·μ)/(n + k)`, k = 3.
A slot seen twice is pulled toward the average instead of being trusted, which
is the whole point of shrinking. `backtest()` splits **by day, never randomly**,
so no future information leaks backwards, and reports MAE + RMSE — the metrics
the synopsis names.

### Evaluation
A booking is a **positive** when the ride happened (`completed` / `confirmed`) and
a **negative** when it fell through (`rejected` / `cancelled`). Bookings still
open are excluded rather than counted as misses. For each score field we report
precision/recall/F1 at the **median score** (so the operating point comes from
the data, not from a hand-picked flattering threshold) plus **AUC** via the
rank-sum identity, which needs no dependency. Module 9's rule score and Module
16's AI score are reported **head to head** on the same bookings, so the report
can state whether the model actually beat the rules.

## 4. Code map — how the pieces connect
- `api/v1/analytics.py` gathers documents and shapes responses; all arithmetic
  is in the service. `_gather()` builds each ride's `riders[]` from segments,
  falling back to booking endpoints.
- `GET /impact`, `/demand`, `/evaluation` are **admin-only** (they describe the
  whole platform); `GET /me` is open to any logged-in user and scopes the same
  maths to rides they drove or rode.
- `/demand` hides the 168 bucket rows unless `?buckets=true` — a summary list is
  the useful default, not a table dump.
- Frontend: `lib/analytics.ts`, `/analytics` (personal impact for everyone;
  platform impact, busiest/thinnest slots, backtest MAE/RMSE and the
  rule-vs-AI table for admins), NavBar "Impact" link.
- **No new collection**, so M2's index set, `db_admin.COLLECTIONS`, the JSON
  schemas and the mongosh scripts are all untouched.

## 5. Integration
Read-only across M12/M13/M16 and the trips/vehicles collections. It is the
module that turns the platform's history into an argument — and it deliberately
reuses M13's segments rather than re-deriving per-rider distance, so the numbers
here and the per-leg costs in a receipt cannot disagree.

## 6. Run + test (verified)
```powershell
cd backend
python -m pytest tests/test_analytics.py -v -p no:cacheprovider  # 13 passed
```
Pure: exact impact arithmetic (18 km solo − 2 km detour = 16 km, 2 cars, CO₂ and
fuel to the digit); the one-rider/negative-km case; EV = 0 tailpipe vs petrol ≠ 0
and petrol ≠ diesel; `unfavourable_riders`; platform totals and the per-fuel
breakdown; bucket keys; shrinkage arithmetic; the 168-slot forecast shape;
MAE ≤ RMSE; `regression_metrics` on a known vector; AUC at 1.0 / 0.0 / 0.5-on-tie
and `None` for a single class; an exact confusion matrix; rule-vs-AI comparison;
and open bookings excluded from labelling. Live: six completed trips with
segments → 60 km avoided, 6 cars, exact CO₂; a non-admin gets 403 on the three
platform routes; `/demand` hides buckets by default and reveals 168 with
`?buckets=true`; the backtest has a real train/test split with MAE ≤ RMSE;
`/evaluation` labels 6 positives vs 1 negative at AUC 1.0; `/me` is open to a
plain user and correctly reports 0 for someone who neither drove nor rode.

## 7. Common errors
| Symptom | Meaning |
|---|---|
| `km_avoided` is negative | honest: the pickup detours cost more km than the riders saved. See §3. |
| `co2_avoided_kg` is 0 for EVs | by design — tailpipe only, no grid factor. |
| `auc` is `null` | every booking fell into one class, or none reached an outcome. AUC would be meaningless. |
| `/impact` returns 403 | it is admin-only; any signed-in user can use `/analytics/me` instead. |
| Backtest says "not enough history" | fewer than 4 departures — a real limitation of a small dataset, not a crash. |

## 8. Commit message
```
feat(analytics): sustainability, demand forecast and honest model evaluation

- counterfactual excludes the driver's own journey; nothing is clamped
- negative km_avoided and unfavourable_riders reported rather than hidden
- Laplace-shrunk (weekday, hour) forecast with a by-day backtest -> MAE/RMSE
- precision/recall/F1 + AUC for the M9 rule and M16 AI scores, head to head
- /impact, /demand, /evaluation (admin) + /me (everyone); 13 tests
```

## 9. SRS / report notes
- The counterfactual derivation is the report's key sustainability argument:
  *the driver travels either way; sharing removes one car per rider and costs
  only the detour.* State it before showing any carbon number.
- Model evaluation table for the report: offline AUC (labelled synthetic set,
  M16) **and** live AUC (real bookings, M24) side by side, with the selection
  bias stated rather than glossed.
- Honest limitations:
  - CO₂ factors are **indicative direct-emission constants**, not a
    region-specific inventory; grid intensity for EVs is deliberately excluded;
  - the demand forecast is a **shrunk-mean baseline**, not a trained model —
    with a demo-sized dataset anything fancier would be theatre;
  - evaluation is **retrospective and selection-biased** (we only see outcomes
    for matches that were booked), so it measures correlation, not causation;
  - "cost saved" assumes a rider's solo alternative is a private car at the
    vehicle's mileage — it excludes public transport, which would reduce the
    apparent saving;
  - only the newest 500 completed trips and 3 000 bookings are analysed.
